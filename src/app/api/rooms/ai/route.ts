import { createCustomStream, createProviderStream, parseOpenRouterError, sanitizeUpstreamError } from "@/lib/ai/openrouter";
import { isValidModelId } from "@/lib/ai/models";
import { resolveRequestAuth } from "@/lib/ai/request-auth";
import { HEADER_API_MODE, HEADER_OPENROUTER_KEY } from "@/lib/ai/request-headers";
import { loadHostKey } from "@/lib/rooms/host-key-store";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import type { ChatCompletionMessage } from "@/lib/ai/types";
import { isValidRoomId, isValidMemberToken } from "@/lib/rooms/access";
import { resolveAiAccess } from "@/lib/rooms/server";

export const runtime = "nodejs";

/**
 * POST /api/rooms/ai — asks the model a question about the room.
 *
 * ## What this route does and does not know
 *
 * It receives the room transcript **already decrypted**. That is not a leak in the design:
 * the server holds ciphertext and never has the room key, so only the browser can build
 * this body. The plaintext passes through here in memory on its way to the provider, which
 * is the same path every private chat message already takes.
 *
 * Two consequences follow, and both are load-bearing:
 *
 *   1. **Nothing here reads the host's memory or chat history.** The request is assembled
 *      in `lib/rooms/ai-bridge.ts`, which cannot import those modules. This route only
 *      forwards. That is what keeps section 1 of the design true, and it is asserted by a
 *      test against the bridge rather than by anything in this file.
 *   2. **Nothing here writes the body anywhere.** No log line, no database column, no
 *      analytics. The transcript is not persisted by this route; the answer is posted back
 *      to the room as a normal encrypted message by the caller, which is the only place
 *      room content is ever stored.
 *
 * ## Who may call this
 *
 * The host and members they promoted to `trusted`. A `guest` is refused with 403 even
 * though they can read everything the model reads. That is the host's money, and the
 * design puts the model behind the host's trust.
 */

const MAX_MESSAGES = 60;
const MAX_QUESTION = 4_000;
const ROOM_AI_REQUESTS_PER_MINUTE = 10;

function isValidTurn(
  value: unknown,
): value is { alias: string | null; body: string; isAi: boolean } {
  if (!value || typeof value !== "object") return false;
  const turn = value as { alias?: unknown; body?: unknown; isAi?: unknown };
  return (
    (turn.alias === null || typeof turn.alias === "string") &&
    typeof turn.body === "string" &&
    turn.body.length > 0 &&
    turn.body.length <= MAX_QUESTION &&
    typeof turn.isAi === "boolean"
  );
}

/** Reads the assistant text out of an SSE stream without buffering the whole thing. */
async function readSingleCompletion(upstream: Response): Promise<string> {
  const body = upstream.body;
  if (!body) return "";

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line. A partial one stays in the buffer rather
      // than being parsed half-read.
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";

      for (const frame of frames) {
        const line = frame.split("\n").find((entry) => entry.startsWith("data:"));
        if (!line) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as {
            choices?: { delta?: { content?: string }; message?: { content?: string } }[];
          };
          const choice = parsed.choices?.[0];
          out += choice?.delta?.content ?? choice?.message?.content ?? "";
        } catch {
          // A malformed frame is not a reason to fail an answer that is already arriving.
        }
      }
    }
  } finally {
    // Cancelled either way: an unread stream would hold the upstream connection open.
    await reader.cancel().catch(() => undefined);
  }

  return out.trim();
}

export async function POST(request: Request) {
  const roomId = new URL(request.url).searchParams.get("roomId") ?? "";
  const memberToken = request.headers.get("x-room-member") ?? "";

  // Shape first, so a malformed request never reaches the database.
  if (!isValidRoomId(roomId) || !isValidMemberToken(memberToken)) {
    return Response.json({ error: "This invite is not valid", code: "INVITE_INVALID" }, { status: 404 });
  }

  // Membership before anything else. A stranger must not learn that a room exists by
  // timing a refusal.
  let access;
  try {
    access = await resolveAiAccess({ roomId, memberToken });
  } catch {
    return Response.json({ error: "The room is unavailable" }, { status: 503 });
  }

  if (!access) {
    // The same refusal as a bad link, for the same reason: this endpoint must not be
    // usable to discover which room ids exist.
    return Response.json({ error: "This invite is not valid", code: "INVITE_INVALID" }, { status: 404 });
  }
  if (!access.mayInvokeModel) {
    return Response.json(
      { error: "Only the host and members they trust can ask the model", code: "AI_NOT_ALLOWED" },
      { status: 403 },
    );
  }

  // ## Where the key comes from (section 5, Options A and B)
  //
  // A key in the request header is Option A: the host's own tab is present and signing. A
  // key opened from `host_ai_keys` is Option B: the host chose to let the room answer
  // without them. Both end up here, and neither is written to a log.
  //
  // Option B is only consulted when the header is absent, so it can never *replace* a key
  // the host is actively using — which also means a host who revokes their stored key while
  // online sees no change until they leave.
  const auth = await resolveKey(request, access);
  if (!auth) {
    return Response.json(
      {
        error:
          "The model needs the host's key. They are not here and no key is stored for this room.",
        code: "KEY_REQUIRED",
      },
      { status: 401 },
    );
  }

  // The model and provider come from the room row, never from the request.
  //
  // The host chose these when they opened the room — which is why `rooms.sql` stores them in
  // the clear with the comment "the server needs them to pick a model without asking the
  // host's device for anything". Every member therefore gets the model the host picked, and
  // a caller-supplied model would let anyone bill the host for a price they never agreed to.
  const model = access.aiModel?.trim() ?? "";
  if (!model || model.length > 200 || !isValidModelId(model)) {
    return Response.json({ error: "This room has no usable model configured" }, { status: 400 });
  }

  // The provider is likewise the room's. A body or header that names a different one would
  // route the host's key somewhere they did not choose, so the room's value wins outright.
  const provider = access.aiProvider?.trim() ?? "openrouter";

  const body = (await request.json().catch(() => null)) as {
    messages?: unknown;
    question?: unknown;
  } | null;

  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!body || !question || question.length > MAX_QUESTION || messages.length === 0) {
    return Response.json({ error: "A question and the room transcript are required" }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES || !messages.every(isValidTurn)) {
    return Response.json({ error: "The room transcript is not valid" }, { status: 400 });
  }

  // Tighter than the private chat's limiter, because here every call is the host's money
  // and a member can make several in a row.
  const limiter = checkRateLimit(`room:${roomId}`, ROOM_AI_REQUESTS_PER_MINUTE);
  if (!limiter.allowed) {
    return Response.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  // Forwarded as built. This route cannot add context, because it imports nothing that
  // could carry any.
  const prompt = buildPrompt(messages as RoomTurn[], question, access.role);

  try {
    // The room's provider decides where the request goes. `custom` needs the base URL the
    // host configured in Settings, which arrives per-request and is validated by
    // `resolveRequestAuth` before it is used — the room never stores a URL of its own.
    const upstream =
      provider === "custom" && auth.baseUrl
        ? await createCustomStream(auth.baseUrl, model, prompt, auth.apiKey)
        : await createProviderStream(
            (provider as Parameters<typeof createProviderStream>[0]),
            model,
            prompt,
            auth.apiKey,
          );

    if (!upstream.ok) {
      const detail = await parseOpenRouterError(upstream);
      return Response.json({ error: sanitizeUpstreamError(detail) }, { status: upstream.status });
    }

    const answer = await readSingleCompletion(upstream);
    if (!answer) {
      return Response.json({ error: "The model did not return an answer" }, { status: 502 });
    }
    // The answer goes to the caller, who encrypts it into the room like any other message.
    // This route never writes room content anywhere.
    return Response.json({ answer, role: access.role });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reach the provider";
    return Response.json({ error: sanitizeUpstreamError(message) }, { status: 500 });
  }
}

interface RoomTurn {
  alias: string | null;
  body: string;
  isAi: boolean;
}

/**
 * Resolves the key that will sign this request, or null when there is none.
 *
 * Order is Option A then Option B, and the order is the whole design:
 *
 *   1. A key in the request header. The host's tab is present, holding their own key, and it
 *      is used without the server ever seeing it stored.
 *   2. Failing that, the host's stored key, opened per request and discarded. This is what
 *      lets the model keep answering after they close their laptop, which is the reason
 *      Option B exists at all.
 *
 * Option B is deliberately last rather than first. A host who is online has the key in hand,
 * and using theirs means a change to their stored key takes effect the next time they are
 * absent — never a stale stored key silently overriding the one they are actually using.
 *
 * Returns null rather than throwing when there is no key, so the route can answer 401 with a
 * sentence a guest can act on.
 */
async function resolveKey(
  request: Request,
  access: { keyMode: string | null; roomOwnerId: string | null },
): Promise<ReturnType<typeof resolveRequestAuth> | null> {
  if (request.headers.get(HEADER_OPENROUTER_KEY)?.trim()) {
    // Throws when the header is present but unusable — an over-long key, or a custom
    // provider with no URL. That is a real client error and is surfaced as one, not
    // swallowed into "no key" and turned into a misleading 401.
    return resolveRequestAuth(request);
  }

  if (access.keyMode !== "server" || !access.roomOwnerId) return null;

  // The stored key is only opened for the room's own host, so one host's credential can
  // never sign another host's room. `loadHostKey` sweeps an expired row on the way past,
  // which is what makes the host's "deleted after N days" a fact rather than a promise.
  const stored = await loadHostKey(access.roomOwnerId);
  if (!stored) return null;

  // Re-sign the request with the stored key so the rest of this route, and the provider
  // dispatch below, are identical whichever option supplied it. One code path means the
  // room cannot behave differently depending on who happened to be online.
  const headers = new Headers(request.headers);
  headers.set(HEADER_OPENROUTER_KEY, stored.key);
  headers.set(HEADER_API_MODE, "byok");
  return resolveRequestAuth(new Request(request.url, { method: "POST", headers }));
}

/**
 * Assembles the provider prompt.
 *
 * Mirrors `buildRoomRequest` rather than importing it, on purpose. The bridge is a browser
 * module whose import wall is the thing being protected; a server-side import would create
 * a path for someone to later "just add memory context" here, on the server, where the
 * bridge's test no longer looks. Keeping the two independent means a change to one is a
 * change the tests have to reconcile.
 *
 * `ai-route.test.ts` asserts the shapes match, so they cannot drift apart unnoticed.
 */
function buildPrompt(
  turns: RoomTurn[],
  question: string,
  role: string,
): ChatCompletionMessage[] {
  const participants = new Set(turns.map((turn) => turn.alias ?? ""));
  const who = (turn: RoomTurn) => turn.alias?.trim().slice(0, 40) || "A participant";

  return [
    {
      role: "system",
      content: [
        "You are taking part in a group brainstorming session.",
        `There are ${participants.size} participant(s) in the room.`,
        `The member asking is the ${role} of this room.`,
        "Answer only from the conversation above. Everything you were told about this room is in this message.",
        "If the room has not given you enough to answer, say what is missing and ask for it rather than guessing.",
        "Do not invent facts about the participants, the company, or anything outside this conversation.",
      ].join(" "),
    },
    ...turns.map((turn): ChatCompletionMessage => ({
      role: turn.isAi ? "assistant" : "user",
      content: `${who(turn)}: ${turn.body.trim().slice(0, MAX_QUESTION)}`,
    })),
    { role: "user", content: question },
  ];
}


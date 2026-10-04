import { createCustomStream, createProviderStream, parseOpenRouterError, sanitizeUpstreamError } from "@/lib/ai/openrouter";
import { isValidModelId } from "@/lib/ai/models";
import { resolveRequestAuth } from "@/lib/ai/request-auth";
import { HEADER_API_MODE, HEADER_OPENROUTER_KEY } from "@/lib/ai/request-headers";
import { loadHostKey } from "@/lib/rooms/host-key-store";
import { checkRateLimit } from "@/lib/ai/rate-limit";
import type { ChatCompletionMessage } from "@/lib/ai/types";
import { isValidRoomId, isValidMemberToken } from "@/lib/rooms/access";
import { recordRoomAiUsage, resolveAiAccess, resolveModelTarget } from "@/lib/rooms/server";

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

/**
 * The largest transcript this route will accept.
 *
 * Equal to `ROOM_CONTEXT_MESSAGES` in `lib/rooms/ai-bridge`, and asserted equal in
 * `__tests__/context-window.test.ts`.
 *
 * These were two independent numbers — 60 here, 40 there — with nothing connecting them.
 * `readMessages` returns a hundred messages, the page sent all of them, and this cap turned
 * every room past sixty into a 400: "Ask the model" failed outright once a conversation got
 * long. The bridge's own bound was never applied, because the page does not call the bridge —
 * it builds the request here. So the two places that decide how much context a question
 * carries have to agree, and a test now makes them.
 */
const MAX_MESSAGES = 40;
const MAX_QUESTION = 4_000;
const ROOM_AI_REQUESTS_PER_MINUTE = 10;

function isValidTurn(
  value: unknown,
): value is {
  alias: string | null;
  body: string;
  isAi: boolean;
  modelLabel?: string | null;
  modelSpecialty?: string | null;
} {
  if (!value || typeof value !== "object") return false;
  const turn = value as {
    alias?: unknown;
    body?: unknown;
    isAi?: unknown;
    modelLabel?: unknown;
    modelSpecialty?: unknown;
  };
  // Attribution is optional and, when present, must be a string or null. It is deliberately
  // *not* required on an `ai` turn: rooms whose host offered no role carry no attribution, and
  // the prompt builder handles that rather than the request being refused for it.
  const optionalText = (field: unknown) =>
    field === undefined || field === null || typeof field === "string";
  return (
    (turn.alias === null || typeof turn.alias === "string") &&
    typeof turn.body === "string" &&
    turn.body.length > 0 &&
    turn.body.length <= MAX_QUESTION &&
    typeof turn.isAi === "boolean" &&
    optionalText(turn.modelLabel) &&
    optionalText(turn.modelSpecialty)
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
    // The two kinds fail differently and must not share a sentence.
    //
    // Telling a panel member "the model needs the host's key" would name a key they may not
    // use and invite them to go and ask the host for it — reintroducing by way of an error
    // message the exact sharing section 5 exists to prevent. In a panel room the only key that
    // works is the member's own, so that is what the refusal has to say.
    const panel = access.roomKind === "panel";
    return Response.json(
      {
        error: panel
          ? "Ask this room with your own key. This room never spends the host's."
          : "The model needs the host's key. They are not here and no key is stored for this room.",
        code: panel ? "PANEL_KEY_REQUIRED" : "KEY_REQUIRED",
      },
      { status: 401 },
    );
  }

  // ## Which model answers
  //
  // **The caller's own model, whenever they have one — in either kind of room.**
  //
  // This used to be gated on `roomKind === "panel"`, which meant a signed-in member of an
  // ordinary guest room was answered by the host's model instead of their own: their key would
  // have paid for it, and they would have been told a model they never registered was speaking.
  // A room is a conversation, and a member who brought a model has asked to be answered by it.
  //
  // The room's own model remains the fallback for a caller with no registration, which is what
  // keeps an ordinary room working for the guest who never signed in — and who therefore has no
  // key and no model to bring.
  //
  // Never from the request body. A caller-supplied model would let any member spend their key on
  // a model they never agreed to run, which is the same abuse as paying for it with somebody
  // else's key.
  // The provider is likewise the room's. A body or header that names a different one would
  // route the host's key somewhere they did not choose, so the room's value wins outright.
  const provider = access.aiProvider?.trim() ?? "openrouter";

  const body = (await request.json().catch(() => null)) as {
    messages?: unknown;
    question?: unknown;
    specialty?: unknown;
    /** Names a model somebody else brought. See the addressing block below. */
    modelSlot?: unknown;
  } | null;

  // ## Addressing a model by name
  //
  // A `modelSlot` in the body names a model **somebody else brought**. In a panel this is
  // the normal case: the host and every member may ask any model in the room, and the model
  // that answers is the owner's, paid for by the owner, inside the owner's own budget.
  //
  // Without a slot this resolves to the caller's own model, or failing that to the room's.
  // So an ordinary room with one host model behaves exactly as it always has, and a member who
  // pressed ask with no choice gets their own.
  const slot = typeof body?.modelSlot === "string" ? body.modelSlot.trim() : "";
  const addressed = slot
    ? await resolveModelTarget({ roomId, slot, onRequest: true })
    : null;

  const model =
    addressed?.modelId.trim() || access.callerModel?.modelId?.trim() || access.aiModel?.trim() || "";

  if (!model || model.length > 200 || !isValidModelId(model)) {
    if (!access.callerModel && !access.aiModel) {
      // No model of their own and no room model. In a panel this means they never registered
      // one; in a guest room it means the host never configured the room's.
      return Response.json(
        access.roomKind === "panel"
          ? {
              error: "Bring a model to ask this room. You have not registered one.",
              code: "PANEL_MODEL_REQUIRED",
            }
          : { error: "This room has no usable model configured" },
        { status: access.roomKind === "panel" ? 403 : 400 },
      );
    }
    return Response.json({ error: "This room has no usable model configured" }, { status: 400 });
  }




  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!body || !question || question.length > MAX_QUESTION || messages.length === 0) {
    return Response.json({ error: "A question and the room transcript are required" }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES || !messages.every(isValidTurn)) {
    return Response.json({ error: "The room transcript is not valid" }, { status: 400 });
  }

  // The role this question is asked under, if the room offers any.
  //
  // A role the host did not offer is dropped rather than refused. Refusing would make a room
  // with a stale client unable to ask anything at all, and a role nobody offered carries no
  // promise that the question is refused — it only fails to be attributed, which is the
  // honest outcome. The room row stays the authority: this never invents a role.
  //
  // Whenever the caller registered a model, the answer is already settled: they registered it
  // *with* a role, and asking under a different one would let a member answer as the critic
  // while being billed as the marketer. The registration is the authority, in either kind of
  // room — a member model is a member model wherever it is brought.
  const acceptedSpecialty = addressed?.specialty || access.callerModel?.specialty || resolveSpecialty(body?.specialty, access.aiSpecialties);

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

    // Recorded here, after the provider answered, so a failed call is not counted as though it
    // had cost the host something. This is what makes the host's spend panel possible at all:
    // without it a `trusted` member can spend the host's key up to the rate limit above and the
    // host has no way to notice.
    //
    // Awaited rather than fire-and-forget, and it never throws. Returning before the write lands
    // would also be fine, but awaiting keeps the ordering predictable when a host opens the
    // panel straight after asking a question.
    await recordRoomAiUsage({ roomId, memberToken, model });

    // The answer goes to the caller, who encrypts it into the room like any other message.
    // This route never writes room content anywhere.
    //
    // `modelLabel` is sent back so the caller can attribute the row it is about to write. It
    // is not a secret — it is the room's own model, already named on the room row — but
    // deriving it here rather than in the browser keeps the prompt and the attribution from
    // being able to disagree about which model answered.
    return Response.json({
      answer,
      role: access.role,
      modelLabel: model,
      modelSpecialty: acceptedSpecialty,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to reach the provider";
    return Response.json({ error: sanitizeUpstreamError(message) }, { status: 500 });
  }
}

/**
 * Returns the requested role only when the host actually offers it.
 *
 * Matching is exact rather than case-insensitive: the list is rendered as a fixed control,
 * so a member sends back one of the strings the server itself sent, and a near-miss is a
 * stale client rather than an attempt to invent a role.
 */
function resolveSpecialty(requested: unknown, offered: string[] | null): string | null {
  if (typeof requested !== "string") return null;
  const trimmed = requested.trim();
  if (!trimmed || trimmed.length > 60) return null;
  if (!Array.isArray(offered) || offered.length === 0) return null;
  return offered.includes(trimmed) ? trimmed : null;
}

interface RoomTurn {
  alias: string | null;
  body: string;
  isAi: boolean;
  /**
   * Attribution on an `ai` turn. Carried so the prompt can name the model the room is
   * already talking to, and so a room with several models reads as several speakers.
   *
   * Ignored on a human turn: a member's message body is never promoted to an attribution,
   * which is what would let one member write in a model's voice.
   */
  modelLabel?: string | null;
  modelSpecialty?: string | null;
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
  access: {
    keyMode: string | null;
    roomOwnerId: string | null;
    roomKind: "guest" | "panel";
    callerModel: { modelId: string } | null;
  },
): Promise<ReturnType<typeof resolveRequestAuth> | null> {
  if (request.headers.get(HEADER_OPENROUTER_KEY)?.trim()) {
    // Throws when the header is present but unusable — an over-long key, or a custom
    // provider with no URL. That is a real client error and is surfaced as one, not
    // swallowed into "no key" and turned into a misleading 401.
    return resolveRequestAuth(request);
  }

  // ## A panel room has no stored key to fall back to
  //
  // This is section 5 of `panel-rooms-proposal.md` made executable:
  //
  // > No one spends someone else's key. Whoever invokes a model invokes it with their own.
  //
  // A **guest room** host may have chosen Option B, which stores their key so the room answers
  // while they are away. That is the host's own consent, given deliberately, and it extends to
  // the members they promoted to `trusted` — that promotion is the host handing over their key,
  // and it is the whole of section 4's quota control.
  //
  // I widened this to "any caller with a registered model" and was wrong. A member who brings
  // their own model in a guest room is a `trusted` member the host authorised, not someone the
  // host's key was stolen from. Reverted: the guard is on the room kind, not on the caller.
  //
  // In a **panel** room it stays closed. There every model belongs to the member who registered
  // it and pays with that member's key, so a stored host key would be the one credential in the
  // room that belongs to nobody present — and adding a reach for it later would break section 5
  // rather than extend the feature.
  if (access.roomKind === "panel") {
    return null;
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
    ...turns.map((turn): ChatCompletionMessage => {
      const body = turn.body.trim().slice(0, MAX_QUESTION);
      if (turn.isAi) {
        // The model's own answers keep the assistant role and drop the participant name.
        //
        // This was a real defect: the mapping below labelled every turn "Name: body", and an
        // `ai` turn carries no name, so the model read its own earlier answers as something a
        // participant said. The browser bridge already got this right; this route had not
        // caught up.
        const label = (turn.modelLabel ?? "").trim().slice(0, 40);
        const specialty = (turn.modelSpecialty ?? "").trim().slice(0, 40);
        return {
          role: "assistant",
          content: label ? `[${label}${specialty ? ` — ${specialty}` : ""}]\n${body}` : body,
        };
      }
      return { role: "user", content: `${who(turn)}: ${body}` };
    }),
    { role: "user", content: question },
  ];
}


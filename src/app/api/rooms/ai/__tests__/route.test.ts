import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 4 of docs/group-rooms-design.md: the room AI route.
 *
 * Three properties are asserted here, and all three are things a reviewer cannot confirm by
 * reading the happy path:
 *
 *   1. A `guest` cannot invoke the model, even though they are a full member of the room.
 *   2. A stranger learns nothing, including whether the room exists.
 *   3. The plaintext transcript is never logged or persisted by this route.
 *
 * The third is the one that changes with the architecture. Because the server holds only
 * ciphertext, the decrypted transcript has to reach the route to be forwarded — which means
 * the room's contents pass through the server in the clear, in memory. That is acceptable
 * and matches what every private chat message already does, but it makes "do not log it" a
 * property that must be checked rather than assumed.
 */

const resolveAiAccess = vi.fn();
const recordRoomAiUsage = vi.fn(async (_input: { roomId: string; memberToken: string; model: string }) => undefined);
const resolveRequestAuth = vi.fn();
const createProviderStream = vi.fn();
const checkRateLimit = vi.fn();

// `server-only` is a build-time marker with no runtime export. The routes under test import
// modules that carry it, so it is stubbed here rather than installed as a dependency.
vi.mock("server-only", () => ({}));

vi.mock("@/lib/rooms/server", () => ({
  resolveAiAccess: (...args: unknown[]) => resolveAiAccess(...args),
  // The spend record. Mocked to a resolved no-op so these tests can keep asserting what the
  // route *returns* without a database; `spend.test.ts` covers the recording itself. The
  // parameter is an object, matching `recordRoomAiUsage` in `server.ts`.
  recordRoomAiUsage: (input: { roomId: string; memberToken: string; model: string }) =>
    recordRoomAiUsage(input),
}));
const loadHostKey = vi.fn();

// Option B: the stored key. Mocked rather than exercised here, because opening a real one
// needs the master secret and a database; `host-key.test.ts` covers the envelope itself, and
// `host-key-store.test.ts` covers expiry. What matters here is which one gets chosen.
vi.mock("@/lib/rooms/host-key-store", () => ({
  loadHostKey: (...args: unknown[]) => loadHostKey(...args),
}));

vi.mock("@/lib/ai/request-auth", () => ({
  resolveRequestAuth: (...args: unknown[]) => resolveRequestAuth(...args),
}));
vi.mock("@/lib/ai/openrouter", () => ({
  createProviderStream: (...args: unknown[]) => createProviderStream(...args),
  createCustomStream: vi.fn(),
  parseOpenRouterError: async () => "upstream failed",
  sanitizeUpstreamError: (message: string) => message,
}));
vi.mock("@/lib/ai/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
}));

import { POST } from "../route";

const ROOM = "7K9P2X";
const TOKEN = "a".repeat(64);

/**
 * The provider and model the *host* chose when they opened the room.
 *
 * These come back from `resolveAiAccess`, which reads the `rooms` row. That is the whole
 * point: the model is a property of the room, not of whoever happens to be asking. A test
 * that picked its own model id would be asserting against a fiction — the caller has no
 * say here, so the test must not pretend it does.
 */
const ROOM_PROVIDER = "openrouter";
const ROOM_MODEL = "openai/gpt-4o";

function access(overrides: Record<string, unknown> = {}) {
  return {
    role: "host",
    mayInvokeModel: true,
    aiProvider: ROOM_PROVIDER,
    aiModel: ROOM_MODEL,
    keyMode: "browser",
    roomOwnerId: "host-account-uuid",
    ...overrides,
  };
}

/** A minimal SSE body, which is what every provider returns here. */
function sse(chunks: string[]): Response {
  const body = chunks
    .map((text) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)
    .join("");
  return new Response(body + "data: [DONE]\n\n", { status: 200 });
}

function request(body: unknown = { question: "Q", messages: [{ alias: "Yara", body: "hi", isAi: false }] }) {
  return new Request(`http://localhost/api/rooms/ai?roomId=${ROOM}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-room-member": TOKEN,
      "x-openrouter-key": "sk-host-key-abcdefghijklmnop",
      // A caller trying to name its own model. The route must ignore it; see the "host's
      // choice" tests below.
      "x-ai-provider": "anthropic",
      "x-ai-model": "anthropic/claude-opus-4",
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveRequestAuth.mockReturnValue({
    apiKey: "sk-host-key-abcdefghijklmnop",
    mode: "byok",
    isUserKey: true,
    provider: "openrouter",
  });
  checkRateLimit.mockReturnValue({ allowed: true, retryAfterSeconds: 0 });
  createProviderStream.mockResolvedValue(sse(["Ship ", "Monday."]));
  loadHostKey.mockResolvedValue(null);
});

describe("only the host and members they trust can spend their money", () => {
  it("refuses a guest, even though the guest is a full member of the room", async () => {
    // The design's decision is explicit: `trusted` may invoke the model, `guest` may not,
    // until granted. A guest reads everything the model reads and still cannot spend the
    // host's key, because the host chooses who can.
    resolveAiAccess.mockResolvedValue(access({ role: "guest", mayInvokeModel: false }));

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("AI_NOT_ALLOWED");
    // And it never reaches the provider, so it never costs anything.
    expect(createProviderStream).not.toHaveBeenCalled();
  });

  it("allows the host", async () => {
    resolveAiAccess.mockResolvedValue(access());

    expect((await POST(request())).status).toBe(200);
    expect(createProviderStream).toHaveBeenCalledOnce();
  });

  it("allows a trusted member", async () => {
    resolveAiAccess.mockResolvedValue(access({ role: "trusted" }));

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect((await response.json()).role).toBe("trusted");
  });
});

describe("a stranger learns nothing about the room", () => {
  it("is refused the same way as a bad link, so the endpoint cannot enumerate rooms", async () => {
    resolveAiAccess.mockResolvedValue(null);

    const response = await POST(request());

    // The identical body and status a malformed room id produces. A different status or a
    // different message here would turn this endpoint into a room-existence oracle.
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("INVITE_INVALID");
    expect(createProviderStream).not.toHaveBeenCalled();
  });

  it("refuses a malformed room id before touching the database", async () => {
    const bad = new Request("http://localhost/api/rooms/ai?roomId=lowercase", {
      method: "POST",
      headers: { "x-room-member": TOKEN },
    });

    expect((await POST(bad)).status).toBe(404);
    // Shape is checked first so a malformed request is never used as a probe.
    expect(resolveAiAccess).not.toHaveBeenCalled();
  });

  it("refuses a missing member token", async () => {
    const noToken = new Request(`http://localhost/api/rooms/ai?roomId=${ROOM}`, {
      method: "POST",
      headers: { "x-openrouter-key": "sk-host-key-abcdefghijklmnop" },
    });

    expect((await POST(noToken)).status).toBe(404);
    expect(resolveAiAccess).not.toHaveBeenCalled();
  });
});

describe("the plaintext transcript is never written anywhere", () => {
  it("never calls console, which is what a request log would capture", async () => {
    // The transcript reaches this route in the clear — the server has the room key only in
    // the browser — so this is the one place it could plausibly end up in a log file. Every
    // console method is spied on, because a route that logs its own input is an ordinary
    // mistake, not a deliberate one.
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    resolveAiAccess.mockResolvedValue(access());

    try {
      const response = await POST(
        request({
          question: "What did we decide about the pricing?",
          messages: [{ alias: "Yara", body: "CONFIDENTIAL-pricing-secret", isAi: false }],
        }),
      );
      expect(response.status).toBe(200);

      for (const spy of spies) {
        const written = spy.mock.calls.flat().map(String).join(" ");
        expect(written, "a console call captured the room transcript").not.toContain(
          "CONFIDENTIAL-pricing-secret",
        );
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("writes nothing over the network, so the answer is stored only as a room message", async () => {
    // The design puts room content in `room_messages` as ciphertext and nowhere else. A
    // route that persisted the prompt would create a second, clearer copy of the room.
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    // Any supabase call would go out over fetch; a route that wrote would use it.
    globalThis.fetch = (async (input: string | URL) => {
      calls.push(String(input));
      return sse(["ok"]);
    }) as typeof fetch;

    resolveAiAccess.mockResolvedValue(access());
    try {
      await POST(
        request({
          question: "Q",
          messages: [{ alias: "Yara", body: "CONFIDENTIAL-pricing-secret", isAi: false }],
        }),
      );
      expect(calls.join(" ")).not.toContain("supabase");
      expect(calls.join(" ")).not.toContain("CONFIDENTIAL-pricing-secret");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("the model is the host's choice, not the caller's", () => {
  it("uses the model the host chose when they opened the room", async () => {
    // `rooms.sql` stores `ai_provider` and `ai_model` with the comment "the server needs
    // them to pick a model without asking the host's device for anything". This is that
    // comment being true.
    resolveAiAccess.mockResolvedValue(access());

    await POST(request());
    const [provider, model] = createProviderStream.mock.calls[0] as [string, string];

    expect(provider).toBe(ROOM_PROVIDER);
    expect(model).toBe(ROOM_MODEL);
  });

  it("ignores a header that names a different provider and model", async () => {
    // The `request` helper deliberately sends both, and they are not what the host picked.
    // A member able to redirect the room's key to another provider would be a far worse
    // problem than a member able to pick a pricier model on the same one.
    resolveAiAccess.mockResolvedValue(access());

    const response = await POST(request());

    expect(response.status).toBe(200);
    const [provider, model, messages] = createProviderStream.mock.calls[0] as [
      string,
      string,
      { content: string }[],
    ];
    expect(provider).not.toBe("anthropic");
    expect(model).not.toBe("anthropic/claude-opus-4");
    expect(JSON.stringify(messages)).not.toContain("claude-opus");
  });

  it("ignores a model smuggled in the body", async () => {
    resolveAiAccess.mockResolvedValue(access());

    const response = await POST(
      request({
        question: "Q",
        model: "anthropic/claude-opus-4",
        messages: [{ alias: "Y", body: "hi", isAi: false }],
      }),
    );

    expect(response.status).toBe(200);
    const [, model] = createProviderStream.mock.calls[0] as [string, string];
    expect(model).toBe(ROOM_MODEL);
  });

  it("refuses when the room has no model configured", async () => {
    // A room opened without a model cannot answer, and saying so beats calling the provider
    // with something invented.
    resolveAiAccess.mockResolvedValue(access({ aiModel: null }));

    expect((await POST(request())).status).toBe(400);
    expect(createProviderStream).not.toHaveBeenCalled();
  });
});

describe("the answer comes back whole", () => {
  it("reassembles a streamed answer across frames", async () => {
    // Providers stream. A route that read only the first frame would show a truncated
    // answer and charge the host for the full one.
    resolveAiAccess.mockResolvedValue(access());
    createProviderStream.mockResolvedValue(sse(["Not ", "on ", "Friday. ", "Ship Monday."]));

    expect((await (await POST(request())).json()).answer).toBe("Not on Friday. Ship Monday.");
  });

  it("reports an empty answer rather than posting a blank message", async () => {
    resolveAiAccess.mockResolvedValue(access());
    createProviderStream.mockResolvedValue(new Response("data: [DONE]\n\n", { status: 200 }));

    expect((await POST(request())).status).toBe(502);
  });
});

describe("the prompt tells the model the room is all it knows", () => {
  it("states the no-outside-knowledge rule and the asker's role", async () => {
    // The system prompt is the second layer of defence. The import wall is the first, but
    // if this ever changes it should say so out loud rather than quietly widening.
    resolveAiAccess.mockResolvedValue(access({ role: "trusted" }));

    await POST(request());
    const [, , messages] = createProviderStream.mock.calls[0] as [
      string,
      string,
      { role: string; content: string }[],
    ];
    const system = messages[0];

    expect(system.role).toBe("system");
    expect(system.content).toContain("Answer only from the conversation above");
    expect(system.content).toContain("the trusted of this room");
    expect(system.content).toContain("Do not invent facts");
  });

  it("keeps the model's earlier answers as the assistant, not as a member", async () => {
    resolveAiAccess.mockResolvedValue(access());

    await POST(
      request({
        question: "Why Monday?",
        messages: [
          { alias: "Yara", body: "Ship on Friday?", isAi: false },
          { alias: null, body: "Ship Monday instead.", isAi: true },
        ],
      }),
    );

    const [, , messages] = createProviderStream.mock.calls[0] as [
      string,
      string,
      { role: string; content: string }[],
    ];
    const assistant = messages.filter((message) => message.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toContain("Ship Monday");
  });

  it("carries only the transcript and the question, and nothing about the host", async () => {
    // The route is the second place this could go wrong, so it gets its own version of the
    // check `ai-bridge.test.ts` makes on the browser side.
    resolveAiAccess.mockResolvedValue(access());

    await POST(
      request({
        question: "What do you recommend?",
        messages: [{ alias: "Yara", body: "Should we go after Northwind?", isAi: false }],
      }),
    );

    const [, , messages] = createProviderStream.mock.calls[0] as [
      string,
      string,
      { content: string }[],
    ];
    const prompt = JSON.stringify(messages);

    expect(prompt).toContain("Northwind");
    // The host's private life has no path to this payload: the route imports nothing that
    // holds it, and the body it accepts has no field to carry it.
    for (const secret of ["salary", "hunter2", "Sarah", "vault", "DECISION"]) {
      expect(prompt, `"${secret}" reached the provider`).not.toContain(secret);
    }
  });
});


describe("the key comes from Option A when the host is here, Option B when they are not", () => {
  // Section 5. Option A is the host's own tab signing with the key it holds; Option B is the
  // host having chosen, in advance, to let the room answer without them. The order matters
  // in one direction only: A wins, because a host who is online has the real key in hand and
  // a stale stored copy must never quietly override it.
  it("signs with the header key and never opens the stored one", async () => {
    resolveAiAccess.mockResolvedValue(access({ keyMode: "server" }));
    loadHostKey.mockResolvedValue({ key: "sk-stored-0123456789abcd", expiresAt: "later" });

    const response = await POST(request());

    expect(response.status).toBe(200);
    // Opening the stored key would be a needless decryption of a credential on every request
    // while the host is present, and a chance to log or mishandle one.
    expect(loadHostKey).not.toHaveBeenCalled();
  });

  it("falls back to the stored key when no key is in the header", async () => {
    resolveAiAccess.mockResolvedValue(access({ keyMode: "server" }));
    loadHostKey.mockResolvedValue({ key: "sk-stored-0123456789abcd", expiresAt: "later" });

    const noKey = new Request(`http://localhost/api/rooms/ai?roomId=${ROOM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-room-member": TOKEN },
      body: JSON.stringify({ question: "Q", messages: [{ alias: "Y", body: "hi", isAi: false }] }),
    });

    const response = await POST(noKey);

    expect(response.status).toBe(200);
    // Opened for the room's own host, not for whoever is asking.
    expect(loadHostKey).toHaveBeenCalledWith("host-account-uuid");
  });

  it("does not open the stored key for a browser-only room", async () => {
    // A room whose host chose Option A promised the model stops when they close their laptop.
    // Reaching for a stored key here would break that promise by accident.
    resolveAiAccess.mockResolvedValue(access({ keyMode: "browser" }));
    loadHostKey.mockResolvedValue({ key: "sk-stored-0123456789abcd", expiresAt: "later" });

    const noKey = new Request(`http://localhost/api/rooms/ai?roomId=${ROOM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-room-member": TOKEN },
      body: JSON.stringify({ question: "Q", messages: [{ alias: "Y", body: "hi", isAi: false }] }),
    });

    expect((await POST(noKey)).status).toBe(401);
    expect(loadHostKey).not.toHaveBeenCalled();
  });

  it("says the host is needed when there is no key at all", async () => {
    resolveAiAccess.mockResolvedValue(access({ keyMode: "server" }));
    loadHostKey.mockResolvedValue(null);

    const noKey = new Request(`http://localhost/api/rooms/ai?roomId=${ROOM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-room-member": TOKEN },
      body: JSON.stringify({ question: "Q", messages: [{ alias: "Y", body: "hi", isAi: false }] }),
    });

    const response = await POST(noKey);

    // The message names the actual cause. A guest staring at "unauthorized" has no idea what
    // to do; told the host is not here, they know to wait.
    expect(response.status).toBe(401);
    expect((await response.json()).error).toMatch(/host/i);
    expect(createProviderStream).not.toHaveBeenCalled();
  });

  it("treats an expired stored key as no key, so the room falls back to waiting", async () => {
    // `loadHostKey` sweeps an expired row and returns null. The route must then behave as
    // Option A rather than erroring, which is what section 5 promises happens.
    resolveAiAccess.mockResolvedValue(access({ keyMode: "server" }));
    loadHostKey.mockResolvedValue(null);

    const noKey = new Request(`http://localhost/api/rooms/ai?roomId=${ROOM}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-room-member": TOKEN },
      body: JSON.stringify({ question: "Q", messages: [{ alias: "Y", body: "hi", isAi: false }] }),
    });

    expect((await POST(noKey)).status).toBe(401);
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The room creation boundary.
 *
 * The rule being pinned here is one line of the design: *"Quota of the model: the host's own
 * key, always. Rooms never touch the free tier."* That is easy to state and easy to lose,
 * because `isValidModelId` accepts a `:free` id without complaint — the free tier and the
 * BYOK tier live in the same catalogue. Without an explicit tier check, a host who picked
 * a free model in Settings could open a room that quietly runs on the app's key, and every
 * member's question would be billed to PermaMind instead of to them.
 */

const createRoom = vi.fn();

// `server-only` is a build-time marker with no runtime export. The routes under test import
// modules that carry it, so it is stubbed here rather than installed as a dependency.
vi.mock("server-only", () => ({}));


const hostKeyStatus = vi.fn();

vi.mock("@/lib/rooms/host-key-store", () => ({
  hostKeyStatus: (...args: unknown[]) => hostKeyStatus(...args),
}));

vi.mock("@/lib/rooms/server", () => ({
  createRoom: (...args: unknown[]) => createRoom(...args),
  RoomError: class RoomError extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
      super(message);
    }
  },
}));

import { POST } from "../route";
import { FREE_MODELS, getByokModels } from "@/lib/ai/models";

const KEY = "a".repeat(64);

function body(overrides: Record<string, unknown> = {}) {
  return {
    title: "Launch",
    topic: "pricing",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    aiProvider: "openrouter",
    aiModel: "openai/gpt-4o",
    // Codes shaped the way `access.ts` mints them. The invite is six digits from "2346789",
    // and the host code is six characters from the id alphabet, which deliberately omits
    // 0/O, 1/I/L, and 5/S so a code read aloud cannot be mistyped into a neighbour.
    //
    // Both of my first attempts were invalid without it being obvious: `483921` contains
    // a `1`, and `7K9P2X` is a room id rather than a host code. The failure surfaced as
    // "The room codes are not valid", which is why the assertions below print the response
    // body — a bare status code could not tell that the model was never reached.
    inviteCode: "483926",
    hostCode: "BK7P2X",
    wrappedRoomKey: "x".repeat(200),
    wrapSalt: "c2FsdA==",
    ...overrides,
  };
}

function post(payload: Record<string, unknown>) {
  return new Request("http://localhost/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  createRoom.mockResolvedValue({ roomId: "7K9P2X" });
  hostKeyStatus.mockResolvedValue({ present: false, expiresAt: null });
});

describe("a room never runs on the app's free tier", () => {
  it("rejects a model the host's own key cannot be billed for", async () => {
    // The first free model is the app's default for unauthenticated chat. A host who never
    // touched Settings, or who picked the cheapest option, would otherwise end up here.
    const freeModel = FREE_MODELS[0];
    expect(freeModel, "the free tier should not be empty").toBeDefined();

    const response = await POST(
      post(body({ aiProvider: "openrouter", aiModel: freeModel.id })),
    );

    expect(response.status).toBe(400);
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("rejects every model in the free catalogue, not just the first", async () => {
    // One id would be an anecdote. The rule is about the tier, so it has to hold for all of
    // them — including any added later, which is the case a hard-coded check would miss.
    for (const model of FREE_MODELS) {
      const response = await POST(
        post(body({ aiProvider: "openrouter", aiModel: model.id })),
      );
      expect(response.status, `${model.id} was accepted`).toBe(400);
    }
    expect(createRoom).not.toHaveBeenCalled();
  });

  it("accepts a BYOK model, because that is the whole point", async () => {
    const byok = getByokModels()[0];
    expect(byok, "the BYOK tier should not be empty").toBeDefined();

    const response = await POST(
      post(body({ aiProvider: "openrouter", aiModel: byok.id })),
    );

    // Surfaced rather than asserted blindly: the error body is what names the offending
    // check, and a bare `400` says only that something upstream refused the request.
    expect(response.status, await response.text()).toBe(201);
    expect(createRoom).toHaveBeenCalledOnce();
  });

  it("lets a custom or local provider name its own model", async () => {
    // Those providers take a free-text model name that is not in our catalogue at all, so
    // an allowlist check would make Ollama rooms impossible. The host pays that bill
    // themselves, which is what the rule is protecting.
    for (const provider of ["ollama", "custom"]) {
      createRoom.mockClear();
      const response = await POST(
        post(body({ aiProvider: provider, aiModel: "my-own-fine-tune" })),
      );
      expect(response.status, `${provider} was rejected`).toBe(201);
    }
  });

  it("still refuses an empty model, whatever the provider", async () => {
    expect((await POST(post(body({ aiModel: "" })))).status).toBe(400);
  });
});

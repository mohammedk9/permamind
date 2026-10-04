import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pinning a message, and who is allowed to.
 *
 * Pinning is the only edit any member can make to a row that already exists. The design gives
 * it to the host alone — *"A group converges on a few items; those need to stop scrolling away.
 * Host only."* — because a pin marks the room's agenda, and who gets to set the agenda is
 * the host's call rather than a reward for arguing well.
 *
 * The tests below are therefore mostly refusals. The failure they guard against is a version
 * that checks "is this person in the room" instead of "is this person the host", which would
 * let any guest pin anything and would look, in review, like a reasonable simplification.
 */

vi.mock("server-only", () => ({}));

const setMessagePinned = vi.fn();
const postMessage = vi.fn();
const readMessages = vi.fn();

vi.mock("@/lib/rooms/server", () => ({
  setMessagePinned: (...args: unknown[]) => setMessagePinned(...args),
  postMessage: (...args: unknown[]) => postMessage(...args),
  readMessages: (...args: unknown[]) => readMessages(...args),
  RoomError: class RoomError extends Error {
    constructor(message: string, readonly status: number, readonly code: string) {
      super(message);
    }
  },
}));

import { PATCH } from "../route";

/**
 * Shapes taken from `lib/rooms/access` rather than invented.
 *
 * Both were wrong in the first attempt and every test failed with a flat 404, which pointed
 * at the authorisation path rather than at the constants. The room id must come from the id
 * alphabet (uppercase, no `A`/`E`/`I`/`O`/`U`/`V`), and the member token must be 64 lowercase
 * hex characters. A realistic value here keeps a future failure about pinning from hiding
 * behind a malformed invite.
 */
const ROOM = "BK7P2X";
const TOKEN = "a".repeat(64);
const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";

/** A pinned-forever timestamp, so the assertion does not depend on the clock. */
const PINNED_AT = "2026-02-01T10:00:00.000Z";

function request(body: unknown, token = TOKEN) {
  return new Request(`http://localhost/api/rooms/messages?roomId=${ROOM}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-room-member": token },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setMessagePinned.mockResolvedValue({ pinnedAt: PINNED_AT });
});

describe("PATCH /api/rooms/messages", () => {
  it("pins a message for the host", async () => {
    const response = await PATCH(request({ roomId: ROOM, messageId: MESSAGE_ID, pinned: true }));

    expect(response.status).toBe(200);
    expect(setMessagePinned).toHaveBeenCalledWith({
      roomId: ROOM,
      memberToken: TOKEN,
      messageId: MESSAGE_ID,
      pinned: true,
    });
    expect(await response.json()).toEqual({ pinnedAt: PINNED_AT });
  });

  it("unpins by sending pinned false, and the column becomes null", async () => {
    setMessagePinned.mockResolvedValue({ pinnedAt: null });

    const response = await PATCH(request({ roomId: ROOM, messageId: MESSAGE_ID, pinned: false }));

    expect(response.status).toBe(200);
    // null rather than a false flag: the column is a timestamp or absent, and the response
    // reports what was actually stored rather than what was asked for.
    expect(await response.json()).toEqual({ pinnedAt: null });
  });

  it("refuses a request with no member token", async () => {
    const response = await PATCH(request({ roomId: ROOM, messageId: MESSAGE_ID, pinned: true }, ""));

    expect(response.status).toBe(404);
    expect(setMessagePinned).not.toHaveBeenCalled();
  });

  it("refuses a malformed room id", async () => {
    const response = await PATCH(request({ roomId: "no", messageId: MESSAGE_ID, pinned: true }));

    expect(response.status).toBe(404);
    expect(setMessagePinned).not.toHaveBeenCalled();
  });

  it("refuses a message id that is not a uuid", async () => {
    const response = await PATCH(request({ roomId: ROOM, messageId: "abc", pinned: true }));

    // 404 rather than 400, so a malformed id is indistinguishable from a message that is
    // genuinely not in the room. A 400 would confirm the endpoint had resolved something.
    expect(response.status).toBe(404);
    expect(setMessagePinned).not.toHaveBeenCalled();
  });

  it("refuses a pinned value that is not a boolean", async () => {
    // The dangerous shape: a truthy string would pin when the caller meant to unpin.
    const response = await PATCH(request({ roomId: ROOM, messageId: MESSAGE_ID, pinned: "false" }));

    expect(response.status).toBe(400);
    expect(setMessagePinned).not.toHaveBeenCalled();
  });

  it("surfaces a non-host refusal from the server without rewriting it", async () => {
    const { RoomError } = await import("@/lib/rooms/server");
    setMessagePinned.mockRejectedValue(new RoomError("Only the host can pin", 403, "NOT_HOST"));

    const response = await PATCH(request({ roomId: ROOM, messageId: MESSAGE_ID, pinned: true }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "NOT_HOST" });
  });

  it("surfaces an unknown message as not found", async () => {
    const { RoomError } = await import("@/lib/rooms/server");
    setMessagePinned.mockRejectedValue(
      new RoomError("That message is not in this room", 404, "MESSAGE_NOT_FOUND"),
    );

    const response = await PATCH(request({ roomId: ROOM, messageId: MESSAGE_ID, pinned: true }));

    expect(response.status).toBe(404);
  });

  it("refuses a body that is not JSON, rather than throwing", async () => {
    const malformed = new Request(`http://localhost/api/rooms/messages?roomId=${ROOM}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-room-member": TOKEN },
      body: "not json at all",
    });

    const response = await PATCH(malformed);

    expect(response.status).toBe(404);
    expect(setMessagePinned).not.toHaveBeenCalled();
  });

  it("never sends room key material, only ids and a flag", async () => {
    await PATCH(request({ roomId: ROOM, messageId: MESSAGE_ID, pinned: true }));

    // Pinning is structural, so it is the one write in this route that carries no ciphertext.
    // A key or a sealed body appearing here would mean the pin had been routed through the
    // encrypted path, and only the host could then read the room's own pinned list.
    const payload = JSON.stringify(setMessagePinned.mock.calls[0][0]);
    expect(payload).not.toContain("ciphertext");
    expect(payload).not.toContain("contentHash");
    expect(payload).not.toContain("wrappedRoomKey");
  });
});
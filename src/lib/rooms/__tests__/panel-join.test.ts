import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Joining a panel room.
 *
 * One rule, and it is the reason panel rooms are a separate kind rather than a flag on the
 * guest room. A panel member spends their own key, so the room must know which account spent
 * it; a `guest` row has no account and therefore could never be held to anything. Section 3 of
 * the proposal puts it as a decision: "Registered accounts only. No anonymous members."
 *
 * Two halves, and they fail differently on purpose:
 *
 *   - An anonymous caller is **refused**.
 *   - A signed-in caller in a **guest** room still gets `user_id: null`, because writing an
 *     account id there would break the promise section 13 makes about guest rooms collecting
 *     no personal data.
 */

vi.mock("server-only", () => ({}));

const announceRoomChange = vi.fn(async (_feedId?: string | null) => {});
vi.mock("@/lib/rooms/realtime", () => ({
  announceRoomChange: (...args: unknown[]) => announceRoomChange(...(args as [string | null])),
}));

const requireUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  requireUser: (...args: unknown[]) => requireUser(...(args as [])),
}));

import { joinRoom } from "../server";

const ROOM = "BK7P2X";
// Digits only, and none of them 0, 1 or 5 — `CODE_ALPHABET` in `access.ts` omits those
// three, so an invite containing one is refused before the database is ever reached.
const INVITE = "482963";
const INVITE_HASH = createHash("sha256").update(INVITE).digest("hex");
const HOUR = 3_600_000;

function install(options: { roomKind?: string; user?: { id: string } | null } = {}) {
  const inserts: Record<string, unknown>[] = [];

  const roomRow = {
    room_id: ROOM,
    invite_code_hash: INVITE_HASH,
    wrapped_room_key: "sealed",
    wrap_salt: "salt",
    closed_at: null,
    expires_at: new Date(Date.now() + HOUR).toISOString(),
    require_display_name: false,
    allow_guest_write: true,
    room_kind: options.roomKind ?? "panel",
  };

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      maybeSingle: async () => ({ data: table === "rooms" ? roomRow : null, error: null }),
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  };

  requireUser.mockResolvedValue({
    supabase: { from },
    user: options.user === null ? null : (options.user ?? { id: "account-1" }),
  });

  return inserts;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a panel room is registered accounts only", () => {
  it("refuses an anonymous caller", async () => {
    install({ roomKind: "panel", user: null });

    await expect(joinRoom({ roomId: ROOM, inviteCode: INVITE })).rejects.toMatchObject({
      status: 401,
      code: "SIGNIN_REQUIRED",
    });
  });

  it("writes nobody's account when it refuses", async () => {
    // A refusal that still created a member row would leave an orphan seat in the roster.
    const inserts = install({ roomKind: "panel", user: null });

    await expect(joinRoom({ roomId: ROOM, inviteCode: INVITE })).rejects.toThrow();

    expect(inserts).toHaveLength(0);
  });

  it("joins a signed-in caller and records their account", async () => {
    const inserts = install({ roomKind: "panel", user: { id: "account-1" } });

    await joinRoom({ roomId: ROOM, inviteCode: INVITE });

    expect(inserts[0].row).toMatchObject({ room_id: ROOM, role: "guest", user_id: "account-1" });
  });
});

describe("a guest room stays anonymous", () => {
  it("lets an anonymous caller in, as it always has", async () => {
    install({ roomKind: "guest", user: null });

    const result = await joinRoom({ roomId: ROOM, inviteCode: INVITE });

    expect(result.role).toBe("guest");
  });

  it("still writes a null user_id even when the caller happens to be signed in", async () => {
    // The important half. A signed-in person joining an ordinary room must not be recorded
    // in it, or a guest room would start holding account ids and section 13 would become false
    // the first time somebody used the app while logged in.
    const inserts = install({ roomKind: "guest", user: { id: "account-1" } });

    await joinRoom({ roomId: ROOM, inviteCode: INVITE });

    expect(inserts[0].row).toMatchObject({ user_id: null });
  });
});

describe("the refusal does not leak the room", () => {
  it("refuses a wrong code before revealing that the room is a panel", async () => {
    install({ roomKind: "panel", user: null });

    // Same error as a bad invite. An anonymous caller must not be able to learn that a room
    // id exists, or which kind it is, from the shape of its refusal.
    await expect(joinRoom({ roomId: ROOM, inviteCode: "000000" })).rejects.toMatchObject({
      status: 404,
      code: "INVITE_INVALID",
    });
  });
});
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The server half of pinning: who may set `pinned_at`, and what the update is allowed to
 * touch.
 *
 * The route test proves the request shape reaches this function. This file proves the rule
 * that matters, which cannot live in the route: *only the host may pin*. Everything else —
 * the shape checks, the uuid pattern — is presentational, and a future refactor could drop
 * any of it without consequence. If the host check went, guests would silently acquire the
 * ability to mark the room's agenda.
 *
 * The second rule pinned here is narrower and easier to break by accident: the update writes
 * one column and is scoped to one room. A `select("*")` or a missing `eq("room_id", …)` would
 * let a pin leak across rooms, and neither would fail any test that only checked the returned
 * timestamp.
 */

// `server-only` is a build-time marker with no runtime export.
vi.mock("server-only", () => ({}));

// Typed to accept the argument `setMessagePinned` passes it. Declared with a parameter
// rather than none so the forwarding cast below is valid, and so the test can assert on
// the feed id that was announced.
// Optional rather than required: the forwarding wrapper below passes the feed id through, and
// an underscore-prefixed parameter keeps the unused-argument lint rule quiet without hiding
// the fact that the real function does take one.
const announceRoomChange = vi.fn(async (_feedId?: string | null) => {});
vi.mock("@/lib/rooms/realtime", () => ({
  announceRoomChange: (...args: unknown[]) => announceRoomChange(...(args as [string | null])),
}));

const requireUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ requireUser: (...args: unknown[]) => requireUser(...args) }));

import { RoomError, setMessagePinned } from "../server";

const ROOM = "BK7P2X";
const TOKEN = "a".repeat(64);
const MESSAGE_ID = "11111111-1111-4111-8111-111111111111";
const FEED_ID = "f".repeat(32);
const PINNED_AT = "2026-02-01T10:00:00.000Z";

/**
 * A query builder that records what it was asked to write and what it filtered on.
 *
 * The recorded `patch` and `filters` are the whole point of this file. `setMessagePinned`
 * looks correct whether or not it writes `{ pinned_at, content_hash }` or filters by id
 * alone, so the assertions have to read the call rather than the return value.
 */
function installSupabase(options: { role: string | null; row?: Record<string, unknown> | null }) {
  const calls: {
    op: string;
    table: string;
    patch?: Record<string, unknown>;
    filters: Record<string, unknown>;
    selected?: string;
  }[] = [];

  const table = (name: string) => {
    /**
     * Mutated in place rather than reassigned.
     *
     * A recorded call holds this exact object, so a filter added after the call was logged
     * is still visible on it. Reassigning `filters` instead would leave every recorded call
     * pointing at the empty object it started with, which is what made the scoping
     * assertion read `{}` — the terminal here is `maybeSingle`, not `then`, so a copy taken
     * at `update()` time would never have been filled in at all.
     */
    const filters: Record<string, unknown> = {};

    const builder: Record<string, unknown> = {
      select: (columns?: string) => {
        calls.push({ op: "select", table: name, filters, selected: columns });
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      maybeSingle: async () => {
        if (name === "room_members") {
          // The membership lookup. An unknown role is what a non-member looks like.
          return { data: options.role ? { role: options.role } : null, error: null };
        }
        if (name === "rooms") {
          return { data: { feed_id: FEED_ID }, error: null };
        }
        return { data: options.row ?? null, error: null };
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: options.row ?? null, error: null }).then(resolve),
    };

    builder.update = (patch: Record<string, unknown>) => {
      // Recorded with a live reference to `filters`, so the `.eq` calls that follow are
      // visible on this entry once the chain is awaited.
      calls.push({ op: "update", table: name, patch, filters });
      const chain: Record<string, unknown> = {
        select: (columns?: string) => {
          calls.push({ op: "select", table: name, filters, selected: columns });
          return chain;
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return chain;
        },
        maybeSingle: async () => ({ data: options.row ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: options.row ?? null, error: null }).then(resolve),
      };
      return chain;
    };

    return builder;
  };

  requireUser.mockResolvedValue({
    supabase: { from: (name: string) => table(name) },
  });

  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  announceRoomChange.mockResolvedValue(undefined);
});

describe("setMessagePinned", () => {
  it("lets the host pin, and records the time", async () => {
    installSupabase({ role: "host", row: { pinned_at: PINNED_AT } });

    const result = await setMessagePinned({
      roomId: ROOM,
      memberToken: TOKEN,
      messageId: MESSAGE_ID,
      pinned: true,
    });

    expect(result).toEqual({ pinnedAt: PINNED_AT });
  });

  it("refuses a trusted member, who may spend the key but not set the agenda", async () => {
    const calls = installSupabase({ role: "trusted", row: { pinned_at: PINNED_AT } });

    await expect(
      setMessagePinned({ roomId: ROOM, memberToken: TOKEN, messageId: MESSAGE_ID, pinned: true }),
    ).rejects.toMatchObject({ status: 403, code: "NOT_HOST" });

    // The refusal happens before any write, not after a rejected one.
    expect(calls.filter((call) => call.op === "update")).toHaveLength(0);
  });

  it("refuses a guest", async () => {
    const calls = installSupabase({ role: "guest", row: { pinned_at: PINNED_AT } });

    await expect(
      setMessagePinned({ roomId: ROOM, memberToken: TOKEN, messageId: MESSAGE_ID, pinned: true }),
    ).rejects.toMatchObject({ status: 403, code: "NOT_HOST" });

    expect(calls.filter((call) => call.op === "update")).toHaveLength(0);
  });

  it("refuses a non-member without revealing that the room exists", async () => {
    installSupabase({ role: null, row: { pinned_at: PINNED_AT } });

    // The same refusal a bad room id gets. A 403 here would confirm the room is real to
    // someone holding only a shared link.
    await expect(
      setMessagePinned({ roomId: ROOM, memberToken: TOKEN, messageId: MESSAGE_ID, pinned: true }),
    ).rejects.toMatchObject({ status: 404, code: "INVITE_INVALID" });
  });

  it("writes only pinned_at, never the message body", async () => {
    const calls = installSupabase({ role: "host", row: { pinned_at: PINNED_AT } });

    await setMessagePinned({ roomId: ROOM, memberToken: TOKEN, messageId: MESSAGE_ID, pinned: true });

    const update = calls.find((call) => call.op === "update");
    expect(Object.keys(update?.patch ?? {})).toEqual(["pinned_at"]);
    // `seq` is the ordering the whole room agrees on, and `ciphertext` is the content. A
    // patch that could touch either would let a pin rewrite history rather than mark it.
    expect(update?.patch).not.toHaveProperty("seq");
    expect(update?.patch).not.toHaveProperty("ciphertext");
    expect(update?.patch).not.toHaveProperty("content_hash");
  });

  it("scopes the update to the room and to the one message", async () => {
    const calls = installSupabase({ role: "host", row: { pinned_at: PINNED_AT } });

    await setMessagePinned({ roomId: ROOM, memberToken: TOKEN, messageId: MESSAGE_ID, pinned: true });

    const update = calls.find((call) => call.op === "update");
    // Ids are globally unique, so this filter is belt-and-braces — but a version without
    // it would be one refactor away from pinning a message in somebody else's room.
    expect(update?.filters).toMatchObject({ room_id: ROOM, id: MESSAGE_ID });
  });

  it("clears the column on unpin rather than writing a flag", async () => {
    const calls = installSupabase({ role: "host", row: { pinned_at: null } });

    const result = await setMessagePinned({
      roomId: ROOM,
      memberToken: TOKEN,
      messageId: MESSAGE_ID,
      pinned: false,
    });

    expect(result.pinnedAt).toBeNull();
    const update = calls.find((call) => call.op === "update");
    expect(update?.patch).toEqual({ pinned_at: null });
  });

  it("tells a missing message apart from a failed write", async () => {
    installSupabase({ role: "host", row: null });

    await expect(
      setMessagePinned({ roomId: ROOM, memberToken: TOKEN, messageId: MESSAGE_ID, pinned: true }),
    ).rejects.toMatchObject({ status: 404, code: "MESSAGE_NOT_FOUND" });
  });

  it("announces the change so other clients re-read the transcript", async () => {
    installSupabase({ role: "host", row: { pinned_at: PINNED_AT } });

    await setMessagePinned({ roomId: ROOM, memberToken: TOKEN, messageId: MESSAGE_ID, pinned: true });

    // Without this, a pin would only appear on the host's screen until the next poll.
    expect(announceRoomChange).toHaveBeenCalledWith(FEED_ID);
  });

  it("throws a RoomError, so the route can map it to a status", async () => {
    installSupabase({ role: "guest" });

    await expect(
      setMessagePinned({ roomId: ROOM, memberToken: TOKEN, messageId: MESSAGE_ID, pinned: true }),
    ).rejects.toBeInstanceOf(RoomError);
  });
});
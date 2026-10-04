import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The host's two remaining levers: the read-only switch, and what the room has cost.
 *
 * Both are the same rule wearing different clothes — **the host only** — and both are the
 * answer to a row in the risk table: "A guest burns the host's quota | Medium if `trusted` is
 * granted freely | Promotion is explicit; per-room and per-member spend is shown to the host;
 * AI invocations are rate limited per room."
 *
 * The rate limit was already there. Promotion is explicit. This file covers the third clause,
 * which did not exist: nothing was recorded, so the host had no figure to look at.
 */

vi.mock("server-only", () => ({}));

// The parameter is declared even though nothing here reads it, because the wrapper below
// forwards one argument into this spy. A zero-argument spy would make that call a type error,
// and dropping the argument here would diverge from `attribution.test.ts` and `pin.test.ts`,
// which mock this module the same way for the same reason.
const announceRoomChange = vi.fn(async (_feedId?: string | null) => {});
vi.mock("@/lib/rooms/realtime", () => ({
  announceRoomChange: (...args: unknown[]) => announceRoomChange(...(args as [string | null])),
}));

const requireUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  requireUser: (...args: unknown[]) => requireUser(...(args as [])),
}));

import { readRoomSpend, recordRoomAiUsage, setRoomReadOnly } from "../server";

const ROOM = "BK7P2X";
const TOKEN = "a".repeat(64);
const HASH = createHash("sha256").update(TOKEN).digest("hex");

/**
 * A table stub that records what was written and can answer the reads `readRoomSpend` makes.
 *
 * `usage` is the room's call log; `members` is the roster the roles come from. Both are
 * seeded per test so the assertions can be about a specific member's count rather than about
 * the shape of the response.
 */
function install(options: {
  role?: string | null;
  usage?: Record<string, unknown>[];
  members?: Record<string, unknown>[];
  allowGuestWrite?: boolean;
}) {
  const writes: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const usage = [...(options.usage ?? [])];
  let allowGuestWrite = options.allowGuestWrite ?? true;

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      maybeSingle: async () => {
        if (table === "room_members") {
          return {
            data: options.role === null ? null : { role: options.role ?? "host" },
            error: null,
          };
        }
        return {
          data: { allow_guest_write: allowGuestWrite, feed_id: "f".repeat(32) },
          error: null,
        };
      },
      then: (resolve: (value: unknown) => unknown) => {
        const matches = (row: Record<string, unknown>) =>
          Object.entries(filters).every(([key, want]) => row[key] === want);
        const rows = table === "room_ai_usage" ? usage : (options.members ?? []);
        return Promise.resolve({ data: rows.filter(matches), error: null }).then(resolve);
      },
      insert: (row: Record<string, unknown>) => {
        writes.push({ table, row });
        usage.push({ created_at: new Date().toISOString(), ...row });
        return { then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
      },
      update: (patch: Record<string, unknown>) => {
        updates.push({ table, patch, filters });
        if ("allow_guest_write" in patch) allowGuestWrite = Boolean(patch.allow_guest_write);
        return {
          ...builder,
          then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r),
        };
      },
    };
    return builder;
  };

  requireUser.mockResolvedValue({ supabase: { from }, user: { id: "owner-1" } });
  return { writes, updates, usage };
}

const usageRow = (hash: string, model = "openai/gpt-4o", hoursAgo = 0) => ({
  room_id: ROOM,
  author_token_hash: hash,
  model,
  created_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ supabase: { from: () => ({}) }, user: { id: "owner-1" } });
});

describe("setRoomReadOnly", () => {
  it("locks guests out and back again", async () => {
    const { updates } = install({ role: "host" });

    await setRoomReadOnly({ roomId: ROOM, memberToken: TOKEN, readOnly: true });
    await setRoomReadOnly({ roomId: ROOM, memberToken: TOKEN, readOnly: false });

    // The column is `allow_guest_write`; the API is `readOnly`. Both names must exist or the
    // host's switch silently does nothing.
    expect(updates[0].patch).toEqual({ allow_guest_write: false });
    expect(updates[1].patch).toEqual({ allow_guest_write: true });
  });

  it("refuses a trusted member", async () => {
    const { updates } = install({ role: "trusted" });

    await expect(
      setRoomReadOnly({ roomId: ROOM, memberToken: TOKEN, readOnly: true }),
    ).rejects.toMatchObject({ status: 403, code: "NOT_HOST" });

    expect(updates).toHaveLength(0);
  });

  it("refuses a guest", async () => {
    const { updates } = install({ role: "guest" });

    await expect(
      setRoomReadOnly({ roomId: ROOM, memberToken: TOKEN, readOnly: true }),
    ).rejects.toMatchObject({ code: "NOT_HOST" });

    expect(updates).toHaveLength(0);
  });

  it("refuses a non-member with the same refusal a bad invite gets", async () => {
    install({ role: null });

    // Deliberately not a 403. A 403 would confirm the room exists to someone holding no
    // invitation, which is the disclosure the 404 exists to prevent.
    await expect(
      setRoomReadOnly({ roomId: ROOM, memberToken: TOKEN, readOnly: true }),
    ).rejects.toMatchObject({ status: 404, code: "INVITE_INVALID" });
  });
});

describe("recordRoomAiUsage", () => {
  it("records the call against the caller's hash, never their token", async () => {
    const { writes } = install({ role: "host" });

    await recordRoomAiUsage({ roomId: ROOM, memberToken: TOKEN, model: "openai/gpt-4o" });

    expect(writes[0].row).toMatchObject({
      room_id: ROOM,
      author_token_hash: HASH,
      model: "openai/gpt-4o",
    });
    // The token itself must never reach the table.
    expect(JSON.stringify(writes[0].row)).not.toContain(TOKEN);
  });

  it("records nothing about what was asked", async () => {
    const { writes } = install({ role: "host" });

    await recordRoomAiUsage({ roomId: ROOM, memberToken: TOKEN, model: "openai/gpt-4o" });

    const row = writes[0].row as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(["author_token_hash", "model", "room_id"]);
  });

  it("never throws, so a failed write cannot withhold an answer", async () => {
    requireUser.mockRejectedValue(new Error("database unavailable"));

    // The member already got their answer. Failing here would trade a missing counter for a
    // missing response.
    await expect(
      recordRoomAiUsage({ roomId: ROOM, memberToken: TOKEN, model: "openai/gpt-4o" }),
    ).resolves.toBeUndefined();
  });
});

describe("readRoomSpend", () => {
  it("counts calls per member, busiest first", async () => {
    install({
      role: "host",
      usage: [
        usageRow("a".repeat(64)),
        usageRow("b".repeat(64)),
        usageRow("b".repeat(64)),
        usageRow("b".repeat(64)),
      ],
      members: [
        { room_id: ROOM, member_token_hash: "a".repeat(64), role: "host" },
        { room_id: ROOM, member_token_hash: "b".repeat(64), role: "trusted" },
      ],
    });

    const spend = await readRoomSpend({ roomId: ROOM, memberToken: TOKEN });

    expect(spend?.totalCalls).toBe(4);
    expect(spend?.members.map((m) => m.calls)).toEqual([3, 1]);
    // The role comes from the roster, not from the usage row.
    expect(spend?.members.map((m) => m.role)).toEqual(["trusted", "host"]);
  });

  it("counts the last day separately", async () => {
    install({
      role: "host",
      usage: [usageRow("a".repeat(64), "openai/gpt-4o", 0), usageRow("a".repeat(64), "openai/gpt-4o", 48)],
    });

    const spend = await readRoomSpend({ roomId: ROOM, memberToken: TOKEN });

    expect(spend?.totalCalls).toBe(2);
    expect(spend?.callsLastDay).toBe(1);
  });

  it("reports models separately so a multi-model room can be compared", async () => {
    install({
      role: "host",
      usage: [
        usageRow("a".repeat(64), "openai/gpt-4o"),
        usageRow("a".repeat(64), "google/gemma-4-31b-it:free"),
      ],
    });

    const spend = await readRoomSpend({ roomId: ROOM, memberToken: TOKEN });

    expect(spend?.models).toEqual(
      expect.arrayContaining([
        { model: "openai/gpt-4o", calls: 1 },
        { model: "google/gemma-4-31b-it:free", calls: 1 },
      ]),
    );
  });

  it("reports an unspent room as zero rather than as an error", async () => {
    install({ role: "host", usage: [] });

    const spend = await readRoomSpend({ roomId: ROOM, memberToken: TOKEN });

    expect(spend).toEqual({ totalCalls: 0, callsLastDay: 0, members: [], models: [] });
  });

  it("never returns a price, because it cannot know one", async () => {
    install({ role: "host", usage: [usageRow("a".repeat(64))] });

    const spend = await readRoomSpend({ roomId: ROOM, memberToken: TOKEN });

    // A currency figure would be a guess wearing a symbol, and the host would act on it.
    const serialised = JSON.stringify(spend);
    expect(serialised).not.toMatch(/"(cost|price|amount|spend|usd|cents)"/i);
    expect(spend?.totalCalls).toBe(1);
  });

  it("refuses a trusted member, who spends the host's key but not its accounting", async () => {
    install({ role: "trusted", usage: [usageRow("a".repeat(64))] });

    // Null rather than a summary: a trusted member invoking the model does not earn a view of
    // the host's bill. That is the opposite of what the trust grant is for.
    expect(await readRoomSpend({ roomId: ROOM, memberToken: TOKEN })).toBeNull();
  });

  it("refuses a guest", async () => {
    install({ role: "guest", usage: [usageRow("a".repeat(64))] });
    expect(await readRoomSpend({ roomId: ROOM, memberToken: TOKEN })).toBeNull();
  });

  it("refuses a non-member", async () => {
    install({ role: null, usage: [usageRow("a".repeat(64))] });
    expect(await readRoomSpend({ roomId: ROOM, memberToken: TOKEN })).toBeNull();
  });
});
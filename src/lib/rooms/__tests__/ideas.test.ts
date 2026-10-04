import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ideas and voting — the three exit criteria of phase 6, and the boundary of section 9.
 *
 * Section 9 is the whole of what this file is about:
 *
 * > A brainstorm is not a record, and treating it as one is how a memory system fills up with
 * > noise.
 *
 * So the property that matters most is not that voting works. It is that **a member cannot
 * move anything out of the room**: acceptance and conversion are host-only, and everything
 * else expires with the room. A board where anyone can accept an idea would be a memory
 * system anyone can write to.
 *
 * The other load-bearing claim is that one vote per person is a **database** guarantee. The
 * primary key on `room_votes` is what makes it true, and this file pins that the code takes
 * the upsert path rather than an insert that would either fail on the second click or, worse,
 * accumulate.
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

import {
  attachIdeaTask,
  createIdea,
  readIdeas,
  RoomError,
  setIdeaStatus,
  voteOnIdea,
  withdrawVote,
} from "../server";

const ROOM = "BK7P2X";
const TOKEN = "a".repeat(64);
const HOUR = 3_600_000;
const IDEA = "11111111-1111-4111-8111-111111111111";

const ideaRow = {
  room_id: ROOM,
  id: IDEA,
  ciphertext: "sealed",
  author_token_hash: createHash("sha256").update(TOKEN).digest("hex"),
  status: "open",
  task_id: null,
  created_at: new Date().toISOString(),
};

function install(options: { role?: string | null; ideas?: Record<string, unknown>[]; votes?: Record<string, unknown>[] } = {}) {
  const writes: Record<string, unknown>[] = [];
  const role = options.role === undefined ? "guest" : options.role;
      // Set by `select` and read by the `maybeSingle` branches to tell a role query
      // apart from a model query on the same table.
      let selected = "";
  let upserts = 0;

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {
      select: (columns: string) => {
        selected = typeof columns === "string" ? columns : "";
        if (typeof columns === "object" && columns !== null) builder.__count = true;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      order: () => builder,
      maybeSingle: async () => {
        if (table === "rooms") {
          return {
            data: {
              closed_at: null,
              expires_at: new Date(Date.now() + HOUR).toISOString(),
            },
            error: null,
          };
        }
        // `room_members` is queried for the role; anything else is an id read-back.
        if (table === "room_members" && !selected.includes("id")) {
          return { data: { role }, error: null };
        }
        return { data: { id: "22222222-2222-4222-8222-222222222222" }, error: null };
      },
      then: (resolve: (value: unknown) => unknown) => {
        const matches = (row: Record<string, unknown>) =>
          Object.entries(filters).every(([key, want]) => row[key] === want);
        const rows =
          table === "room_ideas"
            ? (options.ideas ?? [ideaRow])
            : table === "room_votes"
              ? (options.votes ?? [])
              : [];
        return Promise.resolve({
          data: rows.filter(matches),
          count: builder.__count ? rows.length : undefined,
          error: null,
        }).then(resolve);
      },
      insert: (row: Record<string, unknown>) => {
        writes.push({ table, op: "insert", row });
        // Chained onto the builder so `.insert(...).select(...).maybeSingle()` works, which
        // is the shape `createIdea` uses to read back the generated id.
        return { ...builder, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
      },
      upsert: (row: Record<string, unknown>) => {
        upserts += 1;
        writes.push({ table, op: "upsert", row });
        return { ...builder, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
      },
      update: (patch: Record<string, unknown>) => {
        writes.push({ table, op: "update", patch, filters });
        return { ...builder, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
      },
      delete: () => {
        writes.push({ table, op: "delete", filters });
        return { ...builder, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
      },
    };
    return builder;
  };

  requireUser.mockResolvedValue({ supabase: { from }, user: { id: "account-1" } });
  return { writes, upserts: () => upserts };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("anyone may propose, and a guest is a member", () => {
  it("lets a guest add an idea", async () => {
    const { writes } = install({ role: "guest" });

    await createIdea({ roomId: ROOM, memberToken: TOKEN, ciphertext: "sealed" });

    expect(writes[0]).toMatchObject({ table: "room_ideas", op: "insert" });
  });

  it("stores the idea sealed, and never the plaintext", async () => {
    const { writes } = install({ role: "guest" });

    await createIdea({ roomId: ROOM, memberToken: TOKEN, ciphertext: "sealed-blob" });

    // An idea is room content. A database dump must be as opaque about what was proposed as
    // it is about what was said.
    expect(writes[0].row).toMatchObject({ ciphertext: "sealed-blob" });
    expect(JSON.stringify(writes[0].row)).not.toContain(TOKEN);
  });

  it("refuses a non-member", async () => {
    install({ role: null });

    await expect(
      createIdea({ roomId: ROOM, memberToken: TOKEN, ciphertext: "sealed" }),
    ).rejects.toMatchObject({ code: "INVITE_INVALID" });
  });
});

describe("one vote per person per idea", () => {
  it("writes through an upsert, so a second click replaces rather than adds", async () => {
    const { writes } = install({ role: "guest" });

    await voteOnIdea({ roomId: ROOM, memberToken: TOKEN, ideaId: IDEA, vote: 1 });
    await voteOnIdea({ roomId: ROOM, memberToken: TOKEN, ideaId: IDEA, vote: -1 });

    // Two clicks, two upserts, never an insert. The primary key on (room, idea, voter) means
    // a plain insert would fail on the second — but the upsert is what lets a member change
    // their mind instead of being stuck with their first vote.
    expect(writes).toHaveLength(2);
    expect(writes.every((w) => w.op === "upsert")).toBe(true);
  });

  it("keys the vote to the caller's own hash", async () => {
    const { writes } = install({ role: "guest" });

    await voteOnIdea({ roomId: ROOM, memberToken: TOKEN, ideaId: IDEA, vote: 1 });

    expect(writes[0].row).toMatchObject({
      room_id: ROOM,
      idea_id: IDEA,
      vote: 1,
      voter_token_hash: createHash("sha256").update(TOKEN).digest("hex"),
    });
  });

  it("withdraws by deleting only the caller's own vote", async () => {
    const { writes } = install({ role: "guest" });

    await withdrawVote({ roomId: ROOM, memberToken: TOKEN, ideaId: IDEA });

    expect(writes[0]).toMatchObject({ table: "room_votes", op: "delete" });
    // Without a `voter_token_hash` filter it would take everyone's votes with it.
    const write = writes[0] as { filters: Record<string, unknown> };
    expect(write.filters.voter_token_hash).toBeDefined();
  });
});

describe("the score is the server's arithmetic", () => {
  it("sums votes and reports who voted", async () => {
    const ownHash = createHash("sha256").update(TOKEN).digest("hex");
    install({
      role: "guest",
      votes: [
        { room_id: ROOM, idea_id: IDEA, voter_token_hash: ownHash, vote: 1 },
        { room_id: ROOM, idea_id: IDEA, voter_token_hash: "c".repeat(64), vote: 1 },
        { room_id: ROOM, idea_id: IDEA, voter_token_hash: "d".repeat(64), vote: -1 },
      ],
    });

    const ideas = await readIdeas({ roomId: ROOM, memberToken: TOKEN });

    expect(ideas[0].score).toBe(1);
    expect(ideas[0].voters).toBe(3);
    expect(ideas[0].myVote).toBe(1);
  });

  it("marks the caller's own idea without returning the author hash", async () => {
    install({ role: "guest" });

    const ideas = await readIdeas({ roomId: ROOM, memberToken: TOKEN });

    expect(ideas[0].isMine).toBe(true);
    // A boolean, not the hash. `postMessage` makes the same choice for the same reason: a
    // client that starts reading that column would hold a hash per author.
    expect(JSON.stringify(ideas[0])).not.toContain(createHash("sha256").update(TOKEN).digest("hex"));
  });

  it("reports no vote for a member who has not voted", async () => {
    install({ role: "guest", votes: [] });

    const ideas = await readIdeas({ roomId: ROOM, memberToken: TOKEN });

    expect(ideas[0].myVote).toBe(0);
    expect(ideas[0].score).toBe(0);
  });
});

describe("only the host moves anything out of the room", () => {
  it("refuses a guest accepting an idea", async () => {
    const { writes } = install({ role: "guest" });

    await expect(
      setIdeaStatus({ roomId: ROOM, memberToken: TOKEN, ideaId: IDEA, status: "accepted" }),
    ).rejects.toMatchObject({ status: 403, code: "NOT_HOST" });

    expect(writes).toHaveLength(0);
  });

  it("refuses a trusted member accepting an idea", async () => {
    // Trust grants the model, not the room's record. A member the host trusted with their
    // key has not thereby been trusted with their memory.
    install({ role: "trusted" });

    await expect(
      setIdeaStatus({ roomId: ROOM, memberToken: TOKEN, ideaId: IDEA, status: "accepted" }),
    ).rejects.toMatchObject({ code: "NOT_HOST" });
  });

  it("refuses a guest converting an idea to a task", async () => {
    const { writes } = install({ role: "guest" });

    await expect(
      attachIdeaTask({ roomId: ROOM, memberToken: TOKEN, ideaId: IDEA, taskId: "task-1" }),
    ).rejects.toMatchObject({ code: "NOT_HOST" });

    expect(writes).toHaveLength(0);
  });

  it("lets the host accept, and writes only a status", async () => {
    const { writes } = install({ role: "host" });

    await setIdeaStatus({ roomId: ROOM, memberToken: TOKEN, ideaId: IDEA, status: "accepted" });

    // Acceptance is a status change here. The move into the host's memory ledger happens on
    // the host's device, by an explicit action, and never as a side effect of a vote.
    expect(writes[0]).toMatchObject({ table: "room_ideas", op: "update" });
    expect(writes[0].patch).toEqual({ status: "accepted" });
  });

  it("stores only the task id when converting, never the task", async () => {
    const { writes } = install({ role: "host" });

    await attachIdeaTask({ roomId: ROOM, memberToken: TOKEN, ideaId: IDEA, taskId: "task-9" });

    expect(writes[0].patch).toEqual({ task_id: "task-9" });
  });
});

describe("a finished room takes no more ideas", () => {
  it("refuses an idea in a closed room", async () => {
    const { supabase } = { supabase: null } as never;
    // A dedicated stub, because this is the one check that reads `rooms` rather than
    // `room_members`.
    requireUser.mockResolvedValue({
      supabase: {
        from: () => {
          const builder: Record<string, unknown> = {
            select: () => builder,
            eq: () => builder,
            maybeSingle: async () => ({
              data: { closed_at: new Date().toISOString(), expires_at: new Date().toISOString() },
              error: null,
            }),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
          };
          return builder;
        },
      },
      user: { id: "account-1" },
    });
    void supabase;

    await expect(
      createIdea({ roomId: ROOM, memberToken: TOKEN, ciphertext: "sealed" }),
    ).rejects.toBeInstanceOf(RoomError);
  });
});
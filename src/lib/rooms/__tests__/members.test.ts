import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Host member administration, and the one rule it exists to enforce.
 *
 * The design puts the whole AI budget risk in this file's subject: *"A guest who is not
 * promoted is never charged, so the exposure to the host's bill is bounded by the number of
 * people the host has chosen to trust."* That is a statement about authorisation, so these
 * tests are mostly about who is refused.
 *
 * The rule that is easiest to get wrong by accident is the caller's identity. Every function
 * here takes a `memberToken` and must confirm it is the *host*. A version that checked only
 * "is this person in the room" would let any guest promote themselves, which converts a
 * single-account budget into an open one, so that case is asserted explicitly.
 */

// `server-only` is a build-time marker that has no runtime export.
vi.mock("server-only", () => ({}));

/**
 * A stand-in for the real `hashSecret`.
 *
 * It has to produce *hex*, not a readable string, and that detail is not cosmetic. The
 * production code labels a member with the first six characters of their stored hash, and it
 * validates that label as `/^[0-9a-f]{6}$/` before it reaches the database. A stub returning
 * `hashed:host-token` therefore made the host's own label fail validation, and two tests
 * failed with `MEMBER_NOT_FOUND` against code that was behaving correctly.
 */
const hashSecret = vi.fn(async (value: string) => createHash("sha256").update(value).digest("hex"));
vi.mock("@/lib/rooms/access", () => ({
  hashSecret: (...args: unknown[]) => hashSecret(...(args as [string])),
}));

/**
 * A hand-rolled query builder.
 *
 * The Supabase client is stubbed rather than mocked wholesale so the chain reads like the
 * real one. `on` records every filter, which is what lets the "scoped to this room" and
 * "scoped to this exact hash" assertions be made at all — a `delete` that forgot its room
 * filter would otherwise still pass every test that only checked the response.
 */
function makeTable(rows: Record<string, unknown>[]) {
  const state = { rows: [...rows] };
  const log: { op: string; filters: Record<string, unknown> }[] = [];

  const match = (row: Record<string, unknown>, filters: Record<string, unknown>) =>
    Object.entries(filters).every(([key, want]) => {
      if (typeof want === "string" && want.endsWith("%")) {
        return String(row[key]).startsWith(want.slice(0, -1));
      }
      return row[key] === want;
    });

  /**
   * A fresh builder per `from()` call.
   *
   * Filters are per-query rather than shared across the whole table. The real client scopes
   * a query to one statement, and a shared filter accumulator silently leaks the previous
   * statement's filters into the next one — which showed up here as `assertHost`'s
   * `member_token_hash` narrowing every later read down to the host's own row.
   */
  const from = () => {
    let filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {};

    const passThrough = () => builder;

    /**
     * Builds the tail of a mutation chain.
     *
     * The `.eq` calls after `update(...)` must collect filters *and* return the mutation
     * terminal, not the plain select terminal. Copying the builder with an object spread is
     * not enough: its `eq` still closes over the outer `builder` and hands the chain back to
     * the read path, so `await update(...).eq(...)` silently performed a select instead.
     */
    const mutation = (apply: () => { data: null; error: null }) => {
      const chain: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(apply()).then(resolve),
      };
      for (const verb of ["select", "order", "limit", "single"]) {
        chain[verb] = () => chain;
      }
      chain.eq = (column: string, value: unknown) => {
        filters = { ...filters, [column]: value };
        return chain;
      };
      chain.like = (column: string, value: unknown) => {
        filters = { ...filters, [column]: value };
        return chain;
      };
      return chain;
    };

    Object.assign(builder, {
      select: passThrough,
      order: passThrough,
      limit: passThrough,
      single: passThrough,
      eq: (column: string, value: unknown) => {
        filters = { ...filters, [column]: value };
        return builder;
      },
      like: (column: string, value: unknown) => {
        filters = { ...filters, [column]: value };
        return builder;
      },
      maybeSingle: async () => ({
        data: state.rows.find((row) => match(row, filters)) ?? null,
        error: null,
      }),
      update: (patch: Record<string, unknown>) => {
        // The filters are only complete once the trailing `.eq` calls have run, so the
        // mutation is applied when the chain is awaited, and the log entry is filled in at
        // that moment too. This is what lets the tests assert on the filters that were
        // actually used rather than the ones present when the verb was called.
        const entry = { op: "update", filters: {} as Record<string, unknown> };
        log.push(entry);
        return mutation(() => {
          Object.assign(entry.filters, filters);
          for (const row of state.rows) {
            if (match(row, filters)) Object.assign(row, patch);
          }
          return { data: null, error: null };
        });
      },
      delete: () => {
        const entry = { op: "delete", filters: {} as Record<string, unknown> };
        log.push(entry);
        return mutation(() => {
          Object.assign(entry.filters, filters);
          state.rows = state.rows.filter((row) => !match(row, filters));
          return { data: null, error: null };
        });
      },
    });

    // Awaiting a bare select returns every matching row, as the real client does.
    builder.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: state.rows.filter((row) => match(row, filters)), error: null }).then(resolve);

    return builder;
  };

  return { from, state, log };
}

const getSupabaseAdminClient = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => getSupabaseAdminClient(),
}));

import {
  listRoomMembers,
  MemberAdminError,
  removeMember,
  setMemberRole,
} from "../members";

const ROOM = "room123456";
const HOST_TOKEN = "host-token";

/** What the real `hashSecret` would produce for the host's token. */
const HOST_HASH = createHash("sha256").update(HOST_TOKEN).digest("hex");
/** The first six characters of that hash: the label the host sees for themselves. */
const HOST_LABEL = HOST_HASH.slice(0, 6);

/** `f0c1d2…` is the six-character label a host would read off a guest's screen. */
function member(label: string, role: string, joinedAt: string) {
  return {
    room_id: ROOM,
    member_token_hash: `${label}${"0".repeat(58)}`,
    role,
    invited_by: role === "host" ? null : "someone",
    joined_at: joinedAt,
    last_seen_at: null,
  };
}

/**
 * The host's own row.
 *
 * Its hash must be exactly what `hashSecret(HOST_TOKEN)` returns, because `assertHost` looks
 * the caller up by that value and refuses anyone it cannot find. The label is therefore
 * derived from that hash rather than chosen arbitrarily.
 */
function hostRow(joinedAt = "2026-01-01T00:00:00Z") {
  return { ...member(HOST_LABEL, "host", joinedAt), member_token_hash: HOST_HASH };
}

/**
 * Installs the rows plus the host, unless the caller already supplied a host row.
 *
 * Every test needs the host present because `assertHost` runs first in all three functions;
 * building it here keeps each test's own `install` call to the members it is actually about.
 */
function install(rows: Record<string, unknown>[]) {
  const withHost = rows.some((row) => row.role === "host") ? rows : [hostRow(), ...rows];
  const { from, state, log } = makeTable(withHost);
  getSupabaseAdminClient.mockReturnValue({ from });
  return { state, log };
}

beforeEach(() => {
  vi.clearAllMocks();
  hashSecret.mockImplementation(async (value: string) => createHash("sha256").update(value).digest("hex"));
});

describe("listRoomMembers", () => {
  it("returns a label and a role, and never the token hash", async () => {
    install([member("f0c1d2", "guest", "2026-01-01T00:00:00Z")]);

    const members = await listRoomMembers({ roomId: ROOM, memberToken: HOST_TOKEN });

    // Two rows: the host installed by `install`, and the guest under test. The host sorts
    // first, so the guest is at index 1.
    expect(members).toHaveLength(2);
    expect(members[1]).toMatchObject({ label: "f0c1d2", role: "guest" });
    // The hash is what would let a host recognise this person in a second room.
    expect(JSON.stringify(members)).not.toContain("f0c1d2000");
    expect(JSON.stringify(members)).not.toContain("member_token_hash");
  });

  it("orders the host first, then trusted, then newest guests", async () => {
    install([
      member("aaaaaa", "guest", "2026-01-01T00:00:00Z"),
      member("bbbbbb", "guest", "2026-03-01T00:00:00Z"),
      member("cccccc", "trusted", "2026-01-01T00:00:00Z"),
    ]);

    const members = await listRoomMembers({ roomId: ROOM, memberToken: HOST_TOKEN });

    expect(members.map((m) => m.role)).toEqual(["host", "trusted", "guest", "guest"]);
    // Among equal roles, the later join comes first: the people still arriving are the ones
    // a host most often needs to look at.
    expect(members[2].label).toBe("bbbbbb");
  });

  it("refuses a guest, and does not reveal that the room exists", async () => {
    install([member("f0c1d2", "guest", "2026-01-01T00:00:00Z")]);

    await expect(listRoomMembers({ roomId: ROOM, memberToken: "guest-token" })).rejects.toMatchObject({
      // Same refusal as an unknown room. Distinguishing them would confirm the room's
      // existence to someone holding only a shared link.
      status: 404,
      code: "INVITE_INVALID",
    });
  });

  it("refuses a trusted member, who may spend the key but not hand it on", async () => {
    // The trusted caller needs a row of their own that `assertHost` will find and then
    // refuse, which is the whole point: membership is not enough, the role is.
    const trustedHash = createHash("sha256").update("trusted-token").digest("hex");
    install([
      member("f0c1d2", "guest", "2026-01-01T00:00:00Z"),
      { ...member(trustedHash.slice(0, 6), "trusted", "2026-01-01T00:00:00Z"), member_token_hash: trustedHash },
    ]);

    // The host, on the same rows, succeeds.
    await expect(listRoomMembers({ roomId: ROOM, memberToken: HOST_TOKEN })).resolves.toHaveLength(3);
    // The trusted member does not.
    await expect(
      listRoomMembers({ roomId: ROOM, memberToken: "trusted-token" }),
    ).rejects.toMatchObject({ code: "INVITE_INVALID" });
  });
});

describe("setMemberRole", () => {
  it("promotes a guest to trusted", async () => {
    const { state } = install([member("f0c1d2", "guest", "2026-01-02T00:00:00Z")]);

    const result = await setMemberRole({
      roomId: ROOM,
      memberToken: HOST_TOKEN,
      targetLabel: "f0c1d2",
      role: "trusted",
    });

    expect(result.role).toBe("trusted");
    // Exactly one row changed role: the guest promoted, not the host beside it.
    const roles = state.rows.map((row) => row.role).sort();
    expect(roles).toEqual(["host", "trusted"]);
  });

  it("scopes the update to the room as well as the hash", async () => {
    const { log } = install([member("f0c1d2", "guest", "2026-01-02T00:00:00Z")]);

    await setMemberRole({ roomId: ROOM, memberToken: HOST_TOKEN, targetLabel: "f0c1d2", role: "trusted" });

    const update = log.find((entry) => entry.op === "update");
    // Without room_id in the filter, promoting "f0c1d2" here would also promote that same
    // person in every other room they are in.
    expect(update?.filters).toMatchObject({ room_id: ROOM });
  });

  it("will not promote anyone to host", async () => {
    const { state } = install([member("f0c1d2", "guest", "2026-01-02T00:00:00Z")]);

    // `role` is typed, so this test casts to reach past the compiler and prove the runtime
    // behaviour a JS caller would actually get.
    await expect(
      setMemberRole({
        roomId: ROOM,
        memberToken: HOST_TOKEN,
        targetLabel: "f0c1d2",
        role: "host" as "trusted",
      }),
    ).rejects.toBeInstanceOf(MemberAdminError);

    // The guest is still a guest. A second host row would also violate the single-host
    // unique index, but it must never get that far.
    expect(state.rows.map((row) => row.role).sort()).toEqual(["guest", "host"]);
  });

  it("refuses to change the host's own role", async () => {
    const { state } = install([]);

    await expect(
      // `HOST_LABEL` is the host's own label, derived from their token hash.
      setMemberRole({ roomId: ROOM, memberToken: HOST_TOKEN, targetLabel: HOST_LABEL, role: "guest" }),
    ).rejects.toMatchObject({ code: "ROLE_HOST_LOCKED" });

    // The row is untouched: a host who demotes themselves leaves a room nobody administers.
    expect(state.rows.map((row) => row.role)).toEqual(["host"]);
  });

  it("reports an unknown label as not found rather than as an error", async () => {
    install([member("f0c1d2", "guest", "2026-01-02T00:00:00Z")]);

    await expect(
      setMemberRole({ roomId: ROOM, memberToken: HOST_TOKEN, targetLabel: "ffffff", role: "trusted" }),
    ).rejects.toMatchObject({ status: 404, code: "MEMBER_NOT_FOUND" });
  });

  it("refuses a label that is not six hex characters, before touching the database", async () => {
    const { log } = install([member("f0c1d2", "guest", "2026-01-02T00:00:00Z")]);

    await expect(
      setMemberRole({ roomId: ROOM, memberToken: HOST_TOKEN, targetLabel: "%", role: "trusted" }),
    ).rejects.toMatchObject({ code: "MEMBER_NOT_FOUND" });

    // A `%` would be a wildcard if it reached `like`. It must not.
    expect(log).toHaveLength(0);
  });
});

describe("removeMember", () => {
  it("removes the row, so the token stops working", async () => {
    const { state } = install([member("f0c1d2", "guest", "2026-01-02T00:00:00Z")]);

    await removeMember({ roomId: ROOM, memberToken: HOST_TOKEN, targetLabel: "f0c1d2" });

    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].role).toBe("host");
  });

  it("scopes the delete to the room", async () => {
    const { log } = install([member("f0c1d2", "guest", "2026-01-02T00:00:00Z")]);

    await removeMember({ roomId: ROOM, memberToken: HOST_TOKEN, targetLabel: "f0c1d2" });

    expect(log.find((entry) => entry.op === "delete")?.filters).toMatchObject({ room_id: ROOM });
  });

  it("refuses to remove the host", async () => {
    const { state } = install([]);

    await expect(
      removeMember({ roomId: ROOM, memberToken: HOST_TOKEN, targetLabel: HOST_LABEL }),
    ).rejects.toMatchObject({ code: "ROLE_HOST_LOCKED" });

    expect(state.rows).toHaveLength(1);
  });

  it("refuses a guest", async () => {
    install([member("f0c1d2", "guest", "2026-01-02T00:00:00Z")]);

    await expect(
      removeMember({ roomId: ROOM, memberToken: "guest-token", targetLabel: "f0c1d2" }),
    ).rejects.toMatchObject({ code: "INVITE_INVALID" });
  });
});

describe("host key spending, end to end through these functions", () => {
  it("leaves spending bounded to the members the host promoted", async () => {
    const { state } = install([
      member("bbbbbb", "guest", "2026-01-02T00:00:00Z"),
      member("cccccc", "guest", "2026-01-03T00:00:00Z"),
      member("dddddd", "guest", "2026-01-04T00:00:00Z"),
    ]);

    await setMemberRole({ roomId: ROOM, memberToken: HOST_TOKEN, targetLabel: "bbbbbb", role: "trusted" });

    // Four people in the room, one promotion, so two rows may now invoke the model and two
    // may not. This is the whole budget argument: an unpromoted guest is never charged, so
    // the exposure is the number the host chose rather than the number who showed up.
    const spenders = state.rows.filter((row) => row.role !== "guest");
    expect(spenders.map((row) => row.role)).toEqual(["host", "trusted"]);
    expect(state.rows.filter((row) => row.role === "guest")).toHaveLength(2);
  });

  it("stops a revoked member from spending, without deleting what they wrote", async () => {
    const { state } = install([
      member("bbbbbb", "guest", "2026-01-02T00:00:00Z"),
      member("cccccc", "guest", "2026-01-03T00:00:00Z"),
    ]);

    await setMemberRole({ roomId: ROOM, memberToken: HOST_TOKEN, targetLabel: "bbbbbb", role: "trusted" });
    // Revocation by demotion, the gentler of the two paths.
    await setMemberRole({ roomId: ROOM, memberToken: HOST_TOKEN, targetLabel: "bbbbbb", role: "guest" });

    const spenders = state.rows.filter((row) => row.role !== "guest");
    expect(spenders.map((row) => row.role)).toEqual(["host"]);
    // The row is still there, so the room's history is unchanged for everyone still in it.
    expect(state.rows).toHaveLength(3);
  });
});
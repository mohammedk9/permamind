import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sealed roster, and the rule the whole presence view rests on.
 *
 * ## What is being protected
 *
 * A room is described as collecting no personal data, and section 4 promises the server never
 * learns what anyone is called. Presence breaks that silence by necessity — the host is to
 * see names whether or not anyone has spoken, and a member who has not spoken has no message
 * to carry their name — so the name has to be stored somewhere.
 *
 * It is stored sealed. That keeps the promise: the server holds a string it cannot open.
 *
 * The rule these tests pin is narrower and is the one a refactor would break first: **only the
 * host may read the roster**. A version that checked "is this a member" instead of "is this
 * the host" would hand every guest the names of everyone else in the room, which is exactly
 * what the transcript deliberately refuses to do.
 */

// `server-only` is a build-time marker with no runtime export.
vi.mock("server-only", () => ({}));

const getSupabaseAdminClient = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient: () => getSupabaseAdminClient(),
}));

import { readRoster, setMemberAlias } from "../roster";

const ROOM = "BK7P2X";
const HOST_TOKEN = "host-token";
const HOST_HASH = createHash("sha256").update(HOST_TOKEN).digest("hex");
const SEALED = "aXYtY2lwaGVydGV4dA==";

function member(hash: string, role: string, aliasCiphertext: string | null) {
  return {
    room_id: ROOM,
    member_token_hash: hash,
    role,
    alias_ciphertext: aliasCiphertext,
    joined_at: "2026-01-01T00:00:00Z",
  };
}

/**
 * A fresh builder per `from()` call.
 *
 * Filters must be per-query. A shared accumulator leaks the previous statement's filters into
 * the next one, and here it leaked `assertHost`'s `member_token_hash` into the roster read —
 * so every test saw one row (the host's) instead of the whole room. Two of these tests failed
 * against code that was behaving correctly.
 */
function install(rows: Record<string, unknown>[]) {
  const state = { rows: [...rows], updates: [] as Record<string, unknown>[] };

  const from = () => {
    const filters: Record<string, unknown> = {};

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      maybeSingle: async () => ({
        data:
          state.rows.find((row) =>
            Object.entries(filters).every(([key, want]) => row[key] === want),
          ) ?? null,
        error: null,
      }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: state.rows.filter((row) =>
            Object.entries(filters).every(([key, want]) => row[key] === want),
          ),
          error: null,
        }).then(resolve),
      update: (patch: Record<string, unknown>) => {
        // Recorded with a live reference, so the `.eq` calls that follow are visible.
        const call = { patch, filters };
        state.updates.push(call);
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return chain;
          },
          maybeSingle: async () => ({ data: null, error: null }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        };
        return chain;
      },
    };

    return builder;
  };

  getSupabaseAdminClient.mockReturnValue({ from });
  return { ...state, from };
}

beforeEach(() => {
  vi.clearAllMocks();
  // A default client whose every query is empty, so a test that forgets to install one
  // reads as "no rows" rather than as an unexpected pass against a real client.
  install([]);
});

describe("readRoster", () => {
  it("gives the host the sealed names, never plaintext", async () => {
    install([member(HOST_HASH, "host", SEALED), member(`${"b".repeat(60)}`, "guest", SEALED)]);

    const roster = await readRoster({ roomId: ROOM, memberToken: HOST_TOKEN });

    expect(roster).toHaveLength(2);
    // Ciphertext out, not a name. If a plain alias ever appears here, the promise in
    // section 4 has been broken and this assertion is what would notice.
    expect(roster.every((entry) => entry.aliasCiphertext === SEALED)).toBe(true);
    expect(JSON.stringify(roster)).not.toContain("Sarah");
  });

  it("represents a nameless member as null, not as an empty sealed value", async () => {
    install([member(HOST_HASH, "host", null)]);

    const roster = await readRoster({ roomId: ROOM, memberToken: HOST_TOKEN });

    // Null is what lets the client tell "chose no name" from "chose an empty name" and fall
    // back to the generated label.
    expect(roster[0].aliasCiphertext).toBeNull();
  });

  it("refuses a guest before it reads anything", async () => {
    const guestHash = createHash("sha256").update("guest-token").digest("hex");
    install([member(HOST_HASH, "host", SEALED), member(guestHash, "guest", SEALED)]);

    await expect(readRoster({ roomId: ROOM, memberToken: "guest-token" })).rejects.toMatchObject({
      status: 404,
      code: "INVITE_INVALID",
    });
  });

  it("refuses a trusted member, who may spend the key but not read the roster", async () => {
    const trustedHash = createHash("sha256").update("trusted-token").digest("hex");
    install([member(trustedHash, "trusted", SEALED)]);

    // Trusted means "may invoke the model". It is a cost permission the host granted, not
    // authority over who the room is.
    await expect(readRoster({ roomId: ROOM, memberToken: "trusted-token" })).rejects.toMatchObject({
      status: 404,
      code: "INVITE_INVALID",
    });
  });

  it("orders the host first, then trusted, then guests", async () => {
    const hash = (token: string) => createHash("sha256").update(token).digest("hex");
    install([
      member(hash("g1"), "guest", null),
      member(hash("t1"), "trusted", null),
      member(hash("h1"), "host", null),
    ]);

    const roster = await readRoster({ roomId: ROOM, memberToken: "h1" });

    expect(roster.map((entry) => entry.role)).toEqual(["host", "trusted", "guest"]);
  });
});

describe("setMemberAlias", () => {
  it("writes the sealed name onto the caller's own row only", async () => {
    const state = install([member(HOST_HASH, "host", null)]);

    await setMemberAlias({
      roomId: ROOM,
      memberToken: HOST_TOKEN,
      aliasCiphertext: SEALED,
      aliasBytes: SEALED.length,
    });

    // Scoped to the caller's own hash. A version missing this would let a member stamp a
    // name onto somebody else's row.
    expect(state.updates[0].filters).toMatchObject({
      room_id: ROOM,
      member_token_hash: HOST_HASH,
    });
  });

  it("stores the ciphertext and its length, never a length derived from plaintext", async () => {
    const state = install([member(HOST_HASH, "host", null)]);

    await setMemberAlias({
      roomId: ROOM,
      memberToken: HOST_TOKEN,
      aliasCiphertext: SEALED,
      aliasBytes: SEALED.length,
    });

    expect(state.updates[0].patch).toEqual({ alias_ciphertext: SEALED, alias_bytes: SEALED.length });
  });

  it("refuses an empty sealed name", async () => {
    const state = install([member(HOST_HASH, "host", null)]);

    await expect(
      setMemberAlias({ roomId: ROOM, memberToken: HOST_TOKEN, aliasCiphertext: "", aliasBytes: 0 }),
    ).rejects.toMatchObject({ code: "ALIAS_INVALID" });

    expect(state.updates).toHaveLength(0);
  });

  it("refuses an oversized name", async () => {
    const state = install([member(HOST_HASH, "host", null)]);

    await expect(
      setMemberAlias({
        roomId: ROOM,
        memberToken: HOST_TOKEN,
        aliasCiphertext: SEALED,
        aliasBytes: 100_000,
      }),
    ).rejects.toMatchObject({ code: "ALIAS_INVALID" });

    expect(state.updates).toHaveLength(0);
  });
});
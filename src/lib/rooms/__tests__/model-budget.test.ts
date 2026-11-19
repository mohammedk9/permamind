import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The panel budget is now atomic.
 *
 * `resolveModelTarget` used to read `model_calls_total`, decide, and then write
 * `+1` in a second step. Two members pressing ask at the same instant could both
 * read a slot that had room for one and both be allowed. It now delegates the
 * check-and-increment to `reserve_room_model_call`, a single SQL statement, and
 * the AI route refunds the reservation with `release_room_model_call` when the
 * provider fails.
 *
 * These tests pin the contract at the TypeScript boundary: the RPC is called with
 * the addressed slot, a refusal from the RPC surfaces as MODEL_NOT_SHARED, and a
 * failed RPC is a 503 rather than a silent overspend.
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

import { releaseRoomModelCall, resolveModelTarget } from "../server";

const ROOM = "BK7P2X";
const SLOT = "11111111-1111-1111-1111-111111111111";

type Row = Record<string, unknown>;

/**
 * A `room_members` / rpc stub. `owner` is the addressed model's row, returned by
 * the `maybeSingle` read; `reserve` is what the RPC answers with.
 */
function install(options: { owner?: Row | null; reserve?: unknown; reserveError?: unknown }) {
  const rpcCalls: { fn: string; args: unknown }[] = [];

  const from = (_table: string) => {
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      maybeSingle: async () => ({
        data: options.owner === undefined ? ownerRow() : options.owner,
        error: null,
      }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  };

  const supabase = {
    from,
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === "reserve_room_model_call") {
        return { data: options.reserve ?? { allowed: true }, error: options.reserveError ?? null };
      }
      return { data: true, error: null };
    },
  };

  requireUser.mockResolvedValue({ supabase, user: { id: "member-account" } });
  return { rpcCalls };
}

function ownerRow(): Row {
  return {
    model_id: "openai/gpt-4o",
    model_label: "GPT-4o",
    model_specialty: "Critique",
    model_sharing: "on_request",
    model_call_limit: 10,
    model_daily_limit: null,
    model_calls_total: 2,
    model_calls_on: new Date().toISOString().slice(0, 10),
    model_calls_today: 2,
    user_id: "owner-account",
  };
}

beforeEach(() => vi.clearAllMocks());

describe("resolveModelTarget reserves atomically", () => {
  it("delegates the check-and-increment to the RPC with the addressed slot", async () => {
    const { rpcCalls } = install({ reserve: { allowed: true } });

    const target = await resolveModelTarget({ roomId: ROOM, slot: SLOT, onRequest: true });

    const reserve = rpcCalls.find((call) => call.fn === "reserve_room_model_call");
    expect(reserve).toBeDefined();
    expect(reserve?.args).toEqual({ p_room_id: ROOM, p_slot: SLOT });
    expect(target.modelId).toBe("openai/gpt-4o");
    expect(target.ownerId).toBe("owner-account");
  });

  it("surfaces a refused reservation as MODEL_NOT_SHARED", async () => {
    install({ reserve: { allowed: false } });

    await expect(
      resolveModelTarget({ roomId: ROOM, slot: SLOT, onRequest: true }),
    ).rejects.toMatchObject({ status: 403, code: "MODEL_NOT_SHARED" });
  });

  it("treats an unreadable reservation as a 503, never a silent overspend", async () => {
    install({ reserveError: { message: "rpc failed" } });

    await expect(
      resolveModelTarget({ roomId: ROOM, slot: SLOT, onRequest: true }),
    ).rejects.toMatchObject({ status: 503, code: "MODEL_BUDGET_UNAVAILABLE" });
  });

  it("refuses a slot whose model is gone, without touching the budget", async () => {
    const { rpcCalls } = install({ owner: null });

    await expect(
      resolveModelTarget({ roomId: ROOM, slot: SLOT, onRequest: true }),
    ).rejects.toMatchObject({ status: 404, code: "MODEL_NOT_FOUND" });

    expect(rpcCalls.find((call) => call.fn === "reserve_room_model_call")).toBeUndefined();
  });
});

describe("releaseRoomModelCall refunds a reservation", () => {
  it("calls release_room_model_call with the addressed slot", async () => {
    const { rpcCalls } = install({});

    await releaseRoomModelCall({ roomId: ROOM, slot: SLOT });

    const release = rpcCalls.find((call) => call.fn === "release_room_model_call");
    expect(release?.args).toEqual({ p_room_id: ROOM, p_slot: SLOT });
  });

  it("never throws, because the caller is already returning an error", async () => {
    requireUser.mockRejectedValue(new Error("db down"));
    await expect(releaseRoomModelCall({ roomId: ROOM, slot: SLOT })).resolves.toBeUndefined();
  });
});
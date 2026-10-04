import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who may spend the host's key, and when.
 *
 * These two rules were both missing from `resolveAiAccess`, and both were ways for a member to
 * keep spending after the host had stopped them.
 *
 * **A finished room spends nothing.** `readRoom` and `postMessage` both refuse a closed or
 * expired room. The AI path did not, because the service role bypasses row level security and
 * nothing below the application layer was looking. Closing a room stopped the conversation
 * while leaving the model callable — a `trusted` member drawing on the host's key against a
 * room the host had already ended.
 *
 * **Read-only stops spending, not only typing.** The role table gives read-only
 * `May invoke: No`, and `postMessage` already refused a guest's write in that state. The AI
 * path ignored it, so a host who had set `ai_audience` to `all` and then locked the room got a
 * room nobody could write in where every guest could still spend.
 *
 * Neither is a claim about whether the *host* may spend: that is the host's own money and the
 * host's own room, and both rules deliberately leave them exempt.
 */

vi.mock("server-only", () => ({}));

// The parameter is declared because the wrapper below forwards one argument into this spy;
// see the same note in `attribution.test.ts`.
const announceRoomChange = vi.fn(async (_feedId?: string | null) => {});
vi.mock("@/lib/rooms/realtime", () => ({
  announceRoomChange: (...args: unknown[]) => announceRoomChange(...(args as [string | null])),
}));

const requireUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  requireUser: (...args: unknown[]) => requireUser(...(args as [])),
}));

import { resolveAiAccess } from "../server";

const ROOM = "BK7P2X";
const TOKEN = "a".repeat(64);
const HOUR = 3_600_000;

/** An open room, expired `hoursFromNow` from now. */
function install(options: {
  role?: string | null;
  audience?: string;
  allowGuestWrite?: boolean;
  closedAt?: string | null;
  hoursFromNow?: number;
  /** A raw `expires_at`, for the case where the column itself is unreadable. */
  rawExpiresAt?: unknown;
  specialties?: string[];
  maxModels?: number | null;
}) {
  const role = options.role === undefined ? "guest" : options.role;
  const hours = options.hoursFromNow === undefined ? 24 : options.hoursFromNow;
  const roomRow: Record<string, unknown> | null =
    role === null
      ? null
      : {
          ai_audience: options.audience ?? "trusted",
          ai_provider: "openrouter",
          ai_model: "openai/gpt-4o",
          key_mode: "server",
          owner_id: "owner-1",
          ai_specialties: options.specialties ?? [],
          ai_max_models: options.maxModels === undefined ? null : options.maxModels,
          allow_guest_write: options.allowGuestWrite !== false,
          closed_at: options.closedAt ?? null,
          expires_at:
            options.rawExpiresAt !== undefined
              ? options.rawExpiresAt
              : new Date(Date.now() + hours * HOUR).toISOString(),
        };

  const from = (table: string) => {
    // Mutated in place rather than reassigned, so `const` is both correct and clearer.
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      maybeSingle: async () =>
        table === "room_members"
          ? { data: role === null ? null : { role }, error: null }
          : { data: roomRow, error: null },
      then: (resolve: (value: unknown) => unknown) => {
        const rows = table === "room_members" ? (role === null ? [] : [{ role }]) : [];
        const matches = (row: Record<string, unknown>) =>
          Object.entries(filters).every(([key, want]) => row[key] === want);
        return Promise.resolve({ data: rows.filter(matches), error: null }).then(resolve);
      },
    };
    return builder;
  };

  requireUser.mockResolvedValue({ supabase: { from }, user: { id: "owner-1" } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a finished room answers nothing", () => {
  it("refuses a closed room", async () => {
    install({ role: "trusted", closedAt: new Date().toISOString() });

    expect(await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN })).toBeNull();
  });

  it("refuses an expired room", async () => {
    install({ role: "trusted", hoursFromNow: -1 });

    expect(await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN })).toBeNull();
  });

  it("refuses a room whose expiry cannot be read", async () => {
    // A missing or malformed `expires_at` must fail closed. Treating it as "not expired yet"
    // would make a corrupt row permanent.
    install({ role: "trusted", rawExpiresAt: "not-a-date" });

    expect(await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN })).toBeNull();
  });

  it("refuses the host too, because the room is gone rather than quiet", async () => {
    install({ role: "host", closedAt: new Date().toISOString() });

    expect(await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN })).toBeNull();
  });

  it("lets an open room through, or the two checks above prove nothing", async () => {
    install({ role: "trusted", hoursFromNow: 24 });

    const access = await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN });
    expect(access?.mayInvokeModel).toBe(true);
  });

  it("still refuses a non-member an open room", async () => {
    install({ role: null });

    expect(await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN })).toBeNull();
  });
});

describe("read-only stops a guest spending", () => {
  it("refuses a guest who would otherwise be allowed, because the audience is everyone", async () => {
    // The exact combination that was open: `ai_audience = "all"` makes a guest an allowed
    // caller, and the lock was not consulted at all.
    install({ role: "guest", audience: "all", allowGuestWrite: false });

    const access = await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN });
    expect(access).not.toBeNull();
    expect(access?.mayInvokeModel).toBe(false);
  });

  it("refuses a guest in a locked room without needing the audience to be everyone", async () => {
    install({ role: "guest", audience: "trusted", allowGuestWrite: false });

    expect((await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN }))?.mayInvokeModel).toBe(false);
  });

  it("keeps the host able to ask their own model", async () => {
    // A host who cannot ask their own model has been locked out of their own room. The same
    // exemption `postMessage` makes, for the same reason.
    install({ role: "host", allowGuestWrite: false });

    expect((await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN }))?.mayInvokeModel).toBe(true);
  });

  it("keeps a trusted member able to invoke", async () => {
    // Promotion is the host's explicit grant of exactly this. Read-only is the host's
    // restriction on guests, and a trusted member is not a guest.
    install({ role: "trusted", allowGuestWrite: false });

    expect((await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN }))?.mayInvokeModel).toBe(true);
  });

  it("does not change an open room's behaviour", async () => {
    install({ role: "guest", audience: "all", allowGuestWrite: true });

    expect((await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN }))?.mayInvokeModel).toBe(true);
  });

  it("keeps the ordinary guest refusal intact", async () => {
    install({ role: "guest", audience: "trusted", allowGuestWrite: true });

    expect((await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN }))?.mayInvokeModel).toBe(false);
  });
});

describe("the host's cap reaches the AI layer", () => {
  it("returns the cap the host set", async () => {
    install({ role: "host", maxModels: 5 });

    expect((await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN }))?.aiMaxModels).toBe(5);
  });

  it("returns null rather than zero when no cap was set", async () => {
    // A room with no ceiling and a room whose ceiling is zero are different rooms, and the
    // column's own check already refuses zero, so the two must not collapse here.
    install({ role: "host", maxModels: null });

    expect((await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN }))?.aiMaxModels).toBeNull();
  });
});
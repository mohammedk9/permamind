import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Registering a model, and the cap the host set.
 *
 * `ai_max_models` was added to the room row during the attribution work and enforced nowhere:
 * the server wrote it, `resolveAiAccess` read it, and nothing ever compared a number against
 * it. A host who set "5 models" got a room that would have accepted any number of them, which
 * makes the setting a decoration rather than a bound.
 *
 * This file pins the bound. The cases that matter are the ones that make a cap a cap rather
 * than a suggestion — a caller supplying their own number, replacing a model without costing
 * a second slot, and a cap that is absent meaning "no ceiling" rather than "zero".
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

import { registerPanelModel } from "../server";

const ROOM = "BK7P2X";
const TOKEN = "a".repeat(64);
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest("hex");
const HOUR = 3_600_000;
const MODEL = "openai/gpt-4o";

function install(options: {
  maxModels?: number | null;
  /** How many members already have a model. */
  registered?: number;
  /** The caller's own current model, or null for none. */
  ownModelId?: string | null;
  seatUserId?: string | null;
  roomKind?: string;
  specialties?: string[];
}) {
  const updates: Record<string, unknown>[] = [];
  const ownModelId = options.ownModelId === undefined ? null : options.ownModelId;

  const roomRow = {
    room_kind: options.roomKind ?? "panel",
    ai_specialties: options.specialties ?? ["Critique", "Marketing"],
    ai_max_models: options.maxModels === undefined ? 3 : options.maxModels,
    closed_at: null,
    expires_at: new Date(Date.now() + HOUR).toISOString(),
  };

  const memberRow = {
    user_id: options.seatUserId === undefined ? "member-account" : options.seatUserId,
    model_id: ownModelId,
  };

  const from = (table: string) => {
    let selected = "";
    const filters: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {
      select: (columns: string) => {
        // The count query asks for a column and a `{count, head}` option; the others ask for
        // a column list. Distinguishing them is what lets one stub serve both.
        selected = typeof columns === "string" ? columns : "";
        if (typeof columns === "object" && columns !== null) builder.__count = true;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      not: (column: string, value: unknown) => {
        filters[`not_${column}`] = value;
        return builder;
      },
      maybeSingle: async () => {
        if (table === "rooms") return { data: roomRow, error: null };
        if (selected.includes("user_id")) return { data: memberRow, error: null };
        return { data: { role: "trusted" }, error: null };
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], count: options.registered ?? 0, error: null }).then(resolve),
      update: (patch: Record<string, unknown>) => {
        updates.push({ table, patch, filters });
        return {
          ...builder,
          then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r),
        };
      },
    };
    return builder;
  };

  requireUser.mockResolvedValue({ supabase: { from }, user: { id: "member-account" } });
  return updates;
}

const registration = (overrides: Partial<{ modelId: string; label: string; specialty: string }> = {}) => ({
  roomId: ROOM,
  memberToken: TOKEN,
  modelId: overrides.modelId ?? MODEL,
  modelLabel: overrides.label ?? "GPT-4o",
  specialty: overrides.specialty ?? "Critique",
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the cap the host set is enforced", () => {
  it("refuses a new model once the room is full", async () => {
    install({ maxModels: 2, registered: 2, ownModelId: null });

    await expect(registerPanelModel(registration())).rejects.toMatchObject({
      status: 409,
      code: "PANEL_CAP_REACHED",
    });
  });

  it("allows a new model while there is room", async () => {
    const updates = install({ maxModels: 2, registered: 1, ownModelId: null });

    await registerPanelModel(registration());

    expect(updates).toHaveLength(1);
  });

  it("lets a member replace their own model without costing a second slot", async () => {
    // The room is full, but this member already holds one of the slots. Counting a swap as a
    // new registration would let a member fill the room alone and then be unable to change
    // their mind — the cap would punish exactly the person already inside it.
    const updates = install({ maxModels: 2, registered: 2, ownModelId: MODEL });

    await registerPanelModel(registration({ modelId: "google/gemma-4-31b-it:free" }));

    expect(updates).toHaveLength(1);
  });

  it("treats no cap as no ceiling rather than as zero", async () => {
    const updates = install({ maxModels: null, registered: 99, ownModelId: null });

    await registerPanelModel(registration());

    expect(updates).toHaveLength(1);
  });
});

describe("a model may only be the caller's own", () => {
  it("writes to the row matching the caller's token", async () => {
    const updates = install({ ownModelId: null });

    await registerPanelModel(registration());

    // The only thing in the update's filter is the caller's own token hash. There is no
    // parameter through which another member's row could be named.
    expect(updates[0].filters).toEqual({ room_id: ROOM, member_token_hash: TOKEN_HASH });
  });

  it("refuses a seat belonging to another account", async () => {
    // A leaked member token must not be enough to register a model against someone else's
    // account, which would spend their key.
    install({ ownModelId: null, seatUserId: "somebody-else" });

    await expect(registerPanelModel(registration())).rejects.toMatchObject({
      status: 403,
      code: "NOT_YOUR_SEAT",
    });
  });

  it("refuses a caller with no account", async () => {
    install({ ownModelId: null });
    requireUser.mockResolvedValue({ supabase: { from: () => ({}) }, user: null });

    await expect(registerPanelModel(registration())).rejects.toMatchObject({
      status: 401,
      code: "SIGNIN_REQUIRED",
    });
  });
});

describe("only a panel room takes member models", () => {
  it("refuses a guest room", async () => {
    install({ roomKind: "guest", ownModelId: null });

    await expect(registerPanelModel(registration())).rejects.toMatchObject({
      code: "NOT_A_PANEL",
    });
  });
});

describe("a speciality is the host's to define", () => {
  it("refuses one the host never offered", async () => {
    install({ specialties: ["Critique"], ownModelId: null });

    await expect(registerPanelModel(registration({ specialty: "Marketing" }))).rejects.toMatchObject({
      code: "SPECIALTY_INVALID",
    });
  });

  it("refuses a model id that is not a real model", async () => {
    install({ ownModelId: null });

    await expect(
      registerPanelModel(registration({ modelId: "my-own-fine-tune" })),
    ).rejects.toMatchObject({ code: "MODEL_INVALID" });
  });
});
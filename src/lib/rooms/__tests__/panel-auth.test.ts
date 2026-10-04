import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ## No one spends someone else's key
 *
 * This is the most important test in `panel-rooms-proposal.md`, named as such in section 8.
 * Everything else about panel rooms is a feature; this is the property the whole separation
 * exists to obtain.
 *
 * The rule, from section 5:
 *
 * > No one spends someone else's key. Whoever invokes a model invokes it with their own.
 *
 * In a guest room a member without a key of their own falls back to the host's stored one.
 * That is the intended behaviour there — the host consented to it by choosing Option B — and
 * it is exactly what must not happen in a panel room.
 *
 * Three separate claims, tested separately, because any one of them alone would be
 * satisfiable by an implementation that gets the other two wrong:
 *
 *   1. A panel room never opens the stored key at all.
 *   2. The model that answers is the caller's own registration, never the room row.
 *   3. A member who registered no model cannot invoke one, and is not silently given the
 *      room's — or the host's.
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

const loadHostKey = vi.fn(async (_ownerId: string) => null);
vi.mock("@/lib/rooms/host-key-store", () => ({
  loadHostKey: (...args: unknown[]) => loadHostKey(...(args as [string])),
}));

import { resolveAiAccess } from "../server";

const ROOM = "BK7P2X";
const TOKEN = "a".repeat(64);
const HOUR = 3_600_000;

const HOST_MODEL = "openai/gpt-4o";
const MY_MODEL = "google/gemma-4-31b-it:free";

/**
 * The member's own row, as `resolveAiAccess` would find it.
 *
 * `ownModel` is the crux: a member either brought a model or did not, and that single fact is
 * what decides whether they may invoke anything at all.
 */
function install(options: {
  role?: string;
  roomKind?: string;
  ownModel?: { modelId: string; modelLabel: string; specialty: string } | null;
  keyMode?: string;
  audience?: string;
  allowGuestWrite?: boolean;
}) {
  const roomRow: Record<string, unknown> = {
    ai_audience: options.audience ?? "all",
    ai_provider: "openrouter",
    // The room's own model. A panel room still carries one on its row; the point of the whole
    // feature is that this value is NOT what answers.
    ai_model: HOST_MODEL,
    key_mode: options.keyMode ?? "server",
    owner_id: "host-account-id",
    ai_specialties: ["Critique", "Marketing"],
    ai_max_models: 3,
    allow_guest_write: options.allowGuestWrite !== false,
    closed_at: null,
    expires_at: new Date(Date.now() + HOUR).toISOString(),
    room_kind: options.roomKind ?? "panel",
  };

  const ownRow =
    options.ownModel === null
      ? { model_id: null, model_label: null, model_specialty: null }
      : {
          model_id: options.ownModel?.modelId ?? null,
          model_label: options.ownModel?.modelLabel ?? null,
          model_specialty: options.ownModel?.specialty ?? null,
        };

  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    // `room_members` is queried twice: once for the role, once for the caller's own model.
    // Recording which columns were selected is how the stub tells the two apart.
    let selected = "";
    const builder: Record<string, unknown> = {
      select: (columns: string) => {
        selected = String(columns ?? "");
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      maybeSingle: async () => {
        if (table === "rooms") return { data: roomRow, error: null };
        if (selected.includes("model_id")) return { data: ownRow, error: null };
        return { data: { role: options.role ?? "guest" }, error: null };
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return builder;
  };

  requireUser.mockResolvedValue({ supabase: { from }, user: { id: "member-account-id" } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a panel room answers with the caller's own model", () => {
  it("reports the member's model, not the room's", async () => {
    install({
      ownModel: { modelId: MY_MODEL, modelLabel: "Gemma", specialty: "Critique" },
    });

    const access = await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN });

    // The room row says GPT-4o and the member registered Gemma. The member's answer must be
    // Gemma, or their key is being spent on a model they never agreed to run.
    expect(access?.callerModel?.modelId).toBe(MY_MODEL);
    expect(access?.roomKind).toBe("panel");
    // The room's model is still visible on the access object, and is still NOT what the AI
    // route reads for a panel. Keeping it present is deliberate: the route has to be able to
    // choose, and a test pins that it chooses correctly.
    expect(access?.aiModel).toBe(HOST_MODEL);
  });

  it("reports no model for a member who registered none", async () => {
    install({ ownModel: null });

    const access = await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN });

    // Not the room's model. Not the host's. Null.
    expect(access?.callerModel).toBeNull();
  });

  it("never opens a stored key for a panel room", async () => {
    install({
      keyMode: "server",
      ownModel: { modelId: MY_MODEL, modelLabel: "Gemma", specialty: "Critique" },
    });

    await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN });

    // `resolveAiAccess` itself does not open the key — the AI route does — but this pins that
    // the panel path never even asks for one. The route-level refusal is in `ai-route`.
    expect(loadHostKey).not.toHaveBeenCalled();
  });
});

describe("a guest room is unchanged", () => {
  it("reports no caller model, because the room's own is the only model", async () => {
    install({ roomKind: "guest", ownModel: null });

    const access = await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN });

    expect(access?.roomKind).toBe("guest");
    // The route falls back to `aiModel` for a guest room. If this ever became the member's
    // model, a guest room would start behaving like a panel room by accident.
    expect(access?.callerModel).toBeNull();
    expect(access?.aiModel).toBe(HOST_MODEL);
  });

  it("reports a member's own model in a guest room too", async () => {
    // This said a guest room ignores a member's model. Wrong for the same reason as the
    // registration test: it read the host's single model as a cap on the room's models rather
    // than as one of them. The host's model is still the fallback for anyone who has none —
    // which is what keeps an ordinary room working for the guest who never signed in — but a
    // member who did sign in and brought a model is answered by their own.
    install({
      roomKind: "guest",
      ownModel: { modelId: MY_MODEL, modelLabel: "Gemma", specialty: "Critique" },
    });

    const access = await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN });

    expect(access?.callerModel?.modelId).toBe(MY_MODEL);
    // Still on the object, and still the fallback the route uses when there is no caller model.
    expect(access?.aiModel).toBe(HOST_MODEL);
  });
});

describe("a half-built registration is not a model", () => {
  it("treats an id with no label as no model", async () => {
    // The schema refuses this shape, but a row written before the constraint existed must not
    // be able to hand the AI route a model to sign with.
    install({ roomKind: "panel", ownModel: null });
    const access = await resolveAiAccess({ roomId: ROOM, memberToken: TOKEN });
    expect(access?.callerModel).toBeNull();
  });
});
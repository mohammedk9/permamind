import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Attribution: which model wrote an answer, and under which role.
 *
 * Two rules are load-bearing, and both are about a member being able to say something the
 * room would believe is not theirs.
 *
 * **A human row may not name a model.** Without the check, a member writes "GPT-4o: we should
 * ship on Friday" and the room reads a person's message as the model's finding. The schema
 * refuses it; `postMessage` refuses it first so the caller gets a sentence rather than a
 * constraint violation.
 *
 * **A role must be one the host offered.** A model cannot attach a role nobody agreed to. If
 * the field were free text it would be decorative, and the whole point of the host's list is
 * that the room knows what was agreed.
 *
 * The bridge tests live in `ai-bridge.test.ts` and are unchanged by this file. That is the
 * point: attribution adds text to the prompt, and the isolation assertion must still pass.
 */

// `server-only` is a build-time marker with no runtime export.
vi.mock("server-only", () => ({}));

// Optional rather than required: the forwarding wrapper below passes the feed id through, and
// an underscore-prefixed parameter keeps the unused-argument lint rule quiet without hiding
// the fact that the real function does take one.
const announceRoomChange = vi.fn(async (_feedId?: string | null) => {});
vi.mock("@/lib/rooms/realtime", () => ({
  announceRoomChange: (...args: unknown[]) => announceRoomChange(...(args as [string | null])),
}));

const requireUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ requireUser: (...args: unknown[]) => requireUser(...args) }));

import { createRoom, postMessage, RoomError } from "../server";

const ROOM = "BK7P2X";
const TOKEN = "a".repeat(64);
const CIPHERTEXT = "x".repeat(200);
const CONTENT_HASH = "b".repeat(64);

/**
 * A query builder whose results are asserted on rather than returned.
 *
 * `inserts` is the point of this file: several of these tests are about what would have been
 * written, and a test that only checked the resolved value would pass even if the label had
 * been dropped on the way to the database.
 */
function install(options: { specialties?: string[] } = {}) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  // The room quota counts active rooms through a head request and reads `count` off the
  // result. Zero keeps every createRoom test below the quota.
  let lastCount = 0;

  const from = (table: string) => {
    // `const` and mutated in place: a reassigned `filters` would be a new object each time,
    // and `maybeSingle` closes over the variable rather than a snapshot, so both work — but
    // the lint rule and the intent agree on this form.
    const filters: Record<string, unknown> = {};

    const builder: Record<string, unknown> = {
      select: (_columns?: string, options?: { count?: string; head?: boolean }) => {
        // `activeRoomCount` passes options and reads `count` off the result, so the terminal
        // has to carry it. Missing these chain verbs made four createRoom tests fail with
        // "is not a function" against code that was behaving correctly.
        if (options?.head) lastCount = 0;
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      is: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      gt: (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      },
      maybeSingle: async () => ({
        data:
          table === "room_members"
            ? { role: "host" }
            : {
                allow_guest_write: true,
                closed_at: null,
                expires_at: new Date(Date.now() + 3_600_000).toISOString(),
                feed_id: "f".repeat(32),
                ai_specialties: options.specialties ?? [],
                ai_model: "openai/gpt-4o",
                invite_code_hash: "h".repeat(64),
              },
        error: null,
      }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: { room_id: ROOM, invite_code_hash: "h".repeat(64) },
          error: null,
          count: lastCount,
        }).then(resolve),
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return {
          select: () => ({
            single: async () => ({ data: { ...row, id: "m1", seq: 1, created_at: "now" }, error: null }),
          }),
        };
      },
      update: (patch: Record<string, unknown>) => {
        updates.push({ table, patch });
        return { ...builder, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) };
      },
    };

    return builder;
  };

  requireUser.mockResolvedValue({ supabase: { from }, user: { id: "owner-1" } });
  return { inserts, updates };
}

function post(overrides: Record<string, unknown> = {}) {
  return postMessage({
    roomId: ROOM,
    memberToken: TOKEN,
    ciphertext: CIPHERTEXT,
    contentHash: CONTENT_HASH,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  announceRoomChange.mockResolvedValue(undefined);
  requireUser.mockResolvedValue({ supabase: { from: () => ({}) }, user: { id: "owner-1" } });
});

describe("postMessage attribution", () => {
  it("records the model and role on an ai row", async () => {
    const { inserts } = install({ specialties: ["Critique", "Marketing"] });

    await post({
      kind: "ai",
      modelLabel: "GPT-4o",
      modelSpecialty: "Critique",
    });

    const message = inserts.find((entry) => entry.table === "room_messages");
    expect(message?.row).toMatchObject({
      kind: "ai",
      model_label: "GPT-4o",
      model_specialty: "Critique",
    });
  });

  it("refuses an ai row with no model", async () => {
    const { inserts } = install();

    await expect(post({ kind: "ai" })).rejects.toMatchObject({ code: "MODEL_LABEL_REQUIRED" });
    expect(inserts.filter((entry) => entry.table === "room_messages")).toHaveLength(0);
  });

  it("refuses a human row that names a model", async () => {
    const { inserts } = install();

    // The impersonation case: a member writing in a model's voice.
    await expect(post({ kind: "human", modelLabel: "GPT-4o" })).rejects.toMatchObject({
      code: "MODEL_LABEL_NOT_ALLOWED",
    });
    expect(inserts.filter((entry) => entry.table === "room_messages")).toHaveLength(0);
  });

  it("writes null attribution on a human row rather than an empty string", async () => {
    const { inserts } = install();

    await post({ kind: "human", alias: undefined });

    const message = inserts.find((entry) => entry.table === "room_messages");
    expect(message?.row).toMatchObject({ model_label: null, model_specialty: null });
  });

  it("refuses a role the host never offered", async () => {
    const { inserts } = install({ specialties: ["Critique"] });

    await expect(
      post({ kind: "ai", modelLabel: "GPT-4o", modelSpecialty: "Marketing" }),
    ).rejects.toMatchObject({ code: "SPECIALTY_UNKNOWN" });

    expect(inserts.filter((entry) => entry.table === "room_messages")).toHaveLength(0);
  });

  it("accepts a role the host offered", async () => {
    const { inserts } = install({ specialties: ["Critique", "Marketing"] });

    await post({ kind: "ai", modelLabel: "GPT-4o", modelSpecialty: "Marketing" });

    const message = inserts.find((entry) => entry.table === "room_messages");
    expect(message?.row).toMatchObject({ model_specialty: "Marketing" });
  });

  it("drops a role in a room that offers none, rather than refusing the answer", async () => {
    const { inserts } = install({ specialties: [] });

    // Every room that predates this offers no roles. Refusing here would make the model
    // unusable in all of them, so the role is simply dropped and the answer is kept.
    await post({ kind: "ai", modelLabel: "GPT-4o", modelSpecialty: "Critique" });

    const message = inserts.find((entry) => entry.table === "room_messages");
    expect(message?.row).toMatchObject({ model_label: "GPT-4o", model_specialty: null });
  });

  it("refuses an over-long model label", async () => {
    install();
    await expect(post({ kind: "ai", modelLabel: "m".repeat(61) })).rejects.toMatchObject({
      code: "MODEL_LABEL_TOO_LONG",
    });
  });

  it("trims the label rather than storing the padding", async () => {
    const { inserts } = install();

    await post({ kind: "ai", modelLabel: "  GPT-4o  " });

    const message = inserts.find((entry) => entry.table === "room_messages");
    expect(message?.row).toMatchObject({ model_label: "GPT-4o" });
  });

  it("reads back as attribution, not as an alias", async () => {
    install({ specialties: ["Critique"] });

    const row = await post({ kind: "ai", modelLabel: "GPT-4o", modelSpecialty: "Critique" });

    // A model row must never carry a human name. The renderer picks the model name from
    // these columns, so an alias here would be a second, disagreeing speaker name.
    expect(row.modelLabel).toBe("GPT-4o");
    expect(row.modelSpecialty).toBe("Critique");
    expect(row.kind).toBe("ai");
  });
});

describe("createRoom specialities", () => {
  it("stores the roles the host offered, in order", async () => {
    const { inserts } = install();

    await createRoom({
      title: "Launch",
      topic: "pricing",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      aiProvider: "openrouter",
      aiModel: "openai/gpt-4o",
      keyMode: "browser",
      keyExpiresAt: null,
      allowGuestWrite: true,
      requireDisplayName: true,
      aiSpecialties: ["Critique", "Marketing", "Explain"],
      inviteCode: "483926",
      hostCode: "BK7P2X",
      wrappedRoomKey: "x".repeat(200),
      wrapSalt: "c2FsdA==",
    });

    const room = inserts.find((entry) => entry.table === "rooms");
    expect(room?.row).toMatchObject({
      ai_specialties: ["Critique", "Marketing", "Explain"],
      ai_max_models: null,
    });
  });

  it("de-duplicates roles rather than refusing a host's typo", async () => {
    const { inserts } = install();

    await createRoom({
      title: "Launch",
      topic: "pricing",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      aiProvider: "openrouter",
      aiModel: "openai/gpt-4o",
      keyMode: "browser",
      keyExpiresAt: null,
      allowGuestWrite: true,
      requireDisplayName: true,
      aiSpecialties: ["Critique", "critique", " Marketing "],
      inviteCode: "483926",
      hostCode: "BK7P2X",
      wrappedRoomKey: "x".repeat(200),
      wrapSalt: "c2FsdA==",
    });

    const room = inserts.find((entry) => entry.table === "rooms");
    // Two options, not three: the list renders as a fixed control where a duplicate would be
    // a visibly broken choice.
    expect(room?.row).toMatchObject({ ai_specialties: ["Critique", "Marketing"] });
  });

  it("refuses more roles than the room can hold", async () => {
    install();
    await expect(
      createRoom({
        title: "Launch",
        topic: "pricing",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        aiProvider: "openrouter",
        aiModel: "openai/gpt-4o",
        keyMode: "browser",
        keyExpiresAt: null,
        allowGuestWrite: true,
        requireDisplayName: true,
        aiSpecialties: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
        inviteCode: "483926",
        hostCode: "BK7P2X",
        wrappedRoomKey: "x".repeat(200),
        wrapSalt: "c2FsdA==",
      }),
    ).rejects.toBeInstanceOf(RoomError);
  });

  it("refuses a model cap of zero", async () => {
    install();
    await expect(
      createRoom({
        title: "Launch",
        topic: "pricing",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        aiProvider: "openrouter",
        aiModel: "openai/gpt-4o",
        keyMode: "browser",
        keyExpiresAt: null,
        allowGuestWrite: true,
        requireDisplayName: true,
        aiSpecialties: ["Critique"],
        aiMaxModels: 0,
        inviteCode: "483926",
        hostCode: "BK7P2X",
        wrappedRoomKey: "x".repeat(200),
        wrapSalt: "c2FsdA==",
      }),
    ).rejects.toMatchObject({ code: "MAX_MODELS_INVALID" });
  });

  it("leaves an ordinary room with no roles at all", async () => {
    const { inserts } = install();

    await createRoom({
      title: "Launch",
      topic: "pricing",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      aiProvider: "openrouter",
      aiModel: "openai/gpt-4o",
      keyMode: "browser",
      keyExpiresAt: null,
      allowGuestWrite: true,
      requireDisplayName: true,
      inviteCode: "483926",
      hostCode: "BK7P2X",
      wrappedRoomKey: "x".repeat(200),
      wrapSalt: "c2FsdA==",
    });

    const room = inserts.find((entry) => entry.table === "rooms");
    // The default every existing room already has.
    expect(room?.row).toMatchObject({ ai_specialties: [], ai_max_models: null });
  });
});
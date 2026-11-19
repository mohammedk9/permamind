import { beforeEach, describe, expect, it, vi } from "vitest";

// Retrieval writes the conversation graph as a side effect of reading it. None of
// these tests are about the graph, so it is stubbed rather than allowed to touch
// the user's storage.
vi.mock("@/lib/memory/graph", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/memory/graph")>();
  return { ...actual, updateMemoryGraph: vi.fn(() => ({ version: 1, nodes: [], edges: [] })) };
});

import { retrieveRelevantMemories } from "../retrieve";
import type { Conversation, Message } from "@/types/chat";
import type { MemoryRecord } from "@/types/memory";

const NOW = new Date();
const OLD = new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 40);

function message(id: string, content: string, role: Message["role"] = "user"): Message {
  return { id, role, content, createdAt: NOW };
}

function conversation(
  id: string,
  title: string,
  options: { messages?: Message[]; summary?: string; updatedAt?: Date } = {},
): Conversation {
  const updatedAt = options.updatedAt ?? NOW;
  return {
    id,
    title,
    messages: options.messages ?? [],
    createdAt: updatedAt,
    updatedAt,
    ...(options.summary
      ? {
          metadata: {
            summary: options.summary,
            topics: [],
            tags: [],
            entities: [],
            messageFingerprint: `${id}-print`,
            generatedAt: updatedAt,
          },
        }
      : {}),
  };
}

const records: MemoryRecord[] = [];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("retrieveRelevantMemories", () => {
  it("finds a message from early in a long conversation", () => {
    // The chat path used to index only the last six messages per conversation,
    // so this memory was unreachable no matter how it was asked for.
    const messages = [
      message("m1", "the orbit insertion burn slipped to Tuesday"),
      ...Array.from({ length: 11 }, (_, index) => message(`m${index + 2}`, `routine update ${index}`)),
    ];

    const memories = retrieveRelevantMemories(
      "orbit insertion burn",
      [conversation("c1", "Orbit probe", { messages })],
      null,
      false,
      records,
      [],
    );

    expect(memories.some((memory) => memory.excerpt.includes("orbit insertion burn"))).toBe(true);
  });

  it("does not fill the memory block with unrelated recent conversations", () => {
    // `recency` used to be added to a score whose threshold was lower than
    // recency itself, so every recent summary qualified on every reply.
    const conversations = [
      conversation("match", "Probe", {
        summary: "the orbit insertion burn moved to Tuesday",
        messages: [message("m1", "the orbit insertion burn moved")],
      }),
      conversation("noise1", "Groceries", { summary: "milk, bread, coffee" }),
      conversation("noise2", "Weekend", { summary: "a walk in the park" }),
      conversation("noise3", "Work", { summary: "quarterly planning notes" }),
    ];

    const memories = retrieveRelevantMemories(
      "orbit insertion burn",
      conversations,
      null,
      false,
      records,
      [],
    );

    expect(memories.map((memory) => memory.conversationId)).toEqual(["match"]);
  });

  it("ranks the conversation that matches more of the query first", () => {
    const conversations = [
      conversation("weak", "Launch chatter", {
        summary: "we keep talking about the launch date",
        messages: [message("m1", "the launch date keeps moving")],
      }),
      conversation("strong", "Launch plan", {
        summary: "the launch plan has three phases",
        messages: [message("m2", "the launch plan has three phases")],
      }),
    ];

    const memories = retrieveRelevantMemories(
      "launch plan",
      conversations,
      null,
      false,
      records,
      [],
    );

    expect(memories[0].conversationId).toBe("strong");
  });

  it("still answers a recall question that has no keywords left", () => {
    const memories = retrieveRelevantMemories(
      "ماذا قلت سابقا؟",
      [
        conversation("c1", "Old chat", {
          summary: "we talked about the launch plan",
          messages: [message("m1", "the launch plan")],
          updatedAt: OLD,
        }),
      ],
      null,
      true,
      records,
      [],
    );

    expect(memories.length).toBeGreaterThan(0);
  });

  it("returns nothing when nothing matches and there is no recent history", () => {
    const memories = retrieveRelevantMemories(
      "spectrometer calibration",
      [conversation("c1", "Groceries", { summary: "milk and bread" })],
      null,
      false,
      records,
      [],
    );

    expect(memories).toEqual([]);
  });

  it("does not write the conversation graph while ranking", () => {
    // A read path that writes can fail on a full quota, and this one runs inside
    // the request that produces the user's reply.
    const writes = vi.spyOn(Storage.prototype, "setItem");

    retrieveRelevantMemories(
      "launch plan",
      [conversation("c1", "Launch", { summary: "the launch plan", messages: [message("m1", "launch")] })],
      null,
      false,
      records,
      [],
    );

    expect(writes.mock.calls.map(([key]) => key)).not.toContain("permamind:memory-graph:v1");
    writes.mockRestore();
  });
});

describe("semantic vectors and the dimension guard", () => {
  const pinnedRecord: MemoryRecord = {
    id: "d1",
    kind: "decision",
    text: "launch on Tuesday after the beta",
    conversationId: "c1",
    conversationTitle: "Launch",
    confidence: "high",
    pinned: true,
    status: "active",
    source: "user",
    updatedAt: new Date().toISOString(),
  };

  it("ignores a record that has no vector from the query's model", () => {
    // A 256-dimension model query compared with a 96-dimension hashed record
    // yields a cosine that looks like a score and means nothing. The guard must
    // drop the record instead — even a pinned one.
    const memories = retrieveRelevantMemories(
      "launch",
      [conversation("c1", "Launch")],
      null,
      false,
      [pinnedRecord],
      [],
      { queryVector: new Float32Array(256).fill(0.25) },
    );

    expect(memories.some((memory) => memory.recordId === "d1")).toBe(false);
  });

  it("uses a record vector when it comes from the same model", () => {
    const queryVector = new Float32Array(256).fill(0.25);
    const recordVector = new Float32Array(256).fill(0.25);

    const memories = retrieveRelevantMemories(
      "launch",
      [conversation("c1", "Launch")],
      null,
      false,
      [pinnedRecord],
      [],
      {
        queryVector,
        recordVectors: new Map([[pinnedRecord.id, recordVector]]),
      },
    );

    expect(memories.some((memory) => memory.recordId === "d1")).toBe(true);
  });

  it("still uses the local embedder for everything when no model is given", () => {
    // The default path must be byte-for-byte the old behaviour: hashed query and
    // hashed records, 96 dimensions each.
    const memories = retrieveRelevantMemories(
      "launch",
      [conversation("c1", "Launch")],
      null,
      false,
      [pinnedRecord],
      [],
    );

    expect(memories.some((memory) => memory.recordId === "d1")).toBe(true);
  });

  it("ignores a summary vector whose width does not match the query", () => {
    const conversations = [
      conversation("c1", "Launch", {
        summary: "a summary about the launch plan",
        messages: [message("m1", "launch plan")],
      }),
    ];

    const memories = retrieveRelevantMemories(
      "unmatched query about zebras",
      conversations,
      null,
      false,
      [],
      [{ id: "summary:c1", vector: new Float32Array(96).fill(0.3) }],
      { queryVector: new Float32Array(256).fill(0.3) },
    );

    expect(memories.some((memory) => memory.reason === "meaning match")).toBe(false);
  });
});
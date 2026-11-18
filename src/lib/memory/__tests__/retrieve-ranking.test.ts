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
});
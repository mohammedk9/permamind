import { describe, expect, it, beforeEach } from "vitest";
import { buildMessagesWithMemory } from "../context";
import { syncExtractedMemory } from "../ledger";
import { formatConversationForSummary } from "@/lib/ai/summarize";
import { trimToApiLimit } from "@/components/chat/chat-app";
import {
  isPreviousConversationQuery,
  previousConversationSearchQuery,
  retrieveRelevantMemories,
} from "../retrieve";
import type { Conversation, Message } from "@/types/chat";

const date = new Date("2026-01-01T00:00:00Z");
const conversations: Conversation[] = [{
  id: "old", title: "Project notes", createdAt: date, updatedAt: date,
  messages: [
    { id: "u1", role: "user", content: "My previous project was Atlas", createdAt: date },
    { id: "a1", role: "assistant", content: "We planned an Atlas deployment with a blue-green rollout.", createdAt: date },
  ],
}];

describe("reliable cross-conversation recall", () => {
  beforeEach(() => localStorage.clear());

  it("detects previous-conversation phrasing and keeps the subject", () => {
    expect(isPreviousConversationQuery("did we talk about Atlas?")).toBe(true);
    expect(previousConversationSearchQuery("did we talk about Atlas?")).toBe("Atlas?");
    expect(isPreviousConversationQuery("what did you say before")).toBe(true);
  });

  it("retrieves the exact stored message, not only metadata", () => {
    const memories = retrieveRelevantMemories("Atlas", conversations, null, true);
    expect(memories.some((memory) => memory.excerpt === "My previous project was Atlas" && memory.messageId === "u1")).toBe(true);
  });

  it("retrieves a prior conversation for a generic what-did-you-say query", () => {
    const memories = retrieveRelevantMemories("", conversations, null, true);
    expect(memories.length).toBeGreaterThan(0);
  });

  it("instructs the model not to hallucinate when memory is missing", () => {
    const messages = buildMessagesWithMemory([{ role: "user", content: "what did you say before" }], [], true);
    expect(messages[0].content).toContain("no previous conversation was found");
    expect(messages[0].content).toContain("Do not answer from general knowledge");
  });

  it("detects Arabic previous-conversation phrasing and keeps the subject", () => {
    expect(isPreviousConversationQuery("ما اسم المشروع الذي ذكرته سابقا؟")).toBe(true);
    expect(previousConversationSearchQuery("ما اسم المشروع الذي ذكرته سابقا؟")).toBe("اسم المشروع");
    expect(isPreviousConversationQuery("ماذا قلت سابقا؟")).toBe(true);
    expect(previousConversationSearchQuery("ماذا قلت سابقا؟")).toBe("");
  });

  it("retrieves Arabic messages across conversations with normalized spelling", () => {
    const arabicConversations: Conversation[] = [{
      id: "ar-old",
      title: "ملاحظات المشروع",
      createdAt: date,
      updatedAt: date,
      messages: [
        { id: "ar-u1", role: "user", content: "اسم المشروع أطلس وسأستخدم النشر الأزرق والأخضر", createdAt: date },
        { id: "ar-a1", role: "assistant", content: "سجلت أن أطلس سيستخدم النشر الأزرق والأخضر", createdAt: date },
      ],
    }];

    const memories = retrieveRelevantMemories("أَطْلُس", arabicConversations, null, false);
    expect(memories.some((memory) => memory.messageId === "ar-u1" && memory.excerpt.includes("أطلس"))).toBe(true);
  });

  it("retrieves a prior Arabic conversation for a generic what-did-you-say query", () => {
    const arabicConversations: Conversation[] = [{
      id: "ar-old",
      title: "محادثة سابقة",
      createdAt: date,
      updatedAt: date,
      messages: [
        { id: "ar-u1", role: "user", content: "المشروع الذي اخترته هو أطلس", createdAt: date },
      ],
    }];

    const memories = retrieveRelevantMemories("", arabicConversations, null, true);
    expect(memories.some((memory) => memory.excerpt.includes("أطلس"))).toBe(true);
  });

  it("reaches an older conversation when the recall query has no keywords left", () => {
    // "ماذا قلت سابقا؟" strips down to the empty string, so there is nothing to
    // match against. Every message used to score identically and the selector
    // kept only the newest ones, which made older conversations unreachable.
    const now = Date.now();
    const many: Conversation[] = Array.from({ length: 6 }, (_, index) => {
      const stamp = new Date(now - (index + 1) * 86_400_000);
      return {
        id: `conv-${index}`,
        title: `محادثة ${index}`,
        createdAt: stamp,
        updatedAt: stamp,
        messages: [
          { id: `u-${index}`, role: "user" as const, content: ` معلومة رقم ${index} `, createdAt: stamp },
        ],
      };
    });

    const memories = retrieveRelevantMemories("", many, null, true);
    const ids = new Set(memories.map((memory) => memory.conversationId));
    expect(ids.size).toBeGreaterThan(1);
  });

  it("keeps a decision record when the query is a decision question", () => {
    const records = syncExtractedMemory({
      id: "conv-1",
      title: "قرار",
      createdAt: date,
      updatedAt: date,
      messages: [],
      metadata: {
        summary: "",
        topics: [],
        tags: [],
        entities: [],
        messageFingerprint: "fp-1",
        generatedAt: date,
        facts: [],
        decisions: [{ decision: "استخدام النشر الأزرق والأخضر", status: "active" }],
      },
    });

    // A lexical hit takes the first return path; the decision flag must survive it.
    const memories = retrieveRelevantMemories(
      "ما القرار الذي اخترناه",
      [{ ...conversations[0], id: "other" }],
      null,
      false,
      records,
    );
    expect(memories.some((memory) => memory.recordId)).toBe(true);
  });
});

/**
 * A conversation that outgrows the API's message cap.
 *
 * `/api/chat` and `/api/summarize` both reject a request carrying more than 100
 * messages, and the client sent the entire history with no cap. On message 101
 * every send failed with "Messages are required" and every summary failed with
 * "At least 2 messages required" — the reply button stopped working and the
 * memory ledger stopped receiving new facts and decisions, permanently.
 */
describe("long conversations stay inside the API message cap", () => {
  const MAX_MESSAGES = 100;

  function history(count: number): Message[] {
    return Array.from({ length: count }, (_, index) => ({
      id: `m-${index}`,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message ${index}`,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }));
  }

  it("keeps the request at or below the cap as history grows", () => {
    for (const count of [99, 100, 101, 250, 600]) {
      const trimmed = trimToApiLimit(history(count));
      expect(trimmed.length).toBeLessThanOrEqual(MAX_MESSAGES);
      // The newest turn must survive trimming, or the model answers a question
      // it cannot see.
      expect(trimmed[trimmed.length - 1].content).toBe(`message ${count - 1}`);
    }
  });

  it("keeps the summary prompt inside the cap", () => {
    const text = formatConversationForSummary(history(600));
    expect(text.length).toBeGreaterThan(0);
    // formatConversationForSummary applies its own, much smaller, cap.
    const lines = text.split("\n").filter((line) => line.trim());
    expect(lines.length).toBeLessThanOrEqual(16);
  });
});
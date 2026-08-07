import { describe, expect, it } from "vitest";
import { generateMemoryInsights } from "../insights";
import type { Conversation } from "@/types/chat";

const date = new Date("2026-01-01");
const conversation = (id: string, topic: string): Conversation => ({ id, title: id, messages: [{ id: `${id}-m`, role: "user", content: "hello", createdAt: date }], createdAt: date, updatedAt: date, metadata: { summary: "", topics: [topic], tags: ["work"], entities: ["Acme"], messageFingerprint: "", generatedAt: date } });

describe("generateMemoryInsights", () => {
  it("aggregates local metadata and message statistics", () => {
    const result = generateMemoryInsights([conversation("a", "Planning"), conversation("b", "planning")]);
    expect(result.topics[0]).toEqual({ name: "Planning", count: 2 });
    expect(result.tags[0].count).toBe(2);
    expect(result.conversationStats.messages).toBe(2);
  });
});
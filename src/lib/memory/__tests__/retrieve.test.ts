import { describe, expect, it } from "vitest";
import { estimateMemoryTokens, recencyScore, scoreMemory, selectMemoriesByScore } from "../retrieve";
import type { RetrievedMemory } from "@/types/memory";

const memory = (id: string, score: number, excerpt = "memory text"): RetrievedMemory => ({
  conversationId: id, conversationTitle: id, source: "summary", excerpt, score, updatedAt: new Date(),
});

describe("intelligent memory ranking", () => {
  it("uses summary, entity, and tag relevance", () => {
    const result = scoreMemory("Alice gardening", memory("x", 0, "garden plans"), {
      summary: "Alice's garden", entities: ["Alice"], tags: ["gardening"],
    });
    expect(result.summaryRelevance).toBeGreaterThan(0);
    expect(result.entityOverlap).toBeGreaterThan(0);
    expect(result.tagOverlap).toBeGreaterThan(0);
  });
  it("ranks by score and removes duplicate conversations", () => {
    expect(selectMemoriesByScore([memory("a", 2), memory("a", 1), memory("b", 1)]).map((m) => m.conversationId)).toEqual(["a", "b"]);
  });
  it("respects token budget", () => {
    expect(selectMemoriesByScore([memory("a", 2, "x".repeat(80)), memory("b", 1, "y".repeat(80))], 25)).toHaveLength(1);
  });
  it("scores recent memories higher", () => {
    const now = new Date("2026-01-02T12:00:00Z").getTime();
    expect(recencyScore(new Date("2026-01-02"), now)).toBeGreaterThan(recencyScore(new Date("2025-12-01"), now));
  });
  it("estimates memory token size", () => expect(estimateMemoryTokens(memory("a", 1, "1234"))).toBeGreaterThan(0));
});
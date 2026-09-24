import { describe, expect, it } from "vitest";
import { buildMessagesWithMemory } from "../context";
import type { MemoryRecord, RetrievedMemory } from "@/types/memory";

const date = new Date("2026-01-01T00:00:00Z");
const memory: RetrievedMemory = { conversationId: "old", conversationTitle: "Old", source: "summary", excerpt: "Keep this memory", score: 1, updatedAt: date };
const excluded: RetrievedMemory = { ...memory, conversationId: "secret", excerpt: "Exclude this memory" };
const record: MemoryRecord = { id: "r", kind: "fact", text: "Stable fact", conversationId: "old", conversationTitle: "Old", confidence: "high", pinned: false, status: "active", source: "extracted", updatedAt: date.toISOString() };
const excludedRecord: MemoryRecord = { ...record, id: "x", text: "Excluded fact" };

describe("per-message memory review", () => {
  it("omits excluded items from the request without changing stored records", () => {
    const original = excludedRecord.text;
    const messages = buildMessagesWithMemory(
      [{ role: "user", content: "hello" }],
      [memory].filter((item) => item !== excluded),
      false,
      "",
      [record].filter((item) => item !== excludedRecord),
    );
    expect(messages[0].content).toContain("Keep this memory");
    expect(messages[0].content).toContain("Stable fact");
    expect(messages[0].content).not.toContain("Exclude this memory");
    expect(messages[0].content).not.toContain("Excluded fact");
    expect(excludedRecord.text).toBe(original);
  });
});

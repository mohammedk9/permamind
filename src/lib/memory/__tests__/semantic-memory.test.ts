import { beforeEach, describe, expect, it } from "vitest";
import { buildMessagesWithMemory } from "../context";
import { cosineSimilarity, embedText, syncMemoryEmbeddings } from "../embeddings";
import { forgetMemoryRecord, syncExtractedMemory, updateMemoryRecord } from "../ledger";
import { retrieveRelevantMemories } from "../retrieve";
import type { Conversation } from "@/types/chat";

const date = new Date("2026-01-01T00:00:00Z");
const conversation: Conversation = {
  id: "garden",
  title: "Home plans",
  createdAt: date,
  updatedAt: date,
  messages: [{ id: "u", role: "user", content: "I prefer morning work.", createdAt: date }],
  metadata: {
    summary: "The user prefers morning work and chose a blue green deployment.",
    topics: ["work"], tags: [], entities: [], messageFingerprint: "1", generatedAt: date,
    facts: [{ category: "preference", value: "Prefers focused work early in the morning" }],
    decisions: [{ decision: "Use a blue green deployment", reason: "It allows rollback", status: "active" }],
  },
};

describe("local semantic memory", () => {
  beforeEach(() => localStorage.clear());

  it("matches related meaning more strongly than unrelated text", () => {
    const query = embedText("when is the best time to concentrate");
    const related = cosineSimilarity(query, embedText("focused work early in the morning"));
    const unrelated = cosineSimilarity(query, embedText("tomato soup recipe"));
    expect(related).toBeGreaterThan(unrelated);
  });

  it("stores encrypted vectors without the source text", async () => {
    await syncMemoryEmbeddings([{ id: "summary:garden", conversationId: "garden", conversationTitle: "Home plans", source: "summary", text: "secret morning preference", updatedAt: date.toISOString() }]);
    const stored = localStorage.getItem("permamind:memory-embeddings:v1") ?? "";
    expect(stored).not.toContain("secret morning preference");
    expect(stored).toContain("vector");
  });

  it("retrieves a memory by meaning when the wording differs", () => {
    const records = syncExtractedMemory(conversation);
    const memories = retrieveRelevantMemories("rollback release strategy", [], null, false, records);
    expect(memories.some((memory) => memory.excerpt.includes("blue green"))).toBe(true);
  });
});

describe("editable structured memory", () => {
  beforeEach(() => localStorage.clear());

  it("puts source, date, and confidence into the reply context", () => {
    const records = syncExtractedMemory(conversation);
    const messages = buildMessagesWithMemory([{ role: "user", content: "hello" }], [], false, "", records);
    expect(messages[0].content).toContain("Prefers focused work");
    expect(messages[0].content).toContain("high confidence");
    expect(messages[0].content).toContain("Home plans");
  });

  it("uses a correction and excludes a forgotten memory", () => {
    const record = syncExtractedMemory(conversation).find((item) => item.kind === "preference")!;
    updateMemoryRecord(record.id, { text: "Prefers evening work" });
    const corrected = buildMessagesWithMemory([{ role: "user", content: "hello" }], [], false, "", JSON.parse(localStorage.getItem("permamind:memory-ledger:v1")!).records);
    expect(corrected[0].content).toContain("evening work");
    expect(corrected[0].content).not.toContain("early in the morning");

    forgetMemoryRecord(record.id);
    const forgotten = buildMessagesWithMemory([{ role: "user", content: "hello" }], [], false, "", JSON.parse(localStorage.getItem("permamind:memory-ledger:v1")!).records);
    expect(forgotten[0].content).not.toContain("evening work");
    expect(forgotten[0].content).toContain("blue green deployment");
  });

  it("does not let a later extraction overwrite a user correction", () => {
    const record = syncExtractedMemory(conversation).find((item) => item.kind === "preference")!;
    updateMemoryRecord(record.id, { text: "Corrected preference" });
    syncExtractedMemory(conversation);
    const stored = JSON.parse(localStorage.getItem("permamind:memory-ledger:v1")!).records;
    expect(stored.find((item: { id: string }) => item.id === record.id).text).toBe("Corrected preference");
  });

  it("keeps an older decision when a newer extraction does not explicitly replace it", () => {
    syncExtractedMemory(conversation);
    const later = { ...conversation, metadata: { ...conversation.metadata!, generatedAt: new Date("2026-06-01T00:00:00Z"), decisions: [{ decision: "Use rolling releases", reason: "Faster recovery", status: "active" as const }] } };
    const records = syncExtractedMemory(later);
    expect(records.filter((record) => record.kind === "decision" && record.status === "active")).toHaveLength(2);
  });

  it("marks the old decision superseded only when the newer one says so", () => {
    const [original] = syncExtractedMemory(conversation).filter((record) => record.kind === "decision");
    const later = { ...conversation, metadata: { ...conversation.metadata!, decisions: [{ ...conversation.metadata!.decisions![0], status: "superseded" as const }] } };
    const records = syncExtractedMemory(later);
    expect(records.find((record) => record.id === original.id)?.status).toBe("superseded");
    expect(records.find((record) => record.id === original.id)?.text).toContain("blue green");
  });
});

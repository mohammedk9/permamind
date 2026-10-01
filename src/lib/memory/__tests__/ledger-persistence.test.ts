import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MEMORY_LEDGER_KEY,
  addMemoryRecord,
  loadMemoryLedger,
  syncExtractedMemories,
  syncExtractedMemory,
  updateMemoryRecord,
} from "@/lib/memory/ledger";
import type { Conversation, ConversationMetadata } from "@/types/chat";

function metadata(decisions: ConversationMetadata["decisions"] = []): ConversationMetadata {
  return {
    summary: "A short summary",
    topics: ["topic"],
    tags: ["tag"],
    entities: ["entity"],
    messageFingerprint: "fingerprint",
    generatedAt: new Date(),
    facts: [],
    decisions,
  };
}

function conversation(id: string, meta: ConversationMetadata): Conversation {
  return { id, title: `Conversation ${id}`, messages: [], createdAt: new Date(), updatedAt: new Date(), metadata: meta };
}

function decision(text: string, status: "active" | "superseded" = "active") {
  return { decision: text, status, alternatives: [] };
}

describe("memory ledger persistence", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("writes the ledger once per conversation, not once per record", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    const meta = metadata([decision("one"), decision("two"), decision("three")]);

    syncExtractedMemory(conversation("a", meta));

    const writes = spy.mock.calls.filter(([key]) => key === MEMORY_LEDGER_KEY);
    expect(writes).toHaveLength(1);
  });

  it("writes the ledger once for a whole batch of conversations", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    const conversations = Array.from({ length: 25 }, (_, index) =>
      conversation(`c${index}`, metadata([decision(`decision ${index}`)])),
    );

    syncExtractedMemories(conversations);

    const writes = spy.mock.calls.filter(([key]) => key === MEMORY_LEDGER_KEY);
    expect(writes).toHaveLength(1);
  });

  it("does not throw when the ledger cannot be written", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    expect(() => syncExtractedMemory(conversation("a", metadata([decision("one")])))).not.toThrow();
  });

  it("still returns the records it built when the write fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    const records = syncExtractedMemory(conversation("a", metadata([decision("one")])));

    // The caller can keep working with the in-memory result even though the
    // browser refused to persist it.
    expect(records.length).toBeGreaterThan(0);
  });

  it("preserves the supersede-a-decision behaviour after the batch rewrite", () => {
    syncExtractedMemory(conversation("a", metadata([decision("Use plan A")])));

    syncExtractedMemory(conversation("b", metadata([decision("Use plan A", "superseded")])));

    // Unchanged from the pre-refactor behaviour: a superseded extraction marks
    // the matching active decision instead of replacing it.
    const first = loadMemoryLedger().find((record) => record.conversationId === "a");
    expect(first?.status).toBe("superseded");
    expect(first?.supersededBy).toBeTruthy();
  });

  it("applies the same supersede rule across a batch", () => {
    syncExtractedMemory(conversation("a", metadata([decision("Use plan A")])));

    syncExtractedMemories([
      conversation("b", metadata([decision("Use plan A", "superseded")])),
      conversation("c", metadata([decision("Use plan B")])),
    ]);

    const records = loadMemoryLedger();
    expect(records.find((record) => record.conversationId === "a")?.status).toBe("superseded");
    expect(records.some((record) => record.conversationId === "c" && record.status === "active")).toBe(true);
  });

  it("does not overwrite a user-corrected record during a batch sync", () => {
    const original = conversation("a", metadata([decision("Original")]));
    syncExtractedMemory(original);

    const created = loadMemoryLedger().find((record) => record.text.startsWith("Original"));
    expect(created).toBeDefined();
    updateMemoryRecord(created!.id, { text: "Corrected by the user" });

    syncExtractedMemories([conversation("a", metadata([decision("Original")]))]);

    const corrected = loadMemoryLedger().find((record) => record.id === created!.id);
    expect(corrected?.text).toBe("Corrected by the user");
    expect(corrected?.source).toBe("user");
  });

  it("adds a manual record and returns it without a second read", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");

    const records = addMemoryRecord({
      id: "manual:1",
      kind: "fact",
      text: "A hand written memory",
      conversationId: "a",
      conversationTitle: "Conversation a",
      confidence: "medium",
      pinned: false,
      status: "active",
      source: "user",
      updatedAt: new Date().toISOString(),
    });

    expect(records.some((record) => record.id === "manual:1")).toBe(true);
    expect(spy.mock.calls.filter(([key]) => key === MEMORY_LEDGER_KEY)).toHaveLength(1);
    expect(loadMemoryLedger().some((record) => record.id === "manual:1")).toBe(true);
  });
});

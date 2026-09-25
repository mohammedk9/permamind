import { describe, expect, it } from "vitest";
import { buildDecisionLedger, noteToDecision } from "@/lib/memory/decision-ledger-view";
import type { MemoryRecord } from "@/types/memory";

function decision(overrides: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: "decision:1",
    kind: "decision",
    text: "Use blue green",
    conversationId: "chat-1",
    conversationTitle: "Brand",
    confidence: "medium",
    pinned: false,
    status: "active",
    source: "extracted",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("decision ledger view", () => {
  it("keeps a superseded decision visible under the decision that replaced it", () => {
    const cards = buildDecisionLedger([
      decision({ id: "old", status: "superseded", supersededBy: "new", text: "Use blue", updatedAt: "2026-08-01T00:00:00.000Z" }),
      decision({ id: "new", text: "Use blue green", updatedAt: "2026-09-01T00:00:00.000Z" }),
      decision({ id: "fact-shaped", kind: "fact", text: "ignored" }),
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0].current.id).toBe("new");
    expect(cards[0].history.map((record) => record.id)).toEqual(["old"]);
    expect(cards[0].history[0].text).toBe("Use blue");
  });

  it("stores a handwritten note as its own decision without replacing another", () => {
    const note = noteToDecision("  Ship the Arabic ledger  ");
    expect(note?.kind).toBe("decision");
    expect(note?.source).toBe("user");
    expect(note?.text).toBe("Ship the Arabic ledger");
    expect(note?.status).toBe("active");
    expect(noteToDecision("no")).toBeNull();
  });
});

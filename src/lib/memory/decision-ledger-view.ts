import type { MemoryRecord } from "@/types/memory";

export interface DecisionCard {
  current: MemoryRecord;
  /** Older decisions that point at the current one. They stay visible and are never deleted. */
  history: MemoryRecord[];
}

/**
 * Groups decision records for the ledger page. Active and uncertain decisions lead.
 * A superseded decision stays attached beneath the record that replaced it.
 */
export function buildDecisionLedger(records: MemoryRecord[]): DecisionCard[] {
  const decisions = records.filter((record) => record.kind === "decision" && record.status !== "forgotten");
  const byId = new Map(decisions.map((record) => [record.id, record]));
  const history = new Map<string, MemoryRecord[]>();

  for (const record of decisions) {
    if (record.status !== "superseded" || !record.supersededBy || !byId.has(record.supersededBy)) continue;
    const group = history.get(record.supersededBy) ?? [];
    group.push(record);
    history.set(record.supersededBy, group);
  }

  const attached = new Set([...history.values()].flat().map((record) => record.id));
  const leaders = decisions.filter((record) => record.status !== "superseded" || !attached.has(record.id));

  return leaders
    .map((current) => ({
      current,
      history: (history.get(current.id) ?? []).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    }))
    .sort((left, right) => Number(right.current.pinned) - Number(left.current.pinned) || right.current.updatedAt.localeCompare(left.current.updatedAt));
}

/** A short note the user writes by hand. It is stored beside older decisions, never over them. */
export function noteToDecision(text: string, now = new Date()): MemoryRecord | null {
  const trimmed = text.trim().slice(0, 500);
  if (trimmed.length < 3) return null;
  const stamp = now.toISOString();
  return {
    id: `decision:note:${stamp}:${trimmed.toLocaleLowerCase().replace(/\s+/g, " ").slice(0, 80)}`,
    kind: "decision",
    category: "decision",
    text: trimmed,
    conversationId: "ledger-note",
    conversationTitle: "Decision ledger",
    confidence: "high",
    pinned: true,
    status: "active",
    source: "user",
    updatedAt: stamp,
  };
}

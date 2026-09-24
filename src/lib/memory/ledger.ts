import type { Conversation, MemoryDecision, MemoryFact } from "@/types/chat";
import type { MemoryConfidence, MemoryRecord } from "@/types/memory";

export const MEMORY_LEDGER_KEY = "permamind:memory-ledger:v1";

interface StoredLedger { version: 1; records: MemoryRecord[]; }

function read(): MemoryRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(MEMORY_LEDGER_KEY) ?? "") as StoredLedger;
    return parsed.version === 1 && Array.isArray(parsed.records) ? parsed.records.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is MemoryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<MemoryRecord>;
  return typeof record.id === "string" && typeof record.text === "string" && typeof record.conversationId === "string";
}

function write(records: MemoryRecord[]): void {
  localStorage.setItem(MEMORY_LEDGER_KEY, JSON.stringify({ version: 1, records } satisfies StoredLedger));
}

export function loadMemoryLedger(): MemoryRecord[] {
  return read().sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt));
}

export function activeMemoryRecords(): MemoryRecord[] {
  return loadMemoryLedger().filter((record) => record.status === "active" && record.text.trim());
}

function confidenceFor(pinned: boolean, category?: string): MemoryConfidence {
  if (pinned || category === "preference" || category === "constraint") return "high";
  return "medium";
}

function upsert(records: MemoryRecord[], next: MemoryRecord): MemoryRecord[] {
  const index = records.findIndex((record) => record.id === next.id);
  if (index === -1) return [next, ...records];
  const current = records[index];
  if (current.source === "user" || current.pinned) return records;
  const copy = [...records];
  copy[index] = next;
  return copy;
}

/** Adds newly extracted facts without reviving a record the user forgot or edited. */
export function syncExtractedMemory(conversation: Conversation): MemoryRecord[] {
  const metadata = conversation.metadata;
  if (!metadata || typeof window === "undefined") return loadMemoryLedger();
  let records = read();
  const base = { conversationId: conversation.id, conversationTitle: conversation.title, status: "active" as const, source: "extracted" as const, pinned: false, updatedAt: metadata.generatedAt.toISOString() };

  for (const fact of metadata.facts ?? []) {
    records = upsert(records, factRecord(conversation.id, fact, base));
  }
  for (const decision of metadata.decisions ?? []) {
    if (decision.status === "superseded") continue;
    records = upsert(records, decisionRecord(conversation.id, decision, base));
  }
  if (metadata.project?.name) {
    records = upsert(records, { ...base, id: `project:${conversation.id}`, kind: "project", category: "project", confidence: "medium", text: [metadata.project.name, metadata.project.goal, ...(metadata.project.tasks ?? [])].filter(Boolean).join(" — ") });
  }
  write(records);
  return loadMemoryLedger();
}

function factRecord(conversationId: string, fact: MemoryFact, base: Omit<MemoryRecord, "id" | "kind" | "text" | "category" | "confidence">): MemoryRecord {
  const kind = fact.category === "preference" ? "preference" : "fact";
  return { ...base, id: `${kind}:${conversationId}:${normalizeKey(fact.category)}`, kind, category: fact.category, confidence: confidenceFor(false, fact.category), text: fact.value };
}

function decisionRecord(conversationId: string, decision: MemoryDecision, base: Omit<MemoryRecord, "id" | "kind" | "text" | "category" | "confidence">): MemoryRecord {
  return { ...base, id: `decision:${conversationId}:${normalizeKey(decision.decision)}`, kind: "decision", category: "decision", confidence: decision.status === "uncertain" ? "low" : "medium", text: decision.reason ? `${decision.decision} — ${decision.reason}` : decision.decision };
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ").slice(0, 160);
}

export function updateMemoryRecord(id: string, changes: Partial<Pick<MemoryRecord, "text" | "pinned" | "status">>): MemoryRecord[] {
  const records = read().map((record) => record.id === id ? { ...record, ...changes, text: (changes.text ?? record.text).trim().slice(0, 500), source: changes.text ? "user" as const : record.source, confidence: changes.pinned ? "high" as const : record.confidence, updatedAt: new Date().toISOString() } : record);
  write(records.filter((record) => record.text));
  return loadMemoryLedger();
}

export function forgetMemoryRecord(id: string): MemoryRecord[] {
  return updateMemoryRecord(id, { status: "forgotten", pinned: false });
}

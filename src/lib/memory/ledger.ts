import type { Conversation, MemoryDecision, MemoryFact } from "@/types/chat";
import type { MemoryConfidence, MemoryRecord } from "@/types/memory";

import { persistOrAnnounce } from "@/lib/storage/storage-health";

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

/**
 * Writes the ledger exactly once per batch.
 *
 * The previous version called this unconditionally, which meant a full origin
 * quota threw `QuotaExceededError` straight through `syncExtractedMemory` and
 * aborted the whole memory-index rebuild in `chat-app`. It also serialised the
 * entire record set on every single mutation.
 */
function write(records: MemoryRecord[]): boolean {
  if (typeof window === "undefined") return false;
  return persistOrAnnounce(MEMORY_LEDGER_KEY, JSON.stringify({ version: 1, records } satisfies StoredLedger));
}

function sorted(records: MemoryRecord[]): MemoryRecord[] {
  return records.sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt));
}

export function loadMemoryLedger(): MemoryRecord[] {
  return sorted(read());
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
  if (current.source === "user" || current.pinned || current.status !== "active") return records;
  const copy = [...records];
  copy[index] = next;
  return copy;
}

/**
 * Adds newly extracted facts and decisions. A later extraction never replaces
 * an older decision: a new decision is stored beside it, and the older one is
 * marked superseded only when the extraction explicitly says so.
 *
 * The record list is read once, mutated in memory, and written once. The
 * previous implementation persisted inside the loop, which meant one full
 * serialise-and-write per fact and per decision on every single message.
 */
export function syncExtractedMemory(conversation: Conversation): MemoryRecord[] {
  const metadata = conversation.metadata;
  if (!metadata || typeof window === "undefined") return loadMemoryLedger();
  const records = applyExtraction(read(), conversation, metadata);
  write(records);
  return sorted(records);
}

/**
 * Applies extraction for several conversations with a single read and a single
 * write.
 *
 * `chat-app` rebuilds the whole index after every message, which previously
 * called `syncExtractedMemory` once per conversation. With 100 conversations
 * that was 100 reads plus 100 full writes of the entire ledger per message.
 * The per-conversation function stays for the single-conversation path; the
 * rebuild path uses this one.
 */
export function syncExtractedMemories(conversations: Conversation[]): MemoryRecord[] {
  if (typeof window === "undefined") return [];
  let records = read();
  for (const conversation of conversations) {
    const metadata = conversation.metadata;
    if (!metadata) continue;
    records = applyExtraction(records, conversation, metadata);
  }
  write(records);
  return sorted(records);
}

/** Mutates the record list for one conversation without touching storage. */
function applyExtraction(
  records: MemoryRecord[],
  conversation: Conversation,
  metadata: NonNullable<Conversation["metadata"]>,
): MemoryRecord[] {
  let next = records;
  const base = { conversationId: conversation.id, conversationTitle: conversation.title, status: "active" as const, source: "extracted" as const, pinned: false, updatedAt: metadata.generatedAt.toISOString() };

  for (const fact of metadata.facts ?? []) {
    next = upsert(next, factRecord(conversation.id, fact, base));
  }
  for (const decision of metadata.decisions ?? []) {
    const record = decisionRecord(conversation.id, decision, base);
    next = decision.status === "superseded" ? supersedeMatching(next, record) : upsert(next, record);
  }
  if (metadata.project?.name) {
    next = upsert(next, { ...base, id: `project:${conversation.id}`, kind: "project", category: "project", confidence: "medium", text: [metadata.project.name, metadata.project.goal, ...(metadata.project.tasks ?? [])].filter(Boolean).join(" — ") });
  }
  return next;
}

/** Keeps the old decision and points it at the newer record instead of deleting it. */
function supersedeMatching(records: MemoryRecord[], next: MemoryRecord): MemoryRecord[] {
  const key = normalizeKey(next.text);
  let changed = false;
  const updated = records.map((record) => {
    if (record.kind !== "decision" || record.status !== "active") return record;
    if (normalizeKey(record.text) !== key && record.id !== next.id) return record;
    changed = true;
    return { ...record, status: "superseded" as const, supersededBy: next.id, pinned: false };
  });
  return changed ? updated : records;
}

function factRecord(conversationId: string, fact: MemoryFact, base: Omit<MemoryRecord, "id" | "kind" | "text" | "category" | "confidence">): MemoryRecord {
  const kind = fact.category === "preference" ? "preference" : "fact";
  return { ...base, id: `${kind}:${conversationId}:${normalizeKey(fact.category)}`, kind, category: fact.category, confidence: confidenceFor(false, fact.category), text: fact.value };
}

function decisionRecord(conversationId: string, decision: MemoryDecision, base: Omit<MemoryRecord, "id" | "kind" | "text" | "category" | "confidence">): MemoryRecord {
  const text = decision.reason ? `${decision.decision} — ${decision.reason}` : decision.decision;
  return { ...base, id: `decision:${conversationId}:${normalizeKey(text)}`, kind: "decision", category: "decision", confidence: decision.status === "uncertain" ? "low" : "medium", text };
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ").slice(0, 160);
}

export function addMemoryRecord(record: MemoryRecord): MemoryRecord[] {
  // Return the in-memory result rather than re-reading storage, so a failed
  // write can never make the caller see a stale list as if it were saved.
  const records = upsert(read(), { ...record, text: record.text.trim().slice(0, 500) }).filter((item) => item.text);
  write(records);
  return sorted(records);
}

export function updateMemoryRecord(id: string, changes: Partial<Pick<MemoryRecord, "text" | "pinned" | "status">>): MemoryRecord[] {
  const records = read().map((record) => record.id === id ? { ...record, ...changes, text: (changes.text ?? record.text).trim().slice(0, 500), source: changes.text ? "user" as const : record.source, confidence: changes.pinned ? "high" as const : record.confidence, updatedAt: new Date().toISOString() } : record).filter((record) => record.text);
  write(records);
  return sorted(records);
}

export function forgetMemoryRecord(id: string): MemoryRecord[] {
  return updateMemoryRecord(id, { status: "forgotten", pinned: false });
}

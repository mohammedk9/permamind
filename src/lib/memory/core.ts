/**
 * The memory corpus: every local message, summary, and ledger record, ranked.
 *
 * This module exists because the retrieval path had two defects that made memory
 * feel empty even though the data was all there:
 *
 * 1. **The index only covered the last six messages of each conversation**
 *    (`retrieve.ts` built its documents with `messages.slice(-6)`), so anything
 *    said earlier in a long chat was invisible to retrieval.
 * 2. **The BM25 scores were written under the document id and read under the
 *    conversation id** — `bm25Scores.set("summary:c1")` followed by
 *    `bm25Scores.get("c1")` — so BM25 contributed exactly zero to every ranking
 *    and the effective ranker was a flat word-overlap count, where a term in fifty
 *    conversations scores the same as a term in one.
 *
 * Both are fixed here, and the corpus is cached by a cheap signature so a search
 * does not re-tokenise the whole history on every keystroke.
 *
 * Everything runs on the device: no network, no model, no writes.
 */

import { tokenizeArabic } from "@/lib/i18n/arabic-normalize";
import { loadMemoryLedger } from "@/lib/memory/ledger";
import { buildSnippet } from "@/lib/memory/snippet";
import { Bm25Index } from "@/lib/search/bm25";
import { loadChatData } from "@/lib/storage/chat-storage";
import type { Conversation } from "@/types/chat";
import type { MemoryRecord, MemoryRecordStatus } from "@/types/memory";

/** One searchable unit: a summary, a message, or a ledger record. */
export interface MemoryCoreEntry {
  /** `summary:<cid>`, `message:<mid>`, or `record:<rid>`. */
  id: string;
  kind: "summary" | "message" | "record";
  conversationId: string;
  conversationTitle: string;
  /** Present for messages, so a user's own words can outrank a summary. */
  role?: "user" | "assistant";
  /** The original text, for snippets. */
  text: string;
  /** ISO timestamp of the entry. */
  date: string;
  recordId?: string;
  recordKind?: MemoryRecord["kind"];
  status?: MemoryRecordStatus;
  pinned?: boolean;
}

export interface MemoryCorpus {
  entries: MemoryCoreEntry[];
  byId: Map<string, MemoryCoreEntry>;
  index: Bm25Index;
  /** Cheap fingerprint of the inputs the index was built from. */
  signature: string;
}

/**
 * A fingerprint that is cheap to compute and changes when the corpus changes.
 *
 * Summing the message count and the total character count costs one pass over
 * lengths (O(1) per string), while tokenising the text would cost a pass over
 * every character. The last update time is included so an edit that keeps the
 * length — "launch" → "release" — still invalidates the cache.
 */
function corpusSignature(conversations: Conversation[], records: MemoryRecord[]): string {
  let characters = 0;
  let messages = 0;
  let newest = 0;

  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (message.isStreaming || !message.content.trim()) continue;
      messages += 1;
      characters += message.content.length;
    }
    if (conversation.metadata?.summary) characters += conversation.metadata.summary.length;
    newest = Math.max(newest, conversation.updatedAt.getTime());
  }

  let recordCharacters = 0;
  for (const record of records) {
    if (record.status === "forgotten" || !record.text.trim()) continue;
    recordCharacters += record.text.length;
  }

  return `${conversations.length}:${messages}:${characters}:${newest}:${records.length}:${recordCharacters}`;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** Every searchable unit, in a stable order. */
export function buildMemoryCorpus(
  conversations: Conversation[],
  records: MemoryRecord[],
): MemoryCorpus {
  const entries: MemoryCoreEntry[] = [];

  for (const conversation of conversations) {
    const meta = conversation.metadata;

    if (meta?.summary) {
      entries.push({
        id: `summary:${conversation.id}`,
        kind: "summary",
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        text: [conversation.title, meta.summary, ...(meta.topics ?? []), ...(meta.tags ?? []), ...(meta.entities ?? [])].join(" "),
        date: toIso(conversation.updatedAt),
      });
    }

    for (const message of conversation.messages) {
      if (message.isStreaming || !message.content.trim()) continue;
      entries.push({
        id: `message:${message.id}`,
        kind: "message",
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        role: message.role,
        text: message.content,
        date: toIso(message.createdAt),
      });
    }
  }

  for (const record of records) {
    // A forgotten memory is excluded everywhere else; surfacing it here would
    // make "forget" a lie.
    if (record.status === "forgotten") continue;
    const text = record.text.trim();
    if (!text) continue;

    entries.push({
      id: `record:${record.id}`,
      kind: "record",
      conversationId: record.conversationId,
      conversationTitle: record.conversationTitle || "Memory",
      text,
      date: toIso(record.updatedAt),
      recordId: record.id,
      recordKind: record.kind,
      status: record.status,
      pinned: record.pinned,
    });
  }

  const index = new Bm25Index(entries.map((entry) => ({ id: entry.id, text: entry.text })));

  return {
    entries,
    byId: new Map(entries.map((entry) => [entry.id, entry])),
    index,
    signature: corpusSignature(conversations, records),
  };
}

/**
 * The corpus, rebuilt only when its inputs changed.
 *
 * A cache rather than an index built per call: retrieval runs once per message,
 * and re-tokenising the whole local history each time is what made recall feel
 * slow on a long-lived browser profile.
 */
let cached: MemoryCorpus | null = null;

export function getMemoryCorpus(
  conversations: Conversation[],
  records: MemoryRecord[],
): MemoryCorpus {
  const signature = corpusSignature(conversations, records);
  if (cached && cached.signature === signature) return cached;
  cached = buildMemoryCorpus(conversations, records);
  return cached;
}

/** Drops the cache. Tests and sign-out flows use this. */
export function resetMemoryCorpus(): void {
  cached = null;
}

/** How strongly a hit's age should count, from 1 (today) down to 0.15. */
function recencyFactor(iso: string): number {
  if (!iso) return 0;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 0;
  const hours = Math.max(0, (Date.now() - time) / 3_600_000);
  if (hours < 24) return 1;
  if (hours < 168) return 0.65;
  if (hours < 720) return 0.35;
  return 0.15;
}

/**
 * The best BM25 score per conversation, on a 0-1 scale.
 *
 * This is the function whose absence caused the bug: scores are keyed by
 * conversation, because the ranking loop asks for them by conversation. The
 * previous code stored them under the document id (`summary:c1`) and then read
 * them under the conversation id, so every lookup missed and BM25 silently
 * contributed nothing.
 */
export function conversationBm25Scores(
  corpus: MemoryCorpus,
  query: string,
): Map<string, number> {
  const scores = new Map<string, number>();
  const max = corpus.index.maxScore;
  if (corpus.index.size === 0 || max <= 0) return scores;

  // The whole ranking is fetched: a conversation's score is the best of its
  // documents, and truncating the search could drop the one that mattered.
  for (const hit of corpus.index.search(query, { limit: corpus.entries.length })) {
    const entry = corpus.byId.get(hit.id);
    if (!entry) continue;
    const normalised = Math.min(1, hit.score / max);
    if (normalised > (scores.get(entry.conversationId) ?? 0)) {
      scores.set(entry.conversationId, normalised);
    }
  }

  return scores;
}

export interface MemoryCoreHit {
  entry: MemoryCoreEntry;
  /** Relevance, 0-1-ish, after role/pin/recency adjustments. */
  score: number;
  snippet: string;
}

export interface MemoryCoreSearchOptions {
  /** Maximum hits. Defaults to 8. */
  limit?: number;
  /** Skips a conversation's messages; its summary and records still match. */
  excludeConversationId?: string | null;
  /** Keeps only the best hit per conversation. Defaults to true. */
  dedupePerConversation?: boolean;
  /** Records to consider; loaded from the ledger when omitted. */
  records?: MemoryRecord[];
}

/**
 * Ranks local memory for `query`.
 *
 * Used by the free-quota card and (next) the memory page. The chat path uses
 * {@link conversationBm25Scores} directly, because it fuses BM25 with its own
 * recency, graph, and decision signals.
 *
 * Conversations are read from storage when the caller does not pass them, so a
 * surface that has them already — the chat, which re-renders on every token — can
 * avoid the read.
 */
export function searchMemoryCore(
  query: string,
  options: MemoryCoreSearchOptions & { conversations?: Conversation[] } = {},
): MemoryCoreHit[] {
  const limit = options.limit ?? 8;
  const trimmed = query.trim();
  if (limit <= 0 || !trimmed) return [];

  const tokens = tokenizeArabic(trimmed);
  if (!tokens.length) return [];

  const conversations = options.conversations ?? loadChatData().conversations;
  const records = options.records ?? loadMemoryLedger();
  const corpus = getMemoryCorpus(conversations, records);

  return searchInCorpus(corpus, trimmed, tokens, options, limit);
}

function searchInCorpus(
  corpus: MemoryCorpus,
  query: string,
  tokens: string[],
  options: MemoryCoreSearchOptions,
  limit: number,
): MemoryCoreHit[] {
  const exclude = options.excludeConversationId ?? null;
  const dedupe = options.dedupePerConversation !== false;

  const scored: MemoryCoreHit[] = [];

  for (const hit of corpus.index.search(query, { limit: corpus.entries.length })) {
    const entry = corpus.byId.get(hit.id);
    if (!entry) continue;

    // The excluded conversation keeps its summary and its records: the reason to
    // exclude it is that its newest message *is* the query, not that its older
    // content is irrelevant.
    if (exclude && entry.conversationId === exclude && entry.kind === "message") continue;

    const max = corpus.index.maxScore || 1;
    let score = Math.min(1, hit.score / max);

    // A user's own words are what "what did I say" asks for; an assistant's
    // restatement is a weaker answer to the same question.
    if (entry.role === "user") score *= 1.15;

    // A pinned record is a user instruction and outranks relevance alone.
    if (entry.pinned) score += 0.5;

    score += recencyFactor(entry.date) * 0.15;

    scored.push({ entry, score, snippet: buildSnippet(entry.text, tokens) });
  }

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return right.entry.date.localeCompare(left.entry.date);
  });

  const seen = new Set<string>();
  const results: MemoryCoreHit[] = [];
  for (const hit of scored) {
    // Several messages from one conversation would otherwise crowd out every
    // other chat: the best line from a conversation is the useful one.
    if (dedupe && seen.has(hit.entry.conversationId)) continue;
    seen.add(hit.entry.conversationId);
    results.push(hit);
    if (results.length >= limit) break;
  }

  return results;
}
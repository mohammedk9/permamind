/**
 * Local, offline recall over what is already on the device.
 *
 * This exists for the one moment the network is not an option: when the free
 * daily allowance is spent, the chat cannot ask a model, and the honest answer
 * is "here is what your own memory already says". It therefore has hard rules,
 * and they are the reason it is a separate module rather than a flag on
 * `retrieveRelevantMemories`:
 *
 * - **No network.** It never calls `fetch`, so it cannot fail for a reason the
 *   user cannot fix and cannot leak a query to a provider.
 * - **No writes.** `retrieveRelevantMemories` calls `updateMemoryGraph`, which
 *   persists a graph as a side effect of reading. A card that appears when the
 *   user presses a button must not modify their storage.
 * - **No model, no embeddings.** Everything is synchronous lexical retrieval, so
 *   the first result is available in the same tick as the click.
 *
 * The ranking is BM25 over a corpus assembled from the three things a person
 * actually remembers by: the conversation title, its summary (with topics, tags
 * and entities), and the decisions in the memory ledger. Messages are indexed
 * too, because "what did I say about the launch" is usually answered by a line
 * of text rather than by a summary.
 *
 * All text stays on the device. The only input is the query the user typed.
 */

import { normalizeForMatch, tokenizeArabic } from "@/lib/i18n/arabic-normalize";
import { loadMemoryLedger } from "@/lib/memory/ledger";
import { isDecisionQuery } from "@/lib/memory/retrieve";
import { Bm25Index } from "@/lib/search/bm25";
import { loadChatData } from "@/lib/storage/chat-storage";
import type { Conversation } from "@/types/chat";
import type { MemoryRecord, MemoryRecordStatus } from "@/types/memory";

/** What a hit points at, which decides what the UI offers when it is opened. */
export type OfflineMemoryType = "conversation" | "summary" | "decision";

export interface OfflineMemoryHit {
  /** Index-unique id: `conversation:`/`summary:`/`message:`/`decision:` + source id. */
  id: string;
  type: OfflineMemoryType;
  /** The conversation this came from, so a heading is always available. */
  title: string;
  /** ISO 8601 of the source's last update, for "3 days ago"-style labels. */
  date: string;
  /** A short excerpt around the match, already trimmed and ellipsised. */
  snippet: string;
  /** Conversation to open when the hit is chosen. */
  conversationId: string;
  /** Present for `type: "decision"`: the editable ledger record. */
  recordId?: string;
  /** Present for `type: "decision"`: lets the UI mark a replaced decision. */
  status?: MemoryRecordStatus;
}

export interface OfflineSearchOptions {
  /** How many hits to return. Defaults to {@link DEFAULT_OFFLINE_LIMIT}. */
  limit?: number;
  /**
   * A conversation whose messages are skipped while its title and summary stay
   * searchable.
   *
   * The caller passes the conversation the query came from: the last thing the
   * user typed is already in that conversation, so indexing its messages would
   * return the user's own words as the top "memory". Its summary is still fair
   * game, which is why this excludes messages only.
   */
  excludeConversationId?: string | null;
}

export const DEFAULT_OFFLINE_LIMIT = 5;

/**
 * Shortest query that is allowed to search.
 *
 * Two characters in Arabic are almost always a clitic ("ما", "من") rather than
 * something to recall, and the tokenizer already drops such tokens, so a
 * shorter guard would only produce noise.
 */
export const MIN_OFFLINE_QUERY_LENGTH = 3;

/** Characters of context kept on each side of a match in a snippet. */
const SNIPPET_RADIUS = 80;

/** A run of letters or digits in the *original* text, used to map a match back. */
const WORD_PATTERN = /[\p{L}\p{N}]+/gu;

interface Source {
  /** BM25 document id. */
  key: string;
  type: OfflineMemoryType;
  /** Shown as the hit's heading. */
  title: string;
  /** What the index tokenises. */
  text: string;
  /** What the snippet is cut from; may be shorter than `text`. */
  excerpt: string;
  date: string;
  conversationId: string;
  recordId?: string;
  status?: MemoryRecordStatus;
  /** Decision ordering: 0 active, 1 replaced, 2 not a decision. */
  decisionRank: number;
}

interface ScoredHit {
  source: Source;
  score: number;
}

/**
 * A source's date as an ISO string, or "" when it cannot be read.
 *
 * "" rather than the epoch: a record with a corrupt `updatedAt` should show no
 * date at all, because "Jan 1 1970" is a claim the data does not support. An
 * empty string sorts first in the tie-break, which is harmless — it only decides
 * between two hits of equal score.
 */
function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/**
 * The corpus for one search.
 *
 * Built fresh per call rather than cached: the caller runs this on a click, and
 * a cache would need invalidating on every message, edit, pin and forget. A
 * stale "here is what you remember" is worse than a few milliseconds.
 */
function buildSources(
  conversations: Conversation[],
  records: MemoryRecord[],
  excludeConversationId?: string | null,
): Source[] {
  const sources: Source[] = [];
  const titleById = new Map(conversations.map((conversation) => [conversation.id, conversation.title]));

  for (const conversation of conversations) {
    const meta = conversation.metadata;

    sources.push({
      key: `conversation:${conversation.id}`,
      type: "conversation",
      title: conversation.title,
      text: conversation.title,
      excerpt: conversation.title,
      date: toIso(conversation.updatedAt),
      conversationId: conversation.id,
      decisionRank: 2,
    });

    if (meta?.summary) {
      sources.push({
        key: `summary:${conversation.id}`,
        type: "summary",
        title: conversation.title,
        text: [
          meta.summary,
          ...(meta.topics ?? []),
          ...(meta.tags ?? []),
          ...(meta.entities ?? []),
        ].join(" "),
        excerpt: meta.summary,
        date: toIso(conversation.updatedAt),
        conversationId: conversation.id,
        decisionRank: 2,
      });
    }

    // The conversation the query came from keeps its title and summary above but
    // not its messages, whose newest line is the query itself.
    if (conversation.id === excludeConversationId) continue;

    for (const message of conversation.messages) {
      if (message.isStreaming || !message.content.trim()) continue;
      sources.push({
        key: `message:${message.id}`,
        type: "conversation",
        title: conversation.title,
        text: `${conversation.title} ${message.content}`,
        excerpt: message.content,
        date: toIso(message.createdAt),
        conversationId: conversation.id,
        decisionRank: 2,
      });
    }
  }

  for (const record of records) {
    // Only real decisions, and never one the user asked to forget: surfacing a
    // forgotten memory is the one failure this card must not have.
    if (record.kind !== "decision") continue;
    if (record.status === "forgotten") continue;
    const text = record.text.trim();
    if (!text) continue;

    sources.push({
      key: `decision:${record.id}`,
      type: "decision",
      title: record.conversationTitle || titleById.get(record.conversationId) || "",
      text,
      excerpt: text,
      date: toIso(record.updatedAt),
      conversationId: record.conversationId,
      recordId: record.id,
      status: record.status,
      decisionRank: record.status === "active" ? 0 : 1,
    });
  }

  return sources;
}

/**
 * Finds the first word in the original text that corresponds to a query token.
 *
 * The normaliser changes string length — harakat and tatweel are deleted, a
 * zero-width joiner becomes a space — so an offset found in the normalised text
 * cannot be used against the original. Walking the original words and
 * normalising each one keeps the offset exact for every script.
 *
 * A second, looser pass accepts the Arabic definite article and a leading
 * conjunction, because "القرار" and "قرار" are the same word to a reader, and a
 * snippet centred on the wrong occurrence is simply a worse excerpt.
 */
function findMatchRange(text: string, tokens: string[]): { start: number; end: number } | null {
  if (!tokens.length) return null;

  const words = Array.from(text.matchAll(WORD_PATTERN), (match) => ({
    start: match.index ?? 0,
    word: match[0],
  }));
  if (!words.length) return null;

  for (const { start, word } of words) {
    if (tokens.includes(normalizeForMatch(word))) return { start, end: start + word.length };
  }

  for (const { start, word } of words) {
    const normalized = normalizeForMatch(word);
    const bare = normalized.replace(/^(?:و|ف|ب|ك|ل)+/, "").replace(/^ال/, "");
    if (!bare) continue;
    if (tokens.some((token) => bare === token || (token.length >= 4 && bare.startsWith(token)))) {
      return { start, end: start + word.length };
    }
  }

  return null;
}

/**
 * A short excerpt around the match, or the opening of the text when nothing
 * matched exactly.
 *
 * Word boundaries are respected on both sides so a snippet never begins or ends
 * mid-word, which matters more in Arabic than the characters it costs.
 */
export function buildOfflineSnippet(text: string, tokens: string[]): string {
  if (!text) return "";

  const range = findMatchRange(text, tokens);
  // No exact match: show the opening rather than an excerpt centred on a guess,
  // because a wrong centre reads as a broken result.
  const focus = range ? (range.start + range.end) / 2 : SNIPPET_RADIUS;

  let start = Math.max(0, Math.floor(focus - SNIPPET_RADIUS));
  let end = Math.min(text.length, Math.ceil(focus + SNIPPET_RADIUS));

  if (start > 0) {
    const nextBoundary = text.indexOf(" ", start);
    if (nextBoundary !== -1 && nextBoundary < focus) start = nextBoundary + 1;
  }
  if (end < text.length) {
    const previousBoundary = text.lastIndexOf(" ", end);
    if (previousBoundary > start) end = previousBoundary;
  }

  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/**
 * Ranks hits for display.
 *
 * For a decision question ("what did we decide about the launch?") the ledger is
 * the answer, so decisions come first — the active ones before the ones a later
 * decision replaced, which still carry `status` so the UI can say "replaced".
 * Every other query is plain relevance, newest first on a tie.
 */
function compareHits(decisionQuery: boolean) {
  return (left: ScoredHit, right: ScoredHit): number => {
    if (decisionQuery && left.source.decisionRank !== right.source.decisionRank) {
      return left.source.decisionRank - right.source.decisionRank;
    }
    if (right.score !== left.score) return right.score - left.score;
    if (right.source.date !== left.source.date) return right.source.date.localeCompare(left.source.date);
    return left.source.title.localeCompare(right.source.title);
  };
}

/**
 * Searches local memory for `query` without touching the network.
 *
 * Returns at most `options.limit` hits, best first, and an empty array when
 * nothing matches — the caller can then say so instead of inventing a result.
 */
export function searchMemoryOffline(
  query: string,
  options: OfflineSearchOptions = {},
): OfflineMemoryHit[] {
  const limit = Math.max(0, options.limit ?? DEFAULT_OFFLINE_LIMIT);
  const trimmed = query.trim();
  if (limit === 0 || trimmed.length < MIN_OFFLINE_QUERY_LENGTH) return [];

  const tokens = tokenizeArabic(trimmed);
  if (!tokens.length) return [];

  const sources = buildSources(
    loadChatData().conversations,
    loadMemoryLedger(),
    options.excludeConversationId,
  );
  if (!sources.length) return [];

  const index = new Bm25Index(sources.map((source) => ({ id: source.key, text: source.text })));
  if (index.size === 0) return [];

  const byKey = new Map(sources.map((source) => [source.key, source]));
  const scored: ScoredHit[] = [];

  // The whole ranking is fetched and cut afterwards, because a decision
  // question reorders the list: taking the top N first could drop a decision the
  // reorder would have promoted.
  for (const hit of index.search(trimmed, { limit: sources.length })) {
    const source = byKey.get(hit.id);
    if (source) scored.push({ source, score: hit.score });
  }
  if (!scored.length) return [];

  scored.sort(compareHits(isDecisionQuery(trimmed)));

  return scored.slice(0, limit).map(({ source }) => ({
    id: source.key,
    type: source.type,
    title: source.title,
    date: source.date,
    snippet: buildOfflineSnippet(source.excerpt, tokens),
    conversationId: source.conversationId,
    // Left out rather than set to undefined so a hit serialises to exactly the
    // fields it has, which is what a snapshot or a log diff should show.
    ...(source.recordId !== undefined ? { recordId: source.recordId } : {}),
    ...(source.status !== undefined ? { status: source.status } : {}),
  }));
}
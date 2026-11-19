import type { Conversation } from "@/types/chat";
import { scoreMemory } from "@/lib/memory/retrieve";
import { findMatchRange } from "@/lib/memory/snippet";
import { normalizeForMatch } from "@/lib/i18n/arabic-normalize";

export interface MemorySearchResult {
  conversationId: string;
  conversationTitle: string;
  messageId: string | null;
  matchType: "title" | "message" | "summary" | "entity" | "tag" | "topic";
  role?: "user" | "assistant";
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

export interface MemoryIndexEntry {
  conversationId: string;
  conversationTitle: string;
  messageId: string | null;
  matchType: "title" | "message" | "summary" | "entity" | "tag" | "topic";
  role?: "user" | "assistant";
  normalized: string;
  original: string;
}

const MAX_RESULTS = 30;
const MIN_QUERY_LENGTH = 2;
const SNIPPET_CONTEXT = 48;

/**
 * Normalisation for matching, shared with every other retrieval path.
 *
 * This was `toLowerCase()`, which meant the sidebar search could not find
 * "الإطلاق" written with harakat, "قرار" inside "القرار", or anything where a
 * hamza differed from the stored spelling — the same failure already fixed in the
 * memory page and the chat retriever. One normaliser everywhere is the point:
 * a query that matches in one search box has to match in all of them.
 */
function normalize(text: string): string {
  return normalizeForMatch(text);
}

function buildSnippet(
  text: string,
  matchIndex: number,
  matchLength: number
): { snippet: string; matchStart: number; matchEnd: number } {
  const start = Math.max(0, matchIndex - SNIPPET_CONTEXT);
  const end = Math.min(text.length, matchIndex + matchLength + SNIPPET_CONTEXT);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  const snippet = prefix + text.slice(start, end) + suffix;
  const matchStart = matchIndex - start + prefix.length;
  const matchEnd = matchStart + matchLength;

  return { snippet, matchStart, matchEnd };
}

export function buildMemoryIndex(
  conversations: Conversation[]
): MemoryIndexEntry[] {
  const entries: MemoryIndexEntry[] = [];

  for (const conversation of conversations) {
    entries.push({
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      messageId: null,
      matchType: "title",
      normalized: normalize(conversation.title),
      original: conversation.title,
    });

    const meta = conversation.metadata;
    if (meta) {
      const metadataFields = [
        ["summary", meta.summary],
        ["topic", meta.topics.join(" · ")],
        ["tag", meta.tags.join(" · ")],
        ["entity", meta.entities.join(" · ")],
      ] as const;
      for (const [matchType, original] of metadataFields) {
        if (!original.trim()) continue;
        entries.push({
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          messageId: null,
          matchType,
          normalized: normalize(original),
          original,
        });
      }
    }

    for (const message of conversation.messages) {
      if (message.isStreaming || !message.content.trim()) continue;

      entries.push({
        conversationId: conversation.id,
        conversationTitle: conversation.title,
        messageId: message.id,
        matchType: "message",
        role: message.role,
        normalized: normalize(message.content),
        original: message.content,
      });
    }
  }

  return entries;
}

export function searchMemoryIndex(
  index: MemoryIndexEntry[],
  query: string
): MemorySearchResult[] {
  const q = normalize(query.trim());
  if (q.length < MIN_QUERY_LENGTH) return [];

  const results: Array<MemorySearchResult & { relevance: number }> = [];

  for (const entry of index) {
    // The whole query must appear in the normalised text. This is an existence
    // test only: the offset below comes from the original, because normalisation
    // changes string length and an index into it means nothing here.
    const matchIndex = entry.normalized.indexOf(q);
    if (matchIndex === -1) continue;

    // Locate the first query token in the *original* text, word by word, so the
    // highlight lands on the right characters for Arabic (harakat and hamza) as
    // well as English. Falling back to the start is better than a wrong centre.
    const tokens = q.split(" ").filter(Boolean);
    const range = findMatchRange(entry.original, tokens) ?? {
      start: 0,
      end: Math.min(q.length, entry.original.length),
    };

    const { snippet, matchStart, matchEnd } = buildSnippet(
      entry.original,
      range.start,
      Math.max(1, range.end - range.start),
    );

    const conversationEntries = index.filter((candidate) => candidate.conversationId === entry.conversationId);
    const metadata = conversationEntries.reduce<{ summary?: string; entities?: string[]; tags?: string[] }>((acc, candidate) => {
      if (candidate.matchType === "summary") acc.summary = candidate.original;
      if (candidate.matchType === "entity") acc.entities = candidate.original.split(" · ");
      if (candidate.matchType === "tag") acc.tags = candidate.original.split(" · ");
      return acc;
    }, {});
    const memory = { conversationId: entry.conversationId, conversationTitle: entry.conversationTitle, source: entry.matchType === "message" ? "message" : "summary", excerpt: entry.original, score: 0, confidence: "low", reason: "keyword match", updatedAt: new Date() } as const;
    const relevance = scoreMemory(query, memory, metadata).total + (entry.matchType === "title" ? 1 : 0);
    results.push({
      conversationId: entry.conversationId,
      conversationTitle: entry.conversationTitle,
      messageId: entry.messageId,
      matchType: entry.matchType,
      role: entry.role,
      snippet,
      matchStart,
      matchEnd,
      relevance,
    });

  }

  return results.sort((a, b) => {
    return b.relevance - a.relevance;
  }).slice(0, MAX_RESULTS).map((result) => {
    const { relevance, ...withoutRelevance } = result;
    void relevance;
    return withoutRelevance;
  });
}

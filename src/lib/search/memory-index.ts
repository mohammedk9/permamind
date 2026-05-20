import type { Conversation } from "@/types/chat";

export interface MemorySearchResult {
  conversationId: string;
  conversationTitle: string;
  messageId: string | null;
  matchType: "title" | "message";
  role?: "user" | "assistant";
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

export interface MemoryIndexEntry {
  conversationId: string;
  conversationTitle: string;
  messageId: string | null;
  matchType: "title" | "message";
  role?: "user" | "assistant";
  normalized: string;
  original: string;
}

const MAX_RESULTS = 30;
const MIN_QUERY_LENGTH = 2;
const SNIPPET_CONTEXT = 48;

function normalize(text: string): string {
  return text.toLowerCase();
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
      const metaText = [
        meta.summary,
        ...meta.topics,
        ...meta.tags,
        ...meta.entities,
      ]
        .filter(Boolean)
        .join(" ");

      if (metaText.trim()) {
        entries.push({
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          messageId: null,
          matchType: "title",
          normalized: normalize(metaText),
          original: meta.summary || metaText,
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

  const results: MemorySearchResult[] = [];

  for (const entry of index) {
    const matchIndex = entry.normalized.indexOf(q);
    if (matchIndex === -1) continue;

    const { snippet, matchStart, matchEnd } = buildSnippet(
      entry.original,
      matchIndex,
      q.length
    );

    results.push({
      conversationId: entry.conversationId,
      conversationTitle: entry.conversationTitle,
      messageId: entry.messageId,
      matchType: entry.matchType,
      role: entry.role,
      snippet,
      matchStart,
      matchEnd,
    });

    if (results.length >= MAX_RESULTS) break;
  }

  return results.sort((a, b) => {
    if (a.matchType !== b.matchType) {
      return a.matchType === "title" ? -1 : 1;
    }
    return 0;
  });
}

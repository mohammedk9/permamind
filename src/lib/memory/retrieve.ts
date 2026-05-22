import type { Conversation } from "@/types/chat";
import type { RetrievedMemory } from "@/types/memory";

const MAX_MEMORIES = 4;
const MIN_QUERY_LENGTH = 3;
const MIN_SCORE = 0.8;

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "had",
  "her",
  "was",
  "one",
  "our",
  "out",
  "has",
  "have",
  "been",
  "what",
  "when",
  "with",
  "this",
  "that",
  "from",
  "they",
  "will",
  "your",
  "about",
  "into",
  "would",
  "there",
  "their",
  "could",
  "should",
  "how",
  "why",
  "who",
  "which",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

function wordOverlapScore(
  queryTokens: string[],
  text: string,
  fullQuery: string
): number {
  if (queryTokens.length === 0) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) score += 1;
  }
  let normalized = score / queryTokens.length;
  if (fullQuery.length >= 4 && lower.includes(fullQuery.toLowerCase())) {
    normalized += 1.2;
  }
  return normalized;
}

function recencyBoost(updatedAt: Date): number {
  const hours = (Date.now() - updatedAt.getTime()) / 3_600_000;
  if (hours < 24) return 1;
  if (hours < 168) return 0.65;
  if (hours < 720) return 0.35;
  return 0.15;
}

interface Candidate {
  conversationId: string;
  conversationTitle: string;
  source: "summary" | "message";
  excerpt: string;
  updatedAt: Date;
  score: number;
}

function truncateExcerpt(text: string, max = 200): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max) + "…";
}

export function retrieveRelevantMemories(
  query: string,
  conversations: Conversation[],
  excludeConversationId?: string | null
): RetrievedMemory[] {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const queryTokens = tokenize(q);
  if (queryTokens.length === 0) return [];

  const candidates: Candidate[] = [];

  for (const conversation of conversations) {
    if (conversation.id === excludeConversationId) continue;

    const recency = recencyBoost(conversation.updatedAt);
    const meta = conversation.metadata;

    if (meta?.summary) {
      const metaText = [
        meta.summary,
        ...meta.topics,
        ...meta.tags,
        ...meta.entities,
      ].join(" ");
      const overlap = wordOverlapScore(queryTokens, metaText, q);
      const score = overlap * 2.2 + recency;

      if (score >= MIN_SCORE) {
        candidates.push({
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          source: "summary",
          excerpt: meta.summary,
          updatedAt: conversation.updatedAt,
          score,
        });
      }
    }

    const messages = conversation.messages.filter(
      (m) => !m.isStreaming && m.content.trim()
    );
    const recentMessages = messages.slice(-6);

    for (const message of recentMessages) {
      const overlap = wordOverlapScore(queryTokens, message.content, q);
      const score = overlap * 1.4 + recency * 0.9;

      if (score >= MIN_SCORE) {
        candidates.push({
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          source: "message",
          excerpt: truncateExcerpt(message.content),
          updatedAt: message.createdAt,
          score,
        });
      }
    }

    if (!meta?.summary && conversation.title) {
      const overlap = wordOverlapScore(queryTokens, conversation.title, q);
      const score = overlap * 1.0 + recency * 0.5;
      if (score >= MIN_SCORE && messages.length > 0) {
        const last = messages[messages.length - 1];
        candidates.push({
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          source: "message",
          excerpt: truncateExcerpt(last.content),
          updatedAt: conversation.updatedAt,
          score,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const results: RetrievedMemory[] = [];

  for (const c of candidates) {
    if (seen.has(c.conversationId)) continue;
    seen.add(c.conversationId);
    results.push({
      conversationId: c.conversationId,
      conversationTitle: c.conversationTitle,
      source: c.source,
      excerpt: c.excerpt,
      score: c.score,
      updatedAt: c.updatedAt,
    });
    if (results.length >= MAX_MEMORIES) break;
  }

  if (results.length === 0) {
    const recentWithSummary = conversations
      .filter(
        (c) =>
          c.id !== excludeConversationId &&
          c.metadata?.summary &&
          c.messages.some((m) => !m.isStreaming && m.content.trim())
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 2);

    for (const c of recentWithSummary) {
      results.push({
        conversationId: c.id,
        conversationTitle: c.title,
        source: "summary",
        excerpt: c.metadata!.summary,
        score: recencyBoost(c.updatedAt),
        updatedAt: c.updatedAt,
      });
    }
  }

  return results;
}

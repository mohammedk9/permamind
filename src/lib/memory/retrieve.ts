import type { Conversation } from "@/types/chat";
import type { RetrievedMemory } from "@/types/memory";
import { graphConversationNeighbors, updateMemoryGraph } from "./graph";

const MAX_MEMORIES = 4;
export const MEMORY_TOKEN_BUDGET = 600;
const MIN_QUERY_LENGTH = 3;
const MIN_SCORE = 0.8;

const PREVIOUS_CONVERSATION_PATTERNS = [
  /\bdid we (?:ever )?talk(?:ed)? about\b/i,
  /\bwhat did you say (?:before|previously|last time)\b/i,
  /\bwhat was my previous\b/i,
  /\bcontinue from last time\b/i,
  /\bremember when\b/i,
];

export function isPreviousConversationQuery(query: string): boolean {
  return PREVIOUS_CONVERSATION_PATTERNS.some((pattern) => pattern.test(query));
}

export function previousConversationSearchQuery(query: string): string {
  return query
    .replace(/did we (?:ever )?talk(?:ed)? about/i, "")
    .replace(/what did you say (?:before|previously|last time)/i, "")
    .replace(/what was my previous/i, "")
    .replace(/continue from last time/i, "")
    .replace(/remember when/i, "")
    .trim();
}

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

export function recencyScore(updatedAt: Date, now = Date.now()): number {
  const hours = Math.max(0, (now - updatedAt.getTime()) / 3_600_000);
  if (hours < 24) return 1;
  if (hours < 168) return 0.65;
  if (hours < 720) return 0.35;
  return 0.15;
}

export function estimateMemoryTokens(memory: RetrievedMemory): number {
  return Math.ceil((memory.conversationTitle.length + memory.excerpt.length) / 4);
}

export function selectMemoriesByScore(
  memories: RetrievedMemory[],
  tokenBudget = MEMORY_TOKEN_BUDGET
): RetrievedMemory[] {
  const selected: RetrievedMemory[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const memory of [...memories].sort((a, b) => b.score - a.score)) {
    if (seen.has(memory.conversationId)) continue;
    const tokens = estimateMemoryTokens(memory);
    if (selected.length > 0 && used + tokens > tokenBudget) continue;
    selected.push(memory);
    seen.add(memory.conversationId);
    used += tokens;
    if (selected.length >= MAX_MEMORIES) break;
  }
  return selected;
}

export interface MemoryScoreBreakdown {
  keywordOverlap: number;
  recency: number;
  summaryRelevance: number;
  entityOverlap: number;
  tagOverlap: number;
  total: number;
}

export function scoreMemory(
  query: string,
  memory: RetrievedMemory,
  metadata?: { summary?: string; entities?: string[]; tags?: string[] },
  now = Date.now()
): MemoryScoreBreakdown {
  const tokens = tokenize(query);
  const overlap = (text: string) => wordOverlapScore(tokens, text, "") ;
  const keywordOverlap = overlap(`${memory.conversationTitle} ${memory.excerpt}`);
  const summaryRelevance = overlap(metadata?.summary ?? "");
  const entityOverlap = overlap((metadata?.entities ?? []).join(" "));
  const tagOverlap = overlap((metadata?.tags ?? []).join(" "));
  const recency = recencyScore(memory.updatedAt, now);
  return { keywordOverlap, recency, summaryRelevance, entityOverlap, tagOverlap,
    total: keywordOverlap * 2.2 + recency + summaryRelevance * 1.8 + entityOverlap * 1.5 + tagOverlap * 1.2 };
}

interface Candidate {
  conversationId: string;
  conversationTitle: string;
  source: "summary" | "message";
  excerpt: string;
  updatedAt: Date;
  score: number;
  messageId?: string;
}

export function retrieveRelevantMemories(
  query: string,
  conversations: Conversation[],
  excludeConversationId?: string | null,
  previousConversationQuery = false
): RetrievedMemory[] {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH && !previousConversationQuery) return [];

  const queryTokens = tokenize(q);
  if (queryTokens.length === 0 && !previousConversationQuery) return [];

  const candidates: Candidate[] = [];
  const graph = updateMemoryGraph(conversations);
  const lexicalScores = new Map<string, number>();

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
      lexicalScores.set(conversation.id, Math.max(lexicalScores.get(conversation.id) ?? 0, score));

      if (score >= MIN_SCORE || previousConversationQuery) {
        candidates.push({
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          source: "summary",
          excerpt: meta.summary,
          updatedAt: conversation.updatedAt,
          score,
          messageId: undefined,
        });
      }
    }

    const messages = conversation.messages.filter(
      (m) => !m.isStreaming && m.content.trim()
    );
    const recentMessages = previousConversationQuery ? messages : messages.slice(-6);

    for (const message of recentMessages) {
      const overlap = wordOverlapScore(queryTokens, message.content, q);
      const score = previousConversationQuery && queryTokens.length === 0
        ? Math.max(recency * 0.9, MIN_SCORE)
        : overlap * 1.4 + recency * 0.9;
      lexicalScores.set(conversation.id, Math.max(lexicalScores.get(conversation.id) ?? 0, score));

      if (score >= MIN_SCORE) {
        candidates.push({
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          source: "message",
          excerpt: message.content,
          updatedAt: message.createdAt,
          score,
          messageId: message.id,
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
          excerpt: last.content,
          updatedAt: conversation.updatedAt,
          score,
          messageId: last.id,
        });
      }
    }
  }

  // Graph signals are deliberately additive and capped; lexical ranking remains primary.
  for (const candidate of candidates) {
    const neighbors = graphConversationNeighbors(graph, candidate.conversationId);
    const relevantNeighbors = [...neighbors].filter((id) => (lexicalScores.get(id) ?? 0) >= MIN_SCORE).length;
    candidate.score += Math.min(relevantNeighbors * 0.2, 0.6);
  }

  candidates.sort((a, b) => b.score - a.score);

  const results: RetrievedMemory[] = [];

  for (const c of candidates) {
    results.push({
      conversationId: c.conversationId,
      conversationTitle: c.conversationTitle,
      source: c.source,
      excerpt: c.excerpt,
      score: c.score,
      updatedAt: c.updatedAt,
      ...(c.messageId ? { messageId: c.messageId } : {}),
    });
  }

  const ranked = selectMemoriesByScore(results);
  if (ranked.length > 0) return ranked;

  if (results.length === 0 && !previousConversationQuery) {
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

  return selectMemoriesByScore(results);
}

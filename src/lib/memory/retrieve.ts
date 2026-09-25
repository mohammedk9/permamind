import type { Conversation } from "@/types/chat";
import type { MemoryRecord, RetrievedMemory } from "@/types/memory";
import { cosineSimilarity, embedText } from "./embeddings";
import { graphConversationNeighbors, updateMemoryGraph } from "./graph";

const MAX_MEMORIES = 3;
const DECISION_MAX_MEMORIES = 6;
export const MEMORY_TOKEN_BUDGET = 600;
const DECISION_TOKEN_BUDGET = 1400;
const MIN_QUERY_LENGTH = 3;
const MIN_SCORE = 0.8;

const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const ARABIC_ZERO_WIDTH = /[\u200B-\u200F]/g;

function normalizeArabic(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, "")
    .replace(ARABIC_ZERO_WIDTH, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .replace(/ـ/g, "");
}

const PREVIOUS_CONVERSATION_PATTERNS = [
  /\bdid we (?:ever )?talk(?:ed)? about\b/i,
  /\bwhat did you say (?:before|previously|last time)\b/i,
  /\bwhat was my previous\b/i,
  /\bcontinue from last time\b/i,
  /\bremember when\b/i,
  /\bwhat did we decide\b/i,
  /\bwhy did we (?:decide|reject|choose)\b/i,
];

const ARABIC_PREVIOUS_CONVERSATION_PATTERNS = [
  /(?:^|\s)(?:ماذا|ما|شنو|اشنو|اش|ايه|أي)\s+(?:قلت|قلتي|قلتم|قلنا|ذكرت|ذكرتي|ذكرتم|ذكرنا|قلته|ذكرته)(?:\s+(?:لي|لنا|سابقا|قبل|بالقبل|في\s+السابق|من\s+قبل))?/iu,
  /(?:^|\s)(?:تذكر|تذكري|تذكرو|تذكروا|تذكرين|تذكرني|اذكر|استمر|واصل|أكمل|اكمل)(?:ني)?/iu,
  /(?:^|\s)(?:هل\s+)?(?:تحدثنا|تكلمنا|ناقشنا|تناولنا)(?:\s+عن)?/iu,
  /(?:^|\s)(?:ما|ماذا|شنو|اشنو|اش|ايه|أي)\s+(?:اسم|تفاصيل|ملخص|موضوع|مشروع|قرار|خطة|معلومات)?\s*(?:الذي|التي|اللي)?\s*(?:قلت|قلنا|ذكرت|ذكرنا|قلته|ذكرته)(?:\s+(?:به|عليه|سابقا|قبل|بالقبل|في\s+السابق|من\s+قبل))?/iu,
  /(?:^|\s)(?:المحادثة\s+السابقة|محادثة\s+سابقة|آخر\s+مرة|المرة\s+السابقة|سابقا|قبل|بالقبل|في\s+السابق|من\s+قبل)/iu,
];

function isArabicPreviousConversationQuery(query: string): boolean {
  const normalized = normalizeArabic(query);
  return ARABIC_PREVIOUS_CONVERSATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isPreviousConversationQuery(query: string): boolean {
  return PREVIOUS_CONVERSATION_PATTERNS.some((pattern) => pattern.test(query)) ||
    isArabicPreviousConversationQuery(query);
}

const DECISION_QUERY_PATTERNS = [
  /\bwhat did we decide\b/i,
  /\bwhy did we (?:decide|reject|choose)\b/i,
  /\b(?:our|the) decision\b/i,
];

/** True when the user is asking for a stored decision rather than general recall. */
export function isDecisionQuery(query: string): boolean {
  if (DECISION_QUERY_PATTERNS.some((pattern) => pattern.test(query))) return true;
  return /(?:قرار|قررنا|رفضنا|اخترنا)/u.test(normalizeArabic(query));
}

const ARABIC_INTERROGATIVE_WORDS = [
  "ماذا",
  "ما",
  "شنو",
  "اشنو",
  "اش",
  "ايه",
  "أي",
  "هل",
];

const ARABIC_PREVIOUS_VERBS = [
  "تذكرني",
  "تذكروا",
  "تذكرو",
  "تذكري",
  "تذكرين",
  "تذكر",
  "اذكر",
  "استمر",
  "واصل",
  "أكمل",
  "اكمل",
  "قلته",
  "قلتها",
  "قلتي",
  "قلتم",
  "قلنا",
  "قلت",
  "ذكرته",
  "ذكرتها",
  "ذكرتي",
  "ذكرتم",
  "ذكرنا",
  "ذكرت",
  "تحدثنا",
  "تكلمنا",
  "ناقشنا",
  "تناولنا",
];

const ARABIC_RELATIVE_WORDS = [
  "الذين",
  "اللواتي",
  "اللذان",
  "الذي",
  "التي",
  "اللي",
];

const ARABIC_PREVIOUS_MARKERS = [
  "المحادثة السابقة",
  "محادثة سابقة",
  "المرة السابقة",
  "آخر مرة",
  "اخر مرة",
  "في السابق",
  "من قبل",
  "بالقبل",
  "سابقا",
  "قبل",
];

const ARABIC_FILLER_WORDS = [
  "هناك",
  "هنا",
  "هذا",
  "هذه",
  "ذلك",
  "تلك",
  "كانت",
  "كان",
  "نحن",
  "انا",
  "أنا",
  "انت",
  "أنت",
  "هو",
  "هي",
  "هم",
  "هما",
  "شيء",
  "شي",
];

const ARABIC_STOP_WORDS = new Set([
  ...ARABIC_INTERROGATIVE_WORDS,
  ...ARABIC_PREVIOUS_VERBS,
  ...ARABIC_RELATIVE_WORDS,
  ...ARABIC_PREVIOUS_MARKERS,
  ...ARABIC_FILLER_WORDS,
  "من",
  "في",
  "على",
  "عن",
  "مع",
  "الى",
  "إلى",
  "ب",
  "ل",
  "لا",
  "ليس",
  "لقد",
  "لم",
  "لن",
  "كل",
  "بعض",
  "ايضا",
  "أيضا",
  "عند",
  "اذا",
  "إذا",
  "كيف",
  "لماذا",
  "متى",
  "بين",
  "ثم",
  "لكن",
  "ولكن",
  "او",
  "أو",
  "ان",
  "إن",
  "اما",
  "أما",
  "حتى",
  "لكي",
  "بعد",
  "دون",
  "خلال",
  "حول",
  "داخل",
  "خارج",
  "اول",
  "أول",
  "اخر",
  "آخر",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function removeArabicWords(text: string, words: string[]): string {
  const alternatives = words
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length)
    .join("|");
  if (!alternatives) return text;

  return text.replace(
    new RegExp(`(^|\\s)(?:${alternatives})(?=\\s|$)`, "giu"),
    "$1"
  );
}

function stripArabicPreviousConversationWords(query: string): string {
  let result = normalizeArabic(query)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  result = removeArabicWords(result, ARABIC_PREVIOUS_MARKERS);
  result = removeArabicWords(result, ARABIC_RELATIVE_WORDS);
  result = removeArabicWords(result, ARABIC_PREVIOUS_VERBS);
  result = removeArabicWords(result, ARABIC_INTERROGATIVE_WORDS);
  result = removeArabicWords(result, ARABIC_FILLER_WORDS);

  return result.replace(/\s+/g, " ").trim();
}

export function previousConversationSearchQuery(query: string): string {
  if (isArabicPreviousConversationQuery(query)) {
    return stripArabicPreviousConversationWords(query);
  }

  return query
    .replace(/did we (?:ever )?talk(?:ed)? about/gi, "")
    .replace(/what did you say (?:before|previously|last time)/gi, "")
    .replace(/what was my previous/gi, "")
    .replace(/continue from last time/gi, "")
    .replace(/remember when/gi, "")
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
  const normalized = normalizeArabic(text);
  return normalized
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word) && !ARABIC_STOP_WORDS.has(word));
}

function wordOverlapScore(
  queryTokens: string[],
  text: string,
  fullQuery: string
): number {
  if (queryTokens.length === 0) return 0;
  const normalizedText = normalizeArabic(text);
  const normalizedFullQuery = normalizeArabic(fullQuery);
  let score = 0;
  for (const token of queryTokens) {
    if (normalizedText.includes(token)) score += 1;
  }
  let normalized = score / queryTokens.length;
  if (normalizedFullQuery.length >= 4 && normalizedText.includes(normalizedFullQuery)) {
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
  tokenBudget = MEMORY_TOKEN_BUDGET,
  maxMemories = MAX_MEMORIES,
): RetrievedMemory[] {
  const selected: RetrievedMemory[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const memory of [...memories].sort((a, b) => b.score - a.score)) {
    if (seen.has(memory.conversationId) && !memory.recordId) continue;
    const tokens = estimateMemoryTokens(memory);
    if (selected.length > 0 && used + tokens > tokenBudget) continue;
    selected.push(memory);
    seen.add(memory.conversationId);
    used += tokens;
    if (selected.length >= maxMemories) break;
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
  reason: RetrievedMemory["reason"];
}

export function retrieveRelevantMemories(
  query: string,
  conversations: Conversation[],
  excludeConversationId?: string | null,
  previousConversationQuery = false,
  records: MemoryRecord[] = [],
  semanticDocuments: Array<{ id: string; vector: Float32Array }> = [],
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
          reason: "summary match",
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
          reason: "keyword match",
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
          reason: "keyword match",
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
      confidence: c.score >= 2.5 ? "high" : c.score >= 1.4 ? "medium" : "low",
      reason: c.reason,
      updatedAt: c.updatedAt,
      ...(c.messageId ? { messageId: c.messageId } : {}),
    });
  }

  const ranked = selectMemoriesByScore(results);
  if (ranked.length > 0 || previousConversationQuery) return mergeSemanticMemories(ranked, query, conversations, records, semanticDocuments);

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
        confidence: "low",
        reason: "recent context",
        updatedAt: c.updatedAt,
      });
    }
  }

  return mergeSemanticMemories(selectMemoriesByScore(results), query, conversations, records, semanticDocuments, previousConversationQuery || isDecisionQuery(q));
}

const SEMANTIC_SCORE = 0.22;

function mergeSemanticMemories(
  lexical: RetrievedMemory[],
  query: string,
  conversations: Conversation[],
  records: MemoryRecord[],
  semanticDocuments: Array<{ id: string; vector: Float32Array }>,
  decisionQuery = false,
): RetrievedMemory[] {
  const queryVector = embedText(query);
  if (![...queryVector].some(Boolean)) return lexical;
  const active = records.filter((record) => record.status === "active" && record.text.trim());
  const additions: RetrievedMemory[] = [];

  for (const record of active) {
    const durable = record.pinned || record.kind === "decision";
    const overlap = cosineSimilarity(queryVector, embedText(record.text));
    if (!durable && overlap < SEMANTIC_SCORE) continue;
    if (decisionQuery && record.kind !== "decision" && overlap < SEMANTIC_SCORE) continue;
    additions.push({
      conversationId: record.conversationId,
      conversationTitle: record.conversationTitle,
      source: record.kind === "decision" ? "decision" : record.kind === "project" ? "project" : "fact",
      excerpt: record.text,
      recordId: record.id,
      score: (record.pinned ? Math.max(overlap, SEMANTIC_SCORE) + 1.4 : overlap * 3) + (decisionQuery && record.kind === "decision" ? 2 : 0),
      confidence: record.confidence,
      reason: record.pinned ? "pinned memory" : "meaning match",
      updatedAt: new Date(record.updatedAt),
    });
  }

  for (const document of semanticDocuments) {
    const overlap = cosineSimilarity(queryVector, document.vector);
    if (overlap < SEMANTIC_SCORE || lexical.some((memory) => memory.conversationId === document.id.replace(/^summary:/, ""))) continue;
    const conversation = conversations.find((item) => item.id === document.id.replace(/^summary:/, ""));
    if (!conversation?.metadata?.summary) continue;
    additions.push({
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      source: "summary",
      excerpt: conversation.metadata.summary,
      score: overlap * 3,
      confidence: overlap >= 0.72 ? "high" : "medium",
      reason: "meaning match",
      updatedAt: conversation.updatedAt,
    });
  }

  const merged = [...lexical];
  for (const addition of additions.sort((left, right) => right.score - left.score)) {
    const duplicate = merged.find((memory) => memory.recordId === addition.recordId || (memory.conversationId === addition.conversationId && memory.excerpt === addition.excerpt));
    if (duplicate) {
      duplicate.score = Math.max(duplicate.score, addition.score);
      duplicate.reason = addition.reason === "pinned memory" ? addition.reason : duplicate.reason;
      continue;
    }
    merged.push(addition);
  }
  return selectMemoriesByScore(
    merged,
    decisionQuery ? DECISION_TOKEN_BUDGET : MEMORY_TOKEN_BUDGET,
    decisionQuery ? DECISION_MAX_MEMORIES : MAX_MEMORIES,
  );
}

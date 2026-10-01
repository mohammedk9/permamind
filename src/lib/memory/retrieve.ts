import type { Conversation } from "@/types/chat";
import type { MemoryRecord, RetrievedMemory } from "@/types/memory";
import { cosineSimilarity, embedText } from "./embeddings";
import { graphConversationNeighbors, updateMemoryGraph } from "./graph";

import { normalizeArabic, normalizeForMatch, tokenizeArabic } from "@/lib/i18n/arabic-normalize";
import { buildBm25Index } from "@/lib/search/bm25";
import { reciprocalRankFusion } from "@/lib/search/reciprocal-rank-fusion";

/**
 * Three memories per reply left most of a stored history unused. The budget is
 * what actually protects the context window, not this number, so it is raised
 * and the character budget stays the binding constraint.
 */
const MAX_MEMORIES = 8;
const DECISION_MAX_MEMORIES = 10;
export const MEMORY_TOKEN_BUDGET = 900;
const DECISION_TOKEN_BUDGET = 1600;
const MIN_QUERY_LENGTH = 3;
const MIN_SCORE = 0.8;

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

/** Normalised here once, then filtered against the language stop lists. */
function tokenize(text: string): string[] {
  return tokenizeArabic(text).filter((word) => !STOP_WORDS.has(word) && !ARABIC_STOP_WORDS.has(word));
}

/**
 * Legacy overlap score, retained for the memory-index search path and as the
 * tie-breaker BM25 feeds.
 *
 * BM25 is now the primary ranker; this survives because the Memory page search
 * needs a bounded, explainable 0-1 number per hit and because
 * `scoreMemory` is part of the exported surface other modules already call.
 */
function wordOverlapScore(
  queryTokens: string[],
  text: string,
  fullQuery: string
): number {
  if (queryTokens.length === 0) return 0;
  const normalizedText = normalizeForMatch(text);
  const normalizedFullQuery = normalizeForMatch(fullQuery);
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

/**
 * Builds the corpus BM25 ranks over.
 *
 * Each conversation contributes its summary plus the same recent messages the
 * fallback scan uses, so the two paths see the same material and BM25 is a
 * re-ranking of it rather than a different dataset. Document ids encode the
 * conversation so a hit can be attributed back.
 */
function buildRetrievalDocuments(
  conversations: Conversation[],
  excludeConversationId?: string | null,
  previousConversationQuery = false,
): Array<{ id: string; text: string }> {
  const documents: Array<{ id: string; text: string }> = [];

  for (const conversation of conversations) {
    if (conversation.id === excludeConversationId) continue;

    const meta = conversation.metadata;
    if (meta?.summary) {
      documents.push({
        id: `summary:${conversation.id}`,
        text: [conversation.title, meta.summary, ...meta.topics, ...meta.tags, ...meta.entities].join(" "),
      });
    }

    const messages = conversation.messages.filter((message) => !message.isStreaming && message.content.trim());
    // A recall question ("what did we say about X?") should be able to reach the
    // whole history, which is why it widens the window the same way the
    // fallback scan does.
    const recent = previousConversationQuery ? messages : messages.slice(-6);
    for (const message of recent) {
      documents.push({ id: `message:${message.id}`, text: `${conversation.title} ${message.content}` });
    }
  }

  return documents;
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

  /**
   * BM25 pre-filter.
   *
   * The old loop scored every conversation and every one of its last six
   * messages with a flat overlap count, which ranked a term appearing in fifty
   * conversations exactly the same as a term appearing in one. BM25 inverts
   * that: a rare term dominates, which is what makes "what did we decide about
   * launch?" find the one conversation that actually mentions a launch.
   *
   * The index is built over conversation summaries and their recent messages,
   * and its scores are merged into the existing pipeline rather than replacing
   * it, so recency, graph signals, pinned memories, and the decision rules all
   * keep working exactly as before.
   */
  const bm25 = buildBm25Index(buildRetrievalDocuments(conversations, excludeConversationId, previousConversationQuery));
  const bm25Scores = new Map<string, number>();
  if (bm25.size > 0) {
    const maxScore = bm25.maxScore;
    for (const hit of bm25.search(q, { limit: conversations.length * 4 || 40 })) {
      // Normalise onto 0-1 so it can be combined with the other signals, which
      // already live in that range. The cap keeps one dominant hit from
      // erasing the recency and graph contributions entirely.
      bm25Scores.set(hit.id, Math.min(1, hit.score / maxScore));
    }
  }

  for (const conversation of conversations) {
    if (conversation.id === excludeConversationId) continue;

    const recency = recencyBoost(conversation.updatedAt);
    const meta = conversation.metadata;
    /** BM25 evidence for this conversation, averaged over its indexed documents. */
    const bm25Score = bm25Scores.get(conversation.id) ?? 0;

    if (meta?.summary) {
      const metaText = [
        meta.summary,
        ...meta.topics,
        ...meta.tags,
        ...meta.entities,
      ].join(" ");
      const overlap = wordOverlapScore(queryTokens, metaText, q);
      // BM25 is weighted highest: it is the only signal that understands how
      // rare the query terms are, which the flat overlap count cannot express.
      const score = overlap * 1.4 + bm25Score * 1.6 + recency;
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
        : overlap * 1.0 + bm25Score * 1.3 + recency * 0.9;
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

  /**
   * Fusion.
   *
   * The previous implementation took `Math.max(lexicalScore, semanticScore)`,
   * which assumed the two numbers were on the same scale. They are not: a
   * cosine similarity near 0.3 and an overlap ratio near 0.9 are different
   * quantities, so the larger one silently erased the other. A memory the
   * semantic retriever loved but the lexical one disliked lost, and vice versa.
   *
   * Reciprocal Rank Fusion replaces that with a position-based combination, so
   * a memory ranked highly by either retriever survives, and neither can
   * single-handedly dictate the final order. Pinned and decision memories keep
   * their explicit boosts, which are a user instruction rather than a ranking
   * signal and therefore must not be normalised away.
   */
  const semanticRanking = additions
    .slice()
    .sort((left, right) => right.score - left.score)
    .map((memory) => ({ id: memory.recordId ?? `${memory.conversationId}::${memory.excerpt}`, memory }));

  const fused = reciprocalRankFusion(
    [
      {
        name: "lexical",
        items: lexical
          .slice()
          .sort((left, right) => right.score - left.score)
          .map((memory) => ({ id: memory.recordId ?? `${memory.conversationId}::${memory.excerpt}`, memory })),
      },
      { name: "semantic", items: semanticRanking },
    ],
    { limit: lexical.length + additions.length },
  );

  const byId = new Map<string, RetrievedMemory>();
  for (const memory of lexical) byId.set(memory.recordId ?? `${memory.conversationId}::${memory.excerpt}`, memory);
  for (const entry of semanticRanking) byId.set(entry.id, entry.memory);

  /** Explicit user intent, kept outside the fused ranking score. */
  const intentBoost = new Map<string, number>();
  for (const entry of semanticRanking) {
    const memory = entry.memory;
    let boost = 0;
    if (memory.reason === "pinned memory") boost += 1.4;
    if (decisionQuery && memory.source === "decision") boost += 2;
    if (boost > 0) intentBoost.set(entry.id, boost);
  }

  const merged = fused.map((entry) => {
    const memory = byId.get(entry.id)!;
    // Rescale the fused score back into the 0-1-plus range the rest of this
    // file and the UI already assume, then apply the intent boost last.
    const normalized = entry.score * 20;
    return {
      ...memory,
      score: normalized + (intentBoost.get(entry.id) ?? 0),
      // A memory both retrievers agree on is genuinely more trustworthy.
      confidence: entry.sources.length > 1 ? "high" : memory.confidence,
    };
  });

  return selectMemoriesByScore(
    merged,
    decisionQuery ? DECISION_TOKEN_BUDGET : MEMORY_TOKEN_BUDGET,
    decisionQuery ? DECISION_MAX_MEMORIES : MAX_MEMORIES,
  );
}

/**
 * Local, AI-free extraction of decisions and preferences.
 *
 * Every other memory in this app comes from a model: `queueSummary` posts the
 * conversation to `/api/summarize`, which spends the same daily allowance as a
 * chat message. That makes memory hostage to the quota — exactly when the user
 * has run out, the app has the least to remember with, and the memory ledger
 * stops growing altogether.
 *
 * This module fills that gap with high-precision pattern matching over the
 * user's own words. It is deliberately conservative:
 *
 * - Only the user's messages are read. An assistant's suggestion is not a
 *   decision the user made.
 * - A question is never a decision, and neither is a sentence that only looks
 *   like one ("هل قررنا…؟").
 * - Every draft carries `source: "extracted"` and a confidence, so a wrong guess
 *   is visible and correctable in the ledger instead of being asserted as fact.
 * - It never overwrites a record the user wrote or pinned (the ledger's `upsert`
 *   already guarantees that).
 *
 * This is a floor, not a replacement: when the quota allows, the model still
 * runs and produces richer summaries. The local pass runs either way.
 */

import { normalizeArabicPreservingCase } from "@/lib/i18n/arabic-normalize";
import type { Conversation } from "@/types/chat";
import type { MemoryConfidence } from "@/types/memory";

export interface LocalMemoryDraft {
  kind: "decision" | "preference";
  text: string;
  confidence: MemoryConfidence;
}

/** Below this a sentence is a fragment, not something worth remembering. */
const MIN_LENGTH = 12;

/** Long enough for a memory, short enough to stay a single statement. */
const MAX_LENGTH = 200;

/** A chatty conversation must not fill the ledger by itself. */
const MAX_PER_CONVERSATION = 8;

/** Sentence terminators across Arabic and English. */
const SENTENCE_SPLIT = /[.!?؟\n]+/u;

/** Question openers: a question is never a decision. Written normalised. */
const QUESTION_STARTERS = [
  "ماذا", "ما", "هل", "لماذا", "كيف", "متى", "اين", "من", "كم", "ممكن",
  "which", "what", "why", "how", "when", "where", "who", "is", "are", "do", "does", "did", "can", "could", "should", "would",
];
interface Rule {
  kind: "decision" | "preference";
  pattern: RegExp;
  /** Capture group holding the remembered text, when it is not the whole match. */
  group?: number;
  confidence: MemoryConfidence;
  /**
   * Stores the capture as a negation ("not X") rather than as the bare text.
   *
   * Without it, "we decided against Postgres" would be remembered as "Postgres"
   * — the same record as a decision to adopt it, which is the opposite memory.
   */
  negate?: boolean;
}

/**
 * Matching happens on normalised text, so harakat, hamza, and tatweel cannot
 * hide a pattern from the matcher — "أفضل" and "أفضّل" are the same word here.
 *
 * Case is **preserved**, because the matched group becomes the stored memory:
 * folding it would write "postgresql" where the user wrote "PostgreSQL". The
 * patterns therefore carry the `i` flag, which lets them match "We decided" as
 * well as "we decided".
 *
 * Apostrophes are stripped ("we've" → "weve", "I'd" → "id") because the pattern
 * list cannot spell every typographic apostrophe a keyboard produces.
 */
function normalizeForRule(sentence: string): string {
  return normalizeArabicPreservingCase(sentence).replace(/['\u2019\u02BC]/g, "");
}

const RULES: Rule[] = [
  // Arabic — explicit decisions.
  // `(?:^|\s)` rather than `\b`: JavaScript's `\b` is defined over [A-Za-z0-9_],
  // so it never matches next to an Arabic letter. A pattern written with `\b`
  // would fail at the start of every Arabic sentence, silently.
  { kind: "decision", pattern: /(?:^|\s)قررنا\s+(?:ان\s+)?(.{4,})/iu, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /(?:^|\s)(?:تم\s+)?تقرر\s+(?:ان\s+)?(.{4,})/iu, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /(?:^|\s)اخترنا\s+(.{4,})/iu, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /(?:^|\s)اتفقنا\s+(?:على\s+)?(.{4,})/iu, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /(?:^|\s)(?:لن\s+)?نستخدم\s+(.{4,})/iu, group: 1, confidence: "low" },
  { kind: "decision", pattern: /(?:^|\s)سنقوم\s+ب\s*(.{4,})/iu, group: 1, confidence: "low" },
  { kind: "decision", pattern: /(?:^|\s)سنبدا\s+(.{4,})/iu, group: 1, confidence: "low" },
  // Arabic — further decision phrasings, so the local floor still catches the
  // common ways a decision is stated when the model allowance is spent.
  { kind: "decision", pattern: /(?:^|\s)اعتمدنا\s+(?:على\s+)?(.{4,})/iu, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /(?:^|\s)سنعتمد\s+(.{4,})/iu, group: 1, confidence: "low" },
  { kind: "decision", pattern: /(?:^|\s)اخترت\s+(?:ان\s+)?(.{4,})/iu, group: 1, confidence: "low" },
  { kind: "decision", pattern: /(?:^|\s)تحولنا\s+(?:الي|إلي)\s+(.{4,})/iu, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /(?:^|\s)استبدلنا\s+(.{4,})/iu, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /(?:^|\s)القرار\s+(?:هو\s+)?(?:ان\s+)?(.{4,})/iu, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /(?:^|\s)علينا\s+(?:ان\s+)?(.{4,})/iu, group: 1, confidence: "low" },

  // Arabic — preferences.
  { kind: "preference", pattern: /(?:^|\s)(?:انا\s+)?افضل\s+(?:ان\s+)?(.{3,})/iu, group: 1, confidence: "medium" },
  { kind: "preference", pattern: /(?:^|\s)لا\s+احب\s+(.{3,})/iu, group: 1, confidence: "medium" },
  { kind: "preference", pattern: /(?:^|\s)اكره\s+(.{3,})/iu, group: 1, confidence: "low" },
  { kind: "preference", pattern: /(?:^|\s)اميل\s+الى\s+(.{3,})/iu, group: 1, confidence: "low" },

  // English — explicit decisions.
  // `\b` is safe here (it is ASCII-only by definition) and `i` lets "We decided"
  // match as well as "we decided". Negated forms carry `negate`, so the stored
  // text keeps the "not" the user actually said.
  { kind: "decision", pattern: /\bwe\s*(?:ve|have)\s+decided\s+against\s+(.{4,})/i, group: 1, confidence: "medium", negate: true },
  { kind: "decision", pattern: /\bwe\s+decided\s+against\s+(.{4,})/i, group: 1, confidence: "medium", negate: true },
  { kind: "decision", pattern: /\bwe\s*(?:ve|have)\s+decided\s+(?!against\b)(?:to\s+|on\s+)?(.{4,})/i, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /\bwe\s+decided\s+(?!against\b)(?:to\s+|on\s+)?(.{4,})/i, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /\bwe\s*(?:ve|have)\s+agreed\s+(?:to\s+|on\s+)?(.{4,})/i, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /\bwe\s+agreed\s+(?:to\s+|on\s+)?(.{4,})/i, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /\bwe\s*(?:ve|have)\s+settled\s+on\s+(.{4,})/i, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /\bwe\s+settled\s+on\s+(.{4,})/i, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /\bwe\s*(?:ve|have)\s+picked\s+(.{4,})/i, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /\bwe\s+picked\s+(.{4,})/i, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /\bwe\s*(?:ve|have)\s+switched\s+to\s+(.{4,})/i, group: 1, confidence: "low" },
  { kind: "decision", pattern: /\bwe\s+switched\s+to\s+(.{4,})/i, group: 1, confidence: "low" },
  { kind: "decision", pattern: /\bwe\s+(?:re|are)\s+using\s+(.{4,})/i, group: 1, confidence: "low" },
  { kind: "decision", pattern: /\bwe\s+(?:re|are)\s+not\s+going\s+to\s+(.{4,})/i, group: 1, confidence: "low", negate: true },
  { kind: "decision", pattern: /\bwe\s+(?:re|are)\s+going\s+to\s+(.{4,})/i, group: 1, confidence: "low" },
  { kind: "decision", pattern: /\blets\s+not\s+(.{4,})/i, group: 1, confidence: "low", negate: true },
  { kind: "decision", pattern: /\blets\s+(?!not\b)(.{4,})/i, group: 1, confidence: "low" },
  { kind: "decision", pattern: /\bwe\s+will\s+not\s+(.{4,})/i, group: 1, confidence: "low", negate: true },
  { kind: "decision", pattern: /\bwe\s+wont\s+(.{4,})/i, group: 1, confidence: "low", negate: true },
  { kind: "decision", pattern: /\bwe\s+will\s+(?!not\b)(.{4,})/i, group: 1, confidence: "low" },
  { kind: "decision", pattern: /\bwe\s+should\s+(.{4,})/i, group: 1, confidence: "low" },

  // English — further decision phrasings for the quota-free local floor.
  // Apostrophes are stripped by `normalizeForRule` ("we'll" -> "well"), so the
  // patterns match the stripped form: `(?:ll| will)`, `(?:ve| have)`, `(?:re| are)`.
  { kind: "decision", pattern: /\bwe\s*(?:ll| will)\s+go\s+with\s+(.{4,})/i, group: 1, confidence: "low" },
  { kind: "decision", pattern: /\bwe\s*(?:ve| have)\s+chosen\s+(.{4,})/i, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /\bwe\s+chose\s+(.{4,})/i, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /\bwe\s*(?:ve| have)\s+opted\s+for\s+(.{4,})/i, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /\bwe\s+opted\s+for\s+(.{4,})/i, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /\bthe\s+decision\s+is\s+(?:to\s+)?(.{4,})/i, group: 1, confidence: "medium" },
  { kind: "decision", pattern: /\bwe\s*(?:re| are)\s+going\s+with\s+(.{4,})/i, group: 1, confidence: "low" },

  // English — preferences.
  { kind: "preference", pattern: /\bi\s+prefer\s+(.{3,})/i, group: 1, confidence: "medium" },
  { kind: "preference", pattern: /\bi\s*(?:d\s+|would\s+)rather\s+(.{3,})/i, group: 1, confidence: "low" },
  { kind: "preference", pattern: /\bwe\s*(?:d\s+|would\s+)rather\s+(.{3,})/i, group: 1, confidence: "low" },
  { kind: "preference", pattern: /\bi\s+(?:do\s+)?not\s+like\s+(.{3,})/i, group: 1, confidence: "medium", negate: true },
  { kind: "preference", pattern: /\bi\s+dont\s+like\s+(.{3,})/i, group: 1, confidence: "medium", negate: true },
  { kind: "preference", pattern: /\bwe\s+(?:do\s+)?not\s+like\s+(.{3,})/i, group: 1, confidence: "medium", negate: true },
  { kind: "preference", pattern: /\bwe\s+dont\s+like\s+(.{3,})/i, group: 1, confidence: "medium", negate: true },
  { kind: "preference", pattern: /\bi\s+hate\s+(.{3,})/i, group: 1, confidence: "low" },
  { kind: "preference", pattern: /\bi\s+love\s+(.{3,})/i, group: 1, confidence: "low" },
];

/** True when the sentence asks rather than states. */
function isQuestion(normalised: string): boolean {
  const first = normalised.split(/\s+/u)[0] ?? "";
  return QUESTION_STARTERS.some((starter) => first === starter || first.startsWith(`${starter} `));
}

/** Trims to a word boundary and enforces the length window. */
function fit(text: string): string | null {
  const cleaned = text.replace(/\s+/gu, " ").trim().replace(/[.!?؟]+$/u, "").trim();
  if (cleaned.length < MIN_LENGTH) return null;
  if (cleaned.length <= MAX_LENGTH) return cleaned;

  const cut = cleaned.slice(0, MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > MIN_LENGTH ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Splits a message into sentences and applies every rule to each one. */
export function extractLocalMemory(text: string): LocalMemoryDraft[] {
  if (!text.trim()) return [];

  const drafts: LocalMemoryDraft[] = [];
  const seen = new Set<string>();

  for (const raw of text.split(SENTENCE_SPLIT)) {
    const sentence = raw.trim();
    if (sentence.length < MIN_LENGTH) continue;

    const normalised = normalizeForRule(sentence);
    if (!normalised || isQuestion(normalised)) continue;

    for (const rule of RULES) {
      const match = rule.pattern.exec(normalised);
      if (!match) continue;

      const captured = fit(match[rule.group ?? 0] ?? "");
      if (!captured) continue;

      // A negated rule keeps its "not": remembering "Postgres" for "we decided
      // against Postgres" would store the opposite of what was said.
      const text = rule.negate ? `not ${captured}` : captured;

      const key = `${rule.kind}:${text}`;
      if (seen.has(key)) continue;
      seen.add(key);

      drafts.push({ kind: rule.kind, text, confidence: rule.confidence });
    }
  }

  return drafts;
}

/**
 * Local drafts for one conversation, from the user's messages only.
 *
 * The assistant's replies are excluded on purpose: "we decided to migrate" is a
 * decision when the user writes it, and a proposal when the model does.
 */
export function extractLocalMemoryFromConversation(conversation: Conversation): LocalMemoryDraft[] {
  const drafts: LocalMemoryDraft[] = [];
  const seen = new Set<string>();

  for (const message of conversation.messages) {
    if (message.role !== "user" || message.isStreaming || !message.content.trim()) continue;

    for (const draft of extractLocalMemory(message.content)) {
      if (drafts.length >= MAX_PER_CONVERSATION) return drafts;
      const key = `${draft.kind}:${draft.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      drafts.push(draft);
    }
  }

  return drafts;
}

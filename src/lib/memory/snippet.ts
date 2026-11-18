/**
 * Snippets for memory hits, shared by every surface that shows one.
 *
 * The hard part is that Arabic normalisation changes string length: harakat and
 * tatweel are deleted, a zero-width joiner becomes a space. An offset found in
 * the normalised text therefore cannot be used against the original, which is
 * exactly how the previous implementation produced snippets centred on the wrong
 * word — or none at all.
 *
 * Walking the *original* words and normalising each one keeps the offset exact
 * for every script, at the cost of one pass over the text.
 */

import { normalizeForMatch } from "@/lib/i18n/arabic-normalize";

/** Characters of context kept on each side of a match. */
export const SNIPPET_RADIUS = 80;

/** A run of letters or digits in the original text. */
const WORD_PATTERN = /[\p{L}\p{N}]+/gu;

export interface MatchRange {
  start: number;
  end: number;
}

/**
 * The first word in the original text that corresponds to a query token.
 *
 * A second, looser pass accepts the Arabic definite article and a leading
 * conjunction, because "القرار" and "قرار" are the same word to a reader, and a
 * snippet centred on the wrong occurrence is simply a worse excerpt.
 */
export function findMatchRange(text: string, tokens: string[]): MatchRange | null {
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
export function buildSnippet(text: string, tokens: string[], radius = SNIPPET_RADIUS): string {
  if (!text) return "";

  const range = findMatchRange(text, tokens);
  // No exact match: show the opening rather than an excerpt centred on a guess,
  // because a wrong centre reads as a broken result.
  const focus = range ? (range.start + range.end) / 2 : radius;

  let start = Math.max(0, Math.floor(focus - radius));
  let end = Math.min(text.length, Math.ceil(focus + radius));

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
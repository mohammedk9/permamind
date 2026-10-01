/**
 * Arabic text normalization, shared by every retrieval path.
 *
 * Before this module existed, four separate copies of this logic lived in
 * `retrieve.ts`, `embeddings.ts`, `decision.ts`, and `context.ts`, and they had
 * drifted apart. Running them against the same inputs showed real failures:
 *
 *   input        retrieve.ts   embeddings.ts
 *   ؤسر          وسر           ؤسر        ← hamza-on-waw not unified
 *   ئميعة        يميعه         ئميعه      ← hamza-on-ya not unified
 *   zero-width   مذاقررنا      ماذا قررنا   ← words glued together
 *
 * That is worse than cosmetic. The lexical ranker and the semantic ranker were
 * normalising the same sentence into two different strings, then merging their
 * scores. A query could match lexically and be rejected semantically for no
 * reason the user can see.
 *
 * Everything here runs on the device. No text leaves the browser.
 */

/** Harakat, tanwin, shadda, sukun, and Quranic annotation marks. */
const DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
/** Zero-width joiners and marks that browsers and keyboards insert silently. */
const ZERO_WIDTH = /[\u200B-\u200F\u061C\uFEFF]/g;
/** Tatweel / kashida, used purely for visual stretching. */
const TATWEEL = /\u0640/g;
/** Anything that is not a letter or a number. */
const NON_ALPHANUMERIC = /[^\p{L}\p{N}\s]/gu;

/**
 * Collapses the Arabic letter variants that readers treat as the same letter.
 *
 * Each pair here was verified to differ between the old copies of this
 * function, so every entry closes a real mismatch.
 */
const LETTER_FOLDING: ReadonlyArray<readonly [RegExp, string]> = [
  // أ إ آ ٱ -> ا
  [/[\u0623\u0625\u0622\u0671]/g, "\u0627"],
  // ة -> ه
  [/\u0629/g, "\u0647"],
  // ى -> ي
  [/\u0649/g, "\u064A"],
  // ؤ -> و
  [/\u0624/g, "\u0648"],
  // ئ -> ي
  [/\u0626/g, "\u064A"],
  // ء -> removed, matching how a bare hamza is typed on most keyboards
  [/\u0621/g, ""],
];

/**
 * Full normalisation: case folding, invisible and decorative character removal,
 * then letter unification.
 *
 * The zero-width pass replaces those characters with a space rather than
 * deleting them. Deleting them silently fused the two words on either side into
 * one token: "ماذا" followed by a U+200B followed by "قررنا" became the single
 * unmatchable string "مذاقررنا", so a recall question could never match the
 * conversation it was asking about. A space preserves the boundary, and the
 * later whitespace collapse removes any padding it introduces.
 */
export function normalizeArabic(input: string): string {
  const stripped = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(DIACRITICS, "")
    .replace(TATWEEL, "")
    .replace(ZERO_WIDTH, " ");

  return LETTER_FOLDING.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    stripped,
  );
}

/**
 * Normalisation for matching, which additionally collapses punctuation and
 * whitespace so token comparison is exact.
 *
 * Used by the lexical ranker and the local embedding hash, which must agree on
 * what a word is or their scores become incomparable.
 */
export function normalizeForMatch(input: string): string {
  return normalizeArabic(input).replace(NON_ALPHANUMERIC, " ").replace(/\s+/gu, " ").trim();
}

/**
 * Splits normalised text into comparable tokens.
 *
 * Two-character tokens are dropped. That was the original behaviour and it
 * costs little: every Arabic function word that short is already in the stop
 * list.
 */
export function tokenizeArabic(input: string): string[] {
  const normalized = normalizeForMatch(input);
  if (!normalized) return [];
  return normalized.split(" ").filter((token) => token.length > 2);
}

/**
 * Light normalisation for display-aware keyword matching, where punctuation is
 * meaningful enough to keep but letter variants are not.
 */
export function normalizeArabicPhrase(input: string): string {
  return normalizeArabic(input).replace(/\s+/gu, " ").trim();
}

const ARABIC_RANGE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_RANGE_GLOBAL = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;

/**
 * Script detection used to decide the language of a summary or a reply.
 *
 * Note that diacritics are not stripped before this test on purpose: a single
 * harakat character is still proof the writer was typing Arabic, and removing
 * it first would make a short or heavily punctuated Arabic message look empty.
 */
export function containsArabicScript(input: string): boolean {
  return ARABIC_RANGE.test(input);
}

/**
 * Picks the dominant script of a string.
 *
 * Mixed input (Arabic prose with a technical term in Latin) is decided by which
 * script actually has more characters, so one English word does not flip the
 * answer. The counting regex needs its own global flag: `String.prototype.match`
 * with a non-global regex returns only the first match, which made every
 * Arabic message count as exactly one character and lose to any Latin text.
 */
export function dominantScript(input: string): "ar" | "en" {
  const arabic = input.match(ARABIC_RANGE_GLOBAL)?.length ?? 0;
  const latin = input.match(/[A-Za-z]/g)?.length ?? 0;
  if (!arabic) return "en";
  return arabic >= latin ? "ar" : "en";
}

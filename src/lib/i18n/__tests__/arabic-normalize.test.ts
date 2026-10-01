import { describe, expect, it } from "vitest";

import {
  containsArabicScript,
  dominantScript,
  normalizeArabic,
  normalizeArabicPhrase,
  normalizeForMatch,
  tokenizeArabic,
} from "@/lib/i18n/arabic-normalize";

describe("normalizeArabic", () => {
  it("strips diacritics so a vowel-marked word matches its plain form", () => {
    expect(normalizeArabic("\u0645\u064e\u0627\u0630\u0627")).toBe("\u0645\u0627\u0630\u0627");
    expect(normalizeArabic("\u0642\u0631\u0651\u0631\u0646\u0627")).toBe("\u0642\u0631\u0631\u0646\u0627");
  });

  it("strips tatweel so a stretched word matches its plain form", () => {
    expect(normalizeArabic("\u0645\u0627\u0630\u0627\u064b")).toBe("\u0645\u0627\u0630\u0627");
  });

  /**
   * Regression: a zero-width joiner between two Arabic words used to be removed
   * without a replacement, gluing the words into one unmatchable token. The
   * text "ماذاقرّرنا" normalised to "مذاقررنا", which no recall pattern could
   * ever match.
   */
  it("replaces a zero-width joiner with a space instead of deleting it", () => {
    const glued = "\u0645\u0627\u0630\u0627\u200b\u0642\u0631\u0651\u0631\u0646\u0627";
    expect(normalizeArabic(glued)).toBe("\u0645\u0627\u0630\u0627 \u0642\u0631\u0631\u0646\u0627");
    expect(normalizeArabic(glued)).toContain(" ");
  });

  /**
   * Regression: hamza-on-waw and hamza-on-ya were folded by `retrieve.ts` but
   * not by `embeddings.ts`, so the lexical retriever found a match that the
   * semantic retriever rejected for the same sentence.
   */
  it("unifies hamza variants that used to differ between modules", () => {
    expect(normalizeArabic("\u0624\u0633\u0631")).toBe("\u0648\u0633\u0631");
    expect(normalizeArabic("\u0626\u0645\u064a\u0639\u0629")).toBe("\u064a\u0645\u064a\u0639\u0647");
    expect(normalizeArabic("\u0625\u0633\u0644\u0627\u0645")).toBe("\u0627\u0633\u0644\u0627\u0645");
  });

  it("folds the remaining letter variants", () => {
    expect(normalizeArabic("\u0645\u062f\u064a\u0646\u0629")).toBe("\u0645\u062f\u064a\u0646\u0647");
    expect(normalizeArabic("\u0639\u0644\u064a\u0647")).toBe("\u0639\u0644\u064a\u0647");
    // A final bare alef is left as written; only hamza and ta-marbuta are folded.
    expect(normalizeArabic("\u0645\u0643\u062a\u0628\u0627")).toBe("\u0645\u0643\u062a\u0628\u0627");
  });

  it("applies the same folding to every equivalent spelling of one word", () => {
    const spellings = [
      "\u0625\u0633\u0644\u0627\u0645",
      "\u0623\u0633\u0644\u0627\u0645",
      "\u0622\u0633\u0644\u0627\u0645",
      "\u0627\u0633\u0644\u0627\u0645",
    ];
    const normalised = new Set(spellings.map(normalizeArabic));
    expect(normalised.size).toBe(1);
  });

  it("leaves Latin text alone apart from case folding", () => {
    expect(normalizeArabic("Staged Rollout")).toBe("staged rollout");
  });
});

describe("normalizeForMatch", () => {
  it("collapses punctuation and whitespace into single spaces", () => {
    expect(normalizeForMatch("مرحبا،  بالعالم!")).toBe("مرحبا بالعالم");
    expect(normalizeForMatch("  spaced   out  ")).toBe("spaced out");
  });

  it("agrees with normalizeArabic on Arabic letter folding", () => {
    expect(normalizeForMatch("\u0624\u0633\u0631")).toBe(normalizeArabic("\u0624\u0633\u0631"));
    expect(normalizeForMatch("\u0626\u0645\u064a\u0639\u0629")).toBe(normalizeArabic("\u0626\u0645\u064a\u0639\u0629"));
  });
});

describe("normalizeArabicPhrase", () => {
  it("keeps punctuation shape but still unifies letters", () => {
    expect(normalizeArabicPhrase("\u0625\u0633\u0644\u0627\u0645, \u0645\u062f\u064a\u0646\u0629")).toBe("\u0627\u0633\u0644\u0627\u0645, \u0645\u062f\u064a\u0646\u0647");
  });
});

describe("tokenizeArabic", () => {
  it("drops tokens of two characters or fewer", () => {
    expect(tokenizeArabic("at the project plan")).toEqual(["the", "project", "plan"]);
  });

  it("keeps three-letter and longer tokens", () => {
    expect(tokenizeArabic("a to the plan")).toEqual(["the", "plan"]);
  });

  it("splits on the zero-width joiner instead of merging words", () => {
    expect(tokenizeArabic("\u0645\u0627\u0630\u0627\u200b\u0642\u0631\u0651\u0631\u0646\u0627")).toEqual(["\u0645\u0627\u0630\u0627", "\u0642\u0631\u0631\u0646\u0627"]);
  });

  it("returns an empty list for empty or punctuation-only input", () => {
    expect(tokenizeArabic("")).toEqual([]);
    expect(tokenizeArabic("!!! ???")).toEqual([]);
  });
});

describe("script detection", () => {
  it("detects Arabic in plain and vowel-marked text", () => {
    expect(containsArabicScript("\u0645\u0627\u0630\u0627")).toBe(true);
    expect(containsArabicScript("\u0645\u064e\u0627\u0630\u0627")).toBe(true);
    expect(containsArabicScript("what did we decide")).toBe(false);
  });

  it("picks the dominant script for mixed input", () => {
    expect(dominantScript("\u0645\u0627\u0630\u0627 \u0642\u0631\u0651\u0631\u0646\u0627")).toBe("ar");
    // One Latin word inside a long Arabic sentence must not flip the answer.
    expect(dominantScript("\u0645\u0627\u0630\u0627 \u0642\u0631\u0651\u0631\u0646\u0627 API")).toBe("ar");
    expect(dominantScript("we decided to use the Atlas rollout")).toBe("en");
    expect(dominantScript("")).toBe("en");
  });

  it("treats a single harakat as Arabic rather than stripping it first", () => {
    expect(dominantScript("\u064e")).toBe("ar");
  });
});

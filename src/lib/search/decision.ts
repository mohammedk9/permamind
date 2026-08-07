import {
    INTERNET_KEYWORDS,
    MEMORY_KEYWORDS,
    MIXED_KEYWORDS,
  } from "@/lib/search/keywords";
  import type {
    KeywordMatchResult,
    SearchDecision,
    SearchSignal,
  } from "@/lib/search/types";
  
  /** Minimum normalized query length before any routing runs. */
  const MIN_QUERY_LENGTH = 2;
  
  /**
   * Normalize for matching: lowercase, collapse whitespace, unify common Arabic forms.
   */
  function normalizeQuery(query: string): string {
    return query
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[أإآ]/g, "ا")
      .replace(/ى/g, "ي")
      .replace(/ة/g, "ه");
  }
  
  function findMatches(
    normalized: string,
    keywords: readonly string[]
  ): string[] {
    const hits: string[] = [];
  
    for (const keyword of keywords) {
      const k = normalizeQuery(keyword);
  
      if (k.length < MIN_QUERY_LENGTH) continue;
  
      if (normalized.includes(k)) {
        hits.push(keyword);
      }
    }
  
    return hits;
  }
  
  function analyzeQuery(query: string): KeywordMatchResult {
    const normalized = normalizeQuery(query);
  
    return {
      memory: findMatches(normalized, MEMORY_KEYWORDS),
      internet: findMatches(normalized, INTERNET_KEYWORDS),
      mixed: findMatches(normalized, MIXED_KEYWORDS),
    };
  }
  
  /**
   * Confidence from hit counts.
   */
  function scoreConfidence(
    matches: KeywordMatchResult,
    signal: SearchSignal
  ): number {
    const memoryWeight = matches.memory.reduce((s, k) => s + k.length, 0);
    const internetWeight = matches.internet.reduce((s, k) => s + k.length, 0);
    const mixedWeight = matches.mixed.reduce((s, k) => s + k.length, 0);
  
    const totalHits =
      matches.memory.length +
      matches.internet.length +
      matches.mixed.length;
  
    if (totalHits === 0) return 0.15;
  
    let score = Math.min(0.55 + totalHits * 0.12, 0.92);
  
    if (signal === "mixed" && matches.mixed.length > 0) {
      score = Math.min(0.75 + mixedWeight * 0.008, 0.98);
    }
  
    if (signal === "memory" && memoryWeight > internetWeight) {
      score = Math.min(score + memoryWeight * 0.006, 0.95);
    }
  
    if (signal === "internet" && internetWeight > memoryWeight) {
      score = Math.min(score + internetWeight * 0.006, 0.95);
    }
  
    if (signal === "mixed" && matches.mixed.length === 0) {
      score = Math.min(
        0.7 + (memoryWeight + internetWeight) * 0.004,
        0.9
      );
    }
  
    return Math.round(score * 100) / 100;
  }
  
  function buildReason(
    signal: SearchSignal,
    matches: KeywordMatchResult
  ): string {
    const parts: string[] = [];
  
    if (matches.mixed.length > 0) {
      parts.push(
        `mixed keywords: ${matches.mixed.slice(0, 3).join(", ")}`
      );
    }
  
    if (matches.memory.length > 0) {
      parts.push(
        `memory keywords: ${matches.memory.slice(0, 3).join(", ")}`
      );
    }
  
    if (matches.internet.length > 0) {
      parts.push(
        `internet keywords: ${matches.internet.slice(0, 3).join(", ")}`
      );
    }
  
    const prefix: Record<SearchSignal, string> = {
      memory: "Memory retrieval only",
      internet: "Internet search only",
      mixed: "Memory and internet",
      none: "No routing keywords",
    };
  
    if (parts.length === 0) {
      return `${prefix.none} — general query without live or past-context signals.`;
    }
  
    return `${prefix[signal]} — matched ${parts.join("; ")}.`;
  }
  
  export function decideSearch(query: string): SearchDecision {
    const trimmed = query.trim();
  
    if (trimmed.length < MIN_QUERY_LENGTH) {
      return {
        useMemory: false,
        useInternet: false,
        source: "chat",
        confidence: 0,
        reason: "Query too short for search routing.",
      };
    }
  
    const matches = analyzeQuery(trimmed);
  
    const hasMemory = matches.memory.length > 0;
    const hasInternet = matches.internet.length > 0;
    const hasMixed = matches.mixed.length > 0;
  
    if (hasMixed) {
      const signal: SearchSignal = "mixed";
  
      return {
        useMemory: true,
        useInternet: true,
        source: "memory+internet",
        confidence: scoreConfidence(matches, signal),
        reason: buildReason(signal, matches),
      };
    }
  
    if (hasMemory && hasInternet) {
      const signal: SearchSignal = "mixed";
  
      return {
        useMemory: true,
        useInternet: true,
        source: "memory+internet",
        confidence: scoreConfidence(matches, signal),
        reason: buildReason(signal, matches),
      };
    }
  
    if (hasMemory) {
      const signal: SearchSignal = "memory";
  
      return {
        useMemory: true,
        useInternet: false,
        source: "memory",
        confidence: scoreConfidence(matches, signal),
        reason: buildReason(signal, matches),
      };
    }
  
    if (hasInternet) {
      const signal: SearchSignal = "internet";
  
      return {
        useMemory: false,
        useInternet: true,
        source: "internet",
        confidence: scoreConfidence(matches, signal),
        reason: buildReason(signal, matches),
      };
    }
  
    return {
      useMemory: false,
      useInternet: false,
      source: "chat",
      confidence: 0.2,
      reason: buildReason("none", matches),
    };
  }
/**
 * Result of the deterministic search routing step.
 * Drives whether to query local memory, the public internet, both, or neither.
 */
export interface SearchDecision {
    useMemory: boolean;
    useInternet: boolean;
  
    source:
      | "chat"
      | "memory"
      | "internet"
      | "memory+internet";
  
    confidence: number;
  
    reason: string;
  }

/** Which keyword bucket(s) matched — used internally and for extensions. */
export type SearchSignal = "memory" | "internet" | "mixed" | "none";

export interface KeywordMatchResult {
  memory: string[];
  internet: string[];
  mixed: string[];
}

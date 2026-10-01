export interface RetrievedMemory {
  conversationId: string;
  conversationTitle: string;
  source: "summary" | "message" | "fact" | "decision" | "project";
  excerpt: string;
  /** Present when the memory is an exact stored message. */
  messageId?: string;
  /** Present when the memory comes from the editable memory ledger. */
  recordId?: string;
  score: number;
  confidence?: "high" | "medium" | "low";
  reason?: "keyword match" | "summary match" | "recent context" | "related conversation" | "meaning match" | "pinned memory";
  updatedAt: Date;
}

/**
 * Web search providers supported by PermaMind.
 * `exa` stays the default so existing behavior is unchanged; the others are
 * independent of each other and of the LLM provider.
 */
export type SearchProvider = "exa" | "anysearch" | "google_grounding";

/** A normalized web search hit, whichever provider produced it. */
export interface SearchCitation {
  title: string;
  url: string;
  text: string;
  source: SearchProvider;
  retrievedAt: string;
}

export type MemoryRecordKind = "fact" | "decision" | "preference" | "project";
export type MemoryConfidence = "high" | "medium" | "low";
export type MemoryRecordStatus = "active" | "forgotten" | "superseded";

/** A user-controlled memory. Forgotten and superseded records stay local but are excluded from ordinary replies. */
export interface MemoryRecord {
  id: string;
  kind: MemoryRecordKind;
  text: string;
  category?: string;
  conversationId: string;
  conversationTitle: string;
  confidence: MemoryConfidence;
  pinned: boolean;
  status: MemoryRecordStatus;
  source: "extracted" | "user";
  updatedAt: string;
  /** Set only when a later decision explicitly replaces this one. */
  supersededBy?: string;
}

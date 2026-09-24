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

export type MemoryRecordKind = "fact" | "decision" | "preference" | "project";
export type MemoryConfidence = "high" | "medium" | "low";
export type MemoryRecordStatus = "active" | "forgotten";

/** A user-controlled memory. Forgotten records stay local but are excluded from replies. */
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
}

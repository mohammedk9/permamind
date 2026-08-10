export interface RetrievedMemory {
  conversationId: string;
  conversationTitle: string;
  source: "summary" | "message";
  excerpt: string;
  /** Present when the memory is an exact stored message. */
  messageId?: string;
  score: number;
  confidence?: "high" | "medium" | "low";
  reason?: "keyword match" | "summary match" | "recent context" | "related conversation";
  updatedAt: Date;
}

export interface RetrievedMemory {
  conversationId: string;
  conversationTitle: string;
  source: "summary" | "message";
  excerpt: string;
  score: number;
  updatedAt: Date;
}

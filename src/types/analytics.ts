export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimated?: boolean;
}

export interface MemoryInjectionRecord {
  conversationId: string;
  conversationTitle: string;
  source: "summary" | "message";
  excerpt: string;
  score: number;
}

export type UsageEventType = "chat" | "summary" | "memory_retrieval";

export interface UsageEventBase {
  id: string;
  type: UsageEventType;
  timestamp: string;
  conversationId?: string;
  conversationTitle?: string;
}

export interface ChatUsageEvent extends UsageEventBase {
  type: "chat";
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimated: boolean;
  memoriesInjected: number;
  memoryRecords?: MemoryInjectionRecord[];
}

export interface SummaryUsageEvent extends UsageEventBase {
  type: "summary";
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimated: boolean;
}

export interface MemoryRetrievalEvent extends UsageEventBase {
  type: "memory_retrieval";
  query: string;
  memoriesFound: number;
  memoryRecords: MemoryInjectionRecord[];
}

export type UsageEvent =
  | ChatUsageEvent
  | SummaryUsageEvent
  | MemoryRetrievalEvent;

export interface ModelStats {
  model: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface PeriodStats {
  period: string;
  requests: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface ConversationStats {
  conversationId: string;
  conversationTitle: string;
  chatRequests: number;
  summaryRequests: number;
  memoryRetrievals: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface AnalyticsSummary {
  totalRequests: number;
  chatRequests: number;
  summaryRequests: number;
  memoryRetrievalCount: number;
  totalTokens: number;
  totalCostUsd: number;
  today: PeriodStats;
  thisMonth: PeriodStats;
  byModel: ModelStats[];
  topConversations: ConversationStats[];
  recentEvents: UsageEvent[];
  recentMemoryRetrievals: MemoryRetrievalEvent[];
}

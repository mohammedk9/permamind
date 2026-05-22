import type {
  AnalyticsSummary,
  ConversationStats,
  MemoryRetrievalEvent,
  ModelStats,
  PeriodStats,
  UsageEvent,
} from "@/types/analytics";

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function periodStats(events: UsageEvent[], keyFn: (iso: string) => string): PeriodStats {
  const now = new Date();
  const target =
    keyFn === dayKey ? dayKey(now.toISOString()) : monthKey(now.toISOString());

  const filtered = events.filter((e) => keyFn(e.timestamp) === target);
  let totalTokens = 0;
  let estimatedCostUsd = 0;

  for (const e of filtered) {
    if (e.type === "chat" || e.type === "summary") {
      totalTokens += e.totalTokens;
      estimatedCostUsd += e.estimatedCostUsd;
    }
  }

  return {
    period: target,
    requests: filtered.length,
    totalTokens,
    estimatedCostUsd,
  };
}

export function buildAnalyticsSummary(events: UsageEvent[]): AnalyticsSummary {
  let chatRequests = 0;
  let summaryRequests = 0;
  let memoryRetrievalCount = 0;
  let totalTokens = 0;
  let totalCostUsd = 0;

  const modelMap = new Map<string, ModelStats>();
  const convMap = new Map<string, ConversationStats>();

  for (const event of events) {
    if (event.type === "chat") {
      chatRequests++;
      totalTokens += event.totalTokens;
      totalCostUsd += event.estimatedCostUsd;

      const m = modelMap.get(event.model) ?? {
        model: event.model,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
      m.requests++;
      m.promptTokens += event.promptTokens;
      m.completionTokens += event.completionTokens;
      m.totalTokens += event.totalTokens;
      m.estimatedCostUsd += event.estimatedCostUsd;
      modelMap.set(event.model, m);

      if (event.conversationId) {
        const c = convMap.get(event.conversationId) ?? {
          conversationId: event.conversationId,
          conversationTitle: event.conversationTitle ?? "Untitled",
          chatRequests: 0,
          summaryRequests: 0,
          memoryRetrievals: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        };
        c.chatRequests++;
        c.totalTokens += event.totalTokens;
        c.estimatedCostUsd += event.estimatedCostUsd;
        if (event.conversationTitle) c.conversationTitle = event.conversationTitle;
        convMap.set(event.conversationId, c);
      }
    } else if (event.type === "summary") {
      summaryRequests++;
      totalTokens += event.totalTokens;
      totalCostUsd += event.estimatedCostUsd;

      const m = modelMap.get(event.model) ?? {
        model: event.model,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      };
      m.requests++;
      m.promptTokens += event.promptTokens;
      m.completionTokens += event.completionTokens;
      m.totalTokens += event.totalTokens;
      m.estimatedCostUsd += event.estimatedCostUsd;
      modelMap.set(event.model, m);

      if (event.conversationId) {
        const c = convMap.get(event.conversationId) ?? {
          conversationId: event.conversationId,
          conversationTitle: event.conversationTitle ?? "Untitled",
          chatRequests: 0,
          summaryRequests: 0,
          memoryRetrievals: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        };
        c.summaryRequests++;
        c.totalTokens += event.totalTokens;
        c.estimatedCostUsd += event.estimatedCostUsd;
        if (event.conversationTitle) c.conversationTitle = event.conversationTitle;
        convMap.set(event.conversationId, c);
      }
    } else if (event.type === "memory_retrieval") {
      memoryRetrievalCount++;
      if (event.conversationId) {
        const c = convMap.get(event.conversationId) ?? {
          conversationId: event.conversationId,
          conversationTitle: event.conversationTitle ?? "Untitled",
          chatRequests: 0,
          summaryRequests: 0,
          memoryRetrievals: 0,
          totalTokens: 0,
          estimatedCostUsd: 0,
        };
        c.memoryRetrievals++;
        if (event.conversationTitle) c.conversationTitle = event.conversationTitle;
        convMap.set(event.conversationId, c);
      }
    }
  }

  const recentMemoryRetrievals = events
    .filter((e): e is MemoryRetrievalEvent => e.type === "memory_retrieval")
    .slice(-15)
    .reverse();

  return {
    totalRequests: events.length,
    chatRequests,
    summaryRequests,
    memoryRetrievalCount,
    totalTokens,
    totalCostUsd,
    today: periodStats(events, dayKey),
    thisMonth: periodStats(events, monthKey),
    byModel: [...modelMap.values()].sort(
      (a, b) => b.estimatedCostUsd - a.estimatedCostUsd
    ),
    topConversations: [...convMap.values()]
      .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)
      .slice(0, 8),
    recentEvents: [...events].slice(-12).reverse(),
    recentMemoryRetrievals,
  };
}

export function formatCostUsd(amount: number): string {
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  if (amount < 1) return `$${amount.toFixed(3)}`;
  return `$${amount.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

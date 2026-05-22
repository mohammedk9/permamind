"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { buildAnalyticsSummary } from "@/lib/analytics/aggregate";
import { estimateCostUsd } from "@/lib/analytics/pricing";
import {
  appendAnalyticsEvent,
  clearAnalyticsEvents,
  loadAnalyticsEvents,
} from "@/lib/analytics/storage";
import type { RetrievedMemory } from "@/types/memory";
import type {
  ChatUsageEvent,
  MemoryInjectionRecord,
  MemoryRetrievalEvent,
  SummaryUsageEvent,
  TokenUsage,
} from "@/types/analytics";

function createEventId() {
  return crypto.randomUUID();
}

function toMemoryRecords(memories: RetrievedMemory[]): MemoryInjectionRecord[] {
  return memories.map((m) => ({
    conversationId: m.conversationId,
    conversationTitle: m.conversationTitle,
    source: m.source,
    excerpt: m.excerpt,
    score: m.score,
  }));
}

export function useAnalytics() {
  const [events, setEvents] = useState<ReturnType<typeof loadAnalyticsEvents>>(
    []
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setEvents(loadAnalyticsEvents());
    setHydrated(true);
  }, []);

  const summary = useMemo(() => buildAnalyticsSummary(events), [events]);

  const recordChat = useCallback(
    (params: {
      model: string;
      conversationId: string;
      conversationTitle: string;
      usage: TokenUsage;
      memories: RetrievedMemory[];
    }) => {
      const cost = estimateCostUsd(
        params.model,
        params.usage.promptTokens,
        params.usage.completionTokens
      );

      const event: ChatUsageEvent = {
        id: createEventId(),
        type: "chat",
        timestamp: new Date().toISOString(),
        conversationId: params.conversationId,
        conversationTitle: params.conversationTitle,
        model: params.model,
        promptTokens: params.usage.promptTokens,
        completionTokens: params.usage.completionTokens,
        totalTokens: params.usage.totalTokens,
        estimatedCostUsd: cost,
        estimated: params.usage.estimated ?? false,
        memoriesInjected: params.memories.length,
        memoryRecords: toMemoryRecords(params.memories),
      };

      setEvents(appendAnalyticsEvent(event));
    },
    []
  );

  const recordSummary = useCallback(
    (params: {
      model: string;
      conversationId: string;
      conversationTitle: string;
      usage: TokenUsage;
    }) => {
      const cost = estimateCostUsd(
        params.model,
        params.usage.promptTokens,
        params.usage.completionTokens
      );

      const event: SummaryUsageEvent = {
        id: createEventId(),
        type: "summary",
        timestamp: new Date().toISOString(),
        conversationId: params.conversationId,
        conversationTitle: params.conversationTitle,
        model: params.model,
        promptTokens: params.usage.promptTokens,
        completionTokens: params.usage.completionTokens,
        totalTokens: params.usage.totalTokens,
        estimatedCostUsd: cost,
        estimated: params.usage.estimated ?? false,
      };

      setEvents(appendAnalyticsEvent(event));
    },
    []
  );

  const recordMemoryRetrieval = useCallback(
    (params: {
      conversationId: string;
      conversationTitle: string;
      query: string;
      memories: RetrievedMemory[];
    }) => {
      const event: MemoryRetrievalEvent = {
        id: createEventId(),
        type: "memory_retrieval",
        timestamp: new Date().toISOString(),
        conversationId: params.conversationId,
        conversationTitle: params.conversationTitle,
        query: params.query,
        memoriesFound: params.memories.length,
        memoryRecords: toMemoryRecords(params.memories),
      };

      setEvents(appendAnalyticsEvent(event));
    },
    []
  );

  const clearAll = useCallback(() => {
    clearAnalyticsEvents();
    setEvents([]);
  }, []);

  const refresh = useCallback(() => {
    setEvents(loadAnalyticsEvents());
  }, []);

  return {
    hydrated,
    summary,
    recordChat,
    recordSummary,
    recordMemoryRetrieval,
    clearAll,
    refresh,
  };
}

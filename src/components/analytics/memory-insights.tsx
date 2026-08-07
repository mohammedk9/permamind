"use client";

import { useMemo } from "react";
import { generateMemoryInsights } from "@/lib/memory/insights";
import type { Conversation } from "@/types/chat";

export function MemoryInsightsPanel({ conversations }: { conversations: Conversation[] }) {
  const insights = useMemo(() => generateMemoryInsights(conversations), [conversations]);
  const list = (label: string, values: { name: string; count: number }[]) => values.length ? <div><p className="font-medium">{label}</p><p className="text-muted-foreground">{values.slice(0, 3).map((value) => `${value.name} (${value.count})`).join(" · ")}</p></div> : null;
  return <section className="space-y-2 rounded-md border border-sidebar-border p-2 text-xs" aria-label="Memory insights">
    <p className="font-semibold">Memory insights</p>
    {list("Topics", insights.topics)}{list("Entities", insights.entities)}{list("Tags", insights.tags)}
    <p className="text-muted-foreground">{insights.conversationStats.conversations} conversations · {insights.conversationStats.messages} messages</p>
  </section>;
}
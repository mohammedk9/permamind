import type { Conversation } from "@/types/chat";

export interface MemoryCount { name: string; count: number; }
export interface MemoryInsights {
  topics: MemoryCount[];
  entities: MemoryCount[];
  tags: MemoryCount[];
  recentProjects: string[];
  conversationStats: { conversations: number; messages: number; userMessages: number; assistantMessages: number; averageMessages: number; activeSince: Date | null };
}

function counts(values: string[]): MemoryCount[] {
  const map = new Map<string, MemoryCount>();
  for (const value of values) {
    const name = value.trim(); if (!name) continue;
    const key = name.toLocaleLowerCase();
    const current = map.get(key) ?? { name, count: 0 };
    current.count++; map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function generateMemoryInsights(conversations: Conversation[]): MemoryInsights {
  const messages = conversations.flatMap((conversation) => conversation.messages.filter((message) => !message.isStreaming));
  return {
    topics: counts(conversations.flatMap((c) => c.metadata?.topics ?? [])),
    entities: counts(conversations.flatMap((c) => c.metadata?.entities ?? [])),
    tags: counts(conversations.flatMap((c) => c.metadata?.tags ?? [])),
    recentProjects: conversations.filter((c) => c.metadata?.topics.length).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 5).map((c) => c.title),
    conversationStats: { conversations: conversations.length, messages: messages.length, userMessages: messages.filter((m) => m.role === "user").length, assistantMessages: messages.filter((m) => m.role === "assistant").length, averageMessages: conversations.length ? messages.length / conversations.length : 0, activeSince: conversations.length ? new Date(Math.min(...conversations.map((c) => c.createdAt.getTime()))) : null },
  };
}
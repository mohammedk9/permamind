import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { ConversationMetadata, Message } from "@/types/chat";
import {
  SUMMARY_MAX_CHARS,
  SUMMARY_MAX_MESSAGES,
} from "@/lib/ai/summary-model";

export interface ParsedSummary {
  summary: string;
  topics: string[];
  tags: string[];
  entities: string[];
}

export function getMessageFingerprint(messages: Message[]): string {
  return messages
    .filter((m) => !m.isStreaming && m.content.trim())
    .map((m) => `${m.id}:${m.content.length}`)
    .join("|");
}

export function formatConversationForSummary(messages: Message[]): string {
  const eligible = messages.filter(
    (m) => !m.isStreaming && m.content.trim().length > 0
  );
  const recent = eligible.slice(-SUMMARY_MAX_MESSAGES);

  let text = "";
  for (const message of recent) {
    const line = `${message.role === "user" ? "User" : "Assistant"}: ${message.content.trim()}\n`;
    if (text.length + line.length > SUMMARY_MAX_CHARS) break;
    text += line;
  }
  return text.trim();
}

export function buildSummaryPrompt(conversationText: string): ChatCompletionMessage[] {
  return [
    {
      role: "system",
      content: `Extract memory metadata from a chat. Respond with ONLY valid JSON, no markdown:
{"summary":"1-2 concise sentences","topics":["main themes, max 4"],"tags":["short keywords, max 6"],"entities":["people, places, products, max 8"]}
Keep items short. Use empty arrays if none.`,
    },
    {
      role: "user",
      content: `Conversation:\n\n${conversationText}`,
    },
  ];
}

export function parseSummaryResponse(raw: string): ParsedSummary | null {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const data = JSON.parse(jsonMatch[0]) as {
      summary?: unknown;
      topics?: unknown;
      tags?: unknown;
      entities?: unknown;
    };

    const summary =
      typeof data.summary === "string" ? data.summary.trim() : "";
    if (!summary) return null;

    return {
      summary: summary.slice(0, 500),
      topics: normalizeStringArray(data.topics, 4, 60),
      tags: normalizeStringArray(data.tags, 6, 30),
      entities: normalizeStringArray(data.entities, 8, 40),
    };
  } catch {
    return null;
  }
}

function normalizeStringArray(
  value: unknown,
  maxItems: number,
  maxLen: number
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.slice(0, maxLen))
    .slice(0, maxItems);
}

export function needsSummary(
  messages: Message[],
  metadata?: ConversationMetadata
): boolean {
  const complete = messages.filter(
    (m) => !m.isStreaming && m.content.trim().length > 0
  );
  if (complete.length < 2) return false;

  const hasUser = complete.some((m) => m.role === "user");
  const hasAssistant = complete.some((m) => m.role === "assistant");
  if (!hasUser || !hasAssistant) return false;

  const fingerprint = getMessageFingerprint(messages);
  return metadata?.messageFingerprint !== fingerprint;
}

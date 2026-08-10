import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { ConversationMetadata, Message, MemoryDecision, MemoryFact, MemoryProject } from "@/types/chat";
import {
  SUMMARY_MAX_CHARS,
  SUMMARY_MAX_MESSAGES,
} from "@/lib/ai/summary-model";

export interface ParsedSummary {
  summary: string;
  topics: string[];
  tags: string[];
  entities: string[];
  facts: MemoryFact[];
  decisions: MemoryDecision[];
  project?: MemoryProject;
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
      content: `Extract structured memory from a chat. Respond with ONLY valid JSON, no markdown:
{"summary":"1-2 concise sentences","topics":["main themes, max 4"],"tags":["short keywords, max 6"],"entities":["people, places, products, max 8],"facts":[{"value":"stable fact","category":"project|preference|technology|person|goal|constraint|other"}],"decisions":[{"decision":"decision made","reason":"why","alternatives":["alternative"],"status":"active|superseded|uncertain"}],"project":{"name":"project name","goal":"goal","tasks":["task"]}}
Extract only information explicitly supported by the conversation. Use empty arrays and omit project when unknown. Keep items short.`,
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
      facts?: unknown;
      decisions?: unknown;
      project?: unknown;
    };

    const summary =
      typeof data.summary === "string" ? data.summary.trim() : "";
    if (!summary) return null;

    return {
      summary: summary.slice(0, 500),
      topics: normalizeStringArray(data.topics, 4, 60),
      tags: normalizeStringArray(data.tags, 6, 30),
      entities: normalizeStringArray(data.entities, 8, 40),
      facts: normalizeFacts(data.facts),
      decisions: normalizeDecisions(data.decisions),
      project: normalizeProject(data.project),
    };
  } catch {
    return null;
  }
}

function normalizeFacts(value: unknown): MemoryFact[] {
  if (!Array.isArray(value)) return [];
  const categories = new Set<MemoryFact["category"]>(["project", "preference", "technology", "person", "goal", "constraint", "other"]);
  return value.map((item) => {
    if (!item || typeof item !== "object") return null;
    const value = typeof (item as { value?: unknown }).value === "string" ? (item as { value: string }).value.trim() : "";
    const category = (item as { category?: unknown }).category;
    return value && typeof category === "string" && categories.has(category as MemoryFact["category"])
      ? { value: value.slice(0, 160), category: category as MemoryFact["category"] } : null;
  }).filter((item): item is MemoryFact => Boolean(item)).slice(0, 12);
}

function normalizeDecisions(value: unknown): MemoryDecision[] {
  if (!Array.isArray(value)) return [];
  const decisions: Array<MemoryDecision | null> = value.map((item): MemoryDecision | null => {
    if (!item || typeof item !== "object") return null;
    const data = item as { decision?: unknown; reason?: unknown; alternatives?: unknown; status?: unknown };
    if (typeof data.decision !== "string" || !data.decision.trim()) return null;
    const status = data.status === "superseded" || data.status === "uncertain" ? data.status : "active";
    return { decision: data.decision.trim().slice(0, 200), reason: typeof data.reason === "string" ? data.reason.trim().slice(0, 240) : undefined, alternatives: normalizeStringArray(data.alternatives, 4, 100), status };
  });
  return decisions.filter((item): item is MemoryDecision => Boolean(item)).slice(0, 8);
}

function normalizeProject(value: unknown): MemoryProject | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as { name?: unknown; goal?: unknown; tasks?: unknown };
  if (typeof data.name !== "string" || !data.name.trim()) return undefined;
  return { name: data.name.trim().slice(0, 120), goal: typeof data.goal === "string" ? data.goal.trim().slice(0, 240) : undefined, tasks: normalizeStringArray(data.tasks, 8, 120) };
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

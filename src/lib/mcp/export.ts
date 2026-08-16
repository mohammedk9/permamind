import type { Conversation } from "@/types/chat";

export type McpContentLevel = "none" | "titles" | "summaries" | "messages";

export interface McpExportOptions {
  conversationIds?: string[];
  contentLevel?: McpContentLevel;
  allowSearch?: boolean;
}

export interface McpExport {
  data: { version: 1; conversations: Array<Record<string, unknown>> };
  policy: {
    conversationIds: string[];
    allowTitles: boolean;
    allowSummaries: boolean;
    allowMessages: boolean;
    allowSearch: boolean;
  };
}

/** Builds a deliberately minimal, local-only MCP export. Secrets and app flags never enter it. */
export function buildMcpExport(conversations: Conversation[], options: McpExportOptions = {}): McpExport {
  const ids = new Set((options.conversationIds ?? []).filter((id) => typeof id === "string"));
  const level = options.contentLevel ?? "none";
  const allowTitles = level !== "none";
  const allowSummaries = level === "summaries" || level === "messages";
  const allowMessages = level === "messages";
  const selected = conversations.filter((conversation) => ids.has(conversation.id));

  const exported = selected.map((conversation) => {
    const result: Record<string, unknown> = { id: conversation.id };
    if (allowTitles) result.title = conversation.title;
    if (allowSummaries) result.summary = conversation.metadata?.summary ?? null;
    if (allowMessages) {
      result.messages = conversation.messages
        .filter((message) => !message.isStreaming && message.content.length > 0)
        .map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt: createdAt.toISOString() }));
    }
    return result;
  });

  return {
    data: { version: 1, conversations: exported },
    policy: {
      conversationIds: selected.map(({ id }) => id),
      allowTitles,
      allowSummaries,
      allowMessages,
      allowSearch: options.allowSearch === true && selected.length > 0 && level !== "none",
    },
  };
}
import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { Conversation } from "@/types/chat";
import type { MemoryRecord, RetrievedMemory } from "@/types/memory";
import { formatConversationTime } from "@/lib/format/date";

const MAX_CONTEXT_CHARS = 1600;
const MAX_MEMORY_EXCERPT_CHARS = 420;
const MAX_STRUCTURED_CHARS = 1400;

function formatMemoryBlock(memory: RetrievedMemory, index: number): string {
  const when = formatConversationTime(memory.updatedAt);
  const source =
    memory.source === "summary"
      ? "summary"
      : memory.source === "decision"
        ? "decision"
        : memory.source === "message"
          ? "message excerpt"
          : memory.source;
  const excerpt = memory.excerpt.replace(/\s+/g, " ").trim().slice(0, MAX_MEMORY_EXCERPT_CHARS);
  return `${index + 1}. Source: "${memory.conversationTitle}" (${when}, ${source}, ${memory.confidence ?? "medium"} confidence)\n${excerpt}`;
}

export function buildMemorySystemPrompt(
  memories: RetrievedMemory[],
  previousConversationQuery = false
): string {
  if (memories.length === 0) {
    return previousConversationQuery
      ? "You are PermaMind. The user is asking about a previous conversation, but no matching stored conversation was found. Say explicitly that no previous conversation was found. Do not answer from general knowledge or guess."
      : "";
  }

  const blocks: string[] = [];
  let totalChars = 0;

  for (let i = 0; i < memories.length; i++) {
    const block = formatMemoryBlock(memories[i], i);
    if (totalChars + block.length > MAX_CONTEXT_CHARS) break;
    blocks.push(block);
    totalChars += block.length;
  }

  return `You are PermaMind, an AI with persistent memory across the user's past conversations.

The following memories were retrieved from prior chats because they may be relevant to the user's current message. Use them naturally to personalize your response. Do not list memories mechanically unless the user asks. If nothing is relevant, ignore them.${previousConversationQuery ? "\n\nThis is a previous-conversation question. Answer only from these retrieved memories. Cite the source title and date when you use a decision. Do not use general knowledge, infer missing details, or hallucinate. If they do not answer the question, say the stored source is insufficient." : ""}

## Retrieved memories
${blocks.join("\n\n")}`;
}

function formatStructuredMemory(records: MemoryRecord[]): string {
  const active = records
    .filter((record) => record.status === "active" && record.text.trim())
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.confidence.localeCompare(left.confidence));
  const lines: string[] = [];
  let total = 0;
  for (const record of active) {
    const when = formatConversationTime(new Date(record.updatedAt));
    const line = `- [${record.pinned ? "pinned " : ""}${record.kind}, ${record.confidence} confidence, source: "${record.conversationTitle}", ${when}${record.supersededBy ? `, superseded by ${record.supersededBy}` : ""}] ${record.text}`;
    if (total + line.length > MAX_STRUCTURED_CHARS) break;
    lines.push(line);
    total += line.length;
  }
  if (!lines.length) return "";
  return `Stable memory approved for this user. Treat pinned and high-confidence items as current. Do not revive a memory that is absent here; the user may have corrected or forgotten it. Mention the source only when useful.\n\n${lines.join("\n")}`;
}

export const LINKED_CONVERSATION_MESSAGE_LIMIT = 6;
export const LINKED_CONVERSATION_CHAR_LIMIT = 500;

export function linkedConversationContext(
  current: Pick<Conversation, "id" | "linkedConversationIds"> | null | undefined,
  conversations: Conversation[],
  messageLimit = LINKED_CONVERSATION_MESSAGE_LIMIT,
): string {
  const ids = [...new Set(current?.linkedConversationIds ?? [])];
  const sections = ids.flatMap((id) => {
    if (!id || id === current?.id) return [];
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) return [];
    const messages = conversation.messages
      .filter((message) => (message.role === "user" || message.role === "assistant") && message.content.trim())
      .slice(-messageLimit)
      .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content.trim().slice(0, LINKED_CONVERSATION_CHAR_LIMIT)}`);
    if (!messages.length && !conversation.metadata?.summary) return [];
    return [[
      `Linked conversation: "${conversation.title}" (${conversation.updatedAt.toISOString().slice(0, 10)})`,
      conversation.metadata?.summary ? `Summary: ${conversation.metadata.summary}` : "",
      ...messages,
    ].filter(Boolean).join("\n")];
  });
  return sections.join("\n\n");
}

export function buildMessagesWithMemory(
  messages: ChatCompletionMessage[],
  memories: RetrievedMemory[],
  previousConversationQuery = false,
  projectContext = "",
  records: MemoryRecord[] = [],
  linkedContext = "",
): ChatCompletionMessage[] {
  const memoryPrompt = buildMemorySystemPrompt(memories, previousConversationQuery);
  const structuredPrompt = previousConversationQuery ? formatStructuredMemory(records.filter((record) => record.kind === "decision")) : formatStructuredMemory(records);
  const linkedPrompt = linkedContext.trim()
    ? `The user explicitly linked these previous conversations as the foundation of this chat. Treat them as primary context, then use the automatic memory below for anything else relevant:\n${linkedContext.trim()}`
    : "";
  const systemPrompt = [projectContext, linkedPrompt, structuredPrompt, memoryPrompt].filter(Boolean).join("\n\n");
  if (!systemPrompt) return messages;

  const withoutSystem = messages.filter((m) => m.role !== "system");

  return [{ role: "system", content: systemPrompt }, ...withoutSystem];
}

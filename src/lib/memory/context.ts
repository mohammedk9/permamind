import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { RetrievedMemory } from "@/types/memory";
import { formatConversationTime } from "@/lib/format/date";

const MAX_CONTEXT_CHARS = 2400;

function formatMemoryBlock(memory: RetrievedMemory, index: number): string {
  const when = formatConversationTime(memory.updatedAt);
  const source =
    memory.source === "summary" ? "summary" : "message excerpt";
  return `${index + 1}. "${memory.conversationTitle}" (${when}, ${source})\n${memory.excerpt}`;
}

export function buildMemorySystemPrompt(memories: RetrievedMemory[]): string {
  if (memories.length === 0) return "";

  const blocks: string[] = [];
  let totalChars = 0;

  for (let i = 0; i < memories.length; i++) {
    const block = formatMemoryBlock(memories[i], i);
    if (totalChars + block.length > MAX_CONTEXT_CHARS) break;
    blocks.push(block);
    totalChars += block.length;
  }

  return `You are PermaMind, an AI with persistent memory across the user's past conversations.

The following memories were retrieved from prior chats because they may be relevant to the user's current message. Use them naturally to personalize your response. Do not list memories mechanically unless the user asks. If nothing is relevant, ignore them.

## Retrieved memories
${blocks.join("\n\n")}`;
}

export function buildMessagesWithMemory(
  messages: ChatCompletionMessage[],
  memories: RetrievedMemory[]
): ChatCompletionMessage[] {
  const systemPrompt = buildMemorySystemPrompt(memories);
  if (!systemPrompt) return messages;

  const withoutSystem = messages.filter((m) => m.role !== "system");

  return [{ role: "system", content: systemPrompt }, ...withoutSystem];
}

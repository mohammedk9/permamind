import type { ParsedSummary } from "@/lib/ai/summarize";
import type { ChatCompletionMessage, ChatErrorResponse } from "@/lib/ai/types";

export async function fetchConversationSummary(
  messages: ChatCompletionMessage[]
): Promise<ParsedSummary | null> {
  try {
    const response = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as ChatErrorResponse;
      console.warn("Summary generation failed:", data.error);
      return null;
    }

    return (await response.json()) as ParsedSummary;
  } catch {
    return null;
  }
}

import type { ParsedSummary } from "@/lib/ai/summarize";
import {
  estimateTokensFromMessages,
  estimateTokensFromText,
  usageFromOpenRouter,
} from "@/lib/analytics/pricing";
import type { ChatCompletionMessage, ChatErrorResponse } from "@/lib/ai/types";
import type { TokenUsage } from "@/types/analytics";

export interface SummaryResponse extends ParsedSummary {
  usage?: TokenUsage;
}

export async function fetchConversationSummary(
  messages: ChatCompletionMessage[],
  headers: Record<string, string>
): Promise<SummaryResponse | null> {
  try {
    const response = await fetch("/api/summarize", {
      method: "POST",
      headers,
      body: JSON.stringify({ messages }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as ChatErrorResponse;
      console.warn("Summary generation failed:", data.error);
      return null;
    }

    const data = (await response.json()) as SummaryResponse & {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const apiUsage = usageFromOpenRouter(data.usage);
    const usage =
      apiUsage ??
      (() => {
        const promptTokens = estimateTokensFromMessages(messages);
        const completionTokens = estimateTokensFromText(
          [data.summary, ...data.topics, ...data.tags, ...data.entities].join(" ")
        );
        return {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          estimated: true,
        };
      })();

    return {
      summary: data.summary,
      topics: data.topics,
      tags: data.tags,
      entities: data.entities,
      usage,
    };
  } catch {
    return null;
  }
}

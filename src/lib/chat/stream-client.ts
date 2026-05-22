import type { ChatCompletionMessage, ChatErrorResponse } from "@/lib/ai/types";
import {
  estimateTokensFromMessages,
  estimateTokensFromText,
  usageFromOpenRouter,
} from "@/lib/analytics/pricing";
import type { TokenUsage } from "@/types/analytics";

interface StreamChatOptions {
  model: string;
  messages: ChatCompletionMessage[];
  headers: Record<string, string>;
  signal?: AbortSignal;
  onChunk: (text: string) => void;
  onComplete: (usage: TokenUsage) => void;
  onError: (error: string) => void;
}

interface SsePayload {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
}

function parseSseLine(
  line: string,
  lastUsage: TokenUsage | null
): { content: string | null; usage: TokenUsage | null } {
  if (!line.startsWith("data: ")) {
    return { content: null, usage: lastUsage };
  }
  const data = line.slice(6).trim();
  if (data === "[DONE]") {
    return { content: null, usage: lastUsage };
  }

  try {
    const parsed = JSON.parse(data) as SsePayload;
    if (parsed.error?.message) {
      throw new Error(parsed.error.message);
    }

    const usage = usageFromOpenRouter(parsed.usage) ?? lastUsage;
    const content = parsed.choices?.[0]?.delta?.content ?? null;
    return { content, usage };
  } catch (err) {
    if (err instanceof Error && err.message !== "Unexpected end of JSON input") {
      throw err;
    }
    return { content: null, usage: lastUsage };
  }
}

export async function streamChatCompletion({
  model,
  messages,
  headers,
  signal,
  onChunk,
  onComplete,
  onError,
}: StreamChatOptions) {
  let response: Response;

  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ model, messages }),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    onError("Network error. Check your connection and try again.");
    return;
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as ChatErrorResponse;
    onError(data.error ?? `Request failed (${response.status})`);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError("No response stream received");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let lastUsage: TokenUsage | null = null;
  let completionText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const { content, usage } = parseSseLine(trimmed, lastUsage);
        if (usage) lastUsage = usage;
        if (content) {
          completionText += content;
          onChunk(content);
        }
      }
    }

    const finalUsage =
      lastUsage ??
      (() => {
        const promptTokens = estimateTokensFromMessages(messages);
        const completionTokens = estimateTokensFromText(completionText);
        return {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          estimated: true,
        };
      })();

    onComplete(finalUsage);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    onError(err instanceof Error ? err.message : "Stream interrupted");
  }
}

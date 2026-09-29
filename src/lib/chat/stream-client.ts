import type { ChatCompletionMessage, ChatErrorResponse } from "@/lib/ai/types";
import { isErrorCode, type ErrorCode } from "@/lib/i18n/error-messages";
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
  onError: (error: string, retryable: boolean, code?: ErrorCode, limit?: number) => void;
}

interface SsePayload {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string; code?: string };
}

/** Carries the provider/quota code out of the SSE payload for translation. */
class SseProviderError extends Error {
  constructor(message: string, readonly code?: ErrorCode) {
    super(message);
    this.name = "SseProviderError";
  }
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
      throw new SseProviderError(
        parsed.error.message,
        isErrorCode(parsed.error.code) ? parsed.error.code : "PROVIDER_ERROR",
      );
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
    if (err instanceof Error && err.name === "AbortError") {
      onError("Generation cancelled", false, "CANCELLED");
      return;
    }
    onError("Network error. Check your connection and try again.", true, "NETWORK_ERROR");
    return;
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as ChatErrorResponse;
    onError(
      data.error ?? `Request failed (${response.status})`,
      response.status !== 400 && response.status !== 401 && response.status !== 403 && response.status !== 429,
      // A 4xx from our own quota/auth layer carries a code we can translate. A
      // provider failure does not, so it falls back to the upstream text.
      data.code ?? "PROVIDER_ERROR",
      data.limit,
    );
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    onError("No response stream received", true, "STREAM_UNAVAILABLE");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let lastUsage: TokenUsage | null = null;
  let completionText = "";
  let sawDone = false;

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
        if (trimmed === "data: [DONE]") sawDone = true;
        const { content, usage } = parseSseLine(trimmed, lastUsage);
        if (usage) lastUsage = usage;
        if (content) {
          completionText += content;
          onChunk(content);
        }
      }
    }

    if (!sawDone) {
      onError("Stream interrupted", true, "STREAM_INTERRUPTED");
      return;
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
    if (err instanceof Error && err.name === "AbortError") {
      onError("Generation cancelled", false, "CANCELLED");
      return;
    }
    if (err instanceof SseProviderError) {
      onError(err.message, true, err.code);
      return;
    }
    onError(err instanceof Error ? err.message : "Stream interrupted", true, "STREAM_INTERRUPTED");
  }
}

import type { ChatCompletionMessage, ChatErrorResponse } from "@/lib/ai/types";
import type { ModelId } from "@/lib/ai/models";

interface StreamChatOptions {
  model: ModelId;
  messages: ChatCompletionMessage[];
  signal?: AbortSignal;
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

function parseSseLine(line: string): string | null {
  if (!line.startsWith("data: ")) return null;
  const data = line.slice(6).trim();
  if (data === "[DONE]") return null;

  try {
    const parsed = JSON.parse(data) as {
      choices?: Array<{ delta?: { content?: string } }>;
      error?: { message?: string };
    };
    if (parsed.error?.message) {
      throw new Error(parsed.error.message);
    }
    return parsed.choices?.[0]?.delta?.content ?? null;
  } catch (err) {
    if (err instanceof Error && err.message !== "Unexpected end of JSON input") {
      throw err;
    }
    return null;
  }
}

export async function streamChatCompletion({
  model,
  messages,
  signal,
  onChunk,
  onDone,
  onError,
}: StreamChatOptions) {
  let response: Response;

  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
        const content = parseSseLine(trimmed);
        if (content) onChunk(content);
      }
    }

    onDone();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    onError(err instanceof Error ? err.message : "Stream interrupted");
  }
}

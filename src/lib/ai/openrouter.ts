import type { ChatCompletionMessage } from "@/lib/ai/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function getOpenRouterApiKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY;
}

export async function createOpenRouterStream(
  model: string,
  messages: ChatCompletionMessage[]
) {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "PermaMind",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  return response;
}

export async function createOpenRouterCompletion(
  model: string,
  messages: ChatCompletionMessage[],
  options?: { maxTokens?: number; temperature?: number }
) {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      "X-Title": "PermaMind",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      max_tokens: options?.maxTokens ?? 400,
      temperature: options?.temperature ?? 0.2,
    }),
  });
}

export async function parseOpenRouterError(
  response: Response
): Promise<string> {
  try {
    const data = (await response.json()) as {
      error?: { message?: string };
    };
    return data.error?.message ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

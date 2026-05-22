import type { ChatCompletionMessage } from "@/lib/ai/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_AUTH_URL = "https://openrouter.ai/api/v1/auth/key";

function openRouterHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer":
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    "X-Title": "PermaMind",
  };
}

export async function createOpenRouterStream(
  model: string,
  messages: ChatCompletionMessage[],
  apiKey: string
) {
  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });
}

export async function createOpenRouterCompletion(
  model: string,
  messages: ChatCompletionMessage[],
  apiKey: string,
  options?: { maxTokens?: number; temperature?: number }
) {
  return fetch(OPENROUTER_URL, {
    method: "POST",
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      max_tokens: options?.maxTokens ?? 400,
      temperature: options?.temperature ?? 0.2,
    }),
  });
}

export async function validateOpenRouterKey(
  apiKey: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch(OPENROUTER_AUTH_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (response.ok) {
      return { valid: true };
    }

    const message = await parseOpenRouterError(response);
    return { valid: false, error: message };
  } catch {
    return { valid: false, error: "Could not reach OpenRouter" };
  }
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

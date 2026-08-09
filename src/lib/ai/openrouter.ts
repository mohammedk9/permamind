import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { AiProvider } from "@/lib/settings/api-key-storage";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_AUTH_URL = "https://openrouter.ai/api/v1/auth/key";
const DIRECT_URLS: Partial<Record<AiProvider, string>> = {
  openai: "https://api.openai.com/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  kimi: "https://api.moonshot.ai/v1/chat/completions",
  grok: "https://api.x.ai/v1/chat/completions",
};

function openRouterHeaders(apiKey: string): HeadersInit {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (process.env.NODE_ENV === "production" && (!appUrl || !appUrl.startsWith("https://"))) {
    throw new Error("NEXT_PUBLIC_APP_URL must be configured with an HTTPS production URL");
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer":
      appUrl ?? "http://localhost:3000",
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

export async function createProviderStream(provider: AiProvider, model: string, messages: ChatCompletionMessage[], apiKey: string) {
  if (provider === "openrouter") return createOpenRouterStream(model, messages, apiKey);
  const url = DIRECT_URLS[provider];
  if (!url) throw new Error(`${provider} direct API is not configured yet. Use OpenRouter or a supported direct provider.`);
  const directModel = model.includes("/") ? model.split("/").slice(1).join("/").replace(/:free$/, "") : model;
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: directModel, messages, stream: true }),
  });
}

export async function createCustomStream(baseUrl: string, model: string, messages: ChatCompletionMessage[], apiKey: string) {
  const url = new URL(baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl.replace(/\/$/, "")}/chat/completions`);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Custom AI URL must be a public HTTPS URL.");
  return fetch(url, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, messages, stream: true }) });
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

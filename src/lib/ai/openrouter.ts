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
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GOOGLE_AI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

export type FreeProvider = "openrouter" | "groq" | "google-ai";

export interface FreeRoute {
  id: string;
  provider: FreeProvider;
  model: string;
}

export function getFreeRoute(id: string): FreeRoute {
  if (id.startsWith("groq/")) return { id, provider: "groq", model: id.slice("groq/".length) };
  if (id.startsWith("google-ai/")) return { id, provider: "google-ai", model: id.slice("google-ai/".length) };
  return { id, provider: "openrouter", model: id };
}

function serverKey(provider: FreeProvider): string | undefined {
  if (provider === "groq") return process.env.GROQ_API_KEY?.trim();
  if (provider === "google-ai") return (process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim();
  return process.env.OPENROUTER_API_KEY?.trim();
}

function freeUrl(provider: FreeProvider): string {
  if (provider === "groq") return GROQ_URL;
  if (provider === "google-ai") return GOOGLE_AI_URL;
  return OPENROUTER_URL;
}

export async function createFreeProviderStream(
  route: FreeRoute,
  messages: ChatCompletionMessage[],
) {
  const apiKey = serverKey(route.provider);
  if (!apiKey) return new Response(`${route.provider} server key is not configured`, { status: 503 });
  return fetch(freeUrl(route.provider), {
    method: "POST",
    headers: route.provider === "openrouter" ? openRouterHeaders(apiKey) : {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: route.model, messages, stream: true }),
  });
}

export async function createFreeProviderCompletion(
  route: FreeRoute,
  messages: ChatCompletionMessage[],
  options?: { maxTokens?: number; temperature?: number },
) {
  const apiKey = serverKey(route.provider);
  if (!apiKey) return new Response(`${route.provider} server key is not configured`, { status: 503 });
  return fetch(freeUrl(route.provider), {
    method: "POST",
    headers: route.provider === "openrouter" ? openRouterHeaders(apiKey) : {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: route.model, messages, stream: false, max_tokens: options?.maxTokens ?? 400, temperature: options?.temperature ?? 0.2 }),
  });
}

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

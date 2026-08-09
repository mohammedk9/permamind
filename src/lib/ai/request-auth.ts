import type { AiProvider, ApiKeyMode } from "@/lib/settings/api-key-storage";

export const HEADER_OPENROUTER_KEY = "x-openrouter-key";
export const HEADER_API_MODE = "x-permamind-mode";
export const HEADER_AI_PROVIDER = "x-ai-provider";

export interface ResolvedRequestAuth {
  apiKey: string;
  mode: ApiKeyMode;
  isUserKey: boolean;
  provider: AiProvider;
  baseUrl?: string;
  modelName?: string;
}

/**
 * Resolves API key for a single request. Never persisted or logged.
 * Priority: user header (BYOK) → server env (free fallback).
 */
export function resolveRequestAuth(request: Request): ResolvedRequestAuth {
  const modeHeader = request.headers.get(HEADER_API_MODE)?.toLowerCase();
  const mode: ApiKeyMode = modeHeader === "byok" ? "byok" : "free";

  const userKey = request.headers.get(HEADER_OPENROUTER_KEY)?.trim();
  const providerHeader = request.headers.get(HEADER_AI_PROVIDER)?.toLowerCase();
  const providers: AiProvider[] = ["openrouter", "openai", "anthropic", "google", "deepseek", "qwen", "kimi", "meta", "grok", "custom"];
  const provider = providers.includes(providerHeader as AiProvider) ? providerHeader as AiProvider : "openrouter";
  const baseUrl = request.headers.get("x-ai-base-url")?.trim();
  const modelName = request.headers.get("x-ai-model")?.trim();

  if (userKey && userKey.length > 512) throw new Error("API key is too long");
  if (provider === "custom") {
    if (!baseUrl || !isSafeCustomUrl(baseUrl)) throw new Error("Custom AI URL must be a public HTTPS URL");
    if (!modelName || modelName.length > 200) throw new Error("A valid custom model is required");
  }

  if (mode === "byok") {
    if (!userKey) {
      throw new Error(
        "BYOK mode requires an API key. Add your OpenRouter key in Settings."
      );
    }
    return { apiKey: userKey, mode: "byok", isUserKey: true, provider, baseUrl, modelName };
  }

  if (userKey) {
    return { apiKey: userKey, mode: "byok", isUserKey: true, provider, baseUrl, modelName };
  }

  const serverKey = process.env.OPENROUTER_API_KEY?.trim();
  if (serverKey) {
    return { apiKey: serverKey, mode: "free", isUserKey: false, provider: "openrouter" };
  }

  throw new Error(
    "Free mode needs a server OpenRouter key or switch to BYOK in Settings with your own key."
  );
}

/** Reject SSRF targets. Custom providers must be public HTTPS endpoints. */
export function isSafeCustomUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
    return true;
  } catch { return false; }
}

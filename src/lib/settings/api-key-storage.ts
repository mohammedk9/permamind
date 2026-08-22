export type ApiKeyMode = "free" | "byok";
export type AiProvider = "openrouter" | "openai" | "anthropic" | "google" | "deepseek" | "qwen" | "kimi" | "meta" | "grok" | "custom";

const STORAGE_KEY = "permamind:api-settings:v1";
/**
 * The API key lives in sessionStorage only, so it is automatically cleared
 * when the browser session ends. This shrinks the blast radius of any future
 * XSS: non-session storage persists indefinitely and is a common theft
 * target. Provider/baseUrl/modelName stay in localStorage because they are
 * not secrets.
 */
const API_KEY_STORAGE_KEY = "permamind:api-key:v1";
const ONBOARDING_KEY = "permamind:onboarding:v1";

export interface StoredApiSettings {
  mode: ApiKeyMode;
  apiKey?: string;
  provider?: AiProvider;
  baseUrl?: string;
  modelName?: string;
  validatedAt?: string;
}

export function loadApiSettings(): StoredApiSettings {
  if (typeof window === "undefined") {
    return { mode: "free" };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { mode: "free" };
    const data = JSON.parse(raw) as StoredApiSettings;
    if (data.mode !== "free" && data.mode !== "byok") {
      return { mode: "free" };
    }
    return {
      mode: data.mode,
      apiKey: readSessionApiKey(),
      provider: data.provider ?? "openrouter",
      baseUrl: data.baseUrl?.trim(),
      modelName: data.modelName?.trim(),
      validatedAt: data.validatedAt,
    };
  } catch {
    return { mode: "free" };
  }
}

function readSessionApiKey(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return sessionStorage.getItem(API_KEY_STORAGE_KEY)?.trim() || undefined;
  } catch {
    // sessionStorage unavailable (private mode restrictions) — run keyless.
    return undefined;
  }
}

function writeSessionApiKey(apiKey: string | undefined): void {
  if (typeof window === "undefined") return;
  try {
    if (apiKey) sessionStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    else sessionStorage.removeItem(API_KEY_STORAGE_KEY);
  } catch {
    // ignore quota/unavailability errors — requests fall back to free mode
  }
}

export function saveApiSettings(settings: StoredApiSettings): void {
  if (typeof window === "undefined") return;

  const payload: StoredApiSettings = {
    mode: settings.mode,
    validatedAt: settings.validatedAt,
    provider: settings.provider ?? "openrouter",
    baseUrl: settings.baseUrl?.trim(),
    modelName: settings.modelName?.trim(),
  };

  writeSessionApiKey(
    settings.mode === "byok" ? settings.apiKey?.trim() || undefined : undefined
  );

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota errors
  }
}

export function clearUserApiKey(): void {
  saveApiSettings({ mode: "free" });
}

export function hasSeenOnboarding(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(ONBOARDING_KEY) === "1";
}

export function markOnboardingSeen(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(ONBOARDING_KEY, "1");
}

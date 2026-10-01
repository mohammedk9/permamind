export type ApiKeyMode = "free" | "byok";
export type AiProvider = "openrouter" | "openai" | "anthropic" | "google" | "deepseek" | "qwen" | "kimi" | "meta" | "grok" | "nanogpt" | "eden" | "orcarouter" | "unorouter" | "llm7" | "huggingface" | "custom" | "ollama";

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

/** Exactly what is allowed to reach localStorage. The key is not a member. */
type PersistedApiSettings = Omit<StoredApiSettings, "apiKey">;

/**
 * Last line of defence for the "keys never leave the device" promise.
 *
 * `saveApiSettings` already builds its payload field by field, so `apiKey` can
 * never be serialised. This guard exists because that is a property of the
 * current implementation, not of the type: any future change that passes the
 * caller's object straight through to `JSON.stringify` would persist a BYOK key
 * to disk permanently, where sessionStorage's expiry no longer applies.
 *
 * Returns the payload only when it is proven secret-free.
 */
function withoutSecrets(settings: StoredApiSettings): PersistedApiSettings {
  const candidate: PersistedApiSettings = {
    mode: settings.mode,
    validatedAt: settings.validatedAt,
    provider: settings.provider ?? "openrouter",
    baseUrl: settings.baseUrl?.trim(),
    modelName: settings.modelName?.trim(),
  };

  const serialised = JSON.stringify(candidate);
  if (settings.apiKey && serialised.includes(settings.apiKey)) {
    throw new Error("Refusing to persist an API key to localStorage");
  }
  if (/\bsk-[A-Za-z0-9_-]{8,}/.test(serialised)) {
    throw new Error("Refusing to persist a value that looks like an API key");
  }
  return candidate;
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

  const payload = withoutSecrets(settings);

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

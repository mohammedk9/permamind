export type ApiKeyMode = "free" | "byok";

const STORAGE_KEY = "permamind:api-settings:v1";
const ONBOARDING_KEY = "permamind:onboarding:v1";

export interface StoredApiSettings {
  mode: ApiKeyMode;
  apiKey?: string;
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
      apiKey: data.apiKey?.trim() || undefined,
      validatedAt: data.validatedAt,
    };
  } catch {
    return { mode: "free" };
  }
}

export function saveApiSettings(settings: StoredApiSettings): void {
  if (typeof window === "undefined") return;

  const payload: StoredApiSettings = {
    mode: settings.mode,
    validatedAt: settings.validatedAt,
  };

  if (settings.mode === "byok" && settings.apiKey?.trim()) {
    payload.apiKey = settings.apiKey.trim();
  }

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

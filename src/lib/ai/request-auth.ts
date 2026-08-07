import type { ApiKeyMode } from "@/lib/settings/api-key-storage";

export const HEADER_OPENROUTER_KEY = "x-openrouter-key";
export const HEADER_API_MODE = "x-permamind-mode";

export interface ResolvedRequestAuth {
  apiKey: string;
  mode: ApiKeyMode;
  isUserKey: boolean;
}

/**
 * Resolves API key for a single request. Never persisted or logged.
 * Priority: user header (BYOK) → server env (free fallback).
 */
export function resolveRequestAuth(request: Request): ResolvedRequestAuth {
  const modeHeader = request.headers.get(HEADER_API_MODE)?.toLowerCase();
  const mode: ApiKeyMode = modeHeader === "byok" ? "byok" : "free";

  const userKey = request.headers.get(HEADER_OPENROUTER_KEY)?.trim();

  if (mode === "byok") {
    if (!userKey) {
      throw new Error(
        "BYOK mode requires an API key. Add your OpenRouter key in Settings."
      );
    }
    return { apiKey: userKey, mode: "byok", isUserKey: true };
  }

  if (userKey) {
    return { apiKey: userKey, mode: "byok", isUserKey: true };
  }

  const serverKey = process.env.OPENROUTER_API_KEY?.trim();
  if (serverKey) {
    return { apiKey: serverKey, mode: "free", isUserKey: false };
  }

  throw new Error(
    "Free mode needs a server OpenRouter key or switch to BYOK in Settings with your own key."
  );
}

import type { ApiKeyMode } from "@/lib/settings/api-key-storage";
import {
  HEADER_API_MODE,
  HEADER_OPENROUTER_KEY,
} from "@/lib/ai/request-auth";

export function buildApiHeaders(
  mode: ApiKeyMode,
  apiKey?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [HEADER_API_MODE]: mode,
  };

  if (mode === "byok" && apiKey?.trim()) {
    headers[HEADER_OPENROUTER_KEY] = apiKey.trim();
  }

  return headers;
}

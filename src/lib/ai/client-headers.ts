import type { AiProvider, ApiKeyMode } from "@/lib/settings/api-key-storage";
import {
  HEADER_API_MODE,
  HEADER_OPENROUTER_KEY,
} from "@/lib/ai/request-headers";

export function buildApiHeaders(
  mode: ApiKeyMode,
  apiKey?: string,
  provider: AiProvider = "openrouter",
  baseUrl?: string,
  modelName?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [HEADER_API_MODE]: mode,
  };

  if ((mode === "byok" && apiKey?.trim()) || provider === "ollama") {
    if (apiKey?.trim()) headers[HEADER_OPENROUTER_KEY] = apiKey.trim();
    headers["x-ai-provider"] = provider;
    if ((provider === "custom" || provider === "ollama") && baseUrl?.trim()) headers["x-ai-base-url"] = baseUrl.trim();
    if (modelName?.trim()) headers["x-ai-model"] = modelName.trim();
  }

  return headers;
}

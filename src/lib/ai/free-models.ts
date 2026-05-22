/** OpenRouter free-tier models. First entry is the default. */
export const FREE_MODEL_FALLBACK_CHAIN = [
  "deepseek/deepseek-chat:free",
  "google/gemini-2.0-flash-exp:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free",
] as const;

export type FreeModelId = (typeof FREE_MODEL_FALLBACK_CHAIN)[number];

export const DEFAULT_FREE_MODEL: FreeModelId = FREE_MODEL_FALLBACK_CHAIN[0];

export const FREE_MODELS = [
  {
    id: DEFAULT_FREE_MODEL,
    label: "DeepSeek Chat (Free)",
    provider: "DeepSeek",
  },
  {
    id: "google/gemini-2.0-flash-exp:free",
    label: "Gemini Flash (Free)",
    provider: "Google",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    label: "Llama 3.3 (Free)",
    provider: "Meta",
  },
  {
    id: "qwen/qwen-2.5-72b-instruct:free",
    label: "Qwen 2.5 (Free)",
    provider: "Qwen",
  },
] as const;

export type FreeModelIdSelectable = (typeof FREE_MODELS)[number]["id"];

export function isFreeModelId(id: string): id is FreeModelIdSelectable {
  return FREE_MODELS.some((m) => m.id === id);
}

export function isModelUnavailableError(status: number, message: string): boolean {
  const lower = message.toLowerCase();
  return (
    status === 404 ||
    status === 502 ||
    lower.includes("model") ||
    lower.includes("not found") ||
    lower.includes("unavailable") ||
    lower.includes("no endpoints")
  );
}

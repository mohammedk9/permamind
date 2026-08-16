export const FREE_MODEL_FALLBACK_CHAIN = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "poolside/laguna-xs-2.1:free",
  "groq/llama-3.1-8b-instant",
  "groq/openai/gpt-oss-120b",
  "google-ai/gemini-2.5-flash",
] as const;

export const PAID_FALLBACK_MODEL = "deepseek/deepseek-v4-flash";

export type FreeModelId =
  (typeof FREE_MODEL_FALLBACK_CHAIN)[number];

export const DEFAULT_FREE_MODEL: FreeModelId =
  FREE_MODEL_FALLBACK_CHAIN[0];

export const FREE_MODELS = [
  {
    id: "google/gemma-4-31b-it:free",
    label: "Gemma 4 31B (Free)",
    provider: "Google",
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    label: "Gemma 4 26B A4B (Free)",
    provider: "Google",
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    label: "Nemotron 3 Super (Free)",
    provider: "NVIDIA",
  },
  {
    id: "poolside/laguna-xs-2.1:free",
    label: "Laguna XS 2.1 (Free)",
    provider: "Poolside",
  },
] as const;

export const PREMIUM_MODELS = [
  {
    id: "anthropic/claude-sonnet-4",
    label: "Claude Sonnet 4",
    provider: "Anthropic",
  },
  {
    id: "openai/gpt-4o",
    label: "GPT-4o",
    provider: "OpenAI",
  },
  {
    id: "google/gemini-2.5-flash-preview-05-20",
    label: "Gemini 2.5 Flash",
    provider: "Google",
  },
] as const;

export const AI_MODELS = [
  ...FREE_MODELS,
  ...PREMIUM_MODELS,
] as const;

export type ModelId =
  (typeof AI_MODELS)[number]["id"];

export function isValidModelId(
  id: string,
): id is ModelId {
  return AI_MODELS.some((m) => m.id === id);
}

export function getModelById(id: string) {
  return AI_MODELS.find((m) => m.id === id);
}

export function getFreeModels() {
  return FREE_MODELS;
}

export function getPremiumModels() {
  return PREMIUM_MODELS;
}

export function isFreeModelId(
  id: string,
): id is FreeModelId {
  return FREE_MODELS.some((m) => m.id === id);
}

export function isModelUnavailableError(
  status: number,
  message: string,
): boolean {
  const lower = message.toLowerCase();

  return (
    status === 404 ||
    status === 429 ||
    status === 502 ||
    lower.includes("model") ||
    lower.includes("not found") ||
    lower.includes("unavailable") ||
    lower.includes("rate limit") ||
    lower.includes("no endpoints")
  );
}
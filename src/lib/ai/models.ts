export const AI_MODELS = [
  /**
   * FREE MODELS
   * Instant onboarding experience
   */

  {
    id: "deepseek/deepseek-v4-flash:free",
    label: "DeepSeek Flash (Free)",
    provider: "DeepSeek",
    tier: "free",
  },

  {
    id: "qwen/qwen3-next-80b-a3b-instruct:free",
    label: "Qwen Next (Free)",
    provider: "Qwen",
    tier: "free",
  },

  {
    id: "google/gemma-4-31b-it:free",
    label: "Gemma 4 (Free)",
    provider: "Google",
    tier: "free",
  },

  /**
   * PREMIUM MODELS
   * Cheap + powerful app-hosted models
   */

  {
    id: "google/gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    provider: "Google",
    tier: "premium",
  },

  {
    id: "qwen/qwen3.6-35b-a3b",
    label: "Qwen 3.6 35B",
    provider: "Qwen",
    tier: "premium",
  },

  {
    id: "deepseek/deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    provider: "DeepSeek",
    tier: "premium",
  },

  /**
   * BYOK / POWER USERS
   */

  {
    id: "openrouter/owl-alpha",
    label: "Owl Alpha",
    provider: "OpenRouter",
    tier: "byok",
  },

  {
    id: "anthropic/claude-haiku-latest",
    label: "Claude Haiku",
    provider: "Anthropic",
    tier: "byok",
  },

  {
    id: "openai/gpt-4o",
    label: "GPT-4o",
    provider: "OpenAI",
    tier: "byok",
  },
] as const;

export type ModelId = (typeof AI_MODELS)[number]["id"];

export const DEFAULT_MODEL_ID: ModelId =
  "deepseek/deepseek-v4-flash:free";

export const FREE_MODELS = AI_MODELS.filter(
  (m) => m.tier === "free"
);

export const PREMIUM_MODELS = AI_MODELS.filter(
  (m) => m.tier === "premium"
);

export const BYOK_MODELS = AI_MODELS.filter(
  (m) => m.tier === "byok"
);

export function isValidModelId(id: string): id is ModelId {
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

export function getByokModels() {
  return BYOK_MODELS;
}
export const AI_MODELS = [
  /**
   * FREE MODELS
   * Used for onboarding + free tier
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
    id: "google/gemma-4-31b:free",
    label: "Gemma 4 (Free)",
    provider: "Google",
    tier: "free",
  },

  /**
   * PREMIUM MODELS
   * Better quality + paid usage
   */

  {
    id: "qwen/qwen-3.5-flash",
    label: "Qwen 3.5 Flash",
    provider: "Qwen",
    tier: "premium",
  },

  {
    id: "deepseek/deepseek-chat-v3-0324",
    label: "DeepSeek V3",
    provider: "DeepSeek",
    tier: "premium",
  },

  /**
   * BYOK / POWER USERS
   */

  {
    id: "openai/gpt-4o",
    label: "GPT-4o",
    provider: "OpenAI",
    tier: "byok",
  },

  {
    id: "anthropic/claude-sonnet-4",
    label: "Claude Sonnet",
    provider: "Anthropic",
    tier: "byok",
  },

  {
    id: "google/gemini-2.5-flash-preview-05-20",
    label: "Gemini 2.5 Flash",
    provider: "Google",
    tier: "byok",
  },
] as const;

export type ModelId = (typeof AI_MODELS)[number]["id"];

export const DEFAULT_MODEL_ID: ModelId =
  "deepseek/deepseek-v4-flash:free";

export function isValidModelId(id: string): id is ModelId {
  return AI_MODELS.some((m) => m.id === id);
}

export function getModelById(id: string) {
  return AI_MODELS.find((m) => m.id === id);
}

export function getFreeModels() {
  return AI_MODELS.filter((m) => m.tier === "free");
}

export function getPremiumModels() {
  return AI_MODELS.filter((m) => m.tier === "premium");
}

export function getByokModels() {
  return AI_MODELS.filter((m) => m.tier === "byok");
}
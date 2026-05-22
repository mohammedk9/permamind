import {
  DEFAULT_FREE_MODEL,
  FREE_MODELS,
  isFreeModelId,
  type FreeModelIdSelectable,
} from "@/lib/ai/free-models";

export const PREMIUM_MODELS = [
  {
    id: "anthropic/claude-sonnet-4",
    label: "Claude Sonnet",
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
  {
    id: "deepseek/deepseek-chat-v3-0324",
    label: "DeepSeek V3",
    provider: "DeepSeek",
  },
] as const;

export type PremiumModelId = (typeof PREMIUM_MODELS)[number]["id"];

export type ModelId = PremiumModelId | FreeModelIdSelectable;

export const DEFAULT_PREMIUM_MODEL_ID: PremiumModelId = PREMIUM_MODELS[0].id;

export { DEFAULT_FREE_MODEL, FREE_MODELS };

export function isValidPremiumModelId(id: string): id is PremiumModelId {
  return PREMIUM_MODELS.some((m) => m.id === id);
}

export function isValidModelId(id: string, mode: "free" | "byok"): boolean {
  if (mode === "free") return isFreeModelId(id);
  return isValidPremiumModelId(id) || isFreeModelId(id);
}

export function getModelById(id: string) {
  const premium = PREMIUM_MODELS.find((m) => m.id === id);
  if (premium) return premium;
  return FREE_MODELS.find((m) => m.id === id);
}

export function getDefaultModelId(mode: "free" | "byok"): string {
  return mode === "free" ? DEFAULT_FREE_MODEL : DEFAULT_PREMIUM_MODEL_ID;
}

/** @deprecated Use getDefaultModelId(mode) */
export const DEFAULT_MODEL_ID = DEFAULT_PREMIUM_MODEL_ID;

export const AI_MODELS = [
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

export type ModelId = (typeof AI_MODELS)[number]["id"];

export const DEFAULT_MODEL_ID: ModelId = AI_MODELS[0].id;

export function isValidModelId(id: string): id is ModelId {
  return AI_MODELS.some((m) => m.id === id);
}

export function getModelById(id: string) {
  return AI_MODELS.find((m) => m.id === id);
}

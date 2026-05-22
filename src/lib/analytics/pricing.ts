import { FREE_MODEL_FALLBACK_CHAIN } from "@/lib/ai/free-models";
import { SUMMARY_MODEL_PREMIUM } from "@/lib/ai/summary-model";
import type { TokenUsage } from "@/types/analytics";

/** USD per 1M tokens (input / output). Approximate OpenRouter averages. */
const PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  "anthropic/claude-sonnet-4": { input: 3, output: 15 },
  "openai/gpt-4o": { input: 2.5, output: 10 },
  "google/gemini-2.5-flash-preview-05-20": { input: 0.15, output: 0.6 },
  "deepseek/deepseek-chat-v3-0324": { input: 0.27, output: 1.1 },
  [SUMMARY_MODEL_PREMIUM]: { input: 0.1, output: 0.4 },
  ...Object.fromEntries(
    FREE_MODEL_FALLBACK_CHAIN.map((id) => [id, { input: 0, output: 0 }])
  ),
};

const DEFAULT_PRICING = { input: 1, output: 2 };

export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateTokensFromMessages(
  messages: Array<{ content: string }>
): number {
  return messages.reduce((sum, m) => sum + estimateTokensFromText(m.content), 0);
}

export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const rates = PRICING_PER_MILLION[model] ?? DEFAULT_PRICING;
  return (
    (promptTokens * rates.input + completionTokens * rates.output) / 1_000_000
  );
}

export function usageFromOpenRouter(data?: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}): TokenUsage | null {
  if (!data?.total_tokens && !data?.prompt_tokens) return null;
  const promptTokens = data.prompt_tokens ?? 0;
  const completionTokens = data.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: data.total_tokens ?? promptTokens + completionTokens,
    estimated: false,
  };
}

export function estimateUsage(
  model: string,
  promptText: string,
  completionText: string
): TokenUsage {
  const promptTokens = estimateTokensFromText(promptText);
  const completionTokens = estimateTokensFromText(completionText);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimated: true,
  };
}

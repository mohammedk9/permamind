import { DEFAULT_FREE_MODEL } from "@/lib/ai/free-models";
import type { ApiKeyMode } from "@/lib/settings/api-key-storage";

/** Premium: cheap fast model for summaries. */
export const SUMMARY_MODEL_PREMIUM = "google/gemini-2.0-flash-001";

export const SUMMARY_MAX_MESSAGES = 16;
export const SUMMARY_MAX_CHARS = 6000;

export function getSummaryModel(mode: ApiKeyMode): string {
  return mode === "free" ? DEFAULT_FREE_MODEL : SUMMARY_MODEL_PREMIUM;
}

/** @deprecated Use getSummaryModel(mode) */
export const SUMMARY_MODEL = SUMMARY_MODEL_PREMIUM;

export interface ChatCompletionMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequestBody {
  model: string;
  messages: ChatCompletionMessage[];
}

import type { ErrorCode } from "@/lib/i18n/error-messages";

export interface ChatErrorResponse {
  /** English provider text. Kept for logs and as a last-resort fallback. */
  error: string;
  /** Language-neutral identifier the client translates for display. */
  code?: ErrorCode;
  /** Quota limit for the {count} placeholder, when the code needs one. */
  limit?: number;
}

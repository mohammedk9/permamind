export interface ChatCompletionMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ChatRequestBody {
  model: string;
  messages: ChatCompletionMessage[];
}

import type { ErrorCode } from "@/lib/i18n/error-messages";

/**
 * Wire code for the free daily allowance being exhausted.
 *
 * Spelled exactly as it appears on the wire so the client can match it without
 * a translation step. `QUOTA_EXCEEDED` is the legacy spelling and is no longer
 * emitted by server code.
 */
export const FREE_QUOTA_EXCEEDED_CODE = "free_quota_exceeded" as const;

export interface ChatErrorResponse {
  /** English provider text. Kept for logs and as a last-resort fallback. */
  error: string;
  /** Language-neutral identifier the client translates for display. */
  code?: ErrorCode;
  /** Quota limit for the {count} placeholder, when the code needs one. */
  limit?: number;
  /** How many of the limit were already spent when the request was refused. */
  used?: number;
  /** ISO 8601, UTC: when the daily allowance resets. */
  resetAt?: string;
}

/**
 * The body of a 429 that means "the free daily allowance is spent".
 *
 * Kept as its own type so the server constructs every field and the client can
 * read them without optional chaining. A provider failure never uses this body:
 * it has no `code`, which is what keeps the quota card off transient outages.
 */
export interface QuotaExceededBody extends ChatErrorResponse {
  code: typeof FREE_QUOTA_EXCEEDED_CODE;
  limit: number;
  used: number;
  resetAt: string;
}

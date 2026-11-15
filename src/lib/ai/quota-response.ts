import type { ErrorCode } from "@/lib/i18n/error-messages";

import type { ChatErrorResponse } from "./types";

/**
 * The refusal fields both AI routes need to serialize.
 *
 * Deliberately structural rather than importing the server-only reservation
 * type: the route has a `QuotaRejection`, and a test can pass a plain object
 * with the same fields.
 */
export interface QuotaRejectionLike {
  status: number;
  error: string;
  code: ErrorCode;
  limit?: number;
  used?: number;
  resetAt?: string;
  retryAfterSeconds?: number;
}

/**
 * One shape for every quota refusal.
 *
 * The free-limit response carries `used` and `resetAt` so the client can show
 * "used X of Y" and a real reset time instead of parsing `Retry-After`. Every
 * other refusal keeps the fields it has and omits the rest, which is what lets
 * the client tell a spent allowance from a temporary outage: only the former
 * carries `code: "free_quota_exceeded"`.
 */
export function buildQuotaErrorBody(rejection: QuotaRejectionLike): ChatErrorResponse {
  return {
    error: rejection.error,
    code: rejection.code,
    ...(rejection.limit !== undefined ? { limit: rejection.limit } : {}),
    ...(rejection.used !== undefined ? { used: rejection.used } : {}),
    ...(rejection.resetAt !== undefined ? { resetAt: rejection.resetAt } : {}),
  };
}

/** The complete 429 response, including `Retry-After` when the caller has one. */
export function quotaRejectionResponse(rejection: QuotaRejectionLike): Response {
  return Response.json(buildQuotaErrorBody(rejection), {
    status: rejection.status,
    headers: rejection.retryAfterSeconds ? { "Retry-After": String(rejection.retryAfterSeconds) } : undefined,
  });
}
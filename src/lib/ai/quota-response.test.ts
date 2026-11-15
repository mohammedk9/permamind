import { describe, expect, it } from "vitest";

import { buildQuotaErrorBody, quotaRejectionResponse } from "./quota-response";

describe("quota rejection response", () => {
  it("carries the free-quota code, used count, and reset time", () => {
    const body = buildQuotaErrorBody({
      status: 429,
      error: "You have used your 10 free messages for today.",
      code: "free_quota_exceeded",
      limit: 10,
      used: 10,
      resetAt: "2026-01-02T00:00:00.000Z",
    });

    expect(body).toEqual({
      error: "You have used your 10 free messages for today.",
      code: "free_quota_exceeded",
      limit: 10,
      used: 10,
      resetAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("keeps the 429 status and the Retry-After header", async () => {
    const response = quotaRejectionResponse({
      status: 429,
      error: "spent",
      code: "free_quota_exceeded",
      limit: 10,
      used: 10,
      resetAt: "2026-01-02T00:00:00.000Z",
      retryAfterSeconds: 3600,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
  });

  it("does not add quota fields to an unrelated refusal", () => {
    const body = buildQuotaErrorBody({
      status: 503,
      error: "The daily allowance is temporarily unavailable.",
      code: "QUOTA_UNAVAILABLE",
    });

    expect(body).toEqual({
      error: "The daily allowance is temporarily unavailable.",
      code: "QUOTA_UNAVAILABLE",
    });
    expect(body).not.toHaveProperty("used");
    expect(body).not.toHaveProperty("resetAt");
  });

  it("never labels an outage with the free-quota code", () => {
    const body = buildQuotaErrorBody({
      status: 503,
      error: "The daily allowance is temporarily unavailable.",
      code: "QUOTA_UNAVAILABLE",
    });

    expect(body.code).not.toBe("free_quota_exceeded");
  });
});
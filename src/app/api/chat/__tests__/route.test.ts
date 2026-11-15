import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/openrouter", () => ({
  createProviderStream: vi.fn(),
  createCustomStream: vi.fn(),
  createFreeProviderStream: vi.fn(),
  getFreeRoute: vi.fn(() => "https://free.example/v1"),
  parseOpenRouterError: vi.fn(async () => "provider down"),
  sanitizeUpstreamError: vi.fn((message: string) => `sanitized: ${message}`),
}));

vi.mock("@/lib/ai/models", () => ({ isValidModelId: vi.fn(() => true) }));

vi.mock("@/lib/ai/request-auth", () => ({
  requestBucketId: vi.fn(() => "bucket-1"),
  resolveRequestAuth: vi.fn(() => ({
    apiKey: "server-managed",
    mode: "free",
    isUserKey: false,
    provider: "openrouter",
  })),
}));

vi.mock("@/lib/ai/route-models", () => ({
  isModelUnavailableError: vi.fn(() => false),
  resolveModelChain: vi.fn(() => ["test-model"]),
}));

vi.mock("@/lib/ai/rate-limit", () => ({
  checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })),
}));

vi.mock("@/lib/ai/quota-stream", () => ({ createQuotaStream: vi.fn() }));

vi.mock("@/lib/ai/usage-quota", () => ({
  reserveAiQuota: vi.fn(),
  releaseAiQuota: vi.fn(async () => undefined),
  finalizeAiQuota: vi.fn(async () => undefined),
}));

import { POST } from "../route";
import { createFreeProviderStream } from "@/lib/ai/openrouter";
import {
  finalizeAiQuota,
  releaseAiQuota,
  reserveAiQuota,
} from "@/lib/ai/usage-quota";

const requestBody = { model: "test-model", messages: [{ role: "user", content: "hi" }] };

function chatRequest(): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
}

describe("POST /api/chat quota refusal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createFreeProviderStream).mockResolvedValue({ ok: true, body: new ReadableStream() } as never);
  });

  it("answers the eleventh request with the free-quota code, used count, and reset", async () => {
    vi.mocked(reserveAiQuota).mockResolvedValue({
      ok: false,
      status: 429,
      code: "free_quota_exceeded",
      limit: 10,
      used: 10,
      resetAt: "2026-01-02T00:00:00.000Z",
      error: "You have used your 10 free messages for today.",
      retryAfterSeconds: 3600,
    } as never);

    const response = await POST(chatRequest());
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(body).toMatchObject({
      code: "free_quota_exceeded",
      limit: 10,
      used: 10,
      resetAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("never reaches the provider and never reserves or spends quota on a refusal", async () => {
    vi.mocked(reserveAiQuota).mockResolvedValue({
      ok: false,
      status: 429,
      code: "free_quota_exceeded",
      limit: 10,
      used: 10,
      resetAt: "2026-01-02T00:00:00.000Z",
      error: "spent",
      retryAfterSeconds: 3600,
    } as never);

    await POST(chatRequest());

    expect(createFreeProviderStream).not.toHaveBeenCalled();
    expect(releaseAiQuota).not.toHaveBeenCalled();
    expect(finalizeAiQuota).not.toHaveBeenCalled();
  });

  it("does not show the quota code when the provider fails while quota remains", async () => {
    vi.mocked(reserveAiQuota).mockResolvedValue({ ok: true, reservationId: "reservation-1" } as never);
    vi.mocked(createFreeProviderStream).mockResolvedValue({ ok: false, status: 502 } as never);

    const response = await POST(chatRequest());
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(502);
    expect(body.code).not.toBe("free_quota_exceeded");
    expect(body).not.toHaveProperty("used");
    expect(body).not.toHaveProperty("resetAt");
    expect(releaseAiQuota).toHaveBeenCalledWith("reservation-1");
  });
});
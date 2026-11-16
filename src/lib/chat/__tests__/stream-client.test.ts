import { afterEach, describe, expect, it, vi } from "vitest";

import { streamChatCompletion } from "../stream-client";

const REQUEST = {
  model: "openai/gpt-4o-mini",
  messages: [{ role: "user" as const, content: "hello" }],
  headers: {},
  onChunk: () => {},
  onComplete: () => {},
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("streamChatCompletion error mapping", () => {
  it("hands the spent allowance's used count and reset time to the caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: "You have used your 10 free messages for today.",
            code: "free_quota_exceeded",
            limit: 10,
            used: 10,
            resetAt: "2026-01-02T00:00:00.000Z",
          },
          429,
        ),
      ),
    );
    const onError = vi.fn();

    await streamChatCompletion({ ...REQUEST, onError });

    expect(onError).toHaveBeenCalledWith(
      "You have used your 10 free messages for today.",
      // 429 is the server declining, not a broken connection: retrying now fails.
      false,
      "free_quota_exceeded",
      10,
      10,
      "2026-01-02T00:00:00.000Z",
    );
  });

  it("reports the used count the server sent rather than assuming the limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: "spent", code: "free_quota_exceeded", limit: 10, used: 7, resetAt: "2026-01-02T00:00:00.000Z" }, 429),
      ),
    );
    const onError = vi.fn();

    await streamChatCompletion({ ...REQUEST, onError });

    expect(onError.mock.calls[0][3]).toBe(10);
    expect(onError.mock.calls[0][4]).toBe(7);
  });

  it("leaves the quota counters undefined for a provider failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "upstream exploded" }, 502)));
    const onError = vi.fn();

    await streamChatCompletion({ ...REQUEST, onError });

    const [, retryable, code, limit, used, resetAt] = onError.mock.calls[0];
    expect(retryable).toBe(true);
    expect(code).toBe("PROVIDER_ERROR");
    expect(limit).toBeUndefined();
    expect(used).toBeUndefined();
    expect(resetAt).toBeUndefined();
  });

  it("keeps a refusal off the retry path even when the server sends no code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "no" }, 401)));
    const onError = vi.fn();

    await streamChatCompletion({ ...REQUEST, onError });

    expect(onError.mock.calls[0][1]).toBe(false);
  });
});
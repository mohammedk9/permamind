import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { searchGoogleGrounding, isGoogleGroundingConfigured } from "../google-grounding";

const ORIGINAL_GEMINI = process.env.GEMINI_API_KEY;
const ORIGINAL_GOOGLE_AI = process.env.GOOGLE_AI_API_KEY;
const ORIGINAL_GOOGLE = process.env.GOOGLE_API_KEY;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function clearKeys() {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
}

function restoreKeys() {
  if (ORIGINAL_GEMINI !== undefined) process.env.GEMINI_API_KEY = ORIGINAL_GEMINI;
  if (ORIGINAL_GOOGLE_AI !== undefined) process.env.GOOGLE_AI_API_KEY = ORIGINAL_GOOGLE_AI;
  if (ORIGINAL_GOOGLE !== undefined) process.env.GOOGLE_API_KEY = ORIGINAL_GOOGLE;
}

function groundedBody() {
  return {
    candidates: [
      {
        content: { parts: [{ text: " The grounded answer. " }] },
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: " https://grounded.example/a ", title: " Grounded A " } },
            { web: { uri: "https://grounded.example/b", title: null } },
            { web: {} },
          ],
        },
      },
    ],
  };
}

describe("Google Grounding web search", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearKeys();
    process.env.GEMINI_API_KEY = "gemini-key";
  });

  afterEach(() => {
    restoreKeys();
    vi.unstubAllGlobals();
  });

  it("accepts any of the supported Gemini key variables", () => {
    expect(isGoogleGroundingConfigured()).toBe(true);

    clearKeys();
    expect(isGoogleGroundingConfigured()).toBe(false);

    process.env.GOOGLE_AI_API_KEY = "google-ai-key";
    expect(isGoogleGroundingConfigured()).toBe(true);
  });

  it("maps grounding chunks into google_grounding citations", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse(groundedBody()));
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchGoogleGrounding(" latest release ");

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      title: "Grounded A",
      url: "https://grounded.example/a",
      source: "google_grounding",
    });
    expect(results[1]).toMatchObject({ title: "", url: "https://grounded.example/b" });

    // The answer is split across citations rather than repeated in full.
    const combined = results.map((r) => r.text).join("");
    expect(combined.replace(/\s+/g, "")).toBe("Thegroundedanswer.");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain(":generateContent");
    expect(url).toContain("gemini-2.5-flash");
    // The key must never travel in the URL.
    expect(url).not.toContain("gemini-key");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("gemini-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.method).toBe("POST");

    const body = JSON.parse(String(init.body));
    expect(body.tools).toEqual([{ google_search: {} }]);
    expect(body.contents[0].parts[0].text).toBe("latest release");
  });

  it("keeps the full answer when only one source is cited", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          candidates: [
            {
              content: { parts: [{ text: "Whole answer here." }] },
              groundingMetadata: { groundingChunks: [{ web: { uri: "https://a.example", title: "A" } }] },
            },
          ],
        })
      )
    );

    const results = await searchGoogleGrounding("latest");
    expect(results).toHaveLength(1);
    expect(results[0]?.text).toBe("Whole answer here.");
  });

  it("returns an empty array without calling the API when no key is configured", async () => {
    clearKeys();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await searchGoogleGrounding("anything")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the API for an empty query", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await searchGoogleGrounding("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty array when the response carries no grounding chunks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })));
    expect(await searchGoogleGrounding("latest")).toEqual([]);
  });

  it("retries once after a 429 and returns the second response", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({}, 429))
        .mockResolvedValueOnce(jsonResponse(groundedBody()));
      vi.stubGlobal("fetch", fetchMock);

      const pending = searchGoogleGrounding("latest");
      await vi.runAllTimersAsync();

      const results = await pending;
      expect(results).toHaveLength(2);
      expect(results[0]?.source).toBe("google_grounding");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never throws on a network failure or a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 503)));
    expect(await searchGoogleGrounding("latest")).toEqual([]);

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    expect(await searchGoogleGrounding("latest")).toEqual([]);
  });
});
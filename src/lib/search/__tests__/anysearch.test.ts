import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { searchAnySearch, isAnySearchConfigured } from "../anysearch";

const ORIGINAL_KEY = process.env.ANYSEARCH_API_KEY;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A successful documented envelope with one result. */
function exaLikeResponse(): Response {
  return jsonResponse({
    code: 0,
    message: "success",
    data: {
      results: [{ title: "Retried", url: "https://anysearch.example/r", content: "ok" }],
    },
  });
}

describe("AnySearch web search", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ANYSEARCH_API_KEY = "anysearch-key";
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANYSEARCH_API_KEY;
    else process.env.ANYSEARCH_API_KEY = ORIGINAL_KEY;
    vi.unstubAllGlobals();
  });

  it("is configured only when a key exists", () => {
    expect(isAnySearchConfigured()).toBe(true);
    process.env.ANYSEARCH_API_KEY = "   ";
    expect(isAnySearchConfigured()).toBe(false);
    delete process.env.ANYSEARCH_API_KEY;
    expect(isAnySearchConfigured()).toBe(false);
  });

  it("maps the documented envelope to anysearch citations", async () => {
    // Shape copied from the official /v1/search response example.
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({
        code: 0,
        message: "success",
        request_id: "7d6f4e91-2a83-4c5b-9f10-6e8a3d27b541",
        data: {
          results: [
            {
              title: "  Docs  ",
              url: " https://anysearch.example/a ",
              snippet: "short summary",
              content: " full body ",
            },
            { title: "No URL", url: null, content: "dropped" },
          ],
          metadata: { total_results: 2, search_time_ms: 312 },
        },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await searchAnySearch("  latest docs  ");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Docs",
      url: "https://anysearch.example/a",
      text: "full body",
      source: "anysearch",
    });
    expect(Number.isNaN(Date.parse(results[0]!.retrievedAt))).toBe(false);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.anysearch.com/v1/search");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer anysearch-key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ query: "latest docs" });
    // `max_results` is the real field name; `numResults` would be ignored.
    expect(body.max_results).toBe(3);
    expect(body.numResults).toBeUndefined();
  });

  it("falls back to snippet when content is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          code: 0,
          data: { results: [{ title: "S", url: "https://anysearch.example/s", snippet: "only snippet" }] },
        })
      )
    );

    const results = await searchAnySearch("latest");
    expect(results[0]?.text).toBe("only snippet");
  });

  it("clamps max_results into the documented 1..10 range", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse({ code: 0, data: { results: [] } })
    );
    vi.stubGlobal("fetch", fetchMock);

    process.env.SEARCH_MAX_RESULTS = "99";
    await searchAnySearch("latest");
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body)).max_results).toBe(10);

    process.env.SEARCH_MAX_RESULTS = "4";
    await searchAnySearch("latest");
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body)).max_results).toBe(4);

    // "0" is falsy, so it falls back to the default rather than sending 0,
    // which the API would reject. Same rule as the Exa adapter.
    process.env.SEARCH_MAX_RESULTS = "0";
    await searchAnySearch("latest");
    expect(JSON.parse(String(fetchMock.mock.calls[2]![1].body)).max_results).toBe(3);

    delete process.env.SEARCH_MAX_RESULTS;
  });

  it("returns an empty array for a business-level failure inside a 200 envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ code: -1, message: "Query is required.", request_id: "2e5a8c74" })
      )
    );

    expect(await searchAnySearch("latest")).toEqual([]);
  });

  it("never surfaces the 402 credential payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            code: -1,
            message:
              "Your account and API key have been automatically generated. Use the API key below to continue.\nusername=u\npassword=p\napi_key=as_sk_secret",
          },
          402
        )
      )
    );

    const results = await searchAnySearch("latest");
    expect(results).toEqual([]);
    expect(JSON.stringify(results)).not.toContain("as_sk_secret");
  });

  it("returns an empty array without calling the API when the key is missing", async () => {
    delete process.env.ANYSEARCH_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await searchAnySearch("anything")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the API entirely for an empty query", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await searchAnySearch("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries once after a 429 and returns the second response", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn(async (_url: string, _init: RequestInit) => exaLikeResponse())
        .mockResolvedValueOnce(jsonResponse({ code: -1, message: "Rate limited" }, 429));
      vi.stubGlobal("fetch", fetchMock);

      const pending = searchAnySearch("latest");
      await vi.runAllTimersAsync();

      const results = await pending;
      expect(results).toHaveLength(1);
      expect(results[0]?.source).toBe("anysearch");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry terminal statuses such as 401, 402, or 415", async () => {
    for (const status of [401, 402, 415]) {
      const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
        jsonResponse({ code: -1, message: "denied" }, status)
      );
      vi.stubGlobal("fetch", fetchMock);

      expect(await searchAnySearch("latest")).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("returns an empty array on a non-OK response or a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    expect(await searchAnySearch("latest")).toEqual([]);

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    expect(await searchAnySearch("latest")).toEqual([]);
  });
});
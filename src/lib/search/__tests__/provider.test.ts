import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_SEARCH_PROVIDER,
  availableProviders,
  isProviderConfigured,
  parseSearchProvider,
  runWebSearch,
  SEARCH_PROVIDERS,
} from "../provider";

const KEYS = ["EXA_API_KEY", "ANYSEARCH_API_KEY", "GEMINI_API_KEY"] as const;
const originals = Object.fromEntries(KEYS.map((key) => [key, process.env[key]])) as Record<string, string | undefined>;

function clearKeys() {
  for (const key of KEYS) delete process.env[key];
}

function restoreKeys() {
  for (const key of KEYS) {
    const value = originals[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function anySearchResponse(url: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      code: 0,
      message: "success",
      data: { results: [{ title: "Any", url, content: "any text" }] },
    }),
  } as unknown as Response;
}

function exaResponse(url: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ results: [{ title: "Exa", url, text: "exa text" }] }),
  } as unknown as Response;
}

describe("search provider registry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearKeys();
  });

  afterEach(() => {
    restoreKeys();
    vi.unstubAllGlobals();
  });

  it("exposes the three providers with Exa as the default", () => {
    expect(SEARCH_PROVIDERS).toEqual(["exa", "anysearch", "google_grounding"]);
    expect(DEFAULT_SEARCH_PROVIDER).toBe("exa");
  });

  it("falls back to Exa for unknown or missing provider values", () => {
    expect(parseSearchProvider(null)).toBe("exa");
    expect(parseSearchProvider("")).toBe("exa");
    expect(parseSearchProvider("not-a-provider")).toBe("exa");
    expect(parseSearchProvider("anysearch")).toBe("anysearch");
    expect(parseSearchProvider("google_grounding")).toBe("google_grounding");
  });

  it("reports only providers that have a server-side key", () => {
    expect(availableProviders()).toEqual([]);

    process.env.EXA_API_KEY = "exa-key";
    expect(isProviderConfigured("exa")).toBe(true);
    expect(isProviderConfigured("anysearch")).toBe(false);

    process.env.ANYSEARCH_API_KEY = "any-key";
    expect(availableProviders()).toEqual(["exa", "anysearch"]);
  });

  it("uses the requested provider when it answers", async () => {
    process.env.ANYSEARCH_API_KEY = "any-key";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => anySearchResponse("https://anysearch.example/a"));
    vi.stubGlobal("fetch", fetchMock);

    const { results, provider } = await runWebSearch("latest", "anysearch");

    expect(provider).toBe("anysearch");
    expect(results[0]?.source).toBe("anysearch");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.anysearch.com/v1/search");
  });

  it("falls back to Exa when the requested provider returns nothing", async () => {
    process.env.ANYSEARCH_API_KEY = "any-key";
    process.env.EXA_API_KEY = "exa-key";
    const fetchMock = vi
      .fn(async (_url: string, _init: RequestInit): Promise<Response> => exaResponse("https://exa.example/a"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { results: [] } }),
      } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { results, provider } = await runWebSearch("latest", "anysearch");

    expect(provider).toBe("exa");
    expect(results[0]?.source).toBe("exa");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("skips an unconfigured provider instead of failing", async () => {
    process.env.EXA_API_KEY = "exa-key";
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => exaResponse("https://exa.example/a"));
    vi.stubGlobal("fetch", fetchMock);

    const { results, provider } = await runWebSearch("latest", "google_grounding");

    expect(provider).toBe("exa");
    expect(results[0]?.url).toBe("https://exa.example/a");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.exa.ai/search");
  });

  it("returns nothing when no provider is configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(await runWebSearch("latest", "anysearch")).toEqual({ results: [], provider: "anysearch" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
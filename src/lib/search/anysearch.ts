/**
 * AnySearch client — an independent web search provider.
 *
 * AnySearch is not tied to any LLM: it returns plain search results that this
 * file normalizes into `SearchCitation`, exactly like the Exa adapter does.
 * Exa is left untouched and remains the default provider.
 *
 * Wire format follows the official `/v1/search` reference:
 * https://anysearch.com/docs/api-endpoints/v1-search
 *   request  : { query, max_results }   (max_results: 1..10, server default 10)
 *   response : { code, message, request_id, data: { results: [...] } }
 *   result   : { title, url, snippet, content }
 *   success  : code === 0
 *
 * Security note: a 402 from this API can carry generated credentials inside
 * `message`. Nothing here logs, returns, or persists the response body, so
 * those credentials never reach logs, analytics, or the browser.
 */

import type { SearchCitation } from "@/types/memory";

const ANYSEARCH_SEARCH_URL = "https://api.anysearch.com/v1/search";
const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 1_500;
const DEFAULT_NUM_RESULTS = 3;
const MAX_TEXT_CHARACTERS = 2_500;

/** `/v1/search` result item — `content` is the cleaned body, `snippet` the summary. */
interface AnySearchResultItem {
  title?: string | null;
  url?: string | null;
  content?: string | null;
  snippet?: string | null;
}

/** The documented response envelope. `data` is absent on failures. */
interface AnySearchSearchResponse {
  code?: number;
  message?: string;
  request_id?: string;
  data?: {
    results?: AnySearchResultItem[] | null;
  } | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildAnySearchBody(query: string): string {
  return JSON.stringify({
    query,
    // The field is `max_results` (1..10). `numResults` is silently ignored,
    // which would hand back the server default of 10 results.
    max_results: Math.max(
      1,
      Math.min(10, Number(process.env.SEARCH_MAX_RESULTS) || DEFAULT_NUM_RESULTS)
    ),
  });
}

function anySearchHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey.trim()}`,
  };
}

function requestAnySearch(
  query: string,
  apiKey: string,
  timeoutMs: number
): Promise<Response> {
  return fetchWithTimeout(
    ANYSEARCH_SEARCH_URL,
    {
      method: "POST",
      headers: anySearchHeaders(apiKey),
      body: buildAnySearchBody(query),
    },
    timeoutMs
  );
}

function mapAnySearchResults(
  response: AnySearchSearchResponse,
  limit: number
): SearchCitation[] {
  const retrievedAt = new Date().toISOString();
  return (response.data?.results ?? [])
    .map((item) => ({
      title: item.title?.trim() ?? "",
      url: item.url?.trim() ?? "",
      // `content` is the cleaned body; `snippet` is the short fallback. `text`
      // is not part of this API and would always be undefined.
      text: (item.content?.trim() || item.snippet?.trim() || "").slice(
        0,
        MAX_TEXT_CHARACTERS
      ),
      source: "anysearch" as const,
      retrievedAt,
    }))
    .filter((item) => item.url.length > 0)
    .slice(0, limit);
}

function maxResults(): number {
  return Math.max(
    1,
    Math.min(10, Number(process.env.SEARCH_MAX_RESULTS) || DEFAULT_NUM_RESULTS)
  );
}

async function searchWithAnySearch(
  query: string,
  apiKey: string
): Promise<SearchCitation[]> {
  let response = await requestAnySearch(query, apiKey, DEFAULT_TIMEOUT_MS);

  // 429 is the documented rate-limit status. 415 means the Content-Type was
  // rejected, and 402 means the quota is exhausted — both are terminal, so only
  // 429 is retried once.
  if (response.status === 429) {
    await sleep(RETRY_DELAY_MS);
    response = await requestAnySearch(query, apiKey, DEFAULT_TIMEOUT_MS);
  }

  if (!response.ok) {
    return [];
  }

  let data: AnySearchSearchResponse;
  try {
    data = (await response.json()) as AnySearchSearchResponse;
  } catch {
    return [];
  }

  // Business-level failure inside a 200 envelope.
  if (data.code !== 0) {
    return [];
  }

  return mapAnySearchResults(data, maxResults());
}

/** True when a server-side AnySearch key is configured. */
export function isAnySearchConfigured(): boolean {
  return Boolean(process.env.ANYSEARCH_API_KEY?.trim());
}

/**
 * Search the web through AnySearch.
 *
 * Returns an empty array on a missing key, an empty query, timeouts, rate
 * limits (after one retry), or any other failure. Never throws.
 */
export async function searchAnySearch(query: string): Promise<SearchCitation[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const apiKey = process.env.ANYSEARCH_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }

  try {
    return await searchWithAnySearch(trimmed, apiKey);
  } catch {
    return [];
  }
}
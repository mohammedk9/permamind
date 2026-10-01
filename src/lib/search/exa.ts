/**
 * Internet search client (Exa provider) — the default web search provider.
 *
 * Public surface is provider-agnostic: `searchInternet` returns
 * `SearchCitation`, the same shape the AnySearch and Google Grounding adapters
 * return. Exa-specific request/response types stay internal so the backend can
 * swap providers without changing callers.
 */

import type { SearchCitation } from "@/types/memory";

/**
 * @deprecated Use `SearchCitation` from `@/types/memory`. Kept as an alias so
 * existing imports keep compiling while every provider shares one shape.
 */
export type InternetSearchResult = SearchCitation;

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const DEFAULT_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 1_500;
const DEFAULT_NUM_RESULTS = 3;
const MAX_TEXT_CHARACTERS = 2_500;

/** Exa `/search` response shape (only fields we read). */
interface ExaSearchResponse {
  results?: ExaSearchResultItem[];
}

interface ExaSearchResultItem {
  title?: string | null;
  url?: string | null;
  text?: string | null;
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

function buildExaSearchBody(query: string): string {
  return JSON.stringify({
    query,
    type: "auto",
    numResults: Math.max(1, Math.min(10, Number(process.env.SEARCH_MAX_RESULTS) || DEFAULT_NUM_RESULTS)),
    contents: {
      text: { maxCharacters: MAX_TEXT_CHARACTERS },
    },
  });
}

function exaHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
  };
}

async function requestExaSearch(
  query: string,
  apiKey: string,
  timeoutMs: number
): Promise<Response> {
  return fetchWithTimeout(
    EXA_SEARCH_URL,
    {
      method: "POST",
      headers: exaHeaders(apiKey),
      body: buildExaSearchBody(query),
    },
    timeoutMs
  );
}

function mapExaResults(data: ExaSearchResponse): SearchCitation[] {
  const retrievedAt = new Date().toISOString();
  return (data.results ?? [])
    .map((item) => ({
      title: item.title?.trim() ?? "",
      url: item.url?.trim() ?? "",
      text: item.text?.trim() ?? "",
      source: "exa" as const,
      retrievedAt,
    }))
    .filter((item) => item.url.length > 0);
}

async function searchWithExa(
  query: string,
  apiKey: string
): Promise<SearchCitation[]> {
  let response = await requestExaSearch(query, apiKey, DEFAULT_TIMEOUT_MS);

  if (response.status === 429) {
    await sleep(RETRY_DELAY_MS);
    response = await requestExaSearch(query, apiKey, DEFAULT_TIMEOUT_MS);
  }

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as ExaSearchResponse;
  return mapExaResults(data);
}

/** True when a server-side Exa key is configured. */
export function isExaConfigured(): boolean {
  return Boolean(process.env.EXA_API_KEY?.trim());
}

/**
 * Search the public internet for pages relevant to `query`.
 *
 * Returns an empty array on missing credentials, timeouts, rate limits (after
 * one retry), or any other failure. Never throws.
 */
export async function searchInternet(
  query: string
): Promise<SearchCitation[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const apiKey = process.env.EXA_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }

  try {
    return await searchWithExa(trimmed, apiKey);
  } catch {
    return [];
  }
}

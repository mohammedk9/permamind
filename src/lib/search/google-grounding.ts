/**
 * Google Grounding client — an independent web search provider.
 *
 * Grounding calls Gemini directly (never through OpenRouter). Gemini returns a
 * grounded answer plus the web chunks it used; this file normalizes both into
 * `SearchCitation` so callers stay provider-agnostic.
 */

import type { SearchCitation } from "@/types/memory";

const GROUNDING_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GROUNDING_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 1_500;
const MAX_TEXT_CHARACTERS = 2_500;
const DEFAULT_NUM_RESULTS = 3;

interface GroundingChunk {
  web?: { uri?: string | null; title?: string | null } | null;
}

interface GroundingCandidate {
  groundingMetadata?: { groundingChunks?: GroundingChunk[] | null } | null;
  content?: { parts?: Array<{ text?: string | null }> | null } | null;
}

interface GroundingResponse {
  candidates?: GroundingCandidate[] | null;
}

function groundingModel(): string {
  return process.env.GEMINI_GROUNDING_MODEL?.trim() || DEFAULT_GROUNDING_MODEL;
}

function groundingApiKey(): string | undefined {
  return (
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_AI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    undefined
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGroundingBody(query: string): string {
  return JSON.stringify({
    contents: [{ role: "user", parts: [{ text: query }] }],
    tools: [{ google_search: {} }],
  });
}

function buildGroundingUrl(): string {
  // The API key is NOT placed in the query string: URLs land in access logs and
  // traces far more often than headers. `x-goog-api-key` is the documented
  // header alternative and keeps the credential out of both.
  return `${GROUNDING_BASE_URL}/${encodeURIComponent(groundingModel())}:generateContent`;
}

function requestGrounding(query: string, apiKey: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  return fetch(buildGroundingUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey.trim(),
    },
    body: buildGroundingBody(query),
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
}

function maxResults(): number {
  return Math.max(
    1,
    Math.min(10, Number(process.env.SEARCH_MAX_RESULTS) || DEFAULT_NUM_RESULTS)
  );
}

/**
 * Splits one grounded answer across its citing sources instead of repeating the
 * full answer on every citation. Repeating it would multiply the same ~2.5k
 * characters by the result count for no extra information.
 */
function distributeAnswer(answer: string, count: number): string[] {
  if (!answer || count <= 1) {
    return new Array(count).fill(answer);
  }

  const size = Math.ceil(answer.length / count);
  return Array.from({ length: count }, (_, index) =>
    answer.slice(index * size, index * size + size).trim()
  );
}

function mapGroundingResults(data: GroundingResponse): SearchCitation[] {
  const candidate = data.candidates?.[0];
  if (!candidate) {
    return [];
  }

  const answer = (candidate.content?.parts ?? [])
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT_CHARACTERS);

  const limit = maxResults();
  const retrievedAt = new Date().toISOString();

  const citations = (candidate.groundingMetadata?.groundingChunks ?? [])
    .map((chunk) => ({
      title: chunk.web?.title?.trim() ?? "",
      url: chunk.web?.uri?.trim() ?? "",
      source: "google_grounding" as const,
      retrievedAt,
    }))
    .filter((item) => item.url.length > 0)
    .slice(0, limit);

  const slices = distributeAnswer(answer, citations.length);
  return citations.map((citation, index) => ({ ...citation, text: slices[index] ?? "" }));
}

async function searchWithGrounding(
  query: string,
  apiKey: string
): Promise<SearchCitation[]> {
  let response = await requestGrounding(query, apiKey);

  if (response.status === 429) {
    await sleep(RETRY_DELAY_MS);
    response = await requestGrounding(query, apiKey);
  }

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as GroundingResponse;
  return mapGroundingResults(data);
}

/** True when a server-side Gemini key is configured for grounding. */
export function isGoogleGroundingConfigured(): boolean {
  return Boolean(groundingApiKey());
}

/**
 * Search the web through Gemini Grounding.
 *
 * Returns an empty array on a missing key, an empty query, timeouts, rate
 * limits (after one retry), or any other failure. Never throws.
 */
export async function searchGoogleGrounding(query: string): Promise<SearchCitation[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const apiKey = groundingApiKey();
  if (!apiKey) {
    return [];
  }

  try {
    return await searchWithGrounding(trimmed, apiKey);
  } catch {
    return [];
  }
}
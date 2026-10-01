/**
 * Web search provider registry.
 *
 * Every provider is independent of the others and of the chosen LLM. Exa stays
 * the default so existing installs behave exactly as before; AnySearch and
 * Google Grounding are opt-in through their own server-side keys.
 */

import type { SearchCitation, SearchProvider } from "@/types/memory";
import { isAnySearchConfigured, searchAnySearch } from "./anysearch";
import { isExaConfigured, searchInternet } from "./exa";
import {
  isGoogleGroundingConfigured,
  searchGoogleGrounding,
} from "./google-grounding";

export const SEARCH_PROVIDERS: SearchProvider[] = [
  "exa",
  "anysearch",
  "google_grounding",
];

export const DEFAULT_SEARCH_PROVIDER: SearchProvider = "exa";

/** Whether a server-side key exists for this provider. */
export function isProviderConfigured(provider: SearchProvider): boolean {
  if (provider === "anysearch") return isAnySearchConfigured();
  if (provider === "google_grounding") return isGoogleGroundingConfigured();
  return isExaConfigured();
}

/** Providers usable right now, in preference order. */
export function availableProviders(): SearchProvider[] {
  return SEARCH_PROVIDERS.filter((provider) => isProviderConfigured(provider));
}

function runProvider(
  provider: SearchProvider,
  query: string
): Promise<SearchCitation[]> {
  if (provider === "anysearch") return searchAnySearch(query);
  if (provider === "google_grounding") return searchGoogleGrounding(query);
  return searchInternet(query);
}

/** Accepts only the known provider ids; anything else falls back to Exa. */
export function parseSearchProvider(value: string | null): SearchProvider {
  return SEARCH_PROVIDERS.includes(value as SearchProvider)
    ? (value as SearchProvider)
    : DEFAULT_SEARCH_PROVIDER;
}

/**
 * Run one search through the requested provider.
 *
 * If the requested provider is not configured, or returns nothing, Exa is
 * tried when it is configured — so a free-tier AnySearch or Grounding key that
 * is momentarily unavailable never turns into a failed reply.
 */
export async function runWebSearch(
  query: string,
  provider: SearchProvider
): Promise<{ results: SearchCitation[]; provider: SearchProvider }> {
  const order: SearchProvider[] = isProviderConfigured(provider)
    ? [provider]
    : [];

  if (provider !== "exa" && isExaConfigured()) {
    order.push("exa");
  }

  for (const candidate of order) {
    const results = await runProvider(candidate, query);
    if (results.length > 0) {
      return { results, provider: candidate };
    }
  }

  return { results: [], provider };
}
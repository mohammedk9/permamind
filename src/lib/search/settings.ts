/**
 * Local, non-secret storage for the user's web search provider choice.
 *
 * Provider keys never live in the browser — they stay server-side. Only the
 * preference itself is stored, in localStorage, like provider/baseUrl/modelName.
 */

import type { SearchProvider } from "@/types/memory";
import { DEFAULT_SEARCH_PROVIDER, SEARCH_PROVIDERS } from "./provider";

const STORAGE_KEY = "permamind:search-provider:v1";

export { DEFAULT_SEARCH_PROVIDER, SEARCH_PROVIDERS };

export function loadSearchProvider(): SearchProvider {
  if (typeof window === "undefined") return DEFAULT_SEARCH_PROVIDER;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return SEARCH_PROVIDERS.includes(raw as SearchProvider)
      ? (raw as SearchProvider)
      : DEFAULT_SEARCH_PROVIDER;
  } catch {
    return DEFAULT_SEARCH_PROVIDER;
  }
}

export function saveSearchProvider(provider: SearchProvider): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, provider);
  } catch {
    // ignore quota / private-mode failures — the default stays in effect
  }
}
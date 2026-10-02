import React from "react";
import { Compass, Globe } from "lucide-react";

import { DEFAULT_SEARCH_PROVIDER, SEARCH_PROVIDERS } from "@/lib/search/provider";

/** The copy this section needs, taken from the existing translation bundle. */
export type SearchRailCopy = {
  searchTitle: string;
  searchDescription: string;
};

/**
 * Display names for the provider ids in `SEARCH_PROVIDERS`
 * (src/lib/search/provider.ts), so the section lists exactly the providers the
 * server can reach.
 *
 * These are product names rather than copy, so they are identical in both
 * locales and live here beside the ids instead of in the translation bundle.
 */
const providerLabels: Record<(typeof SEARCH_PROVIDERS)[number], string> = {
  exa: "Exa",
  anysearch: "AnySearch",
  google_grounding: "Google Grounding",
};

/**
 * Web search, shown as a provider rail.
 *
 * The list is read from `SEARCH_PROVIDERS` rather than written out, so adding a
 * provider in `lib/search/provider.ts` makes it appear here on its own — the same
 * rule `SecurityStrip` follows for the Arweave constants.
 *
 * No English prose is invented here. The section renders the two translation keys
 * that already exist and are otherwise unused (`searchTitle`, `searchDescription`)
 * plus the provider names, so it stays correct in both locales without adding new
 * strings. The stale `searchBadge` key is deliberately not rendered: it still
 * reads "Coming soon", which stopped being true once the second and third
 * providers shipped.
 */
export function SearchRail({ copy }: { copy: SearchRailCopy }) {
  return (
    <section id="search" className="scroll-mt-20 border-t border-border/50 py-16 sm:py-24">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6 sm:gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-4xl">
            <Compass className="size-6 shrink-0 text-primary sm:size-7" aria-hidden="true" />
            <span className="min-w-0">{copy.searchTitle}</span>
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">
            {copy.searchDescription}
          </p>
        </div>

        <ul className="grid gap-3">
          {SEARCH_PROVIDERS.map((provider) => {
            const isDefault = provider === DEFAULT_SEARCH_PROVIDER;
            return (
              <li
                key={provider}
                // The default provider carries the same emphasis treatment the
                // Arweave chip gets in `OwnershipMarks`, so "which one is
                // default" is answered by the existing visual language instead of
                // by a new label that would need translating.
                className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 ${
                  isDefault
                    ? "border-primary/40 bg-primary/10"
                    : "border-border/70 bg-card/60"
                }`}
                data-default={isDefault ? "true" : undefined}
              >
                <Globe
                  className={`size-4 shrink-0 ${isDefault ? "text-primary" : "text-muted-foreground"}`}
                  aria-hidden="true"
                />
                <span className={`text-sm font-semibold ${isDefault ? "text-foreground" : "text-foreground/80"}`}>
                  {providerLabels[provider]}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

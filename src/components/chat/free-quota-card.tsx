"use client";

/**
 * What the user gets when the free daily allowance is spent.
 *
 * The request cannot be sent, so instead of a dead end this offers the two things
 * that still work: their own API key, and the memory already on the device. That
 * second half is the point — the model is unavailable, but the user's own history
 * is not, and saying "come back tomorrow" while withholding what is already local
 * would be withholding something the app was built to keep.
 *
 * Three rules shape the markup:
 *
 * - **It never claims to be an answer.** The eyebrow says so in the user's
 *   language, and the results are labelled as memory, not as a reply.
 * - **It is reachable without a mouse and readable without sight.** The card is a
 *   labelled region, the result list is a live region so a screen reader hears
 *   that results arrived, and every control is at least 44px tall.
 * - **It works right-to-left.** The parts that have a direction use logical
 *   properties — `ms-auto` to push the date to the inline end, `text-start` for
 *   the result text — so the Arabic layout mirrors without a second stylesheet.
 *   The card's own padding is symmetric (`px`/`py`) precisely because there is
 *   nothing to mirror there.
 *
 * The search itself is `searchMemoryOffline`: synchronous, local, no `fetch`. It
 * runs only once the user asks for it, and only recomputes when the query
 * changes.
 */

import { BookOpen, KeyRound, Search, X } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/hooks/use-locale";
import { localizeError, localizeErrorTitle } from "@/lib/i18n/error-messages";
import { formatQuotaResetLabel } from "@/lib/i18n/quota-reset";
import { translations } from "@/lib/i18n/translations";
import {
  searchMemoryOffline,
  type OfflineMemoryHit,
  type OfflineMemoryType,
} from "@/lib/memory/search-offline";
import { cn } from "@/lib/utils";

interface FreeQuotaCardProps {
  /** The message the user just tried to send; the default local query. */
  query: string;
  /** When the allowance returns, from the server's `resetAt` or from local state. */
  resetAt?: string | null;
  /** The limit the server reported, for the "{count} free messages" sentence. */
  limit?: number;
  /** Conversation the query came from; its messages are skipped. */
  excludeConversationId?: string | null;
  /** Opens Settings so the user can add their own key. */
  onOpenSettings: () => void;
  /** Opens the conversation a result came from. */
  onOpenConversation: (conversationId: string) => void;
  /** Opens the memory area, where every decision can be reviewed. */
  onOpenMemory: () => void;
  /** Closes the card; also forgets the remembered refusal. */
  onDismiss: () => void;
}

const RESULT_BADGE_CLASS =
  "rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground";

const RESULT_BUTTON_CLASS = cn(
  "flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-lg px-3 py-2 text-start",
  "transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
);

/**
 * The three labels this card needs, as a structural type.
 *
 * `typeof translations.en` would reject the Arabic object, because every value in
 * it is a different string literal. What the function actually needs is these
 * three strings, so that is what it asks for.
 */
type QuotaCardCopy = {
  freeQuotaTypeSummary: string;
  freeQuotaTypeConversation: string;
  freeQuotaTypeDecision: string;
  /** "{count} results", with the number substituted for the active locale. */
  freeQuotaResultsCount: string;
};

/** Localized label for what a hit points at. */
function typeLabel(type: OfflineMemoryType, copy: QuotaCardCopy): string {
  if (type === "decision") return copy.freeQuotaTypeDecision;
  if (type === "summary") return copy.freeQuotaTypeSummary;
  return copy.freeQuotaTypeConversation;
}

/** Short localized date; empty when the value cannot be parsed. */
function formatHitDate(iso: string, locale: "en" | "ar"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en", { dateStyle: "medium" }).format(date);
}

/**
 * "{count} results" with the number written the way the locale writes numbers.
 *
 * Passing the count through `Intl.NumberFormat` rather than interpolating it is
 * what keeps the number in the sentence's own script — a bare template literal
 * drops English digits into an Arabic line.
 */
function resultsCountLabel(count: number, locale: "en" | "ar", copy: QuotaCardCopy): string {
  const formatted = new Intl.NumberFormat(locale === "ar" ? "ar" : "en").format(count);
  return copy.freeQuotaResultsCount.replace("{count}", formatted);
}

export function FreeQuotaCard({
  query,
  resetAt,
  limit,
  excludeConversationId,
  onOpenSettings,
  onOpenConversation,
  onOpenMemory,
  onDismiss,
}: FreeQuotaCardProps) {
  const { locale } = useLocale();
  const copy = translations[locale];
  const titleId = useId();
  // Ids for the results region. The wrapper is always in the document, so
  // `aria-controls` never points at a missing element and the live region exists
  // before its content changes — a live region created at the same moment as the
  // content is announced unreliably, if at all.
  const resultsId = useId();
  const [showResults, setShowResults] = useState(false);

  // Computed on demand rather than on mount: the index is built from the whole
  // local history, and building it for a card the user may never expand would be
  // work spent on nothing.
  const hits = useMemo<OfflineMemoryHit[]>(
    () => (showResults ? searchMemoryOffline(query, { excludeConversationId }) : []),
    [showResults, query, excludeConversationId],
  );

  const resetLabel = formatQuotaResetLabel(resetAt, locale);
  const title = localizeErrorTitle("free_quota_exceeded", locale);
  // The catalogue sentence names a number, so without one it renders a literal
  // "{count}" into the UI. A reload can legitimately have a reset time but no
  // stored limit, so there is a second sentence for exactly that case rather than
  // a placeholder the user has to decode.
  const body =
    limit === undefined
      ? copy.freeQuotaBodyNoCount
      : localizeError("free_quota_exceeded", locale, undefined, limit);

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      className="border-b border-border/70 bg-muted/40 px-4 py-4"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">{copy.freeQuotaEyebrow}</p>
          <p id={titleId} className="mt-1 text-sm font-medium">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
          {resetLabel && <p className="mt-1 text-xs text-muted-foreground">{resetLabel}</p>}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={onOpenSettings} className="min-h-11">
              <KeyRound aria-hidden="true" />
              {copy.freeQuotaAddKey}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              aria-expanded={showResults}
              aria-controls={resultsId}
              onClick={() => setShowResults((current) => !current)}
            >
              <Search aria-hidden="true" />
              {showResults ? copy.freeQuotaHideResults : copy.freeQuotaSearch}
            </Button>
            <Button size="sm" variant="ghost" onClick={onOpenMemory} className="min-h-11">
              <BookOpen aria-hidden="true" />
              {copy.freeQuotaOpenMemory}
            </Button>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon-lg"
          onClick={onDismiss}
          aria-label={copy.freeQuotaDismiss}
          // 44x44 rather than the usual icon size: this is the one control that
          // covers the card, and it has to be hit on a phone with a thumb.
          className="min-h-11 min-w-11 shrink-0"
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/*
        Always in the document, even when collapsed: a live region that is created
        at the same instant as its content is announced unreliably, and
        `aria-controls` on the toggle must resolve to something that exists.
        Tailwind's preflight removes list markers, which also removes the list
        semantics from Safari's accessibility tree — `role="list"` puts them back.
      */}
      <div id={resultsId} aria-live="polite" aria-atomic="true">
        {showResults && (
          <div className="mt-3">
            <p className="text-xs font-medium text-muted-foreground">
              {copy.freeQuotaResultsTitle} · {resultsCountLabel(hits.length, locale, copy)}
            </p>
            {hits.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">{copy.freeQuotaNoResults}</p>
            ) : (
              <ul role="list" className="mt-2 space-y-1">
                {hits.map((hit) => (
                  <li key={hit.id} role="listitem">
                    <button
                      type="button"
                      onClick={() => onOpenConversation(hit.conversationId)}
                      className={RESULT_BUTTON_CLASS}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={RESULT_BADGE_CLASS}>{typeLabel(hit.type, copy)}</span>
                        {hit.status === "superseded" && (
                          <span className={RESULT_BADGE_CLASS}>{copy.freeQuotaStatusReplaced}</span>
                        )}
                        <span className="min-w-0 truncate text-sm font-medium">{hit.title}</span>
                        <span className="ms-auto text-xs text-muted-foreground">
                          {formatHitDate(hit.date, locale)}
                        </span>
                      </span>
                      <span className="line-clamp-2 text-xs text-muted-foreground">{hit.snippet}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
"use client";

import { AlertCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/hooks/use-locale";
import { localizeError, localizeErrorTitle } from "@/lib/i18n/error-messages";
import type { ErrorCode } from "@/lib/i18n/error-messages";
import { formatQuotaResetLabel } from "@/lib/i18n/quota-reset";
import { translations } from "@/lib/i18n/translations";
import { FREE_QUOTA_EXCEEDED_CODE } from "@/lib/ai/types";

interface ChatErrorBannerProps {
  /** English fallback, used only when the code cannot be resolved. */
  message: string;
  /** Language-neutral identifier; drives the localized copy. */
  code?: ErrorCode;
  /** Quota limit substituted into the localized message. */
  limit?: number;
  /**
   * When the daily allowance returns, from the server's own `resetAt`.
   *
   * Only a spent allowance has one, so its presence is what adds the reset
   * line. Rendered in UTC because the server's counter rolls over at UTC
   * midnight: showing a local time would invite the user to wait an hour too
   * long or too little.
   */
  resetAt?: string;
  onDismiss: () => void;
  onRetry?: () => void;
}

export function ChatErrorBanner({ message, code, limit, resetAt, onDismiss, onRetry }: ChatErrorBannerProps) {
  const { locale } = useLocale();
  const copy = translations[locale];
  const title = localizeErrorTitle(code, locale);
  const body = localizeError(code, locale, message, limit);
  // Gated on the code, not just on the timestamp: a remembered reset time can
  // still be in state when the newest failure is something else entirely, and
  // "resets at midnight" under a provider error would be a claim about the wrong
  // limit.
  const resetLabel =
    code === FREE_QUOTA_EXCEEDED_CODE ? formatQuotaResetLabel(resetAt, locale) : null;

  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1"><p className="font-medium">{title}</p><p className="mt-0.5 opacity-90">{body}</p>{resetLabel && <p className="mt-1 text-xs opacity-80">{resetLabel}</p>}{onRetry && <button type="button" onClick={onRetry} className="mt-2 font-medium underline underline-offset-2 hover:no-underline">{copy.retryAction}</button>}</div>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDismiss}
        aria-label={copy.dismissError}
        className="shrink-0 text-destructive hover:bg-destructive/20"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

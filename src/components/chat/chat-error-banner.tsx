"use client";

import { AlertCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/hooks/use-locale";
import { localizeError, localizeErrorTitle } from "@/lib/i18n/error-messages";
import type { ErrorCode } from "@/lib/i18n/error-messages";

interface ChatErrorBannerProps {
  /** English fallback, used only when the code cannot be resolved. */
  message: string;
  /** Language-neutral identifier; drives the localized copy. */
  code?: ErrorCode;
  /** Quota limit substituted into the localized message. */
  limit?: number;
  onDismiss: () => void;
  onRetry?: () => void;
}

export function ChatErrorBanner({ message, code, limit, onDismiss, onRetry }: ChatErrorBannerProps) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const title = localizeErrorTitle(code, locale);
  const body = localizeError(code, locale, message, limit);

  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1"><p className="font-medium">{title}</p><p className="mt-0.5 opacity-90">{body}</p>{onRetry && <button type="button" onClick={onRetry} className="mt-2 font-medium underline underline-offset-2 hover:no-underline">{ar ? "أعد المحاولة" : "Try again"}</button>}</div>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDismiss}
        aria-label={ar ? "إغلاق الخطأ" : "Dismiss error"}
        className="shrink-0 text-destructive hover:bg-destructive/20"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

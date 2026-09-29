import type { Locale } from "@/lib/i18n/translations";

/**
 * Stable, language-neutral error identifiers.
 *
 * The server sends one of these codes in the `code` field of its JSON error
 * response. The client renders the localized copy. English provider text is
 * kept in `error` as a fallback and for logs, but it is never the only thing
 * the user can be shown.
 */
export const ERROR_CODES = [
  "QUOTA_UNAVAILABLE",
  "QUOTA_EXCEEDED",
  "SIGNIN_REQUIRED",
  "RATE_LIMITED",
  "STREAM_INTERRUPTED",
  "STREAM_UNAVAILABLE",
  "CANCELLED",
  "NETWORK_ERROR",
  "REQUEST_FAILED",
  "PROVIDER_ERROR",
  "UNKNOWN",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (ERROR_CODES as readonly string[]).includes(value);
}

type Copy = { title: string; body: string };

/**
 * `body` may contain a single `{count}` placeholder, replaced with the
 * per-kind quota limit so the sentence stays grammatically correct in Arabic
 * (dual/plural) and English.
 */
const MESSAGES: Record<ErrorCode, { en: Copy; ar: Copy }> = {
  QUOTA_UNAVAILABLE: {
    en: {
      title: "We couldn't complete that request",
      body: "The daily allowance is temporarily unavailable. Please try again in a moment.",
    },
    ar: {
      title: "تعذّر إتمام الطلب",
      body: "الحد اليومي غير متاح مؤقتاً. يرجى المحاولة بعد قليل.",
    },
  },
  QUOTA_EXCEEDED: {
    en: {
      title: "You've reached your daily limit",
      body: "You have used your {count} free requests for today. Add your own API key in Settings, or come back tomorrow.",
    },
    ar: {
      title: "وصلت إلى حدّك اليومي",
      body: "لقد استخدمت {count} من طلباتك المجانية اليوم. أضف مفتاح API خاص بك من الإعدادات، أو عد غداً.",
    },
  },
  SIGNIN_REQUIRED: {
    en: {
      title: "Sign in to continue",
      body: "Sign in to use the free daily allowance, or add your own API key in Settings.",
    },
    ar: {
      title: "سجّل الدخول للمتابعة",
      body: "سجّل الدخول لاستخدام الحد اليومي المجاني، أو أضف مفتاح API خاص بك من الإعدادات.",
    },
  },
  RATE_LIMITED: {
    en: {
      title: "Too many requests",
      body: "You're sending requests too quickly. Please slow down and try again.",
    },
    ar: {
      title: "طلبات كثيرة جداً",
      body: "ترسل طلبات بسرعة كبيرة. يرجى التمهّل والمحاولة مرة أخرى.",
    },
  },
  STREAM_INTERRUPTED: {
    en: {
      title: "Connection interrupted",
      body: "The response was cut off before it finished. Please try again.",
    },
    ar: {
      title: "انقطع الاتصال",
      body: "تم قطع الرد قبل اكتماله. يرجى المحاولة مرة أخرى.",
    },
  },
  STREAM_UNAVAILABLE: {
    en: {
      title: "No response received",
      body: "The server sent no data stream. Please try again.",
    },
    ar: {
      title: "لم يصل أي رد",
      body: "لم يرسل الخادم أي تدفّق بيانات. يرجى المحاولة مرة أخرى.",
    },
  },
  CANCELLED: {
    en: { title: "Generation cancelled", body: "You stopped this response." },
    ar: { title: "تم إلغاء الرد", body: "لقد أوقفت هذا الرد." },
  },
  NETWORK_ERROR: {
    en: {
      title: "Network error",
      body: "Check your connection and try again.",
    },
    ar: {
      title: "خطأ في الشبكة",
      body: "تحقّق من اتصالك ثم أعد المحاولة.",
    },
  },
  REQUEST_FAILED: {
    en: {
      title: "Request failed",
      body: "The request could not be completed. Please try again.",
    },
    ar: {
      title: "فشل الطلب",
      body: "تعذّر إتمام الطلب. يرجى المحاولة مرة أخرى.",
    },
  },
  PROVIDER_ERROR: {
    en: {
      title: "The AI provider returned an error",
      body: "The model could not answer right now. Please try again, or switch model in Settings.",
    },
    ar: {
      title: "خطأ من مزوّد الذكاء الاصطناعي",
      body: "تعذّر على النموذج الإجابة حالياً. يرجى المحاولة مجدداً أو تغيير النموذج من الإعدادات.",
    },
  },
  UNKNOWN: {
    en: {
      title: "We couldn't complete that request",
      body: "An unexpected error occurred.",
    },
    ar: {
      title: "تعذّر إتمام الطلب",
      body: "حدث خطأ غير متوقع.",
    },
  },
};

function fill(body: string, count?: number): string {
  return count === undefined ? body : body.replace("{count}", String(count));
}

/**
 * Resolve a server `code` into display text. Falls back to the raw English
 * `error` string when the code is unknown, so a server message is never lost.
 */
export function localizeError(
  code: unknown,
  locale: Locale,
  fallback?: string,
  count?: number
): string {
  const key: ErrorCode = isErrorCode(code) ? code : "UNKNOWN";
  const copy = MESSAGES[key][locale];
  const body = fill(copy.body, count);
  // An unknown code with a real provider message should still show it, because
  // hiding it would leave the user with no explanation at all.
  if (key === "UNKNOWN" && fallback && !isErrorCode(code)) return fallback;
  return body;
}

export function localizeErrorTitle(code: unknown, locale: Locale): string {
  const key: ErrorCode = isErrorCode(code) ? code : "UNKNOWN";
  return MESSAGES[key][locale].title;
}

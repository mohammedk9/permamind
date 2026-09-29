import { describe, expect, it } from "vitest";

import { isErrorCode, localizeError, localizeErrorTitle } from "../error-messages";

describe("error message localization", () => {
  it("recognizes known codes and rejects unknown values", () => {
    expect(isErrorCode("QUOTA_EXCEEDED")).toBe(true);
    expect(isErrorCode("NOT_A_REAL_CODE")).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });

  it("renders the unavailable allowance in Arabic, not English", () => {
    // The English copy is the one that leaked into the Arabic UI in
    // production. The Arabic copy must be Arabic script, not the fallback.
    const arabic = localizeError("QUOTA_UNAVAILABLE", "ar");
    expect(arabic).toBe("الحد اليومي غير متاح مؤقتاً. يرجى المحاولة بعد قليل.");
    expect(arabic).not.toBe(localizeError("QUOTA_UNAVAILABLE", "en"));
    // Arabic output must contain Arabic script and no Latin words.
    expect(arabic).toMatch(/[\u0600-\u06FF]/);
    expect(arabic).not.toMatch(/[A-Za-z]{3,}/);
    expect(localizeErrorTitle("QUOTA_UNAVAILABLE", "ar")).toBe("تعذّر إتمام الطلب");
  });

  it("substitutes the limit into the exhausted message for both languages", () => {
    expect(localizeError("QUOTA_EXCEEDED", "en", undefined, 10)).toContain("your 10 free requests");
    expect(localizeError("QUOTA_EXCEEDED", "ar", undefined, 10)).toContain("10 من طلباتك");
  });

  it("distinguishes a spent allowance from an unavailable one", () => {
    expect(localizeError("QUOTA_EXCEEDED", "ar", undefined, 10)).not.toBe(
      localizeError("QUOTA_UNAVAILABLE", "ar"),
    );
  });

  it("keeps an unknown provider message rather than hiding the reason", () => {
    const upstream = "upstream said no";
    expect(localizeError("SOMETHING_ELSE", "ar", upstream)).toBe(upstream);
  });

  it("falls back to a generic message when no fallback text exists", () => {
    expect(localizeError(undefined, "ar")).toBe("حدث خطأ غير متوقع.");
    expect(localizeError(undefined, "en")).toBe("An unexpected error occurred.");
  });

  it("translates every client and server error code in both languages", () => {
    const codes = [
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
    ] as const;
    for (const code of codes) {
      const arabicTitle = localizeErrorTitle(code, "ar");
      const arabicBody = localizeError(code, "ar", undefined, 10);
      const englishTitle = localizeErrorTitle(code, "en");
      const englishBody = localizeError(code, "en", undefined, 10);
      expect(arabicTitle.length).toBeGreaterThan(0);
      expect(arabicBody.length).toBeGreaterThan(0);
      // Arabic and English copy must actually differ, or the UI is not translating.
      expect(arabicTitle).not.toBe(englishTitle);
      expect(arabicBody).not.toBe(englishBody);
      // No unresolved placeholder may reach the user.
      expect(arabicBody).not.toContain("{count}");
      expect(englishBody).not.toContain("{count}");
    }
  });
});

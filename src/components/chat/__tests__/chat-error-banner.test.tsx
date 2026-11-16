import React from "react";
import { render, screen } from "@testing-library/react";

import { ChatErrorBanner } from "@/components/chat/chat-error-banner";
import { translations } from "@/lib/i18n/translations";
import { FREE_QUOTA_EXCEEDED_CODE } from "@/lib/ai/types";

const RESET_AT = "2026-01-02T00:00:00.000Z";

function renderBanner(props: Partial<React.ComponentProps<typeof ChatErrorBanner>> = {}) {
  return render(
    <ChatErrorBanner
      message="fallback text"
      onDismiss={() => {}}
      {...props}
    />,
  );
}

describe("ChatErrorBanner", () => {
  it("states when the spent allowance returns, in UTC", () => {
    renderBanner({
      code: FREE_QUOTA_EXCEEDED_CODE,
      limit: 10,
      resetAt: RESET_AT,
    });

    expect(screen.getByText(new RegExp(translations.en.freeQuotaResetAt))).toBeTruthy();
    // The server's counter rolls over at UTC midnight, so the label must say so.
    expect(screen.getByText(/UTC/)).toBeTruthy();
  });

  it("shows no reset time when the server sent none", () => {
    renderBanner({ code: FREE_QUOTA_EXCEEDED_CODE, limit: 10 });

    expect(screen.queryByText(/UTC/)).toBeNull();
  });

  it("never labels a provider failure with the quota's reset time", () => {
    renderBanner({ code: "PROVIDER_ERROR", resetAt: RESET_AT });

    expect(screen.queryByText(/UTC/)).toBeNull();
    expect(screen.queryByText(new RegExp(translations.en.freeQuotaResetAt))).toBeNull();
  });

  it("still shows the localized limit for the refusal", () => {
    renderBanner({ code: FREE_QUOTA_EXCEEDED_CODE, limit: 10, resetAt: RESET_AT });

    expect(screen.getByText(/10 free messages/)).toBeTruthy();
  });

  it("renders the localized retry and dismiss controls", () => {
    render(
      <ChatErrorBanner
        message="fallback text"
        code="PROVIDER_ERROR"
        onDismiss={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: translations.en.retryAction })).toBeTruthy();
    expect(screen.getByRole("button", { name: translations.en.dismissError })).toBeTruthy();
  });

  it("renders the reset line in Arabic when the locale is Arabic", async () => {
    window.localStorage.setItem("permamind-locale", "ar");

    renderBanner({ code: FREE_QUOTA_EXCEEDED_CODE, limit: 10, resetAt: RESET_AT });

    expect(await screen.findByText(new RegExp(translations.ar.freeQuotaResetAt))).toBeTruthy();
  });
});
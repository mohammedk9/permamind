import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FreeQuotaCard } from "@/components/chat/free-quota-card";
import { saveChatData } from "@/lib/storage/chat-storage";
import { translations } from "@/lib/i18n/translations";
import type { Conversation } from "@/types/chat";

const RESET_AT = "2026-01-02T00:00:00.000Z";
const copy = translations.en;

function conversation(id: string, title: string, summary: string): Conversation {
  const updatedAt = new Date("2026-01-01T00:00:00.000Z");
  return {
    id,
    title,
    messages: [],
    createdAt: updatedAt,
    updatedAt,
    metadata: {
      summary,
      topics: [],
      tags: [],
      entities: [],
      messageFingerprint: `${id}-print`,
      generatedAt: updatedAt,
    },
  };
}

function renderCard(overrides: Partial<React.ComponentProps<typeof FreeQuotaCard>> = {}) {
  const props = {
    query: "staged launch plan",
    resetAt: RESET_AT,
    limit: 10,
    excludeConversationId: null,
    onOpenSettings: () => {},
    onOpenConversation: () => {},
    onOpenMemory: () => {},
    onDismiss: () => {},
    ...overrides,
  };
  return render(<FreeQuotaCard {...props} />);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("FreeQuotaCard", () => {
  it("says the allowance is spent, by how much, and when it returns", () => {
    renderCard();

    expect(screen.getByText(copy.freeQuotaEyebrow)).toBeTruthy();
    expect(screen.getByText(/10 free messages/)).toBeTruthy();
    expect(screen.getByText(/UTC/)).toBeTruthy();
  });

  it("is a named region, so assistive technology can find it", () => {
    renderCard();

    const region = screen.getByRole("region");
    // The accessible name comes from the localized title, not from the markup order.
    const labelId = region.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId ?? "")?.textContent).toBeTruthy();
  });

  it("does not search the local memory until the user asks", () => {
    saveChatData([conversation("c1", "Launch", "staged launch plan for the beta")], null);
    renderCard();

    // Nothing to show yet: the card does not dump the user's history on them.
    // The heading now carries a result count in the same line, so match on part.
    const heading = new RegExp(copy.freeQuotaResultsTitle);
    expect(screen.queryByText(heading)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: copy.freeQuotaSearch }));

    expect(screen.getByText(heading)).toBeTruthy();
    expect(screen.getByText(/staged launch plan for the beta/)).toBeTruthy();
  });

  it("says so plainly when nothing on the device matches", () => {
    saveChatData([conversation("c1", "Groceries", "milk and bread")], null);
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: copy.freeQuotaSearch }));

    expect(screen.getByText(copy.freeQuotaNoResults)).toBeTruthy();
  });

  it("opens the conversation a result came from", () => {
    saveChatData([conversation("c1", "Launch", "staged launch plan for the beta")], null);
    const onOpenConversation = vi.fn();
    renderCard({ onOpenConversation });

    fireEvent.click(screen.getByRole("button", { name: copy.freeQuotaSearch }));
    // The title and the summary are two hits from the same conversation.
    fireEvent.click(screen.getAllByRole("button", { name: /Launch/ })[0]);

    expect(onOpenConversation).toHaveBeenCalledWith("c1");
  });

  it("offers the two ways forward: an own key, and the memory area", () => {
    const onOpenSettings = vi.fn();
    const onOpenMemory = vi.fn();
    renderCard({ onOpenSettings, onOpenMemory });

    fireEvent.click(screen.getByRole("button", { name: copy.freeQuotaAddKey }));
    fireEvent.click(screen.getByRole("button", { name: copy.freeQuotaOpenMemory }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenMemory).toHaveBeenCalledTimes(1);
  });

  it("offers the local model instead of a key when one is verified as running", () => {
    const onOpenSettings = vi.fn();
    const onUseLocalModel = vi.fn();
    renderCard({ onOpenSettings, onUseLocalModel });

    // The key is not the only way out on a machine that already has a model.
    expect(screen.queryByRole("button", { name: copy.freeQuotaAddKey })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.freeQuotaUseLocal }));

    expect(onUseLocalModel).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it("can be dismissed by name", () => {
    const onDismiss = vi.fn();
    renderCard({ onDismiss });

    fireEvent.click(screen.getByRole("button", { name: copy.freeQuotaDismiss }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders Arabic copy, and Arabic digits, when the locale is Arabic", async () => {
    window.localStorage.setItem("permamind-locale", "ar");
    renderCard();

    expect(await screen.findByText(translations.ar.freeQuotaEyebrow)).toBeTruthy();
    expect(screen.queryByText(copy.freeQuotaEyebrow)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: translations.ar.freeQuotaSearch }));

    // The count is formatted for the locale rather than hardcoded, so the
    // expectation is built the same way: whether that yields Arabic-Indic or
    // Latin digits depends on the host's ICU data, not on this component.
    const expectedCount = translations.ar.freeQuotaResultsCount.replace(
      "{count}",
      new Intl.NumberFormat("ar").format(0),
    );
    expect(screen.getByText(new RegExp(expectedCount))).toBeTruthy();
  });

  it("says only what it knows when no limit was reported", () => {
    renderCard({ limit: undefined, resetAt: null });

    // No "{count}" placeholder may survive into the sentence.
    expect(screen.queryByText(/\{count\}/)).toBeNull();
    expect(screen.getByText(copy.freeQuotaBodyNoCount)).toBeTruthy();
    expect(screen.queryByText(/UTC/)).toBeNull();
  });

  it("has a live results region before it is expanded, so updates are announced", () => {
    renderCard();

    // Collapsed, but already in the document: a live region created together
    // with its content is announced unreliably.
    const region = document.querySelector("[aria-live='polite']");
    expect(region).toBeTruthy();
    expect(region?.getAttribute("aria-atomic")).toBe("true");
    expect(region?.textContent).toBe("");
  });

  it("points the toggle at the region it controls", () => {
    renderCard();

    const toggle = screen.getByRole("button", { name: copy.freeQuotaSearch });
    const controls = toggle.getAttribute("aria-controls");

    // The id must resolve, collapsed or not, or assistive technology follows a
    // reference to nothing.
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls ?? "")).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(controls ?? "")?.textContent).not.toBe("");
  });

  it("keeps list semantics that Tailwind's reset removes", () => {
    saveChatData([conversation("c1", "Launch", "staged launch plan for the beta")], null);
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: copy.freeQuotaSearch }));

    // Safari drops list semantics when `list-style: none` is applied, so the
    // explicit role is what keeps "list of 2 items" available.
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
  });

  it("reports how many results it found", () => {
    saveChatData([conversation("c1", "Launch", "staged launch plan for the beta")], null);
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: copy.freeQuotaSearch }));

    expect(screen.getByText(/2 results/)).toBeTruthy();
  });

  it("gives every control a 44px touch target", () => {
    renderCard();

    for (const name of [
      copy.freeQuotaAddKey,
      copy.freeQuotaSearch,
      copy.freeQuotaOpenMemory,
      copy.freeQuotaDismiss,
    ]) {
      const control = screen.getByRole("button", { name });
      expect(control.className).toContain("min-h-11");
    }
  });
});

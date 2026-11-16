import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatMain } from "@/components/chat/chat-main";
import { saveChatData } from "@/lib/storage/chat-storage";
import { translations } from "@/lib/i18n/translations";
import type { AnalyticsSummary } from "@/types/analytics";
import type { Conversation } from "@/types/chat";

const copy = translations.en;
const RESET_AT = "2026-01-02T00:00:00.000Z";

const period = { period: "day", requests: 0, totalTokens: 0, estimatedCostUsd: 0 };

const analyticsSummary: AnalyticsSummary = {
  totalRequests: 0,
  chatRequests: 0,
  summaryRequests: 0,
  memoryRetrievalCount: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  today: period,
  thisMonth: period,
  byModel: [],
  topConversations: [],
  recentEvents: [],
  recentMemoryRetrievals: [],
};

function conversation(): Conversation {
  const updatedAt = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "c1",
    title: "Launch plan",
    messages: [
      {
        id: "m1",
        role: "user",
        content: "what did we decide about the launch",
        createdAt: updatedAt,
      },
    ],
    createdAt: updatedAt,
    updatedAt,
  };
}

function renderMain(overrides: Partial<React.ComponentProps<typeof ChatMain>> = {}) {
  const props = {
    conversation: conversation(),
    conversations: [conversation()],
    activeId: "c1",
    onSelect: () => {},
    onNewChat: () => {},
    onRename: () => {},
    onDelete: () => {},
    onSend: () => {},
    onQuickCommand: () => {},
    model: "openai/gpt-4o-mini",
    onModelChange: () => {},
    mode: "free" as const,
    isLoading: false,
    error: null,
    analyticsSummary,
    onClearAnalytics: () => {},
    onLinkedConversationsChange: () => {},
    onDismissError: () => {},
    ...overrides,
  };
  return render(<ChatMain {...props} />);
}

/**
 * Renders inside an async `act` so the scroll area's own state update is flushed
 * before the assertions run. Without it React logs a warning that has nothing to
 * do with what these tests check.
 */
async function renderMainSettled(overrides: Partial<React.ComponentProps<typeof ChatMain>> = {}) {
  await act(async () => {
    renderMain(overrides);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  saveChatData([conversation()], "c1");

  // jsdom does not implement matchMedia, and the chat shell uses it to decide
  // whether scrolling should animate. A stub is enough: nothing here asserts on
  // scroll behaviour.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  );

  // jsdom implements neither scrolling nor layout.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("ChatMain and a spent free allowance", () => {
  it("shows the quota card, not the error banner, when the server refuses", async () => {
    await renderMainSettled({
      error: {
        message: "spent",
        code: "free_quota_exceeded",
        limit: 10,
        used: 10,
        resetAt: RESET_AT,
      },
    });

    expect(screen.getByText(copy.freeQuotaEyebrow)).toBeTruthy();
    // The generic banner would say only "you hit a limit"; the card does more.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still shows the card after the error was dismissed or the page reloaded", async () => {
    await renderMainSettled({ error: null, quotaResetAt: RESET_AT, quotaLimit: 10, quotaQuery: "launch" });

    expect(screen.getByText(copy.freeQuotaEyebrow)).toBeTruthy();
    expect(screen.getByText(/10 free messages/)).toBeTruthy();
  });

  it("keeps a provider failure on the ordinary banner", async () => {
    await renderMainSettled({ error: { message: "upstream exploded", code: "PROVIDER_ERROR" } });

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText(copy.freeQuotaEyebrow)).toBeNull();
  });

  it("sends \"open memory\" to the memory area, not to a conversation", async () => {
    const onOpenMemory = vi.fn();
    const onOpenMemoryArea = vi.fn();
    await renderMainSettled({
      error: null,
      quotaResetAt: RESET_AT,
      quotaLimit: 10,
      onOpenMemory,
      onOpenMemoryArea,
    });

    fireEvent.click(screen.getByRole("button", { name: copy.freeQuotaOpenMemory }));

    expect(onOpenMemoryArea).toHaveBeenCalledTimes(1);
    expect(onOpenMemory).not.toHaveBeenCalled();
  });
});
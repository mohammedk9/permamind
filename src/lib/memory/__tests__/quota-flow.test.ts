/**
 * The contract between the three phases, exercised end to end without a browser.
 *
 * Each phase has its own tests, but they all agree on one object: the refusal the
 * server builds is the refusal the client stores, and the fields it stores are the
 * ones the card reads. That agreement is the thing worth pinning in one place —
 * rename `resetAt` on the wire and every unit test still passes while the card
 * silently loses its reset time.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { FREE_QUOTA_EXCEEDED_CODE } from "@/lib/ai/types";
import { buildQuotaErrorBody } from "@/lib/ai/quota-response";
import { formatQuotaResetLabel } from "@/lib/i18n/quota-reset";
import { addMemoryRecord } from "@/lib/memory/ledger";
import { searchMemoryOffline } from "@/lib/memory/search-offline";
import { saveChatData } from "@/lib/storage/chat-storage";
import {
  clearFreeQuotaState,
  readActiveFreeQuotaState,
  rememberFreeQuotaResetAt,
} from "@/lib/storage/quota-state";
import type { Conversation } from "@/types/chat";

/** A reset an hour from now, so the stored state is still active when read. */
const RESET_AT = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const LAST_MESSAGE = "what did we decide about the launch";

function conversation(): Conversation {
  const updatedAt = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "c1",
    title: "Launch plan",
    messages: [
      {
        id: "m1",
        role: "user",
        content: LAST_MESSAGE,
        createdAt: updatedAt,
      },
    ],
    createdAt: updatedAt,
    updatedAt,
    metadata: {
      summary: "We compared a staged launch with a single public release, and chose the staged one.",
      topics: ["launch"],
      tags: [],
      entities: [],
      messageFingerprint: "c1-print",
      generatedAt: updatedAt,
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  saveChatData([conversation()], "c1");
  addMemoryRecord({
    id: "d1",
    kind: "decision",
    text: "Launch on Tuesday — the private beta was ready",
    conversationId: "c1",
    conversationTitle: "Launch plan",
    confidence: "medium",
    pinned: false,
    status: "active",
    source: "user",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  vi.restoreAllMocks();
});

describe("spent allowance, from the wire to the card", () => {
  it("stores exactly the fields the server refused with", () => {
    const body = buildQuotaErrorBody({
      status: 429,
      error: "You have used your 10 free messages for today.",
      code: FREE_QUOTA_EXCEEDED_CODE,
      limit: 10,
      used: 10,
      resetAt: RESET_AT,
      retryAfterSeconds: 3600,
    });

    rememberFreeQuotaResetAt(body.resetAt!, { used: body.used, limit: body.limit });
    const stored = readActiveFreeQuotaState();

    expect(stored?.resetAt).toBe(body.resetAt);
    expect(stored?.used).toBe(body.used);
    expect(stored?.limit).toBe(body.limit);
  });

  it("keeps the count the server reported instead of assuming the limit", () => {
    const body = buildQuotaErrorBody({
      status: 429,
      error: "spent",
      code: FREE_QUOTA_EXCEEDED_CODE,
      limit: 10,
      used: 7,
      resetAt: RESET_AT,
    });

    rememberFreeQuotaResetAt(body.resetAt!, { used: body.used, limit: body.limit });

    expect(readActiveFreeQuotaState()?.used).toBe(7);
  });

  it("shows a UTC reset label built from the stored value", () => {
    const body = buildQuotaErrorBody({
      status: 429,
      error: "spent",
      code: FREE_QUOTA_EXCEEDED_CODE,
      limit: 10,
      used: 10,
      resetAt: RESET_AT,
    });
    rememberFreeQuotaResetAt(body.resetAt!, { used: body.used, limit: body.limit });

    const label = formatQuotaResetLabel(readActiveFreeQuotaState()?.resetAt, "en");

    expect(label).toContain("UTC");
    expect(label).toBeTruthy();
  });

  it("answers the failed question from local memory, with no network", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const hits = searchMemoryOffline(LAST_MESSAGE, { excludeConversationId: "c1" });

    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.type === "decision")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("forgets the refusal once it is dismissed", () => {
    rememberFreeQuotaResetAt(RESET_AT, { limit: 10 });
    clearFreeQuotaState();

    expect(readActiveFreeQuotaState()).toBeNull();
  });
});
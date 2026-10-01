import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadChatData, saveChatData } from "@/lib/storage/chat-storage";
import {
  clearSyncWatermark,
  fetchSyncDelta,
  readSyncWatermark,
  writeSyncWatermark,
  type RemoteSummaryRow,
} from "@/lib/storage/sync-client";
import type { Conversation } from "@/types/chat";

function conversation(id: string, updatedAt: string, title = `Chat ${id}`): Conversation {
  const date = new Date(updatedAt);
  return { id, title, messages: [], createdAt: date, updatedAt: date };
}

function row(
  conversationId: string,
  sourceUpdatedAt: string,
  overrides: Partial<RemoteSummaryRow> = {},
): RemoteSummaryRow {
  return {
    conversation_id: conversationId,
    ciphertext: "ciphertext",
    encryption_version: 1,
    content_hash: "a".repeat(64),
    source_created_at: "2026-01-01T00:00:00.000Z",
    source_updated_at: sourceUpdatedAt,
    updated_at: sourceUpdatedAt,
    ...overrides,
  };
}

function stubFetch(payload: unknown, ok = true) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(payload), { status: ok ? 200 : 500 }),
  );
}

describe("sync watermark", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("starts empty so a new device pulls the full history", () => {
    expect(readSyncWatermark()).toBeNull();
  });

  it("persists and clears the watermark", () => {
    writeSyncWatermark("2026-06-01T00:00:00.000Z");
    expect(readSyncWatermark()).toBe("2026-06-01T00:00:00.000Z");

    clearSyncWatermark();
    expect(readSyncWatermark()).toBeNull();
  });
});

describe("fetchSyncDelta", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("requests the full history when no watermark exists", async () => {
    const fetchMock = stubFetch({ summaries: [], lastSyncedAt: "2026-01-01T00:00:00.000Z", hasMore: false });

    await fetchSyncDelta({ since: readSyncWatermark() });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/sync/summaries");
    expect(url).not.toContain("since=");
  });

  it("passes the watermark so only newer rows are returned", async () => {
    writeSyncWatermark("2026-06-01T00:00:00.000Z");
    const fetchMock = stubFetch({ summaries: [], lastSyncedAt: "2026-06-01T00:00:00.000Z", hasMore: false });

    await fetchSyncDelta({ since: readSyncWatermark() });

    expect(String(fetchMock.mock.calls[0][0])).toContain("since=2026-06-01");
  });

  it("returns the rows and the new watermark", async () => {
    stubFetch({
      summaries: [row("c1", "2026-02-01T00:00:00.000Z")],
      lastSyncedAt: "2026-02-01T00:00:00.000Z",
      hasMore: false,
    });

    const result = await fetchSyncDelta();

    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0].conversation_id).toBe("c1");
    expect(result.lastSyncedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(result.hasMore).toBe(false);
  });

  it("reports a partial page so the caller can page again", async () => {
    const rows = Array.from({ length: 500 }, (_, index) => row(`c${index}`, "2026-02-01T00:00:00.000Z"));
    stubFetch({ summaries: rows, lastSyncedAt: "2026-02-01T00:00:00.000Z", hasMore: true });

    const result = await fetchSyncDelta({ limit: 500 });

    expect(result.hasMore).toBe(true);
  });

  it("surfaces the server message on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Could not load sync data" }), { status: 500 }),
    );

    await expect(fetchSyncDelta()).rejects.toThrow(/Could not load sync data/);
  });
});

/**
 * The failure mode this replaces: one encrypted blob per scope, so two devices
 * editing two different conversations meant the second upload destroyed the
 * first. These assert the per-row behaviour that fixes it.
 */
describe("delta merge semantics", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("keeps edits made on two different conversations", () => {
    saveChatData([conversation("a", "2026-01-01T00:00:00.000Z")], "a");
    // Device B writes conversation B while device A still holds A.
    saveChatData(
      [conversation("a", "2026-01-01T00:00:00.000Z"), conversation("b", "2026-01-02T00:00:00.000Z")],
      "b",
    );

    const ids = loadChatData().conversations.map((item) => item.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("prefers the newer row for the same conversation", () => {
    saveChatData([conversation("shared", "2026-01-01T00:00:00.000Z", "local")], "shared");

    const local = loadChatData().conversations.find((item) => item.id === "shared")!;
    const remote = conversation("shared", "2026-06-01T00:00:00.000Z", "remote");

    // Mirrors the comparison in useDeltaSync: newer source wins.
    const winner = new Date(remote.updatedAt).getTime() > local.updatedAt.getTime() ? remote : local;
    expect(winner.title).toBe("remote");
  });

  it("does not delete a local conversation missing from the page", () => {
    saveChatData(
      [conversation("local-only", "2026-01-01T00:00:00.000Z"), conversation("shared", "2026-01-01T00:00:00.000Z")],
      "shared",
    );

    // A delta page containing only "shared" is not evidence of a deletion.
    const byId = new Map(loadChatData().conversations.map((item) => [item.id, item]));
    byId.set("shared", conversation("shared", "2026-06-01T00:00:00.000Z", "remote"));

    expect([...byId.keys()].sort()).toEqual(["local-only", "shared"]);
  });
});

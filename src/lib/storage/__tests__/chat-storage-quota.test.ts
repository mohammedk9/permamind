import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadChatData, saveChatData } from "@/lib/storage/chat-storage";
import { STORAGE_FULL_EVENT, type StorageFullDetail } from "@/lib/storage/storage-health";
import type { Conversation, Project } from "@/types/chat";

function conversation(id: string, content = "hello"): Conversation {
  return {
    id,
    title: `Conversation ${id}`,
    messages: [{ id: `${id}-m1`, role: "user", content, createdAt: new Date() }],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function project(id: string): Project {
  return { id, name: `Project ${id}`, summary: "", goals: [], tasks: [], decisions: [], openQuestions: [], createdAt: new Date(), updatedAt: new Date() };
}

function failSetItem(error: unknown) {
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw error;
  });
}

describe("saveChatData result reporting", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("reports success and round-trips the data", () => {
    const result = saveChatData([conversation("a")], "a", [project("p")]);
    expect(result).toEqual({ ok: true });

    const loaded = loadChatData();
    expect(loaded.conversations).toHaveLength(1);
    expect(loaded.conversations[0].title).toBe("Conversation a");
    expect(loaded.projects).toHaveLength(1);
    expect(loaded.activeId).toBe("a");
  });

  it("reports a failure instead of throwing when the quota is full", () => {
    failSetItem(new DOMException("full", "QuotaExceededError"));

    const result = saveChatData([conversation("a")], "a");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.reason).toBe("quota");
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("does not throw out of saveChatData on a full quota", () => {
    failSetItem(new DOMException("full", "QuotaExceededError"));
    expect(() => saveChatData([conversation("a")], "a")).not.toThrow();
  });

  it("broadcasts a storage-full event carrying the lost payload size", () => {
    failSetItem(new DOMException("full", "QuotaExceededError"));
    const listener = vi.fn();
    window.addEventListener(STORAGE_FULL_EVENT, listener);

    const result = saveChatData([conversation("a", "x".repeat(50))], "a");

    expect(listener).toHaveBeenCalledOnce();
    const detail = (listener.mock.calls[0][0] as CustomEvent<StorageFullDetail>).detail;
    expect(detail.quota).toBe(true);
    // The reported size must cover the payload, not just its JSON string length.
    expect(detail.bytes).toBeGreaterThan(0);
    expect(result.ok).toBe(false);

    window.removeEventListener(STORAGE_FULL_EVENT, listener);
  });

  it("keeps previously stored data when a later write fails", () => {
    saveChatData([conversation("a", "original")], "a");
    failSetItem(new DOMException("full", "QuotaExceededError"));
    saveChatData([conversation("a", "replacement"), conversation("b")], "b");

    // The failed write must not corrupt what is already on disk.
    const loaded = loadChatData();
    expect(loaded.conversations).toHaveLength(1);
    expect(loaded.conversations[0].messages[0].content).toBe("original");
  });

  it("writes the payload exactly once per save", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    const conversations = [conversation("a"), conversation("b"), conversation("c")];

    saveChatData(conversations, "a");

    const writes = spy.mock.calls.filter(([key]) => key === "permamind:chat:v1");
    expect(writes).toHaveLength(1);
  });
});

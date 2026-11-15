import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createJsonStore } from "../json-store";
import { STORAGE_FULL_EVENT, type StorageFullDetail } from "../storage-health";

interface Doc { version: 1; items: string[] }

const KEY = "permamind:test:doc:v1";

function parse(value: unknown): Doc | null {
  if (!value || typeof value !== "object") return null;
  const doc = value as Partial<Doc>;
  return doc.version === 1 && Array.isArray(doc.items) ? { version: 1, items: doc.items } : null;
}

function makeStore() {
  return createJsonStore<Doc>({ key: KEY, fallback: { version: 1, items: [] }, parse });
}

describe("json store", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips a document through the synchronous facade", () => {
    const store = makeStore();

    expect(store.load()).toEqual({ version: 1, items: [] });
    expect(store.save({ version: 1, items: ["a"] })).toBe(true);
    expect(store.load().items).toEqual(["a"]);
    expect(JSON.parse(localStorage.getItem(KEY)!).items).toEqual(["a"]);
  });

  it("falls back when the stored payload fails validation", () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 2, items: ["stale"] }));

    expect(makeStore().load()).toEqual({ version: 1, items: [] });
  });

  it("hydrates without IndexedDB and reports the localStorage backend", async () => {
    const store = makeStore();

    await expect(store.hydrate()).resolves.toBeUndefined();
    expect(store.isHydrated()).toBe(true);
    expect(store.backend()).toBe("localstorage");
  });

  it("reports a failed write instead of throwing", () => {
    const store = makeStore();
    const listener = vi.fn();
    window.addEventListener(STORAGE_FULL_EVENT, listener);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    const result = store.save({ version: 1, items: ["lost"] });

    expect(result).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    const detail = (listener.mock.calls[0][0] as CustomEvent<StorageFullDetail>).detail;
    expect(detail.quota).toBe(true);

    window.removeEventListener(STORAGE_FULL_EVENT, listener);
  });
});
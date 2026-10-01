import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ESTIMATED_QUOTA_BYTES,
  STORAGE_CHANGED_EVENT,
  STORAGE_FULL_EVENT,
  formatBytes,
  measureLocalStorage,
  measureStorageBreakdown,
  persistOrAnnounce,
  watchLocalStorage,
  type LocalStorageUsage,
  type StorageFullDetail,
} from "@/lib/storage/storage-health";

/** Replaces localStorage.setItem with one that fails like a full origin. */
function withFailingSetItem(error: unknown) {
  const original = Storage.prototype.setItem;
  const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw error;
  });
  return {
    spy,
    restore: () => {
      spy.mockRestore();
      original.call(localStorage, "", "");
    },
  };
}

describe("local storage health", () => {
  beforeEach(() => {
    localStorage.clear();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("reports an empty origin as healthy", () => {
    const usage = measureLocalStorage();
    expect(usage.available).toBe(true);
    expect(usage.usedBytes).toBe(0);
    expect(usage.level).toBe("ok");
    expect(usage.quotaBytes).toBe(ESTIMATED_QUOTA_BYTES);
  });

  it("counts key and value bytes in UTF-16 code units", () => {
    localStorage.setItem("alpha", "abc");
    const usage = measureLocalStorage();
    // "alpha" (5) + "abc" (3) = 8 code units = 16 bytes.
    expect(usage.usedBytes).toBe(16);
  });

  it("escalates the level as the origin fills", () => {
    vi.spyOn(Storage.prototype, "length", "get").mockReturnValue(1);
    // 4.5 MB used of a 5 MB budget = 90%, which is the critical threshold.
    const used = Math.round(ESTIMATED_QUOTA_BYTES * 0.9);
    localStorage.setItem("blob", "x".repeat(Math.floor(used / 2)));

    const usage = measureLocalStorage();
    expect(usage.level).toBe("critical");
    expect(usage.ratio).toBeGreaterThanOrEqual(0.9);
  });

  it("caps the ratio at 1 so an over-full origin cannot overflow the meter", () => {
    // jsdom enforces a real ~5 MB quota, so the length and the value are stubbed
    // instead of writing a blob large enough to trip it.
    const large = "x".repeat(6 * 1024 * 1024);
    vi.spyOn(Storage.prototype, "length", "get").mockReturnValue(1);
    vi.spyOn(Storage.prototype, "key").mockReturnValue("blob");
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(large);

    const usage = measureLocalStorage();

    expect(usage.usedBytes).toBeGreaterThan(ESTIMATED_QUOTA_BYTES);
    expect(usage.ratio).toBe(1);
    expect(usage.level).toBe("critical");
  });

  it("marks storage unavailable instead of throwing when access is blocked", () => {
    const lengthSpy = vi.spyOn(Storage.prototype, "length", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const usage = measureLocalStorage();
    expect(usage.available).toBe(false);
    expect(usage.level).toBe("unavailable");
    lengthSpy.mockRestore();
  });

  it("returns true and announces the change on a successful write", () => {
    const changed = vi.fn();
    window.addEventListener(STORAGE_CHANGED_EVENT, changed);

    const written = persistOrAnnounce("permamind:test", "value");

    expect(written).toBe(true);
    expect(localStorage.getItem("permamind:test")).toBe("value");
    expect(changed).toHaveBeenCalledOnce();
    window.removeEventListener(STORAGE_CHANGED_EVENT, changed);
  });

  it("returns false and announces the failure when the quota is exhausted", () => {
    const quotaError = new DOMException("full", "QuotaExceededError");
    const failing = withFailingSetItem(quotaError);
    const full = vi.fn();
    window.addEventListener(STORAGE_FULL_EVENT, full);

    const written = persistOrAnnounce("permamind:test", "x".repeat(100));

    expect(written).toBe(false);
    expect(full).toHaveBeenCalledOnce();
    const detail = (full.mock.calls[0][0] as CustomEvent<StorageFullDetail>).detail;
    expect(detail.quota).toBe(true);
    expect(detail.bytes).toBe(200);

    window.removeEventListener(STORAGE_FULL_EVENT, full);
    failing.restore();
  });

  it("distinguishes an unavailable store from an exhausted quota", () => {
    const failing = withFailingSetItem(new DOMException("blocked", "SecurityError"));
    const full = vi.fn();
    window.addEventListener(STORAGE_FULL_EVENT, full);

    persistOrAnnounce("permamind:test", "value");

    const detail = (full.mock.calls[0][0] as CustomEvent<StorageFullDetail>).detail;
    expect(detail.quota).toBe(false);

    window.removeEventListener(STORAGE_FULL_EVENT, full);
    failing.restore();
  });

  it("streams usage to a subscriber and stops after unmount", () => {
    const onChanged = vi.fn();
    const unsubscribe = watchLocalStorage(onChanged);

    expect(onChanged).toHaveBeenCalledTimes(1);
    persistOrAnnounce("permamind:test", "value");
    expect(onChanged).toHaveBeenCalledTimes(2);

    unsubscribe();
    persistOrAnnounce("permamind:test", "other");
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it("delivers the failure detail only to the full subscriber", () => {
    const onChanged = vi.fn();
    const onFull = vi.fn();
    const unsubscribe = watchLocalStorage(onChanged, onFull);
    const failing = withFailingSetItem(new DOMException("full", "QuotaExceededError"));

    persistOrAnnounce("permamind:test", "value");

    expect(onFull).toHaveBeenCalledOnce();
    expect(onFull.mock.calls[0][0]).toMatchObject({ quota: true });

    unsubscribe();
    failing.restore();
  });

  it("formats byte counts for the meter label", () => {
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(512 * 1024)).toBe("512 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.00 MB");
    expect(formatBytes(Number.NaN)).toBe("0 MB");
    expect(formatBytes(-10)).toBe("0 MB");
  });
});

describe("measureLocalStorage shape", () => {
  it("always returns every field the UI depends on", () => {
    const usage: LocalStorageUsage = measureLocalStorage();
    expect(Object.keys(usage).sort()).toEqual(
      ["available", "level", "quotaBytes", "ratio", "usedBytes"].sort(),
    );
  });
});

/**
 * The breakdown exists to answer one question with data rather than a guess:
 * which store is large enough to justify migrating it to IndexedDB. If it
 * cannot name the store, the migration decision is unfounded.
 */
describe("measureStorageBreakdown", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("attributes each PermaMind store to a named role", () => {
    localStorage.setItem("permamind:chat:v1", "x".repeat(100));
    localStorage.setItem("permamind:memory-ledger:v1", "y".repeat(50));
    localStorage.setItem("permamind:memory-embeddings:v1", "z".repeat(20));

    const breakdown = measureStorageBreakdown();
    const roles = breakdown.entries.map((entry) => entry.role).sort();

    expect(roles).toEqual(["conversations", "embeddings", "memory"]);
  });

  it("keeps a total that matches the overall measurement", () => {
    localStorage.setItem("permamind:chat:v1", "x".repeat(100));
    localStorage.setItem("permamind:analytics:v1", "y".repeat(30));

    const usage = measureLocalStorage();
    const breakdown = measureStorageBreakdown();

    expect(breakdown.usedBytes).toBe(usage.usedBytes);
  });

  it("sorts the largest store first so the culprit is visible", () => {
    localStorage.setItem("permamind:analytics:v1", "y".repeat(10));
    localStorage.setItem("permamind:chat:v1", "x".repeat(500));

    const breakdown = measureStorageBreakdown();

    expect(breakdown.entries[0].role).toBe("conversations");
    expect(breakdown.entries[0].bytes).toBeGreaterThan(breakdown.entries[1].bytes);
  });

  it("labels an unknown key as other rather than dropping it", () => {
    localStorage.setItem("someone-elses-key", "value");

    const breakdown = measureStorageBreakdown();

    expect(breakdown.entries.map((entry) => entry.role)).toContain("other");
  });

  it("returns the same shape when storage is unavailable", () => {
    const lengthSpy = vi.spyOn(Storage.prototype, "length", "get").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    const breakdown = measureStorageBreakdown();

    expect(breakdown.entries).toEqual([]);
    expect(breakdown.level).toBe("unavailable");
    lengthSpy.mockRestore();
  });
});

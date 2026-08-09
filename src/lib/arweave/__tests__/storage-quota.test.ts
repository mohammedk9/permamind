import { beforeEach, describe, expect, it } from "vitest";
import {
  addPurchasedQuota,
  canUpload,
  defaultStorageAccount,
  getStorageUsage,
  loadStorageAccount,
  recordSuccessfulUpload,
} from "../storage-quota";

describe("storage quota", () => {
  beforeEach(() => localStorage.clear());

  it("calculates remaining storage and percentage", () => {
    const usage = getStorageUsage({ ...defaultStorageAccount(), usedBytes: 5 * 1024 * 1024 });
    expect(usage.remainingBytes).toBe(10 * 1024 * 1024);
    expect(usage.percentageUsed).toBeCloseTo(33.333333, 5);
  });

  it("blocks at quota and allows uploads below it", () => {
    const account = { ...defaultStorageAccount(), usedBytes: defaultStorageAccount().freeQuotaBytes - 10 };
    expect(canUpload(11, account)).toBe(false);
    expect(canUpload(10, account)).toBe(true);
  });

  it("includes purchased quota in the effective limit", () => {
    const usage = addPurchasedQuota(10 * 1024 * 1024);
    expect(usage.effectiveQuotaBytes).toBe(25 * 1024 * 1024);
    expect(canUpload(20 * 1024 * 1024)).toBe(true);
    expect(canUpload(25 * 1024 * 1024 + 1)).toBe(false);
  });

  it("migrates stale accounts to the current 15 MB free quota", () => {
    localStorage.setItem("permamind:storage:account:v1", JSON.stringify({
      freeQuotaBytes: 25 * 1024 * 1024,
      purchasedQuotaBytes: 10 * 1024 * 1024,
      usedBytes: 0,
    }));

    const usage = getStorageUsage();
    expect(usage.freeQuotaBytes).toBe(15 * 1024 * 1024);
    expect(usage.effectiveQuotaBytes).toBe(25 * 1024 * 1024);
  });

  it("persists and accounts only successful uploads", () => {
    expect(loadStorageAccount().usedBytes).toBe(0);
    recordSuccessfulUpload({ uploadedBytes: 123, uploadedAt: new Date().toISOString(), arweavePrice: "7", txId: "tx" });
    expect(loadStorageAccount().usedBytes).toBe(123);
    expect(JSON.parse(localStorage.getItem("permamind:storage:uploads:v1") ?? "[]")[0].txId).toBe("tx");
  });
});
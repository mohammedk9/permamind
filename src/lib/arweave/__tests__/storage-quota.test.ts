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
    expect(usage.remainingBytes).toBe(20 * 1024 * 1024);
    expect(usage.percentageUsed).toBe(20);
  });

  it("blocks at quota and allows uploads below it", () => {
    const account = { ...defaultStorageAccount(), usedBytes: defaultStorageAccount().freeQuotaBytes - 10 };
    expect(canUpload(11, account)).toBe(false);
    expect(canUpload(10, account)).toBe(true);
  });

  it("includes purchased quota in the effective limit", () => {
    const usage = addPurchasedQuota(10 * 1024 * 1024);
    expect(usage.effectiveQuotaBytes).toBe(35 * 1024 * 1024);
    expect(canUpload(30 * 1024 * 1024)).toBe(true);
  });

  it("persists and accounts only successful uploads", () => {
    expect(loadStorageAccount().usedBytes).toBe(0);
    recordSuccessfulUpload({ uploadedBytes: 123, uploadedAt: new Date().toISOString(), arweavePrice: "7", txId: "tx" });
    expect(loadStorageAccount().usedBytes).toBe(123);
    expect(JSON.parse(localStorage.getItem("permamind:storage:uploads:v1") ?? "[]")[0].txId).toBe("tx");
  });
});
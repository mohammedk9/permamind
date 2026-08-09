import { DEFAULT_FREE_STORAGE_QUOTA_BYTES, STORAGE_ACCOUNT_KEY } from "./constants";

export interface StorageAccount {
  freeQuotaBytes: number;
  purchasedQuotaBytes: number;
  usedBytes: number;
}

export interface StorageUsage extends StorageAccount {
  effectiveQuotaBytes: number;
  remainingBytes: number;
  usedMb: number;
  remainingMb: number;
  percentageUsed: number;
}

export interface UploadCostRecord {
  uploadedBytes: number;
  uploadedAt: string;
  arweavePrice: string | null;
  txId: string;
}

const COSTS_KEY = "permamind:storage:uploads:v1";

export function defaultStorageAccount(): StorageAccount {
  return { freeQuotaBytes: DEFAULT_FREE_STORAGE_QUOTA_BYTES, purchasedQuotaBytes: 0, usedBytes: 0 };
}

export function loadStorageAccount(): StorageAccount {
  if (typeof window === "undefined") return defaultStorageAccount();
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_ACCOUNT_KEY) ?? "null") as Partial<StorageAccount> | null;
    if (!parsed) return defaultStorageAccount();
    // The free allowance is a product limit, not user-editable state. Always
    // use the current default so accounts created with the old 25 MB limit are
    // migrated to 15 MB instead of keeping the stale localStorage value.
    return { ...defaultStorageAccount(), ...parsed, freeQuotaBytes: DEFAULT_FREE_STORAGE_QUOTA_BYTES };
  } catch { return defaultStorageAccount(); }
}

function save(account: StorageAccount): void {
  if (typeof window !== "undefined") localStorage.setItem(STORAGE_ACCOUNT_KEY, JSON.stringify(account));
}

export function getStorageUsage(account = loadStorageAccount()): StorageUsage {
  const effectiveQuotaBytes = account.freeQuotaBytes + account.purchasedQuotaBytes;
  const remainingBytes = Math.max(0, effectiveQuotaBytes - account.usedBytes);
  return { ...account, effectiveQuotaBytes, remainingBytes, usedMb: account.usedBytes / 1024 / 1024, remainingMb: remainingBytes / 1024 / 1024, percentageUsed: effectiveQuotaBytes ? Math.min(100, account.usedBytes / effectiveQuotaBytes * 100) : 100 };
}

export function canUpload(bytes: number, account = loadStorageAccount()): boolean {
  return bytes <= getStorageUsage(account).remainingBytes;
}

export function recordSuccessfulUpload(record: UploadCostRecord): StorageUsage {
  const account = loadStorageAccount();
  account.usedBytes += record.uploadedBytes;
  save(account);
  if (typeof window !== "undefined") {
    const previous = JSON.parse(localStorage.getItem(COSTS_KEY) ?? "[]") as UploadCostRecord[];
    localStorage.setItem(COSTS_KEY, JSON.stringify([...previous, record]));
  }
  return getStorageUsage(account);
}

export function addPurchasedQuota(bytes: number): StorageUsage {
  const account = loadStorageAccount(); account.purchasedQuotaBytes += bytes; save(account); return getStorageUsage(account);
}

export function setPurchasedQuota(bytes: number): StorageUsage {
  const account = loadStorageAccount();
  account.purchasedQuotaBytes = Math.max(0, Math.floor(bytes));
  save(account);
  return getStorageUsage(account);
}
import {
  FREE_STORAGE_QUOTA_BYTES,
  FREE_UPLOADS_PER_HOUR,
  MAX_UPLOAD_SIZE_BYTES,
  PRO_UPLOADS_PER_HOUR,
  UPLOAD_RATE_WINDOW_MS,
} from "./constants";

type UploadRecord = { at: number };
type Usage = { usedBytes: number; uploads: UploadRecord[] };

const usageByUser = new Map<string, Usage>();

function usageFor(userId: string): Usage {
  const existing = usageByUser.get(userId);
  if (existing) return existing;
  const created = { usedBytes: 0, uploads: [] };
  usageByUser.set(userId, created);
  return created;
}

export function uploadLimitFor(pro: boolean): number {
  return (pro ? PRO_UPLOADS_PER_HOUR : FREE_UPLOADS_PER_HOUR);
}

export function checkUploadRate(userId: string, pro: boolean, now = Date.now()):
  | { ok: true }
  | { ok: false; retryAfter: number } {
  const usage = usageFor(userId);
  usage.uploads = usage.uploads.filter(({ at }) => now - at < UPLOAD_RATE_WINDOW_MS);
  if (usage.uploads.length < uploadLimitFor(pro)) return { ok: true };
  const oldest = usage.uploads[0]?.at ?? now;
  return { ok: false, retryAfter: Math.max(1, Math.ceil((oldest + UPLOAD_RATE_WINDOW_MS - now) / 1000)) };
}

export function checkStorage(userId: string, bytes: number):
  | { ok: true; remainingBytes: number }
  | { ok: false; remainingMb: number } {
  const remainingBytes = Math.max(0, FREE_STORAGE_QUOTA_BYTES - usageFor(userId).usedBytes);
  if (bytes <= remainingBytes) return { ok: true, remainingBytes: remainingBytes - bytes };
  return { ok: false, remainingMb: Math.floor(remainingBytes / 1024 / 1024) };
}

export function recordUpload(userId: string, bytes: number, now = Date.now()): void {
  const usage = usageFor(userId);
  usage.usedBytes += bytes;
  usage.uploads.push({ at: now });
}

export function resetUploadProtection(): void { usageByUser.clear(); }

export { MAX_UPLOAD_SIZE_BYTES };
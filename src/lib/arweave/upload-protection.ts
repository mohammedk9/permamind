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

/**
 * Reads a request body while enforcing a byte ceiling.
 *
 * Lives here rather than in the route file because Next.js validates every
 * route module and rejects any export that is not a route handler. Exporting
 * this helper from the route made `next build` fail with "Property
 * 'readBodyWithLimit' is incompatible with index signature", which meant the
 * production build could not be produced at all.
 *
 * Returning null as soon as the ceiling is passed is the point: the stream is
 * cancelled rather than buffered, so an oversized upload cannot be used to
 * exhaust memory before the size check runs.
 */
export async function readBodyWithLimit(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > limit) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

export { MAX_UPLOAD_SIZE_BYTES };
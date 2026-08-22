/**
 * Minimal fixed-window, in-memory rate limiter for AI proxy routes.
 *
 * Scope: per server instance. It is a lightweight guard against abuse
 * (runaway loops, scripted hammering) rather than a hard quota; durable
 * per-user quotas live in Supabase (see reserve_search_request).
 *
 * Windows are per (identifier + window length), so a client can have both a
 * per-minute burst limit and a per-day allowance tracked independently.
 */
const DEFAULT_WINDOW_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 10_000;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function prune(now: number): void {
  if (buckets.size < MAX_TRACKED_CLIENTS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(
  identifier: string,
  limitPerWindow: number,
  windowMs: number = DEFAULT_WINDOW_MS
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  prune(now);
  const key = `${identifier}:${windowMs}`;
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limitPerWindow) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Stable, non-reversible identifier from request IP and optional key. */
export function rateLimitIdentifier(ip: string | null, secretSuffix: string): string {
  return `${ip ?? "unknown"}:${secretSuffix.slice(-8)}`;
}

export const RATE_LIMIT_DAY_MS = DAY_MS;


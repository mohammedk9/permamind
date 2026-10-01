/**
 * Local browser storage health.
 *
 * PermaMind is local-first: conversations, the memory ledger, and the
 * encrypted embedding index all live in this origin's localStorage. That is a
 * deliberate choice, but localStorage is small (5 MB in Chromium, 10 MB in
 * Firefox) and the browser reports exhaustion only by throwing
 * `QuotaExceededError` from `setItem`. Before this module existed, a full quota
 * meant a write was discarded with no signal anywhere: the user kept chatting,
 * saw a successful reply, and lost the conversation on the next refresh.
 *
 * This module measures what is actually stored and broadcasts the failure so
 * the UI can warn before it is too late. It deliberately does NOT attempt to
 * move data to IndexedDB; that is a separate migration with its own async API.
 */

/**
 * Conservative per-origin budget. Chromium (and therefore most Chrome-based
 * browsers and every iOS browser) allows 5 MB, so that value is used even when
 * the browser would technically allow more. Under-reporting makes the meter
 * warn earlier, which is the safe direction for a warning.
 */
export const ESTIMATED_QUOTA_BYTES = 5 * 1024 * 1024;

/** Ratio at which the meter starts reporting a warning. */
export const STORAGE_WARN_RATIO = 0.75;
/** Ratio at which writing is expected to fail imminently. */
export const STORAGE_CRITICAL_RATIO = 0.9;

export type StorageLevel = "ok" | "warn" | "critical" | "unavailable";

/**
 * Which localStorage keys belong to PermaMind, and what each one holds.
 *
 * Used by the diagnostic breakdown. The keys are listed explicitly rather than
 * guessed so a new store cannot silently go unmeasured.
 */
const KEY_ROLES: ReadonlyArray<{ pattern: RegExp; role: string }> = [
  { pattern: /^permamind:chat:v1$/, role: "conversations" },
  { pattern: /^permamind:memory-ledger:v1$/, role: "memory" },
  { pattern: /^permamind:memory-embeddings:v1$/, role: "embeddings" },
  { pattern: /^permamind:memory-graph:v1$/, role: "graph" },
  { pattern: /^permamind:snapshots:meta:v1$/, role: "snapshots" },
  { pattern: /^permamind:upload:queue:v1$/, role: "uploadQueue" },
  { pattern: /^permamind:analytics:v1$/, role: "analytics" },
  { pattern: /^permamind:storage:account:v1$/, role: "storageAccount" },
  { pattern: /^permamind:snapshots:dedup:v1$/, role: "dedup" },
];

export interface StorageBreakdownEntry {
  key: string;
  role: string;
  bytes: number;
}

export interface StorageBreakdown {
  usedBytes: number;
  quotaBytes: number;
  ratio: number;
  level: StorageLevel;
  entries: StorageBreakdownEntry[];
}

/**
 * Attribute the origin's usage to individual PermaMind stores.
 *
 * This answers the question that actually decides whether an IndexedDB
 * migration is worth the churn: which store is large. Without it the answer is
 * a guess, and a wrong guess means rewriting 70+ call sites for no benefit.
 */
export function measureStorageBreakdown(): StorageBreakdown {
  const usage = measureLocalStorage();
  const entries: StorageBreakdownEntry[] = [];

  if (typeof window !== "undefined" && usage.available) {
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key === null) continue;
        const value = localStorage.getItem(key) ?? "";
        const bytes = (key.length + value.length) * 2;
        const role = KEY_ROLES.find((entry) => entry.pattern.test(key))?.role ?? "other";
        entries.push({ key, role, bytes });
      }
    } catch {
      return { ...usage, entries: [] };
    }
  }

  entries.sort((left, right) => right.bytes - left.bytes);
  return { ...usage, entries };
}

export interface LocalStorageUsage {
  /** Bytes this origin occupies, counting key and value in UTF-16 code units. */
  usedBytes: number;
  /** The estimated ceiling. Callers must treat this as an estimate. */
  quotaBytes: number;
  /** 0-1. Capped at 1 so callers never render an over-full bar. */
  ratio: number;
  level: StorageLevel;
  /** False when localStorage throws on access (private mode, blocked storage). */
  available: boolean;
}

/** Fired when a write fails because the origin is out of space. */
export const STORAGE_FULL_EVENT = "permamind:storage-full";
/** Fired after any successful or failed write, with fresh usage. */
export const STORAGE_CHANGED_EVENT = "permamind:storage-changed";

export interface StorageFullDetail {
  /** Size of the payload that could not be written. */
  bytes: number;
  /** True when the browser reported an exhausted quota. */
  quota: boolean;
}

/**
 * Payload of `STORAGE_CHANGED_EVENT`.
 *
 * A distinct alias rather than `interface ... extends LocalStorageUsage {}`:
 * the empty interface is equivalent to its supertype, which the linter rejects,
 * and a type alias documents that the event simply carries the usage snapshot.
 */
export type StorageChangedDetail = LocalStorageUsage;

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    // jsdom and older browsers may surface a plain Error carrying a code.
    const candidate = error as { name?: string; code?: number } | null;
    return candidate?.name === "QuotaExceededError" || candidate?.code === 22;
  }
  return error.name === "QuotaExceededError" || error.code === 22;
}

function levelFor(ratio: number): StorageLevel {
  if (ratio >= STORAGE_CRITICAL_RATIO) return "critical";
  if (ratio >= STORAGE_WARN_RATIO) return "warn";
  return "ok";
}

/**
 * Total bytes used by this origin.
 *
 * `localStorage.length` and indexed reads are the only way to enumerate keys,
 * and both are synchronous. This runs on writes (already behind a debounce) and
 * on an explicit meter refresh, never inside a render loop.
 */
export function measureLocalStorage(): LocalStorageUsage {
  if (typeof window === "undefined") {
    return { usedBytes: 0, quotaBytes: ESTIMATED_QUOTA_BYTES, ratio: 0, level: "ok", available: false };
  }

  try {
    let usedBytes = 0;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === null) continue;
      const value = localStorage.getItem(key) ?? "";
      // Strings occupy two bytes per code unit in the browser's implementation.
      usedBytes += (key.length + value.length) * 2;
    }

    const ratio = Math.min(1, usedBytes / ESTIMATED_QUOTA_BYTES);
    return { usedBytes, quotaBytes: ESTIMATED_QUOTA_BYTES, ratio, level: levelFor(ratio), available: true };
  } catch {
    // Access itself can throw when storage is disabled entirely.
    return { usedBytes: 0, quotaBytes: ESTIMATED_QUOTA_BYTES, ratio: 0, level: "unavailable", available: false };
  }
}

/**
 * Single place that decides whether a failed localStorage write was an
 * exhausted quota or an unavailable store, and announces it.
 *
 * Returns true when the write actually landed. Callers use the return value so
 * they never report a save that did not happen.
 */
export function persistOrAnnounce(key: string, serialized: string): boolean {
  if (typeof window === "undefined") return false;

  try {
    localStorage.setItem(key, serialized);
    announceChange();
    return true;
  } catch (error) {
    const detail: StorageFullDetail = { bytes: serialized.length * 2, quota: isQuotaError(error) };
    window.dispatchEvent(new CustomEvent<StorageFullDetail>(STORAGE_FULL_EVENT, { detail }));
    // Re-measure so a listener that only reads usage sees the real number.
    announceChange();
    return false;
  }
}

export function announceStorageFull(detail: StorageFullDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StorageFullDetail>(STORAGE_FULL_EVENT, { detail }));
}

function announceChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<StorageChangedDetail>(STORAGE_CHANGED_EVENT, { detail: measureLocalStorage() }));
}

/**
 * Subscribes to both storage events. `onFull` fires only when a write actually
 * failed, so a listener can present an export prompt without polling.
 */
export function watchLocalStorage(
  onChanged: (usage: LocalStorageUsage) => void,
  onFull?: (detail: StorageFullDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const changed = (event: Event) => {
    onChanged((event as CustomEvent<StorageChangedDetail>).detail);
  };
  const full = (event: Event) => {
    onFull?.((event as CustomEvent<StorageFullDetail>).detail);
  };

  window.addEventListener(STORAGE_CHANGED_EVENT, changed);
  window.addEventListener(STORAGE_FULL_EVENT, full);
  onChanged(measureLocalStorage());

  return () => {
    window.removeEventListener(STORAGE_CHANGED_EVENT, changed);
    window.removeEventListener(STORAGE_FULL_EVENT, full);
  };
}

/** Human-readable byte size for the meter label. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const megabytes = bytes / (1024 * 1024);
  if (megabytes < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${megabytes.toFixed(2)} MB`;
}

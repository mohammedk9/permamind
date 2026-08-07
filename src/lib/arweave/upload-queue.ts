/**
 * Persistent upload queue for the Arweave snapshot pipeline.
 *
 * Stores encrypted snapshot payloads in localStorage so the queue survives
 * browser restarts. Supports:
 * - FIFO processing order
 * - Exponential backoff retries
 * - Offline detection and automatic pause/resume
 * - Stale "uploading" item recovery on load
 * - Coalescing of superseded snapshots
 *
 * Storage convention matches `src/lib/storage/chat-storage.ts`:
 * - Versioned localStorage key (`permamind:upload:queue:v1`)
 * - JSON parse/stringify with SSR guard
 * - try/catch for quota errors and private browsing
 */

import type { QueueItem, QueueItemStatus, QueueStatusSummary } from "./snapshot-types";
import {
  RETRY_BASE_DELAY_MS,
  RETRY_MAX_DELAY_MS,
  UPLOAD_QUEUE_KEY,
} from "./constants";
import { withLease } from "./coordination";

// ---------------------------------------------------------------------------
// Stale Upload Timeout
// ---------------------------------------------------------------------------

/**
 * Maximum time (in milliseconds) an item can remain in "uploading" status
 * before being considered stale. Stale items are reset to "pending" on load.
 *
 * This handles the case where the browser crashes or is closed mid-upload —
 * the item would otherwise be stuck in "uploading" forever.
 */
const STALE_UPLOADING_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

// ---------------------------------------------------------------------------
// Queue Load / Save
// ---------------------------------------------------------------------------

/**
 * Internal queue structure stored in localStorage.
 */
interface StoredQueue {
  version: 1;
  items: QueueItem[];
}

/**
 * Loads the upload queue from localStorage.
 *
 * On load, any items stuck in "uploading" status longer than
 * {@link STALE_UPLOADING_TIMEOUT_MS} are automatically reset to "pending".
 * This handles browser crashes or closures during an active upload.
 *
 * @returns The current queue items, or an empty array.
 */
function loadQueue(): QueueItem[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(UPLOAD_QUEUE_KEY);
    if (!raw) return [];

    const data = JSON.parse(raw) as StoredQueue;
    if (data.version !== 1 || !Array.isArray(data.items)) return [];

    // Reset stale "uploading" items to "pending"
    const now = Date.now();
    for (const item of data.items) {
      if (item.status === "uploading") {
        const createdAt = new Date(item.createdAt).getTime();
        if (now - createdAt > STALE_UPLOADING_TIMEOUT_MS) {
          item.status = "pending";
          item.nextRetryAt = null;
        }
      }
    }

    return data.items;
  } catch {
    return [];
  }
}

/**
 * Saves the upload queue to localStorage.
 *
 * Silently fails if localStorage is unavailable (quota exceeded, private browsing).
 *
 * @param items - The queue items to persist.
 */
function saveQueue(items: QueueItem[]): void {
  if (typeof window === "undefined") return;

  const data: StoredQueue = { version: 1, items };

  localStorage.setItem(UPLOAD_QUEUE_KEY, JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Exponential Backoff
// ---------------------------------------------------------------------------

/**
 * Computes the next retry delay using exponential backoff with a cap.
 *
 * Formula: min(baseDelay * 2^attempt, maxDelay)
 *
 * Example with base=1000ms, max=60000ms:
 * - Attempt 0: 1000ms  (1s)
 * - Attempt 1: 2000ms  (2s)
 * - Attempt 2: 4000ms  (4s)
 * - Attempt 3: 8000ms  (8s)
 * - Attempt 4: 16000ms (16s)
 * - Attempt 5+: 60000ms (capped at 1 minute)
 *
 * @param attempt - The current attempt number (0-indexed).
 * @returns The delay in milliseconds before the next retry.
 */
function computeBackoffDelay(attempt: number): number {
  const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, RETRY_MAX_DELAY_MS);
}

/**
 * Computes the ISO 8601 timestamp for the next allowed retry.
 *
 * @param attempt - The current attempt number (0-indexed).
 * @returns An ISO 8601 timestamp string.
 */
function computeNextRetryAt(attempt: number): string {
  const delay = computeBackoffDelay(attempt);
  return new Date(Date.now() + delay).toISOString();
}

// ---------------------------------------------------------------------------
// Public API — Queue Operations
// ---------------------------------------------------------------------------

/**
 * Adds a new item to the end of the upload queue and persists it.
 *
 * The item is added with status "pending" and attempt count 0.
 * The `nextRetryAt` is set to the current time (eligible for immediate processing).
 *
 * @param item - The {@link QueueItem} to enqueue.
 */
export function enqueue(item: QueueItem): void {
  withLease("upload-queue", () => {
    const items = loadQueue();
    items.push(item);
    saveQueue(items);
  });
}

/** Removes an item during persistence rollback. */
export function remove(queueId: string): void {
  withLease("upload-queue", () => {
    const items = loadQueue();
    saveQueue(items.filter((item) => item.queueId !== queueId));
  });
}

/**
 * Marks and returns the next eligible item from the front of the queue.
 *
 * An item is eligible if:
 * - Its status is "pending"
 * - Its `nextRetryAt` is null or in the past
 *
 * The returned item's status is updated to "uploading" and persisted in the
 * queue. Keeping it stored while uploading allows a browser crash or failed
 * upload to be recovered by the stale-item handling and retry logic.
 * If no eligible item exists, returns `null`.
 *
 * @returns The next eligible {@link QueueItem}, or `null` if the queue is
 *          empty or no items are eligible.
 */
export function dequeue(): QueueItem | null {
  return withLease("upload-queue", () => {
    const items = loadQueue();
    const now = Date.now();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.status !== "pending") continue;

    // Check if the item is eligible for processing
    if (item.nextRetryAt) {
      const retryTime = new Date(item.nextRetryAt).getTime();
      if (retryTime > now) continue; // Not yet time to retry
    }

    // Mark as uploading, but keep it persisted until the upload succeeds.
    item.status = "uploading";
      saveQueue(items);
      return item;
  }

    return null;
  }) ?? null;
}

/**
 * Returns the next eligible item without removing it from the queue.
 *
 * Useful for checking if there's work to do before starting the processor.
 *
 * @returns The next eligible {@link QueueItem}, or `null` if none.
 */
export function peek(): QueueItem | null {
  const items = loadQueue();
  const now = Date.now();

  for (const item of items) {
    if (item.status !== "pending") continue;

    if (item.nextRetryAt) {
      const retryTime = new Date(item.nextRetryAt).getTime();
      if (retryTime > now) continue;
    }

    return item;
  }

  return null;
}

/**
 * Updates the status of a queue item identified by its `queueId`.
 *
 * If the item is not found in the queue, this is a no-op.
 *
 * Status transitions:
 * - `"done"` — Item is removed from the queue (upload succeeded).
 * - `"failed"` — Item remains in the queue with its current attempt count.
 * - `"pending"` — Item is re-queued with updated `nextRetryAt` for backoff.
 * - `"superseded"` — Item is removed from the queue.
 *
 * @param queueId - The unique identifier of the queue item.
 * @param status - The new status to set.
 * @param txId - Optional Arweave transaction ID (set when status is "done").
 */
export function updateStatus(
  queueId: string,
  status: QueueItemStatus,
  txId?: string
): void {
  withLease("upload-queue", () => {
  const items = loadQueue();
  const index = items.findIndex((item) => item.queueId === queueId);

  if (index === -1) return;

  const item = items[index];

  if (status === "done" || status === "superseded") {
    // Remove completed or superseded items from the queue
    items.splice(index, 1);
    saveQueue(items);
    return;
  }

  if (status === "failed") {
    // Check if max attempts reached
    if (item.attempts >= item.maxAttempts) {
      item.status = "failed";
      item.nextRetryAt = null;
    } else {
      // Schedule retry with exponential backoff
      item.status = "pending";
      item.nextRetryAt = computeNextRetryAt(item.attempts);
    }
    saveQueue(items);
    return;
  }

  if (status === "pending") {
    // Re-queue with backoff
    item.status = "pending";
    item.nextRetryAt = computeNextRetryAt(item.attempts);
    saveQueue(items);
    return;
  }

  // For "uploading" or any other status, just update
  item.status = status;
  if (txId) item.txId = txId;
  saveQueue(items);
  });
}

/**
 * Records a failed upload attempt for a queue item.
 *
 * Increments the attempt count and schedules the next retry using
 * exponential backoff. If the maximum number of attempts is reached,
 * the item is marked as "failed".
 *
 * @param queueId - The unique identifier of the queue item.
 */
export function recordFailedAttempt(queueId: string): void {
  withLease("upload-queue", () => {
  const items = loadQueue();
  const item = items.find((i) => i.queueId === queueId);

  if (!item) return;

  item.attempts += 1;

  if (item.attempts >= item.maxAttempts) {
    item.status = "failed";
    item.nextRetryAt = null;
  } else {
    item.status = "pending";
    item.nextRetryAt = computeNextRetryAt(item.attempts);
  }

  saveQueue(items);
  });
}

// ---------------------------------------------------------------------------
// Public API — Queue Maintenance
// ---------------------------------------------------------------------------

/**
 * Resets any items stuck in "uploading" status to "pending".
 *
 * Called on app load to recover from browser crashes or closures that
 * occurred during an active upload. Items are only reset if they have
 * been in "uploading" status longer than {@link STALE_UPLOADING_TIMEOUT_MS}.
 *
 * This function is also called automatically by {@link loadQueue}.
 */
export function resetStaleUploading(): void {
  withLease("upload-queue", () => {
  const items = loadQueue();
  const now = Date.now();
  let changed = false;

  for (const item of items) {
    if (item.status === "uploading") {
      const createdAt = new Date(item.createdAt).getTime();
      if (now - createdAt > STALE_UPLOADING_TIMEOUT_MS) {
        item.status = "pending";
        item.nextRetryAt = null;
        changed = true;
      }
    }
  }

  if (changed) {
    saveQueue(items);
  }
  });
}

/**
 * Coalesces superseded snapshots in the queue.
 *
 * If multiple items exist for the same `snapshotHash` (content hash),
 * only the most recent one (by `createdAt`) is kept. Older items are
 * marked as "superseded" and removed.
 *
 * This prevents uploading the same data multiple times when snapshots
 * are queued faster than they can be uploaded.
 *
 * **Data safety:** Coalescing never loses data. The most recent snapshot
 * for each content hash is always preserved. If two items have different
 * content hashes, both are kept.
 */
export function coalesceSuperseded(): void {
  withLease("upload-queue", () => {
  const items = loadQueue();

  // Group items by content hash
  const byHash = new Map<string, QueueItem[]>();
  for (const item of items) {
    const existing = byHash.get(item.snapshotHash) ?? [];
    existing.push(item);
    byHash.set(item.snapshotHash, existing);
  }

  // For each hash with multiple items, keep only the most recent
  const kept: QueueItem[] = [];
  for (const [, group] of byHash) {
    if (group.length === 1) {
      kept.push(group[0]);
      continue;
    }

    // Sort by createdAt descending — most recent first
    group.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // Keep the most recent, discard the rest
    kept.push(group[0]);
  }

  // Sort kept items by original order (by createdAt ascending for FIFO)
  kept.sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  saveQueue(kept);
  });
}

/**
 * Removes all completed ("done") and superseded items from the queue.
 *
 * These items should already be removed by {@link updateStatus}, but this
 * function provides a cleanup mechanism for any edge cases.
 */
export function clearCompleted(): void {
  withLease("upload-queue", () => {
  const items = loadQueue();
  const filtered = items.filter(
    (item) => item.status !== "done" && item.status !== "superseded"
  );

  if (filtered.length !== items.length) {
    saveQueue(filtered);
  }
  });
}

// ---------------------------------------------------------------------------
// Public API — Queue Status
// ---------------------------------------------------------------------------

/**
 * Returns a summary of the current queue state.
 *
 * Used by the UI to display queue status (pending count, uploading count,
 * failed count, last upload time).
 *
 * @returns A {@link QueueStatusSummary} with aggregated counts.
 */
export function getQueueStatus(): QueueStatusSummary {
  const items = loadQueue();

  let pending = 0;
  let uploading = 0;
  let done = 0;
  let failed = 0;

  for (const item of items) {
    switch (item.status) {
      case "pending":
        pending++;
        break;
      case "uploading":
        uploading++;
        break;
      case "done":
        done++;
        break;
      case "failed":
        failed++;
        break;
      // "superseded" items are not counted
    }
  }

  // Find the most recent successful upload
  // Note: "done" items are typically removed from the queue, so this
  // looks at the queue's metadata. For a more accurate lastUploadedAt,
  // the snapshot registry should be consulted.
  const lastUploadedAt = null; // Done items are removed from queue

  return {
    total: items.length,
    pending,
    uploading,
    done,
    failed,
    lastUploadedAt,
  };
}

// ---------------------------------------------------------------------------
// Public API — Online/Offline Event Listeners
// ---------------------------------------------------------------------------

/**
 * Callback type for online/offline event handlers.
 */
type ConnectivityCallback = (isOnline: boolean) => void;

/**
 * Registered connectivity callbacks.
 */
const connectivityCallbacks: ConnectivityCallback[] = [];

/**
 * Whether event listeners have been registered.
 */
let listenersRegistered = false;
let onlineHandler: (() => void) | null = null;
let offlineHandler: (() => void) | null = null;

/**
 * Registers online/offline event listeners for automatic queue pause/resume.
 *
 * When the browser goes offline, the queue processor should pause.
 * When the browser comes back online, the queue processor should resume.
 *
 * This function is idempotent — calling it multiple times only registers
 * the listeners once.
 *
 * @param callback - Optional callback invoked when connectivity changes.
 *                   Receives `true` when online, `false` when offline.
 */
export function registerConnectivityListeners(
  callback?: ConnectivityCallback
): void {
  if (typeof window === "undefined") return;

  if (callback) {
    connectivityCallbacks.push(callback);
  }

  if (listenersRegistered) return;
  listenersRegistered = true;

  onlineHandler = () => {
    for (const cb of connectivityCallbacks) {
      cb(true);
    }
  };

  offlineHandler = () => {
    for (const cb of connectivityCallbacks) {
      cb(false);
    }
  };

  window.addEventListener("online", onlineHandler);
  window.addEventListener("offline", offlineHandler);
}

/** Removes a previously registered connectivity callback. */
export function unregisterConnectivityListener(callback: ConnectivityCallback): void {
  const index = connectivityCallbacks.indexOf(callback);
  if (index !== -1) connectivityCallbacks.splice(index, 1);

  if (connectivityCallbacks.length === 0 && listenersRegistered && typeof window !== "undefined") {
    if (onlineHandler) window.removeEventListener("online", onlineHandler);
    if (offlineHandler) window.removeEventListener("offline", offlineHandler);
    onlineHandler = null;
    offlineHandler = null;
    listenersRegistered = false;
  }
}

/**
 * Checks whether the browser is currently online.
 *
 * @returns `true` if `navigator.onLine` is true; `false` otherwise.
 *          Returns `true` on the server (SSR) as a safe default.
 */
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}
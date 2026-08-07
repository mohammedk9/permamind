/**
 * Queue processor — background worker for uploading snapshots to Arweave.
 *
 * Continuously drains the upload queue when online, processing items FIFO.
 * Handles retries with exponential backoff, online/offline detection, and
 * graceful start/stop without losing queue state.
 *
 * Architecture:
 * - Runs in the browser main thread (not a Web Worker for MVP simplicity)
 * - Uses setTimeout to yield to the UI thread between items
 * - Processes one item at a time to avoid overwhelming the network
 * - Respects exponential backoff delays from the queue
 *
 * Pipeline position:
 *   pipeline enqueues → processor dequeues → uploads to Arweave → updates registry
 */

import type { QueueItem } from "./snapshot-types";
import {
  dequeue,
  peek,
  updateStatus,
  recordFailedAttempt,
  resetStaleUploading,
  coalesceSuperseded,
  clearCompleted,
  registerConnectivityListeners,
  unregisterConnectivityListener,
  isOnline,
} from "./upload-queue";
import { updateTxId } from "./snapshot-registry";
import { updateDedupTxId } from "./dedup";
import { getSnapshotByVersion } from "./snapshot-registry";
import { acquireLease, renewLease, releaseLease } from "./coordination";
import { recordSuccessfulUpload } from "./storage-quota";

// ---------------------------------------------------------------------------
// Processor Status
// ---------------------------------------------------------------------------

/**
 * Status of the queue processor.
 */
export interface ProcessorStatus {
  /** Whether the processor is currently running. */
  isRunning: boolean;

  /** Whether the browser is currently online. */
  isOnline: boolean;

  /** Number of items currently being processed (0 or 1). */
  processingCount: number;

  /** Total number of items successfully uploaded since the processor started. */
  uploadedCount: number;

  /** Total number of failed upload attempts since the processor started. */
  failedCount: number;

  /** ISO 8601 timestamp of the last successful upload, or null. */
  lastUploadedAt: string | null;
}

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

/**
 * Internal state of the queue processor.
 */
interface ProcessorState {
  /** Whether the processor is running. */
  isRunning: boolean;

  /** Whether the browser is online. */
  isOnline: boolean;

  /** Whether an item is currently being processed. */
  isProcessing: boolean;

  /** Retained for the processor API; payloads are already encrypted in queue storage. */
  passphrase: string | null;

  /** Timeout ID for the next processing cycle. */
  timeoutId: ReturnType<typeof setTimeout> | null;

  /** Counters for status reporting. */
  uploadedCount: number;
  failedCount: number;
  lastUploadedAt: string | null;
  leaseToken: string | null;
  generation: number;
}

const state: ProcessorState = {
  isRunning: false,
  isOnline: true,
  isProcessing: false,
  passphrase: null,
  timeoutId: null,
  uploadedCount: 0,
  failedCount: 0,
  lastUploadedAt: null,
  leaseToken: null,
  generation: 0,
};

/**
 * Delay between processing cycles when the queue is empty.
 * Prevents busy-waiting when there's nothing to do.
 */
const IDLE_DELAY_MS = 5000; // 5 seconds

/**
 * Delay between processing cycles when an item was just processed.
 * Yields to the UI thread and prevents overwhelming the network.
 */
const INTER_ITEM_DELAY_MS = 1000; // 1 second

const handleConnectivityChange = (online: boolean) => {
  state.isOnline = online;
};

// ---------------------------------------------------------------------------
// Process Loop
// ---------------------------------------------------------------------------

/**
 * Processes a single queue item.
 *
 * Steps:
 * 1. Load snapshot metadata to build Arweave tags
 * 2. Create and sign the transaction
 * 3. Upload to Arweave
 * 4. Update the queue and registry on success
 *
 * @param item - The queue item to process.
 * @returns True if the upload succeeded, false otherwise.
 */
async function processItem(item: QueueItem): Promise<boolean> {
  if (!state.passphrase) {
    // Cannot process without credentials
    return false;
  }

  try {
    // Step 1: Build tags from the metadata recorded by the pipeline.
    const meta = getSnapshotByVersion(item.snapshotVersion);
    if (!meta) throw new Error(`Snapshot metadata not found: v${item.snapshotVersion}`);

    // The envelope stays encrypted in the browser and is uploaded by the
    // server using its application-owned wallet. Plaintext never leaves here.
    const response = await fetch("/api/snapshots/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encryptedPayload: item.encryptedPayload, metadata: meta }),
    });
    const result = (await response.json()) as { txId?: string; error?: string; uploadedBytes?: number; arweavePrice?: string | null };
    if (!response.ok || !result.txId) throw new Error(result.error ?? "Snapshot upload failed");
    const txId = result.txId;

    // Completion is idempotent because the server returns the signed transaction ID.
    /*
    try {
      txId = await uploadTransaction(result.transaction);
    } catch (error) {
      // A gateway/network failure after POST is ambiguous: retrying can create
      // a second permanent transaction. The signed transaction ID is stable,
      // so record it and make completion idempotent instead.
      txId = result.txId;
      updateTxId(item.snapshotVersion, txId);
      updateDedupTxId(item.snapshotHash, txId);
      updateStatus(item.queueId, "done", txId);
      state.uploadedCount++;
      state.lastUploadedAt = new Date().toISOString();
      return true;
    }
    */

    // Step 4: Update the queue and registry
    updateTxId(item.snapshotVersion, txId);
    updateDedupTxId(item.snapshotHash, txId);
    updateStatus(item.queueId, "done", txId);
    recordSuccessfulUpload({ uploadedBytes: result.uploadedBytes ?? new TextEncoder().encode(item.encryptedPayload).byteLength, uploadedAt: new Date().toISOString(), arweavePrice: result.arweavePrice ?? null, txId });

    // Update counters
    state.uploadedCount++;
    state.lastUploadedAt = new Date().toISOString();

    return true;
  } catch {
    // Upload failed — record the attempt and let the queue handle backoff
    recordFailedAttempt(item.queueId);
    state.failedCount++;
    return false;
  }
}

/**
 * Main processing loop.
 *
 * Checks for pending items, processes them one at a time, and schedules
 * the next cycle. Yields to the UI thread between items.
 */
async function processLoop(): Promise<void> {
  // Check if we should stop
  if (!state.isRunning) {
    return;
  }
  if (!state.leaseToken || !renewLease("upload-processor", state.leaseToken)) {
    stopProcessor();
    return;
  }

  // Check if we're offline
  if (!state.isOnline) {
    // Schedule a retry when we come back online
    state.timeoutId = setTimeout(processLoop, IDLE_DELAY_MS);
    return;
  }

  // Check if we're already processing an item
  if (state.isProcessing) {
    // This shouldn't happen, but handle it gracefully
    state.timeoutId = setTimeout(processLoop, INTER_ITEM_DELAY_MS);
    return;
  }

  // Coalesce superseded items before processing
  coalesceSuperseded();

  // Check for pending items
  const nextItem = peek();

  if (!nextItem) {
    // Queue is empty — wait and check again
    state.timeoutId = setTimeout(processLoop, IDLE_DELAY_MS);
    return;
  }

  // Check if the item is ready (respecting backoff delays)
  if (nextItem.nextRetryAt) {
    const retryTime = new Date(nextItem.nextRetryAt).getTime();
    const now = Date.now();
    if (retryTime > now) {
      // Not yet time to retry — wait until the retry time
      const delay = Math.min(retryTime - now, IDLE_DELAY_MS);
      state.timeoutId = setTimeout(processLoop, delay);
      return;
    }
  }

  // Dequeue the item (this also marks it as "uploading")
  const item = dequeue();
  if (!item) {
    // Item was dequeued by another process or became ineligible
    state.timeoutId = setTimeout(processLoop, INTER_ITEM_DELAY_MS);
    return;
  }

  // Process the item
  state.isProcessing = true;
  try {
    await processItem(item);
  } finally {
    state.isProcessing = false;
  }

  // Clean up completed items
  clearCompleted();

  // Schedule the next cycle (yield to UI thread)
  state.timeoutId = setTimeout(processLoop, INTER_ITEM_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Starts the queue processor.
 *
 * The processor will continuously drain the upload queue, processing items
 * FIFO and handling retries with exponential backoff. It respects online/offline
 * status and yields to the UI thread between items.
 *
 * Safe to call multiple times — subsequent calls are no-ops if already running.
 *
 * @param passphrase - Used only to indicate that client-side snapshot encryption is configured.
 *
 * @example
 * ```ts
 * startProcessor(walletJwk, "my-passphrase");
 * ```
 */
export function startProcessor(passphraseOrLegacyWallet: string | unknown, legacyPassphrase?: string): void {
  if (state.isRunning) {
    return; // Already running
  }
  const leaseToken = acquireLease("upload-processor");
  if (!leaseToken) return;

  // Store credentials
  state.passphrase = typeof passphraseOrLegacyWallet === "string"
    ? passphraseOrLegacyWallet
    : legacyPassphrase ?? null;
  state.leaseToken = leaseToken;
  const generation = ++state.generation;

  // Reset counters
  state.uploadedCount = 0;
  state.failedCount = 0;
  state.lastUploadedAt = null;

  // Reset stale uploading items (from previous crashes)
  resetStaleUploading();

  // Register online/offline listeners
  registerConnectivityListeners(handleConnectivityChange);

  // Initialize online status
  state.isOnline = isOnline();

  // Start the processor
  state.isRunning = true;
  state.timeoutId = setTimeout(() => {
    if (state.generation === generation) void processLoop();
  }, 0);
}

/**
 * Stops the queue processor.
 *
 * Gracefully stops the processing loop. Any in-progress upload will complete,
 * but no new items will be processed. Queue state is preserved in localStorage.
 *
 * Safe to call multiple times — subsequent calls are no-ops if already stopped.
 *
 * @example
 * ```ts
 * stopProcessor();
 * ```
 */
export function stopProcessor(): void {
  const token = state.leaseToken;
  // Stop the processor
  state.isRunning = false;
  state.isProcessing = false;

  unregisterConnectivityListener(handleConnectivityChange);

  // Clear any pending timeout
  if (state.timeoutId) {
    clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }

  // Clear credentials (security)
  state.passphrase = null;
  state.leaseToken = null;
  state.generation++;
  if (token) releaseLease("upload-processor", token);
}

/**
 * Returns the current status of the queue processor.
 *
 * @returns A {@link ProcessorStatus} object with runtime statistics.
 *
 * @example
 * ```ts
 * const status = getProcessorStatus();
 * console.log(`Running: ${status.isRunning}, Online: ${status.isOnline}`);
 * console.log(`Uploaded: ${status.uploadedCount}, Failed: ${status.failedCount}`);
 * ```
 */
export function getProcessorStatus(): ProcessorStatus {
  return {
    isRunning: state.isRunning,
    isOnline: state.isOnline,
    processingCount: state.isProcessing ? 1 : 0,
    uploadedCount: state.uploadedCount,
    failedCount: state.failedCount,
    lastUploadedAt: state.lastUploadedAt,
  };
}
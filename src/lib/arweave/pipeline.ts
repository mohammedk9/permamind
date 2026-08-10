/**
 * Snapshot pipeline orchestrator — coordinates the full snapshot pipeline.
 *
 * This module wires together all phases of the snapshot system:
 * 1. Load registry (Phase 5)
 * 2. Build snapshot (Phase 6)
 * 3. Check deduplication (Phase 4, via Phase 6)
 * 4. Compress payload (Phase 2)
 * 5. Encrypt compressed data (Phase 3)
 * 6. Enqueue for upload (Phase 7)
 * 7. Update registry (Phase 5)
 *
 * The pipeline does NOT upload directly. It only enqueues items for the
 * queue processor (Phase 11) to handle. This separation ensures:
 * - The pipeline is fast (no network I/O)
 * - Uploads can be retried independently
 * - Offline mode works seamlessly
 *
 * Idempotency:
 * - The pipeline is idempotent given identical input data.
 * - Deduplication (via content hash) prevents double uploads.
 * - Running the pipeline twice with the same conversations produces
 *   the same result (second run returns "skipped-no-changes" or "skipped-duplicate").
 *
 * Error handling:
 * - Each stage is wrapped in try/catch.
 * - Failures abort the pipeline without partial side effects.
 * - The fingerprint cache (updated in Phase 6) may be out of sync after
 *   a failure, but this is acceptable — it's a cache, not the source of truth.
 */

import type { Conversation } from "@/types/chat";
import type { PipelineResult, QueueItem } from "./snapshot-types";
import { loadRegistry, addSnapshot, removeSnapshot } from "./snapshot-registry";
import { buildSnapshot } from "./snapshot-builder";
import { compress, jsonToBytes } from "./compression";
import { generateSalt, deriveKey, encrypt } from "./encryption";
import { enqueue, remove as removeQueueItem } from "./upload-queue";
import { addDedupEntry } from "./dedup";
import { MAX_UPLOAD_ATTEMPTS } from "./constants";
import { canUpload } from "./storage-quota";
import type { StoragePolicy } from "./storage-policy";

/**
 * Runs the full snapshot pipeline.
 *
 * This is the main entry point for creating snapshots. It orchestrates
 * all phases and returns a {@link PipelineResult} indicating the outcome.
 *
 * @param conversations - The current list of all conversations from localStorage.
 * @param passphrase - The user's encryption passphrase. Used to derive the AES key.
 * @param walletKey - The Arweave wallet key (JWK). Reserved for the queue processor
 *                    (Phase 11). The pipeline does not upload directly.
 * @returns A {@link PipelineResult} with the outcome status and metadata.
 *
 * @example
 * ```ts
 * const { conversations } = loadChatData();
 * const result = await runSnapshotPipeline(conversations, passphrase, walletKey);
 *
 * switch (result.status) {
 *   case "queued":
 *     console.log(`Snapshot v${result.snapshotVersion} queued for upload`);
 *     break;
 *   case "skipped-no-changes":
 *     console.log("No changes detected");
 *     break;
 *   case "skipped-duplicate":
 *     console.log("Duplicate content — skipping");
 *     break;
 *   case "failed":
 *     console.error(`Pipeline failed: ${result.error}`);
 *     break;
 * }
 * ```
 */
export async function runSnapshotPipeline(
  conversations: Conversation[],
  passphrase: string,
  walletKey: unknown,
  policy?: StoragePolicy
): Promise<PipelineResult> {
  // walletKey is reserved for the queue processor (Phase 11).
  // The pipeline does not upload directly; it only enqueues items.
  void walletKey;

  try {
    // -------------------------------------------------------------------------
    // Step 1: Load registry
    // -------------------------------------------------------------------------
    const registry = loadRegistry();

    // -------------------------------------------------------------------------
    // Step 2: Build snapshot
    // -------------------------------------------------------------------------
    // buildSnapshot performs diffing, versioning, and dedup checking.
    // It also updates the fingerprint cache (a side effect, but acceptable
    // for a cache).
    // Callers in the application resolve the user's policy before entering the
    // pipeline. Keeping the library default explicit also makes the pipeline
    // deterministic for integrations and tests.
    const buildResult = await buildSnapshot(conversations, registry, policy ?? "store_everything");

    if (!buildResult) {
      // No changes detected since last snapshot
      return {
        status: "skipped-no-changes",
        snapshotVersion: null,
        txId: null,
        message: "No changes detected since last snapshot",
        error: null,
      };
    }

    // -------------------------------------------------------------------------
    // Step 3: Check deduplication
    // -------------------------------------------------------------------------
    // buildSnapshot already computed the content hash and checked the dedup
    // registry. If the content is identical to a previous snapshot, skip.
    if (buildResult.isDuplicate) {
      return {
        status: "skipped-duplicate",
        snapshotVersion: buildResult.meta.version,
        txId: null,
        message: "Snapshot content is identical to a previous snapshot",
        error: null,
      };
    }

    // -------------------------------------------------------------------------
    // Step 4: Compress payload
    // -------------------------------------------------------------------------
    // Convert the payload to bytes, then compress with gzip.
    const plaintextBytes = jsonToBytes(buildResult.payload);
    const compressedBytes = await compress(plaintextBytes);

    // -------------------------------------------------------------------------
    // Step 5: Encrypt compressed data
    // -------------------------------------------------------------------------
    // Generate a unique salt, derive the AES key from the passphrase,
    // then encrypt the compressed data with AES-256-GCM.
    const salt = generateSalt();
    const key = await deriveKey(passphrase, salt);
    const encryptedPayload = await encrypt(compressedBytes, key, salt);

    // -------------------------------------------------------------------------
    // Step 6: Create queue item
    // -------------------------------------------------------------------------
    // The encrypted payload is serialized as a JSON string for localStorage.
    const encryptedPayloadJson = JSON.stringify(encryptedPayload);
    const uploadBytes = new TextEncoder().encode(encryptedPayloadJson).byteLength;
    if (!canUpload(uploadBytes)) {
      return { status: "quota-exceeded", snapshotVersion: buildResult.meta.version, txId: null, message: "Permanent storage quota exceeded", error: null };
    }

    const queueItem: QueueItem = {
      queueId: crypto.randomUUID(),
      snapshotVersion: buildResult.meta.version,
      snapshotHash: buildResult.meta.contentHash,
      encryptedPayload: encryptedPayloadJson,
      status: "pending",
      attempts: 0,
      maxAttempts: MAX_UPLOAD_ATTEMPTS,
      nextRetryAt: null, // Eligible for immediate processing
      createdAt: new Date().toISOString(),
      txId: null,
    };

    // -------------------------------------------------------------------------
    // Step 7: Enqueue
    // -------------------------------------------------------------------------
    // Add the item to the persistent upload queue.
    enqueue(queueItem);

    // -------------------------------------------------------------------------
    // Step 8: Update registry
    // -------------------------------------------------------------------------
    // Add the snapshot metadata to the registry with actual sizes.
    // Calculate encrypted size from the base64-encoded fields:
    // base64 encoding adds ~33% overhead, so original bytes ≈ base64 length * 0.75
    const ivBytes = Math.floor(encryptedPayload.iv.length * 0.75);
    const ciphertextBytes = Math.floor(encryptedPayload.ciphertext.length * 0.75);
    const saltBytes = Math.floor(encryptedPayload.salt.length * 0.75);
    const encryptedSize = ivBytes + ciphertextBytes + saltBytes;

    const meta = {
      ...buildResult.meta,
      compressedSize: compressedBytes.byteLength,
      encryptedSize,
    };

    try {
      addSnapshot(meta);
      addDedupEntry({
        contentHash: meta.contentHash,
        snapshotVersion: meta.version,
        txId: null,
        createdAt: meta.createdAt,
      });
    } catch (error) {
      removeQueueItem(queueItem.queueId);
      removeSnapshot(meta.version);
      throw error;
    }

    // -------------------------------------------------------------------------
    // Step 9: Return success
    // -------------------------------------------------------------------------
    return {
      status: "queued",
      snapshotVersion: buildResult.meta.version,
      txId: null, // txId will be populated by the queue processor after upload
      message: `Snapshot v${buildResult.meta.version} queued for upload`,
      error: null,
    };
  } catch (error) {
    // -------------------------------------------------------------------------
    // Error handling
    // -------------------------------------------------------------------------
    // Any failure at any stage aborts the pipeline and returns a "failed" status.
    // Partial side effects (e.g., fingerprint cache update) are acceptable
    // because they are caches, not the source of truth.
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      status: "failed",
      snapshotVersion: null,
      txId: null,
      message: "Pipeline failed",
      error: errorMessage,
    };
  }
}
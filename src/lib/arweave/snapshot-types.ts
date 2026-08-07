/**
 * Core type definitions for the Arweave snapshot system.
 *
 * These types define the contracts between every layer of the snapshot pipeline:
 * builder → dedup → compression → encryption → queue → Arweave upload.
 *
 * No implementation logic belongs here — only interfaces, type aliases, and enums.
 */

import type { Conversation } from "@/types/chat";

// ---------------------------------------------------------------------------
// Snapshot Classification
// ---------------------------------------------------------------------------

/**
 * Whether a snapshot contains the full conversation state or only changes
 * since the previous snapshot.
 *
 * - `"full"`  — Complete state of all conversations. Used for the first snapshot
 *               and periodic compaction snapshots.
 * - `"delta"` — Only conversations that changed since the parent snapshot,
 *               plus deletion markers for removed conversations.
 */
export type SnapshotType = "full" | "delta";

// ---------------------------------------------------------------------------
// Snapshot Metadata
// ---------------------------------------------------------------------------

/**
 * Metadata record for a single snapshot.
 *
 * Stored in the snapshot registry (localStorage). One record per snapshot.
 * Forms a linked chain via `parentVersion` and `parentTxId`.
 */
export interface SnapshotMeta {
  /** Monotonically increasing version number within the current epoch. */
  version: number;

  /**
   * Epoch number. Increments on every full snapshot.
   * Epoch 1 starts with the first-ever full snapshot.
   */
  epoch: number;

  /** Whether this is a full or delta snapshot. */
  type: SnapshotType;

  /**
   * Version of the previous snapshot in the chain.
   * `null` for the first snapshot in an epoch (full snapshot).
   */
  parentVersion: number | null;

  /**
   * Arweave transaction ID of the parent snapshot.
   * `null` if the parent has not been uploaded yet or this is the first snapshot.
   */
  parentTxId: string | null;

  /** ISO 8601 timestamp of when the snapshot was created. */
  createdAt: string;

  /**
   * SHA-256 hash of the canonical JSON representation of the plaintext
   * snapshot payload. Used for deduplication and integrity verification.
   */
  contentHash: string;

  /** IDs of all conversations included in this snapshot. */
  conversationIds: string[];

  /** Total number of messages across all conversations in this snapshot. */
  messageCount: number;

  /** Size of the payload after compression, in bytes. */
  compressedSize: number;

  /** Size of the payload after encryption, in bytes. */
  encryptedSize: number;

  /**
   * Arweave transaction ID.
   * `null` until the snapshot has been successfully uploaded and confirmed.
   */
  txId: string | null;
}

// ---------------------------------------------------------------------------
// Snapshot Payload
// ---------------------------------------------------------------------------

/**
 * A single conversation as serialized inside a snapshot payload.
 *
 * Mirrors the structure from `chat-storage.ts` but is explicitly typed
 * for the snapshot domain to avoid coupling to the storage layer's internal types.
 */
export interface SnapshotConversation {
  id: string;
  title: string;
  messages: SnapshotMessage[];
  createdAt: string;
  updatedAt: string;
  metadata?: SnapshotConversationMetadata;
}

/** A single message inside a {@link SnapshotConversation}. */
export interface SnapshotMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

/**
 * Conversation metadata (summary, topics, tags, entities) as stored
 * inside a snapshot. All dates are ISO 8601 strings.
 */
export interface SnapshotConversationMetadata {
  summary: string;
  topics: string[];
  tags: string[];
  entities: string[];
  messageFingerprint: string;
  generatedAt: string;
}

/**
 * Marker indicating that a conversation was deleted since the parent snapshot.
 * Only present in delta snapshots.
 */
export interface SnapshotDeletionMarker {
  conversationId: string;
  deletedAt: string;
}

/**
 * The plaintext payload of a snapshot before compression and encryption.
 *
 * For full snapshots: `conversations` contains every conversation, `deletions` is empty.
 * For delta snapshots: `conversations` contains only changed conversations,
 * `deletions` lists conversations removed since the parent snapshot.
 */
export interface SnapshotPayload {
  /** Snapshot version — matches {@link SnapshotMeta.version}. */
  version: number;

  /** Snapshot epoch — matches {@link SnapshotMeta.epoch}. */
  epoch: number;

  /** Snapshot type — matches {@link SnapshotMeta.type}. */
  type: SnapshotType;

  /** ISO 8601 timestamp of when the payload was built. */
  createdAt: string;

  /** Conversations included in this snapshot. */
  conversations: SnapshotConversation[];

  /**
   * Deletion markers for conversations removed since the parent snapshot.
   * Always empty for full snapshots.
   */
  deletions: SnapshotDeletionMarker[];
}

// ---------------------------------------------------------------------------
// Snapshot Build Result
// ---------------------------------------------------------------------------

/**
 * Result returned by the snapshot builder after evaluating the current state.
 */
export interface SnapshotBuildResult {
  /** The plaintext payload ready for compression. */
  payload: SnapshotPayload;

  /** Metadata record for the registry (contentHash populated, sizes are 0 until later stages). */
  meta: SnapshotMeta;

  /**
   * `true` if the content hash matches a previously uploaded snapshot,
   * meaning this snapshot should be skipped entirely.
   */
  isDuplicate: boolean;
}

// ---------------------------------------------------------------------------
// Encrypted Payload
// ---------------------------------------------------------------------------

/**
 * The output of the encryption layer.
 *
 * Contains everything needed to decrypt: the IV (unique per snapshot),
 * the ciphertext (compressed data encrypted with AES-256-GCM),
 * and the salt used during key derivation.
 */
export interface EncryptedPayload {
  /** AES-GCM initialization vector (12 bytes, stored as base64). */
  iv: string;

  /** Encrypted ciphertext including the GCM authentication tag (stored as base64). */
  ciphertext: string;

  /** PBKDF2 salt used during key derivation (stored as base64). */
  salt: string;
}

// ---------------------------------------------------------------------------
// Upload Queue
// ---------------------------------------------------------------------------

/**
 * Status of a single item in the upload queue.
 *
 * - `"pending"`     — Waiting to be processed.
 * - `"uploading"`   — Currently being uploaded to Arweave.
 * - `"done"`        — Successfully uploaded; txId is populated.
 * - `"failed"`      — All retry attempts exhausted.
 * - `"superseded"`  — Replaced by a newer snapshot for the same data.
 */
export type QueueItemStatus =
  | "pending"
  | "uploading"
  | "done"
  | "failed"
  | "superseded";

/**
 * A single item in the persistent upload queue.
 *
 * Stored in localStorage so the queue survives browser restarts.
 */
export interface QueueItem {
  /** Unique identifier for this queue item (UUID). */
  queueId: string;

  /** Snapshot version this item corresponds to. */
  snapshotVersion: number;

  /** SHA-256 content hash of the plaintext snapshot (for dedup verification). */
  snapshotHash: string;

  /** The encrypted payload, serialized as a JSON string of {@link EncryptedPayload}. */
  encryptedPayload: string;

  /** Current processing status. */
  status: QueueItemStatus;

  /** Number of upload attempts made so far. */
  attempts: number;

  /** Maximum number of upload attempts before marking as failed. */
  maxAttempts: number;

  /**
   * ISO 8601 timestamp of the next allowed retry.
   * Used for exponential backoff scheduling.
   */
  nextRetryAt: string | null;

  /** ISO 8601 timestamp of when this item was enqueued. */
  createdAt: string;

  /**
   * Arweave transaction ID.
   * Populated after a successful upload; `null` otherwise.
   */
  txId: string | null;
}

/**
 * Summary of the current upload queue state.
 * Used by the UI to display queue status.
 */
export interface QueueStatusSummary {
  /** Total number of items in the queue (all statuses). */
  total: number;

  /** Number of items waiting to be uploaded. */
  pending: number;

  /** Number of items currently being uploaded. */
  uploading: number;

  /** Number of items that have been successfully uploaded. */
  done: number;

  /** Number of items that failed after exhausting retries. */
  failed: number;

  /** ISO 8601 timestamp of the most recent successful upload, or `null`. */
  lastUploadedAt: string | null;
}

// ---------------------------------------------------------------------------
// Snapshot Registry
// ---------------------------------------------------------------------------

/**
 * The complete snapshot registry stored in localStorage.
 *
 * Contains metadata for every snapshot ever created, forming a versioned chain.
 */
export interface SnapshotRegistry {
  /** Schema version for future migrations. */
  version: 1;

  /** All snapshot metadata records, ordered by version ascending. */
  snapshots: SnapshotMeta[];
}

// ---------------------------------------------------------------------------
// Deduplication Registry
// ---------------------------------------------------------------------------

/**
 * A single entry in the deduplication registry.
 *
 * Maps a content hash to the snapshot version and optional Arweave txId
 * where that content was uploaded.
 */
export interface DedupEntry {
  /** SHA-256 hash of the canonical JSON payload. */
  contentHash: string;

  /** Snapshot version that produced this hash. */
  snapshotVersion: number;

  /** Arweave txId if the snapshot was uploaded; `null` if it was only built locally. */
  txId: string | null;

  /** ISO 8601 timestamp of when this entry was recorded. */
  createdAt: string;
}

/**
 * The complete deduplication registry stored in localStorage.
 *
 * Used to check whether a snapshot's content has already been uploaded,
 * preventing redundant compression, encryption, and Arweave transactions.
 */
export interface DedupRegistry {
  /** Schema version for future migrations. */
  version: 1;

  /** All dedup entries, ordered by creation time ascending. */
  entries: DedupEntry[];
}

// ---------------------------------------------------------------------------
// Arweave Transaction Tags
// ---------------------------------------------------------------------------

/** A single name-value tag attached to an Arweave transaction. */
export interface ArweaveTag {
  name: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Pipeline Result
// ---------------------------------------------------------------------------

/**
 * Result returned by the snapshot pipeline after a full run.
 */
export interface PipelineResult {
  /** Outcome of the pipeline execution. */
  status: "uploaded" | "queued" | "skipped-duplicate" | "skipped-no-changes" | "quota-exceeded" | "failed";

  /** Snapshot version if a snapshot was built; `null` if skipped. */
  snapshotVersion: number | null;

  /** Arweave txId if uploaded immediately; `null` if queued or skipped. */
  txId: string | null;

  /** Human-readable message describing the outcome. */
  message: string;

  /** Error details if the pipeline failed; `null` otherwise. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Utility Types
// ---------------------------------------------------------------------------

/**
 * Converts a {@link Conversation} (runtime type with Date objects) into
 * a {@link SnapshotConversation} (serialized type with ISO strings).
 *
 * This is a type-level mapping only — the actual conversion function
 * lives in the snapshot builder.
 */
export type ConversationToSnapshot = (conversation: Conversation) => SnapshotConversation;
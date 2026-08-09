/**
 * Arweave snapshot system constants.
 *
 * All localStorage keys follow the project convention: `permamind:<domain>:v<version>`.
 * All timing values are in milliseconds unless noted otherwise.
 */

// ---------------------------------------------------------------------------
// localStorage Keys
// ---------------------------------------------------------------------------

/** Snapshot metadata registry — tracks every snapshot ever created. */
export const SNAPSHOT_REGISTRY_KEY = "permamind:snapshots:meta:v1";

/** Persistent upload queue — survives browser restarts. */
export const UPLOAD_QUEUE_KEY = "permamind:upload:queue:v1";
export const STORAGE_ACCOUNT_KEY = "permamind:storage:account:v1";

/** Managed upload-service limits. Sizes are measured in binary megabytes. */
/** Maximum size of one uploaded file/snapshot. This is separate from the free quota. */
export const MAX_UPLOAD_SIZE_MB = 50;
export const FREE_STORAGE_QUOTA_MB = 15;
export const FREE_UPLOADS_PER_HOUR = 10;
export const PRO_UPLOADS_PER_HOUR = 100;
export const UPLOAD_RATE_WINDOW_MS = 60 * 60 * 1000;
export const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
export const FREE_STORAGE_QUOTA_BYTES = FREE_STORAGE_QUOTA_MB * 1024 * 1024;
/** Configurable lifetime free permanent-storage allowance. */
export const DEFAULT_FREE_STORAGE_QUOTA_BYTES = FREE_STORAGE_QUOTA_BYTES;

/** Deduplication registry — content hashes of previously uploaded snapshots. */
export const DEDUP_REGISTRY_KEY = "permamind:snapshots:dedup:v1";
// ---------------------------------------------------------------------------
// Snapshot Trigger Thresholds
// ---------------------------------------------------------------------------

/** Milliseconds of user inactivity before an automatic snapshot is triggered. */
export const IDLE_TRIGGER_MS = 5 * 60 * 1000; // 5 minutes

/** Milliseconds between periodic snapshots during active use. */
export const PERIODIC_TRIGGER_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Number of delta snapshots after which a full (compaction) snapshot is forced.
 * Prevents unbounded delta chains during restoration.
 */
export const COMPACTION_INTERVAL = 50;

// ---------------------------------------------------------------------------
// Upload Queue — Retry Configuration
// ---------------------------------------------------------------------------

/** Maximum number of upload attempts before an item is marked as failed. */
export const MAX_UPLOAD_ATTEMPTS = 5;

/** Base delay in milliseconds for exponential backoff between retries. */
export const RETRY_BASE_DELAY_MS = 1000;

/**
 * Maximum delay cap in milliseconds.
 * Prevents backoff from growing unreasonably large.
 */
export const RETRY_MAX_DELAY_MS = 60 * 1000; // 1 minute

// ---------------------------------------------------------------------------
// Encryption Parameters
// ---------------------------------------------------------------------------

/** Symmetric encryption algorithm used for snapshot payloads. */
export const ENCRYPTION_ALGORITHM = "AES-256-GCM" as const;

/** Key derivation function used to derive an AES key from the user passphrase. */
export const KDF_ALGORITHM = "PBKDF2" as const;

/** Hash function used inside PBKDF2. */
export const KDF_HASH = "SHA-256" as const;

/** Number of PBKDF2 iterations for key derivation. */
export const KDF_ITERATIONS = 310_000;

/** Length of the PBKDF2 salt in bytes. */
export const KDF_SALT_LENGTH = 16;

/** Length of the AES-GCM initialization vector in bytes. */
export const AES_IV_LENGTH = 12;

/** AES key length in bits. */
export const AES_KEY_LENGTH = 256;

// ---------------------------------------------------------------------------
// Compression Parameters
// ---------------------------------------------------------------------------

/** Compression algorithm used before encryption. */
export const COMPRESSION_ALGORITHM = "gzip" as const;

// ---------------------------------------------------------------------------
// Deduplication Parameters
// ---------------------------------------------------------------------------

/** Hash algorithm used for content-addressable deduplication. */
export const DEDUP_HASH_ALGORITHM = "SHA-256" as const;

// ---------------------------------------------------------------------------
// Arweave Transaction Tags
// ---------------------------------------------------------------------------

/** Application name tag — identifies PermaMind transactions on Arweave. */
export const ARWEAVE_APP_NAME = "PermaMind";

/** Application version tag. */
export const ARWEAVE_APP_VERSION = "1.0.0";

/**
 * Complete set of tag names used on Arweave snapshot transactions.
 * These tags are the primary interface for future AO process discovery.
 */
export const ARWEAVE_TAG_NAMES = {
  APP_NAME: "App-Name",
  APP_VERSION: "App-Version",
  CONTENT_TYPE: "Content-Type",
  SNAPSHOT_VERSION: "Snapshot-Version",
  SNAPSHOT_EPOCH: "Snapshot-Epoch",
  SNAPSHOT_TYPE: "Snapshot-Type",
  PARENT_TX_ID: "Parent-TxId",
  CONTENT_HASH: "Content-Hash",
  CONVERSATION_COUNT: "Conversation-Count",
  MESSAGE_COUNT: "Message-Count",
  CREATED_AT: "Created-At",
  ENCRYPTION: "Encryption",
  COMPRESSION: "Compression",
} as const;

/** Content-Type value for encrypted binary payloads. */
export const ARWEAVE_CONTENT_TYPE = "application/octet-stream";

// Restore safety limits. These protect the browser from oversized or hostile
// snapshots before local chat data is replaced.
export const MAX_ENCRYPTED_PAYLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_DECOMPRESSED_PAYLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_RESTORE_CONVERSATIONS = 10_000;
export const MAX_RESTORE_MESSAGES = 100_000;
// Web Crypto API algorithm identifier (must be exactly "AES-GCM" per spec —
// key length is specified separately via the `length` param, not in the name).
export const AES_GCM_ALGORITHM_NAME = "AES-GCM";
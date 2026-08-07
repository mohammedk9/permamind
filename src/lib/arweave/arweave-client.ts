/**
 * Arweave client — transaction creation and upload for the snapshot pipeline.
 *
 * Uses the official `arweave` npm package to create and upload transactions
 * to the Arweave network. Each snapshot becomes exactly one Arweave transaction
 * with a comprehensive tag set for future AO process discovery.
 *
 * Security:
 * - The wallet key (JWK) is NEVER stored — it must be injected at runtime.
 * - No module-level state holds sensitive data.
 * - All functions are stateless and pure (except for network I/O).
 *
 * Pipeline position:
 *   encrypt → enqueue → dequeue → createTransaction → uploadTransaction → Arweave
 */

import Arweave from "arweave";
import type { JWKInterface } from "arweave/node/lib/wallet";
import type Transaction from "arweave/node/lib/transaction";
import type { ArweaveTag, SnapshotMeta } from "./snapshot-types";
import {
  ARWEAVE_APP_NAME,
  ARWEAVE_APP_VERSION,
  ARWEAVE_CONTENT_TYPE,
  ARWEAVE_TAG_NAMES,
  COMPRESSION_ALGORITHM,
  ENCRYPTION_ALGORITHM,
} from "./constants";

// ---------------------------------------------------------------------------
// Arweave Instance
// ---------------------------------------------------------------------------

/**
 * Singleton Arweave client instance.
 *
 * Configured to connect to the main Arweave gateway (arweave.net).
 * This instance is used for creating and uploading transactions.
 *
 * The gateway can be changed for testing (e.g., to a local arlocal instance)
 * by modifying this configuration.
 */
const arweave = Arweave.init({
  host: "arweave.net",
  port: 443,
  protocol: "https",
});

// ---------------------------------------------------------------------------
// Transaction Result
// ---------------------------------------------------------------------------

/**
 * Result of creating an Arweave transaction.
 *
 * Contains the transaction object (for upload) and the transaction ID
 * (for tracking and tagging).
 */
export interface TransactionResult {
  /** The Arweave transaction object, ready to be uploaded. */
  transaction: Transaction;

  /** The transaction ID (43-character base64url string). */
  txId: string;
}

// ---------------------------------------------------------------------------
// Tag Building
// ---------------------------------------------------------------------------

/**
 * Builds the complete set of Arweave transaction tags for a snapshot.
 *
 * These tags are the primary interface for future AO process discovery.
 * AO processes will query Arweave using GraphQL filtered by these tags
 * to find and index PermaMind snapshots.
 *
 * Tag set includes:
 * - App identification (App-Name, App-Version)
 * - Content metadata (Content-Type, Content-Hash)
 * - Snapshot metadata (Snapshot-Version, Snapshot-Epoch, Snapshot-Type)
 * - Chain linkage (Parent-TxId)
 * - Payload statistics (Conversation-Count, Message-Count)
 * - Algorithm identifiers (Encryption, Compression)
 * - Timestamp (Created-At)
 *
 * @param meta - The snapshot metadata record.
 * @returns An array of {@link ArweaveTag} objects.
 *
 * @example
 * ```ts
 * const tags = buildTags(snapshotMeta);
 * const result = await createTransaction(encryptedPayload, tags, jwk);
 * ```
 */
export function buildTags(meta: SnapshotMeta): ArweaveTag[] {
  const tags: ArweaveTag[] = [
    // App identification
    { name: ARWEAVE_TAG_NAMES.APP_NAME, value: ARWEAVE_APP_NAME },
    { name: ARWEAVE_TAG_NAMES.APP_VERSION, value: ARWEAVE_APP_VERSION },

    // Content type (encrypted binary)
    { name: ARWEAVE_TAG_NAMES.CONTENT_TYPE, value: ARWEAVE_CONTENT_TYPE },

    // Snapshot metadata
    { name: ARWEAVE_TAG_NAMES.SNAPSHOT_VERSION, value: String(meta.version) },
    { name: ARWEAVE_TAG_NAMES.SNAPSHOT_EPOCH, value: String(meta.epoch) },
    { name: ARWEAVE_TAG_NAMES.SNAPSHOT_TYPE, value: meta.type },

    // Content hash (for dedup verification and integrity checking)
    { name: ARWEAVE_TAG_NAMES.CONTENT_HASH, value: meta.contentHash },

    // Payload statistics
    {
      name: ARWEAVE_TAG_NAMES.CONVERSATION_COUNT,
      value: String(meta.conversationIds.length),
    },
    { name: ARWEAVE_TAG_NAMES.MESSAGE_COUNT, value: String(meta.messageCount) },

    // Timestamp
    { name: ARWEAVE_TAG_NAMES.CREATED_AT, value: meta.createdAt },

    // Algorithm identifiers (for future decryption/indexing)
    { name: ARWEAVE_TAG_NAMES.ENCRYPTION, value: ENCRYPTION_ALGORITHM },
    { name: ARWEAVE_TAG_NAMES.COMPRESSION, value: COMPRESSION_ALGORITHM },
  ];

  // Parent transaction ID (for chain traversal)
  // Only included if the parent has been uploaded (txId is not null)
  if (meta.parentTxId) {
    tags.push({
      name: ARWEAVE_TAG_NAMES.PARENT_TX_ID,
      value: meta.parentTxId,
    });
  }

  return tags;
}

// ---------------------------------------------------------------------------
// Transaction Creation
// ---------------------------------------------------------------------------

/**
 * Creates an Arweave transaction with the given payload and tags.
 *
 * The transaction is signed with the provided wallet key (JWK) but NOT
 * yet uploaded. Call {@link uploadTransaction} to submit it to the network.
 *
 * The wallet key is passed as a parameter and is NEVER stored anywhere.
 * It exists only in the call stack and is discarded after signing.
 *
 * @param payload - The encrypted snapshot payload (binary data).
 * @param tags - The transaction tags (from {@link buildTags}).
 * @param jwk - The Arweave wallet key (JWK format). Injected at runtime, never stored.
 * @returns A {@link TransactionResult} containing the transaction object and txId.
 * @throws {Error} If transaction creation or signing fails.
 *
 * @example
 * ```ts
 * const tags = buildTags(snapshotMeta);
 * const result = await createTransaction(encryptedBytes, tags, walletJwk);
 * const txId = await uploadTransaction(result.transaction);
 * ```
 */
export async function createTransaction(
  payload: Uint8Array,
  tags: ArweaveTag[],
  jwk: JWKInterface
): Promise<TransactionResult> {
  // Create the transaction with the payload as data
  const transaction = await arweave.createTransaction(
    {
      data: payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer,
    },
    jwk
  );

  // Add all tags to the transaction
  for (const tag of tags) {
    transaction.addTag(tag.name, tag.value);
  }

  // Sign the transaction with the wallet key
  await arweave.transactions.sign(transaction, jwk);

  const txId = transaction.id;

  return { transaction, txId };
}

// ---------------------------------------------------------------------------
// Transaction Upload
// ---------------------------------------------------------------------------

/**
 * Uploads a signed Arweave transaction to the network.
 *
 * Uses the Arweave gateway's POST endpoint to submit the transaction.
 * The transaction must have been created and signed via {@link createTransaction}.
 *
 * Network errors are surfaced to the caller so the queue processor can
 * implement retry logic with exponential backoff.
 *
 * @param transaction - The signed Arweave transaction to upload.
 * @returns The transaction ID (43-character base64url string).
 * @throws {Error} If the upload fails (network error, gateway rejection, etc.).
 *         The error message includes the HTTP status and response body for debugging.
 *
 * @example
 * ```ts
 * try {
 *   const txId = await uploadTransaction(result.transaction);
 *   console.log(`Uploaded: ${txId}`);
 * } catch (error) {
 *   // Queue processor will retry with backoff
 *   console.error(`Upload failed: ${error.message}`);
 *   throw error;
 * }
 * ```
 */
export async function uploadTransaction(transaction: Transaction): Promise<string> {
  const response = await arweave.transactions.post(transaction);

  // Check for HTTP errors
  if (response.status !== 200) {
    const errorBody = typeof response.data === "string" ? response.data : JSON.stringify(response.data);
    throw new Error(
      `Arweave upload failed: HTTP ${response.status} — ${errorBody}`
    );
  }

  return transaction.id;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Retrieves the current AR balance for a wallet address.
 *
 * Useful for displaying wallet balance in the UI and checking if the
 * user has sufficient funds for uploads.
 *
 * @param address - The Arweave wallet address (43-character base64url string).
 * @returns The balance in Winston (1 AR = 10^12 Winston).
 * @throws {Error} If the balance query fails.
 */
export async function getWalletBalance(address: string): Promise<string> {
  const balance = await arweave.wallets.getBalance(address);
  return balance;
}

/**
 * Converts a Winston amount to AR.
 *
 * @param winston - The amount in Winston (string or bigint).
 * @returns The amount in AR as a string with up to 12 decimal places.
 */
export function winstonToAr(winston: string): string {
  return arweave.ar.winstonToAr(winston);
}

/**
 * Estimates the cost (in Winston) to upload a given number of bytes.
 *
 * Arweave pricing is based on data size. This function queries the
 * current price from the gateway.
 *
 * @param bytes - The number of bytes to estimate cost for.
 * @returns The estimated cost in Winston.
 * @throws {Error} If the price query fails.
 */
export async function estimateUploadCost(bytes: number): Promise<string> {
  const cost = await arweave.transactions.getPrice(bytes);
  return cost;
}

/**
 * Derives the wallet address from a JWK.
 *
 * @param jwk - The Arweave wallet key (JWK format).
 * @returns The wallet address (43-character base64url string).
 */
export async function getWalletAddress(jwk: JWKInterface): Promise<string> {
  const address = await arweave.wallets.jwkToAddress(jwk);
  return address;
}
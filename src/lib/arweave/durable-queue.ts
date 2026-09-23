import type { SnapshotMeta } from "./snapshot-types";
import { MAX_UPLOAD_SIZE_BYTES } from "./constants";

export const DURABLE_QUEUE_STATUSES = ["pending", "uploading", "uploaded", "failed"] as const;
export type DurableQueueStatus = (typeof DURABLE_QUEUE_STATUSES)[number];

/** Ciphertext envelope accepted into the durable queue. No plaintext fields. */
export interface DurableQueueInput {
  id: string;
  contentHash: string;
  snapshotVersion: number;
  ciphertext: string;
  metadata: SnapshotMeta;
}

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateDurableQueueInput(input: DurableQueueInput): string | null {
  if (!UUID_PATTERN.test(input.id)) return "Invalid queue id";
  if (!HASH_PATTERN.test(input.contentHash)) return "Invalid content hash";
  if (!Number.isInteger(input.snapshotVersion) || input.snapshotVersion < 1) return "Invalid snapshot version";
  if (input.metadata.contentHash !== input.contentHash || input.metadata.version !== input.snapshotVersion) {
    return "Metadata does not match the queue item";
  }
  const bytes = new TextEncoder().encode(input.ciphertext).byteLength;
  if (bytes < 1 || bytes > MAX_UPLOAD_SIZE_BYTES) return "Encrypted payload is an invalid size";
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.ciphertext) as { iv?: unknown; ciphertext?: unknown; salt?: unknown };
  } catch {
    return "Encrypted payload is not a JSON envelope";
  }
  const envelope = parsed as { iv?: unknown; ciphertext?: unknown; salt?: unknown };
  if (typeof envelope.iv !== "string" || typeof envelope.ciphertext !== "string" || typeof envelope.salt !== "string") {
    return "Encrypted payload is missing envelope fields";
  }
  return null;
}

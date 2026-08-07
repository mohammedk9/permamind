/**
 * Deduplication utilities for the Arweave snapshot pipeline.
 *
 * Prevents identical snapshot data from being compressed, encrypted, or uploaded
 * more than once. Uses SHA-256 content hashing with deterministic JSON serialization
 * to ensure identical data always produces the same hash regardless of key
 * insertion order.
 *
 * Pipeline position:
 *   build snapshot → canonicalJSON → computeContentHash → isDuplicate? → skip or continue
 */

import type { DedupEntry } from "./snapshot-types";
import { DEDUP_HASH_ALGORITHM } from "./constants";
import { DEDUP_REGISTRY_KEY } from "./constants";

// ---------------------------------------------------------------------------
// Canonical JSON
// ---------------------------------------------------------------------------

/**
 * Serializes a value to a canonical JSON string with recursively sorted keys.
 *
 * This function guarantees that two objects with identical data but different
 * key insertion orders will produce the exact same JSON string. This is
 * critical for content-addressable hashing — the SHA-256 hash must be
 * deterministic for deduplication to work.
 *
 * Rules:
 * - Object keys are sorted alphabetically at every depth (recursive).
 * - Arrays maintain their original order (conversation order is meaningful).
 * - Primitives (string, number, boolean, null) are serialized normally.
 * - `undefined` values and functions are omitted (standard JSON behavior).
 * - No whitespace in the output.
 * - Dates must already be ISO 8601 strings before reaching this function
 *   (the snapshot payload uses string dates, not Date objects).
 *
 * @param obj - Any JSON-serializable value.
 * @returns A deterministic JSON string.
 *
 * @example
 * ```ts
 * // These produce identical output:
 * canonicalJSON({ b: 2, a: 1 })  // '{"a":1,"b":2}'
 * canonicalJSON({ a: 1, b: 2 })  // '{"a":1,"b":2}'
 *
 * // Nested objects are sorted recursively:
 * canonicalJSON({ z: { b: 2, a: 1 }, a: 1 })
 * // '{"a":1,"z":{"a":1,"b":2}}'
 * ```
 */
export function canonicalJSON(obj: unknown): string {
  return JSON.stringify(sortValue(obj));
}

/**
 * Recursively sorts an object's keys and returns a new object with
 * alphabetically ordered keys. Arrays are mapped element-by-element.
 * Primitives are returned as-is.
 */
function sortValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const key of keys) {
      const v = (value as Record<string, unknown>)[key];
      // Skip undefined values (consistent with JSON.stringify behavior)
      if (v !== undefined) {
        sorted[key] = sortValue(v);
      }
    }
    return sorted;
  }

  // Primitives: string, number, boolean
  return value;
}

// ---------------------------------------------------------------------------
// Content Hashing
// ---------------------------------------------------------------------------

/**
 * Computes a SHA-256 hash of a string and returns it as a lowercase hex string.
 *
 * Uses the Web Crypto API (`crypto.subtle.digest`) for the hash computation.
 * The input is typically the output of {@link canonicalJSON} applied to a
 * snapshot payload.
 *
 * @param data - The string to hash (typically canonical JSON).
 * @returns A lowercase hex-encoded SHA-256 hash (64 characters).
 *
 * @example
 * ```ts
 * const json = canonicalJSON(snapshotPayload);
 * const hash = await computeContentHash(json);
 * // hash = "a3f2b8c1d4e5..." (64 hex chars)
 * ```
 */
export async function computeContentHash(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);

  const hashBuffer = await crypto.subtle.digest(
    DEDUP_HASH_ALGORITHM,
    encoded.buffer as ArrayBuffer
  );

  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Converts a Uint8Array to a lowercase hexadecimal string.
 */
function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

// ---------------------------------------------------------------------------
// Duplicate Detection
// ---------------------------------------------------------------------------

/**
 * Checks whether a content hash already exists in the deduplication registry.
 *
 * A snapshot is considered a duplicate if its SHA-256 content hash matches
 * any entry in the registry. Duplicate snapshots should be skipped entirely —
 * no compression, no encryption, no upload.
 *
 * @param hash - The SHA-256 hex hash of the snapshot's canonical JSON payload.
 * @param registry - The current deduplication registry entries.
 * @returns `true` if the hash already exists in the registry; `false` otherwise.
 *
 * @example
 * ```ts
 * const hash = await computeContentHash(canonicalJSON(payload));
 * if (isDuplicate(hash, dedupRegistry.entries)) {
 *   // Skip — this data was already uploaded
 *   return;
 * }
 * ```
 */
export function isDuplicate(hash: string, registry: DedupEntry[]): boolean {
  return registry.some((entry) => entry.contentHash === hash);
}

function loadDedupEntries(): DedupEntry[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(DEDUP_REGISTRY_KEY);
  if (!raw) return [];
  const data = JSON.parse(raw) as { version: number; entries: DedupEntry[] };
  if (data.version !== 1 || !Array.isArray(data.entries)) throw new Error("Invalid dedup registry");
  return data.entries;
}

function saveDedupEntries(entries: DedupEntry[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DEDUP_REGISTRY_KEY, JSON.stringify({ version: 1, entries }));
}

export function addDedupEntry(entry: DedupEntry): void {
  const entries = loadDedupEntries();
  if (!isDuplicate(entry.contentHash, entries)) saveDedupEntries([...entries, entry]);
}

export function updateDedupTxId(contentHash: string, txId: string): void {
  const entries = loadDedupEntries();
  const entry = entries.find((candidate) => candidate.contentHash === contentHash);
  if (!entry) throw new Error(`Dedup entry not found: ${contentHash}`);
  entry.txId = txId;
  saveDedupEntries(entries);
}
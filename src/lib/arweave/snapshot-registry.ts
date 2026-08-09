/**
 * Snapshot registry — persistent metadata store for all Arweave snapshots.
 *
 * Tracks every snapshot ever created, forming a versioned chain that enables:
 * - Delta snapshot diffing (what changed since the last snapshot?)
 * - Restoration from Arweave (walk the chain from the latest full snapshot)
 * - Transaction ID tracking (which snapshots have been uploaded?)
 *
 * Storage convention matches `src/lib/storage/chat-storage.ts`:
 * - Versioned localStorage key (`permamind:snapshots:meta:v1`)
 * - JSON parse/stringify with SSR guard (`typeof window === "undefined"`)
 * - try/catch for quota errors and private browsing
 */

import type { SnapshotMeta, SnapshotRegistry } from "./snapshot-types";
import { SNAPSHOT_REGISTRY_KEY } from "./constants";
import { withLease } from "./coordination";

// ---------------------------------------------------------------------------
// Registry Load / Save
// ---------------------------------------------------------------------------

/**
 * Loads the snapshot registry from localStorage.
 *
 * Returns an empty registry if:
 * - Running on the server (SSR)
 * - The key does not exist in localStorage
 * - The stored data is malformed or has an unexpected schema version
 * - A JSON parse error occurs
 *
 * @returns The current {@link SnapshotRegistry}, or an empty registry.
 */
export function loadRegistry(): SnapshotRegistry {
  if (typeof window === "undefined") {
    return { version: 1, snapshots: [] };
  }

  try {
    const raw = localStorage.getItem(SNAPSHOT_REGISTRY_KEY);
    if (!raw) return { version: 1, snapshots: [] };

    const data = JSON.parse(raw) as SnapshotRegistry;

    // Validate schema version
    if (data.version !== 1 || !Array.isArray(data.snapshots)) {
      return { version: 1, snapshots: [] };
    }

    return data;
  } catch {
    return { version: 1, snapshots: [] };
  }
}

/**
 * Saves the snapshot registry to localStorage.
 *
 * Silently fails if localStorage is unavailable (quota exceeded, private browsing).
 *
 * @param registry - The {@link SnapshotRegistry} to persist.
 */
export function saveRegistry(registry: SnapshotRegistry): void {
  if (typeof window === "undefined") return;

  localStorage.setItem(SNAPSHOT_REGISTRY_KEY, JSON.stringify(registry));
}

/** Validates the persisted snapshot chain before it is used for restore. */
export function validateSnapshotChain(snapshots: SnapshotMeta[]): void {
  const seen = new Set<number>();
  for (let i = 0; i < snapshots.length; i++) {
    const snapshot = snapshots[i];
    if (seen.has(snapshot.version)) throw new Error(`Duplicate snapshot version: v${snapshot.version}`);
    seen.add(snapshot.version);
    if (i > 0 && snapshot.version <= snapshots[i - 1].version) {
      throw new Error(`Snapshot versions are not strictly increasing at v${snapshot.version}`);
    }
    if (i === 0) {
      if (snapshot.parentVersion !== null || snapshot.parentTxId !== null) {
        throw new Error(`Snapshot v${snapshot.version} has an unexpected parent`);
      }
      continue;
    }
    const parent = snapshots[i - 1];
    if (snapshot.parentVersion !== parent.version) {
      throw new Error(`Snapshot v${snapshot.version} has missing or invalid parent`);
    }
    if (snapshot.parentTxId !== parent.txId) {
      throw new Error(`Snapshot v${snapshot.version} has inconsistent parent transaction`);
    }
    if (snapshot.type === "delta" && snapshot.epoch !== parent.epoch) {
      throw new Error(`Delta snapshot v${snapshot.version} crosses epochs`);
    }
    if (snapshot.type === "full" && snapshot.epoch <= parent.epoch) {
      throw new Error(`Full snapshot v${snapshot.version} does not advance epoch`);
    }
  }
}

// ---------------------------------------------------------------------------
// Query Functions
// ---------------------------------------------------------------------------

/**
 * Returns the most recent snapshot in the registry, or `null` if empty.
 *
 * "Most recent" is determined by the highest version number.
 * The registry is expected to be ordered by version ascending, so the
 * last element is the latest.
 *
 * @returns The latest {@link SnapshotMeta}, or `null` if no snapshots exist.
 */
export function getLastSnapshot(): SnapshotMeta | null {
  const registry = loadRegistry();
  if (registry.snapshots.length === 0) return null;
  return registry.snapshots[registry.snapshots.length - 1];
}

/**
 * Finds a snapshot by its version number.
 *
 * @param version - The version number to search for.
 * @returns The matching {@link SnapshotMeta}, or `null` if not found.
 */
export function getSnapshotByVersion(version: number): SnapshotMeta | null {
  const registry = loadRegistry();
  return registry.snapshots.find((s) => s.version === version) ?? null;
}

/**
 * Returns all snapshots in the registry, ordered by version ascending.
 *
 * @returns An array of all {@link SnapshotMeta} records.
 */
export function getAllSnapshots(): SnapshotMeta[] {
  const registry = loadRegistry();
  return registry.snapshots;
}

/**
 * Returns the most recent full (compaction) snapshot in the registry.
 *
 * Used by the snapshot builder to determine:
 * - The current epoch number (increments on each full snapshot)
 * - Whether a new full snapshot is needed (compaction interval check)
 * - The starting point for restoration from Arweave
 *
 * @returns The latest full {@link SnapshotMeta}, or `null` if none exists.
 */
export function getLatestFullSnapshot(): SnapshotMeta | null {
  const registry = loadRegistry();

  // Walk backwards to find the most recent full snapshot
  for (let i = registry.snapshots.length - 1; i >= 0; i--) {
    if (registry.snapshots[i].type === "full") {
      return registry.snapshots[i];
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Mutation Functions
// ---------------------------------------------------------------------------

/**
 * Adds a new snapshot metadata record to the registry and persists it.
 *
 * The snapshot is appended to the end of the array. The caller is responsible
 * for ensuring the version number is correct (monotonically increasing).
 *
 * @param meta - The {@link SnapshotMeta} record to add.
 */
export function addSnapshot(meta: SnapshotMeta): void {
  withLease("snapshot-registry", () => {
    const registry = loadRegistry();
    validateSnapshotChain([...registry.snapshots, meta]);
    registry.snapshots.push(meta);
    saveRegistry(registry);
  });
}

/** Removes a snapshot metadata record, used to roll back a failed enqueue. */
export function removeSnapshot(version: number): void {
  withLease("snapshot-registry", () => {
    const registry = loadRegistry();
    registry.snapshots = registry.snapshots.filter((snapshot) => snapshot.version !== version);
    saveRegistry(registry);
  });
}

/**
 * Updates the Arweave transaction ID for a specific snapshot version.
 *
 * Called after a successful upload to record the txId. If the version
 * is not found, this is a no-op.
 *
 * @param version - The snapshot version number to update.
 * @param txId - The Arweave transaction ID to record.
 */
export function updateTxId(version: number, txId: string, uploadedAt = new Date().toISOString()): void {
  withLease("snapshot-registry", () => {
  const registry = loadRegistry();

  const snapshot = registry.snapshots.find((s) => s.version === version);
  if (!snapshot) throw new Error(`Snapshot metadata not found: v${version}`);

  snapshot.txId = txId;
  snapshot.uploadedAt = uploadedAt;
  saveRegistry(registry);
  });
}
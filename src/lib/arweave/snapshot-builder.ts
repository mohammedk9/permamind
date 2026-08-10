/**
 * Snapshot builder — the core intelligence layer of the Arweave pipeline.
 *
 * Reads the current conversation state, diffs it against the last known state,
 * decides full vs. delta, assigns versions, computes content hashes, checks
 * deduplication, and produces a {@link SnapshotBuildResult} ready for compression.
 *
 * Pipeline position:
 *   localStorage → buildSnapshot → compress → encrypt → enqueue → upload
 *
 * Key design decisions:
 * - A fingerprint cache (separate localStorage key) tracks per-conversation
 *   fingerprints to enable efficient change detection without decrypting
 *   previous snapshots.
 * - Full snapshots are forced at the first run and every COMPACTION_INTERVAL
 *   deltas to prevent unbounded delta chains.
 * - Deduplication is checked at the snapshot level via SHA-256 content hash.
 */

import type { Conversation } from "@/types/chat";
import type {
  DedupRegistry,
  SnapshotBuildResult,
  SnapshotConversation,
  SnapshotDeletionMarker,
  SnapshotMeta,
  SnapshotPayload,
  SnapshotRegistry,
  SnapshotType,
} from "./snapshot-types";
import { COMPACTION_INTERVAL, DEDUP_REGISTRY_KEY } from "./constants";
import { getMessageFingerprint } from "@/lib/ai/summarize";
import { canonicalJSON, computeContentHash, isDuplicate } from "./dedup";
import { DEFAULT_STORAGE_POLICY, filterConversationsByPolicy, loadStoragePolicy, type StoragePolicy } from "./storage-policy";

// ---------------------------------------------------------------------------
// Fingerprint Cache (internal)
// ---------------------------------------------------------------------------

/**
 * localStorage key for the per-conversation fingerprint cache.
 *
 * This cache tracks the message fingerprint of every conversation at the time
 * of the last snapshot, enabling efficient change detection without needing to
 * decrypt previous snapshot payloads.
 */
const FINGERPRINT_CACHE_KEY = "permamind:snapshots:fingerprints:v1";

/**
 * Internal cache structure. Maps conversation IDs to their last-snapshotted
 * message fingerprint (as produced by {@link getMessageFingerprint}).
 */
interface FingerprintCache {
  version: 1;
  fingerprints: Record<string, string>;
}

/**
 * Loads the fingerprint cache from localStorage.
 * Returns an empty cache on SSR, missing key, malformed data, or parse error.
 */
function loadFingerprintCache(): FingerprintCache {
  if (typeof window === "undefined") {
    return { version: 1, fingerprints: {} };
  }

  try {
    const raw = localStorage.getItem(FINGERPRINT_CACHE_KEY);
    if (!raw) return { version: 1, fingerprints: {} };

    const data = JSON.parse(raw) as FingerprintCache;
    if (data.version !== 1 || typeof data.fingerprints !== "object" || data.fingerprints === null) {
      return { version: 1, fingerprints: {} };
    }

    return data;
  } catch {
    return { version: 1, fingerprints: {} };
  }
}

/**
 * Persists the fingerprint cache to localStorage.
 * Silently fails on quota errors or private browsing.
 */
function saveFingerprintCache(cache: FingerprintCache): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(FINGERPRINT_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Quota exceeded or private browsing — fail silently
  }
}

// ---------------------------------------------------------------------------
// Dedup Registry Loader (internal)
// ---------------------------------------------------------------------------

/**
 * Loads deduplication entries from localStorage.
 * Returns an empty array on SSR, missing key, malformed data, or parse error.
 */
function loadDedupEntries(): DedupRegistry["entries"] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(DEDUP_REGISTRY_KEY);
    if (!raw) return [];

    const data = JSON.parse(raw) as DedupRegistry;
    if (data.version !== 1 || !Array.isArray(data.entries)) return [];

    return data.entries;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Registry Query Helpers (internal, operate on the passed-in registry)
// ---------------------------------------------------------------------------

/**
 * Returns the last snapshot from the passed-in registry, or null if empty.
 * Mirrors the logic of `getLastSnapshot()` from snapshot-registry.ts but
 * operates on the provided registry to avoid a redundant localStorage read.
 */
function getLastSnapshotFromRegistry(registry: SnapshotRegistry): SnapshotMeta | null {
  if (registry.snapshots.length === 0) return null;
  return registry.snapshots[registry.snapshots.length - 1];
}

/**
 * Returns the latest full snapshot from the passed-in registry, or null.
 * Mirrors the logic of `getLatestFullSnapshot()` from snapshot-registry.ts.
 */
function getLatestFullSnapshotFromRegistry(registry: SnapshotRegistry): SnapshotMeta | null {
  for (let i = registry.snapshots.length - 1; i >= 0; i--) {
    if (registry.snapshots[i].type === "full") {
      return registry.snapshots[i];
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Diffing Logic
// ---------------------------------------------------------------------------

/** Result of comparing current conversations against the fingerprint cache. */
interface ConversationDiff {
  /** Conversations that did not exist in the last snapshot. */
  newConversations: Conversation[];
  /** Conversations whose message fingerprint changed since the last snapshot. */
  modifiedConversations: Conversation[];
  /** IDs of conversations that existed in the last snapshot but are now gone. */
  deletedIds: string[];
}

/**
 * Compares the current conversation list against the fingerprint cache to
 * identify new, modified, and deleted conversations.
 *
 * - **New:** conversation ID is not in the cache.
 * - **Modified:** conversation ID is in the cache but its current fingerprint
 *   (computed via {@link getMessageFingerprint}) differs from the cached one.
 * - **Deleted:** conversation ID is in the cache but not in the current list.
 *
 * @param conversations - The current list of all conversations.
 * @returns A {@link ConversationDiff} with new, modified, and deleted entries.
 */
function getChangedConversations(conversations: Conversation[]): ConversationDiff {
  const cache = loadFingerprintCache();
  const currentIds = new Set(conversations.map((c) => c.id));

  const newConversations: Conversation[] = [];
  const modifiedConversations: Conversation[] = [];

  for (const conv of conversations) {
    const currentFingerprint = getMessageFingerprint(conv.messages);
    const cachedFingerprint = cache.fingerprints[conv.id];

    if (!cachedFingerprint) {
      // Conversation not in cache → new
      newConversations.push(conv);
    } else if (currentFingerprint !== cachedFingerprint) {
      // Fingerprint changed → modified
      modifiedConversations.push(conv);
    }
    // else: unchanged — skip
  }

  // Any cached ID not in the current set → deleted
  const deletedIds = Object.keys(cache.fingerprints).filter(
    (id) => !currentIds.has(id)
  );

  return { newConversations, modifiedConversations, deletedIds };
}

// ---------------------------------------------------------------------------
// Versioning Logic
// ---------------------------------------------------------------------------

/**
 * Determines whether the next snapshot should be a full (compaction) snapshot.
 *
 * Rules:
 * 1. The first snapshot is always full.
 * 2. After {@link COMPACTION_INTERVAL} delta snapshots since the last full
 *    snapshot, the next snapshot is forced to be full.
 * 3. Otherwise, the next snapshot is a delta.
 *
 * @param registry - The current snapshot registry.
 * @returns `true` if the next snapshot should be full; `false` for delta.
 */
function shouldBuildFull(registry: SnapshotRegistry): boolean {
  const lastSnapshot = getLastSnapshotFromRegistry(registry);

  // First snapshot is always full
  if (!lastSnapshot) return true;

  const lastFull = getLatestFullSnapshotFromRegistry(registry);
  const lastFullVersion = lastFull?.version ?? 0;
  const deltasSinceLastFull = lastSnapshot.version - lastFullVersion;

  return deltasSinceLastFull >= COMPACTION_INTERVAL;
}

/**
 * Assigns the next monotonically increasing version number.
 *
 * @param registry - The current snapshot registry.
 * @returns The next version number (1 if no snapshots exist).
 */
function assignVersion(registry: SnapshotRegistry): number {
  const lastSnapshot = getLastSnapshotFromRegistry(registry);
  if (!lastSnapshot) return 1;
  return lastSnapshot.version + 1;
}

/**
 * Assigns the epoch number for the next snapshot.
 *
 * The epoch increments on every full snapshot. Delta snapshots inherit the
 * current epoch. The first full snapshot is epoch 1.
 *
 * @param registry - The current snapshot registry.
 * @param isFull - Whether the next snapshot is full.
 * @returns The epoch number for the next snapshot.
 */
function assignEpoch(registry: SnapshotRegistry, isFull: boolean): number {
  const lastFull = getLatestFullSnapshotFromRegistry(registry);
  const currentEpoch = lastFull?.epoch ?? 0;
  return isFull ? currentEpoch + 1 : currentEpoch;
}

// ---------------------------------------------------------------------------
// Payload Construction
// ---------------------------------------------------------------------------

/**
 * Converts a runtime {@link Conversation} (with Date objects) into a
 * {@link SnapshotConversation} (with ISO 8601 strings).
 *
 * Filters out streaming messages and empty messages, matching the
 * serialization pattern in `chat-storage.ts`.
 */
function conversationToSnapshot(conv: Conversation): SnapshotConversation {
  return {
    id: conv.id,
    title: conv.title,
    messages: conv.messages
      .filter((m) => !m.isStreaming && m.content.trim().length > 0)
      .map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    metadata: conv.metadata
      ? {
          summary: conv.metadata.summary,
          topics: conv.metadata.topics,
          tags: conv.metadata.tags,
          entities: conv.metadata.entities,
          messageFingerprint: conv.metadata.messageFingerprint,
          generatedAt: conv.metadata.generatedAt.toISOString(),
        }
      : undefined,
  };
}

/**
 * Builds deletion markers for conversations that were removed since the
 * last snapshot. Only used in delta snapshots.
 *
 * @param deletedIds - IDs of deleted conversations.
 * @returns An array of {@link SnapshotDeletionMarker} objects.
 */
function buildDeletionMarkers(deletedIds: string[]): SnapshotDeletionMarker[] {
  const now = new Date().toISOString();
  return deletedIds.map((id) => ({
    conversationId: id,
    deletedAt: now,
  }));
}

/**
 * Constructs the complete {@link SnapshotPayload} — the plaintext data that
 * will be compressed, encrypted, and uploaded.
 *
 * @param version - Snapshot version number.
 * @param epoch - Snapshot epoch number.
 * @param type - "full" or "delta".
 * @param conversations - Conversations to include in the payload.
 * @param deletions - Deletion markers (empty for full snapshots).
 * @returns The complete {@link SnapshotPayload}.
 */
function buildPayload(
  version: number,
  epoch: number,
  type: SnapshotType,
  conversations: Conversation[],
  deletions: SnapshotDeletionMarker[]
): SnapshotPayload {
  return {
    version,
    epoch,
    type,
    createdAt: new Date().toISOString(),
    conversations: conversations.map(conversationToSnapshot),
    deletions,
  };
}

// ---------------------------------------------------------------------------
// Fingerprint Cache Update
// ---------------------------------------------------------------------------

/**
 * Updates the fingerprint cache after a successful snapshot build.
 *
 * - **Full snapshot:** Rebuilds the cache from scratch with all current
 *   conversations. This ensures the cache is a clean representation of
 *   the complete state.
 * - **Delta snapshot:** Incrementally updates the cache — adds/updates
 *   fingerprints for included conversations, removes fingerprints for
 *   deleted conversations, and preserves fingerprints for unchanged ones.
 *
 * @param includedConversations - Conversations included in the snapshot.
 * @param deletedIds - IDs of deleted conversations.
 * @param isFull - Whether this is a full snapshot.
 */
function updateFingerprintCache(
  includedConversations: Conversation[],
  deletedIds: string[],
  isFull: boolean
): void {
  if (isFull) {
    // Rebuild from scratch for full snapshots
    const cache: FingerprintCache = {
      version: 1,
      fingerprints: {},
    };
    for (const conv of includedConversations) {
      cache.fingerprints[conv.id] = getMessageFingerprint(conv.messages);
    }
    saveFingerprintCache(cache);
  } else {
    // Incremental update for delta snapshots
    const cache = loadFingerprintCache();
    for (const conv of includedConversations) {
      cache.fingerprints[conv.id] = getMessageFingerprint(conv.messages);
    }
    for (const id of deletedIds) {
      delete cache.fingerprints[id];
    }
    saveFingerprintCache(cache);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a snapshot from the current conversation state.
 *
 * This is the main entry point for the snapshot pipeline. It:
 *
 * 1. Diffs current conversations against the fingerprint cache to detect
 *    new, modified, and deleted conversations.
 * 2. Returns `null` if nothing has changed since the last snapshot.
 * 3. Determines whether the snapshot should be full or delta.
 * 4. Assigns the next version number and epoch.
 * 5. Constructs the {@link SnapshotPayload}.
 * 6. Computes the SHA-256 content hash via {@link canonicalJSON} +
 *    {@link computeContentHash}.
 * 7. Checks the deduplication registry via {@link isDuplicate}.
 * 8. Updates the fingerprint cache to reflect the new state.
 * 9. Returns a {@link SnapshotBuildResult} with the payload, metadata,
 *    and dedup flag.
 *
 * The returned `meta` has `compressedSize: 0` and `encryptedSize: 0` —
 * these are filled by the pipeline after compression and encryption.
 * The `txId` is `null` — it is filled after a successful Arweave upload.
 *
 * @param conversations - The current list of all conversations from localStorage.
 * @param registry - The current snapshot registry (loaded via `loadRegistry()`).
 * @returns A {@link SnapshotBuildResult} if a snapshot should be created,
 *          or `null` if nothing has changed.
 *
 * @example
 * ```ts
 * const { conversations } = loadChatData();
 * const registry = loadRegistry();
 * const result = await buildSnapshot(conversations, registry);
 *
 * if (!result) {
 *   console.log("No changes — skipping snapshot");
 * } else if (result.isDuplicate) {
 *   console.log("Duplicate content — skipping upload");
 * } else {
 *   // Proceed with compress → encrypt → enqueue
 * }
 * ```
 */
export async function buildSnapshot(
  conversations: Conversation[],
  registry: SnapshotRegistry,
  policy: StoragePolicy = "store_everything"
): Promise<SnapshotBuildResult | null> {
  const eligibleConversations = filterConversationsByPolicy(conversations, policy);
  // Step 1: Diff current state against fingerprint cache
  const { newConversations, modifiedConversations, deletedIds } =
    getChangedConversations(eligibleConversations);

  // Step 2: If nothing changed, return null
  const hasChanges =
    newConversations.length > 0 ||
    modifiedConversations.length > 0 ||
    deletedIds.length > 0;

  if (!hasChanges) {
    return null;
  }

  // Step 3: Determine full vs. delta
  const isFull = shouldBuildFull(registry);
  const type: SnapshotType = isFull ? "full" : "delta";

  // Step 4: Assign version and epoch
  const version = assignVersion(registry);
  const epoch = assignEpoch(registry, isFull);

  // Step 5: Determine included conversations
  // Full snapshot: all conversations. Delta: only new + modified.
  const includedConversations = isFull
    ? eligibleConversations
    : [...newConversations, ...modifiedConversations];

  // Step 6: Build deletion markers (only for delta snapshots)
  const deletions = isFull ? [] : buildDeletionMarkers(deletedIds);

  // Step 7: Construct the payload
  const payload = buildPayload(version, epoch, type, includedConversations, deletions);

  // Step 8: Compute content hash for deduplication
  const json = canonicalJSON(payload);
  const contentHash = await computeContentHash(json);

  // Step 9: Check deduplication registry
  const dedupEntries = loadDedupEntries();
  const duplicate = isDuplicate(contentHash, dedupEntries);

  // Step 10: Build metadata record
  const lastSnapshot = getLastSnapshotFromRegistry(registry);

  const messageCount = includedConversations.reduce(
    (sum, conv) =>
      sum +
      conv.messages.filter((m) => !m.isStreaming && m.content.trim().length > 0)
        .length,
    0
  );

  const meta: SnapshotMeta = {
    version,
    epoch,
    type,
    parentVersion: lastSnapshot?.version ?? null,
    parentTxId: lastSnapshot?.txId ?? null,
    createdAt: new Date().toISOString(),
    contentHash,
    conversationIds: includedConversations.map((c) => c.id),
    messageCount,
    compressedSize: 0, // filled by pipeline after compression
    encryptedSize: 0, // filled by pipeline after encryption
    txId: null, // filled after Arweave upload
  };

  // Step 11: Update fingerprint cache (even if duplicate — the state is still current)
  updateFingerprintCache(includedConversations, deletedIds, isFull);

  return {
    payload,
    meta,
    isDuplicate: duplicate,
  };
}
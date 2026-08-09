/** Restore encrypted Arweave snapshots into the existing chat storage schema. */
import type { Conversation } from "@/types/chat";
import { saveChatData } from "@/lib/storage/chat-storage";
import { bytesToJson, decompress } from "./compression";
import { canonicalJSON, computeContentHash } from "./dedup";
import { decrypt, deriveKey } from "./encryption";
import { loadRegistry, validateSnapshotChain } from "./snapshot-registry";
import type {
  EncryptedPayload,
  SnapshotMeta,
  SnapshotPayload,
  SnapshotConversation,
} from "./snapshot-types";
import {
  MAX_DECOMPRESSED_PAYLOAD_BYTES,
  MAX_ENCRYPTED_PAYLOAD_BYTES,
  MAX_RESTORE_CONVERSATIONS,
  MAX_RESTORE_MESSAGES,
} from "./constants";

const GATEWAY = "https://arweave.net";

export interface RestoreOptions {
  passphrase: string;
  /** Must return true immediately before the local chat data is replaced. */
  confirm: boolean | (() => boolean | Promise<boolean>);
  gateway?: string;
  fetcher?: typeof fetch;
}

export interface ManualRestoreOptions extends RestoreOptions {
  txId: string;
}

export interface RestoreResult {
  status: "restored" | "cancelled" | "failed";
  conversationCount: number;
  snapshotVersion: number | null;
  message: string;
  error: string | null;
}

class CorruptSnapshotError extends Error {
  constructor(message: string) {
    super(`Corrupt snapshot: ${message}`);
    this.name = "CorruptSnapshotError";
  }
}

function isValidConversation(value: unknown): value is SnapshotConversation {
  const c = value as SnapshotConversation;
  return !!c && typeof c === "object" && typeof c.id === "string" &&
    typeof c.title === "string" && Array.isArray(c.messages) &&
    typeof c.createdAt === "string" && typeof c.updatedAt === "string" &&
    c.messages.every((m) => !!m && typeof m.id === "string" &&
      (m.role === "user" || m.role === "assistant") && typeof m.content === "string" &&
      typeof m.createdAt === "string");
}

function isValidDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function validateDates(payload: SnapshotPayload): void {
  if (!isValidDate(payload.createdAt)) throw new CorruptSnapshotError("invalid payload date");
  for (const conversation of payload.conversations) {
    if (!isValidDate(conversation.createdAt) || !isValidDate(conversation.updatedAt)) {
      throw new CorruptSnapshotError(`invalid dates in conversation ${conversation.id}`);
    }
    for (const message of conversation.messages) {
      if (!isValidDate(message.createdAt)) throw new CorruptSnapshotError(`invalid date in message ${message.id}`);
    }
    if (conversation.metadata && !isValidDate(conversation.metadata.generatedAt)) {
      throw new CorruptSnapshotError(`invalid metadata date in conversation ${conversation.id}`);
    }
  }
  for (const deletion of payload.deletions) {
    if (!isValidDate(deletion.deletedAt)) throw new CorruptSnapshotError("invalid deletion date");
  }
}

function validatePayload(payload: unknown, meta: SnapshotMeta): asserts payload is SnapshotPayload {
  const p = payload as SnapshotPayload;
  if (!p || typeof p !== "object" || p.version !== meta.version ||
      p.epoch !== meta.epoch || p.type !== meta.type ||
      typeof p.createdAt !== "string" || !Array.isArray(p.conversations) ||
      !Array.isArray(p.deletions) || !p.conversations.every(isValidConversation) ||
      !p.deletions.every((d) => d && typeof d.conversationId === "string" && typeof d.deletedAt === "string")) {
    throw new CorruptSnapshotError(`metadata does not match snapshot v${meta.version}`);
  }
  validateDates(p);
}

async function download(meta: SnapshotMeta, options: RestoreOptions): Promise<SnapshotPayload> {
  if (!meta.txId) throw new CorruptSnapshotError(`snapshot v${meta.version} has no transaction ID`);
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(`${options.gateway ?? GATEWAY}/${meta.txId}/data`);
  if (!response.ok) throw new Error(`Unable to download snapshot v${meta.version} (HTTP ${response.status})`);
  const encrypted = await response.json() as EncryptedPayload;
  if (!encrypted || typeof encrypted.iv !== "string" || typeof encrypted.ciphertext !== "string" || typeof encrypted.salt !== "string") {
    throw new CorruptSnapshotError(`invalid encrypted envelope for v${meta.version}`);
  }
  let encryptedBytes: Uint8Array;
  try { encryptedBytes = Uint8Array.from(atob(encrypted.ciphertext), (c) => c.charCodeAt(0)); }
  catch { throw new CorruptSnapshotError(`invalid encrypted payload for v${meta.version}`); }
  if (encryptedBytes.byteLength > MAX_ENCRYPTED_PAYLOAD_BYTES) {
    throw new CorruptSnapshotError(`encrypted payload exceeds the ${MAX_ENCRYPTED_PAYLOAD_BYTES}-byte limit`);
  }
  try {
    const salt = Uint8Array.from(atob(encrypted.salt), (c) => c.charCodeAt(0));
    const plaintext = await decrypt(encrypted, await deriveKey(options.passphrase, salt));
    const decompressed = await decompress(plaintext);
    if (decompressed.byteLength > MAX_DECOMPRESSED_PAYLOAD_BYTES) {
      throw new CorruptSnapshotError(`decompressed payload exceeds the ${MAX_DECOMPRESSED_PAYLOAD_BYTES}-byte limit`);
    }
    const payload = bytesToJson<SnapshotPayload>(decompressed);
    validatePayload(payload, meta);
    if (await computeContentHash(canonicalJSON(payload)) !== meta.contentHash) {
      throw new CorruptSnapshotError(`content hash mismatch for v${meta.version}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof CorruptSnapshotError) throw error;
    throw new CorruptSnapshotError(`unable to decrypt or decode v${meta.version}`);
  }
}

function manualMeta(txId: string, tags: Record<string, string>): SnapshotMeta {
  const version = Number(tags["Snapshot-Version"]);
  const epoch = Number(tags["Snapshot-Epoch"]);
  if (!/^[A-Za-z0-9_-]{43}$/.test(txId) || !Number.isInteger(version) || !Number.isInteger(epoch) ||
      (tags["Snapshot-Type"] !== "full" && tags["Snapshot-Type"] !== "delta") ||
      !/^[a-f0-9]{64}$/.test(tags["Content-Hash"] ?? "")) {
    throw new CorruptSnapshotError("transaction is not a valid PermaMind snapshot");
  }
  return { version, epoch, type: tags["Snapshot-Type"] as "full" | "delta", parentVersion: null,
    parentTxId: null, createdAt: tags["Created-At"] ?? new Date(0).toISOString(), contentHash: tags["Content-Hash"],
    conversationIds: [], messageCount: 0, compressedSize: 0, encryptedSize: 0, txId };
}

export async function restoreSnapshotByTxId(options: ManualRestoreOptions): Promise<RestoreResult> {
  try {
    if (!options.passphrase) throw new Error("A passphrase is required");
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(`${options.gateway ?? GATEWAY}/tx/${options.txId}`);
    if (!response.ok) throw new Error(`Unable to find snapshot (HTTP ${response.status})`);
    const transaction = await response.json() as { tags?: Array<{ name?: string; value?: string }> };
    const tags = Object.fromEntries((transaction.tags ?? []).filter((tag) => tag.name && tag.value).map((tag) => [tag.name!, tag.value!]));
    if (tags["App-Name"] !== "PermaMind") throw new CorruptSnapshotError("transaction does not belong to PermaMind");
    const meta = manualMeta(options.txId, tags);
    if (meta.type !== "full") throw new CorruptSnapshotError("manual recovery requires a full snapshot");
    const payload = await download(meta, options);
    const messageCount = payload.conversations.reduce((total, conversation) => total + conversation.messages.length, 0);
    if (payload.conversations.length > MAX_RESTORE_CONVERSATIONS || messageCount > MAX_RESTORE_MESSAGES) {
      throw new CorruptSnapshotError("restored snapshot exceeds conversation or message limits");
    }
    const confirmed = typeof options.confirm === "function" ? await options.confirm() : options.confirm;
    if (!confirmed) return { status: "cancelled", conversationCount: 0, snapshotVersion: meta.version, message: "Restore cancelled; local data was not changed", error: null };
    const conversations = payload.conversations.map(toConversation);
    saveChatData(conversations, conversations[0]?.id ?? null);
    return { status: "restored", conversationCount: conversations.length, snapshotVersion: meta.version, message: `Restored ${conversations.length} conversations`, error: null };
  } catch (error) {
    return { status: "failed", conversationCount: 0, snapshotVersion: null, message: "Restore failed", error: error instanceof Error ? error.message : String(error) };
  }
}

function toConversation(c: SnapshotConversation): Conversation {
  return {
    id: c.id, title: c.title,
    messages: c.messages.map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: new Date(m.createdAt) })),
    createdAt: new Date(c.createdAt), updatedAt: new Date(c.updatedAt),
    metadata: c.metadata ? { ...c.metadata, generatedAt: new Date(c.metadata.generatedAt) } : undefined,
  };
}

export async function restoreLatestSnapshot(options: RestoreOptions): Promise<RestoreResult> {
  try {
    if (!options.passphrase) throw new Error("A passphrase is required");
    const snapshots = loadRegistry().snapshots;
    validateSnapshotChain(snapshots);
    const latest = snapshots[snapshots.length - 1];
    if (!latest) throw new Error("No snapshots are available to restore");
    const start = snapshots.findIndex((s) => s.epoch === latest.epoch && s.type === "full");
    if (start < 0) throw new CorruptSnapshotError("latest snapshot chain has no full snapshot");
    const state = new Map<string, Conversation>();
    const chain = snapshots.slice(start).filter((s) => s.epoch === latest.epoch && s.version <= latest.version);
    if (chain.length === 0 || chain[chain.length - 1].version !== latest.version) {
      throw new CorruptSnapshotError("latest snapshot chain is incomplete");
    }
    for (const meta of chain) {
      const payload = await download(meta, options);
      if (payload.type === "full") state.clear();
      for (const conversation of payload.conversations) state.set(conversation.id, toConversation(conversation));
      for (const deletion of payload.deletions) state.delete(deletion.conversationId);
      if (state.size > MAX_RESTORE_CONVERSATIONS ||
          [...state.values()].reduce((total, conversation) => total + conversation.messages.length, 0) > MAX_RESTORE_MESSAGES) {
        throw new CorruptSnapshotError("restored snapshot exceeds conversation or message limits");
      }
    }
    const confirmed = typeof options.confirm === "function" ? await options.confirm() : options.confirm;
    if (!confirmed) return { status: "cancelled", conversationCount: 0, snapshotVersion: latest.version, message: "Restore cancelled; local data was not changed", error: null };
    const conversations = [...state.values()];
    saveChatData(conversations, conversations[0]?.id ?? null);
    return { status: "restored", conversationCount: conversations.length, snapshotVersion: latest.version, message: `Restored ${conversations.length} conversations`, error: null };
  } catch (error) {
    return { status: "failed", conversationCount: 0, snapshotVersion: null, message: "Restore failed", error: error instanceof Error ? error.message : String(error) };
  }
}
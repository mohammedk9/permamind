import { decryptSyncValue, encryptSyncValue } from "./sync-encryption";
import type { Conversation } from "@/types/chat";
import { canonicalJSON, computeContentHash } from "@/lib/arweave/dedup";

export type SyncScope = "conversations" | "memories" | "projects";

export interface ConversationSummarySyncPayload {
  conversationId: string;
  title: string;
  summary: string;
  topics: string[];
  tags: string[];
  entities: string[];
  facts: NonNullable<NonNullable<Conversation["metadata"]>["facts"]>;
  decisions: NonNullable<NonNullable<Conversation["metadata"]>["decisions"]>;
  messageCount: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export async function uploadConversationSummary(conversation: Conversation): Promise<"uploaded" | "unchanged"> {
  if (!conversation.metadata) throw new Error("This conversation does not have a summary yet");
  const metadata = conversation.metadata;
  const payload = {
    conversationId: conversation.id,
    title: conversation.title,
    summary: metadata.summary,
    topics: metadata.topics,
    tags: metadata.tags,
    entities: metadata.entities,
    facts: metadata.facts ?? [],
    decisions: metadata.decisions ?? [],
    messageCount: conversation.messages.filter((message) => !message.isStreaming && message.content.trim()).length,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
  const contentHash = await computeContentHash(canonicalJSON(payload));
  const ciphertext = await encryptSyncValue(payload);
  const response = await fetch("/api/sync/summaries", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: conversation.id,
      contentHash,
      ciphertext,
      encryptionVersion: 1,
      sourceCreatedAt: conversation.createdAt.toISOString(),
      sourceUpdatedAt: conversation.updatedAt.toISOString(),
      mcpAllowed: conversation.syncToCloud === true,
    }),
  });
  if (response.status === 304) return "unchanged";
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(error?.error ?? "Could not sync conversation summary");
  }
  return "uploaded";
}

export interface RemoteSyncBlob {
  data_scope: SyncScope;
  ciphertext: string;
  encryption_version: number;
  content_hash?: string | null;
  updated_at: string;
}

export async function uploadEncryptedSync(scope: SyncScope, value: unknown): Promise<void> {
  const ciphertext = await encryptSyncValue(value);
  const contentHash = await computeContentHash(canonicalJSON(value));
  const response = await fetch("/api/sync", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope, ciphertext, contentHash, encryptionVersion: 1 }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "Cloud sync failed");
  }
}

export async function downloadEncryptedSync<T>(scope: SyncScope): Promise<{ value: T; updatedAt: string; contentHash: string | null } | null> {
  const response = await fetch(`/api/sync?scope=${encodeURIComponent(scope)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "Cloud sync download failed");
  }
  const payload = await response.json() as { blob: RemoteSyncBlob | null };
  if (!payload.blob) return null;
  const value = await decryptSyncValue<T>(payload.blob.ciphertext);
  return { value, updatedAt: payload.blob.updated_at, contentHash: payload.blob.content_hash ?? null };
}
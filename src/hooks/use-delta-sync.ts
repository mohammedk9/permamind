"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { loadChatData, saveChatData } from "@/lib/storage/chat-storage";
import { isCloudSyncEnabled } from "@/lib/storage/storage-preferences";
import { decryptSyncValue, setSyncPassphrase } from "@/lib/storage/sync-encryption";
import { fetchSyncDelta, readSyncWatermark, writeSyncWatermark, type ConversationSummarySyncPayload } from "@/lib/storage/sync-client";
import type { Conversation } from "@/types/chat";

/** How often the app checks for work done on another device. */
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** Delay after mount so the first pull cannot race the conversation hydration. */
const INITIAL_SYNC_DELAY_MS = 5_000;

type SyncState = "idle" | "syncing" | "synced" | "error";

interface DeltaSyncResult {
  /** Conversations taken from the cloud because they are newer. */
  merged: number;
  /** Rows that arrived but were older than the local copy. */
  skipped: number;
  /** Rows whose ciphertext could not be decrypted with the current passphrase. */
  undecryptable: number;
}

export interface UseDeltaSyncOptions {
  /** Called after a successful merge so the UI can reload local storage. */
  onApplied?: () => void;
  /** Current passphrase; without it encrypted rows cannot be read. */
  passphrase?: string;
}

/**
 * Pulls conversation summaries written by other devices and merges them in.
 *
 * The merge rule is the one the cloud restore already uses: per conversation,
 * the newer `updatedAt` wins. That is what makes two devices safe at once —
 * editing conversation A on a laptop no longer destroys an edit to conversation
 * B made on a phone, which was the failure mode of the single-blob design.
 *
 * Deliberate limitations:
 *  - it never uploads. Pushing stays an explicit user action, so this can never
 *    quietly send anything to the cloud;
 *  - it never deletes a local conversation that is absent from the response,
 *    because a partial page is not evidence of deletion;
 *  - it advances the watermark only after a successful apply, so a wrong
 *    passphrase is retried rather than skipped forever.
 */
export function useDeltaSync({ onApplied, passphrase }: UseDeltaSyncOptions = {}) {
  const [state, setState] = useState<SyncState>("idle");
  const [lastResult, setLastResult] = useState<DeltaSyncResult | null>(null);
  const running = useRef(false);
  const onAppliedRef = useRef(onApplied);
  const passphraseRef = useRef(passphrase);

  onAppliedRef.current = onApplied;
  passphraseRef.current = passphrase;

const sync = useCallback(async (): Promise<DeltaSyncResult | null> => {
    // Guard against a slow pull overlapping the next interval tick.
    if (running.current) return null;
    if (typeof window === "undefined") return null;
    if (!isCloudSyncEnabled()) return null;

    const unlock = passphraseRef.current;
    if (!unlock) return null;
    setSyncPassphrase(unlock);

    running.current = true;
    setState("syncing");
    try {
      const delta = await fetchSyncDelta({ since: readSyncWatermark() });

      const local = loadChatData();
      const byId = new Map(local.conversations.map((conversation) => [conversation.id, conversation]));
      let merged = 0;
      let skipped = 0;
      let undecryptable = 0;

      for (const row of delta.summaries) {
        const existing = byId.get(row.conversation_id);
        const remoteUpdated = new Date(row.source_updated_at).getTime();
        // Already current locally: nothing to decrypt and nothing to change.
        if (existing && existing.updatedAt.getTime() >= remoteUpdated) {
          skipped += 1;
          continue;
        }

        let payload: ConversationSummarySyncPayload;
        try {
          payload = await decryptSyncValue<ConversationSummarySyncPayload>(row.ciphertext);
        } catch {
          // A wrong passphrase must not advance the watermark, so this row is
          // counted and left for the next attempt.
          undecryptable += 1;
          continue;
        }

        const incoming: Conversation = {
          ...(existing ?? {}),
          id: payload.conversationId,
          title: payload.title,
          createdAt: new Date(payload.createdAt),
          updatedAt: new Date(payload.updatedAt),
          messages: existing?.messages ?? [],
          metadata: {
            summary: payload.summary,
            topics: payload.topics,
            tags: payload.tags,
            entities: payload.entities,
            facts: payload.facts ?? [],
            decisions: payload.decisions ?? [],
            messageFingerprint: payload.contentHash,
            generatedAt: new Date(payload.updatedAt),
          },
        };
        byId.set(incoming.id, incoming);
        merged += 1;
      }

      if (merged > 0) {
        const conversations = [...byId.values()].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
        const activeId = local.activeId && byId.has(local.activeId) ? local.activeId : conversations[0]?.id ?? null;
        saveChatData(conversations, activeId, local.projects);
        onAppliedRef.current?.();
      }

      // Only advance past rows that were actually read. A page containing an
      // undecryptable row must be retried, so the mark stays behind it.
      if (undecryptable === 0) writeSyncWatermark(delta.lastSyncedAt);

      const result = { merged, skipped, undecryptable };
      setLastResult(result);
      setState("synced");
      return result;
    } catch {
      setState("error");
      return null;
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!isCloudSyncEnabled()) return;
    const initial = window.setTimeout(() => void sync(), INITIAL_SYNC_DELAY_MS);
    const interval = window.setInterval(() => void sync(), SYNC_INTERVAL_MS);
    const onFocus = () => void sync();
    window.addEventListener("focus", onFocus);

    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [sync]);

  return { state, lastResult, syncNow: sync };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Conversation } from "@/types/chat";
import type { QueueStatusSummary } from "@/lib/arweave/snapshot-types";
import {
  IDLE_TRIGGER_MS,
  PERIODIC_TRIGGER_MS,
} from "@/lib/arweave/constants";
import { runSnapshotPipeline } from "@/lib/arweave/pipeline";
import { getQueueStatus, retryFailedUploads } from "@/lib/arweave/upload-queue";
import { startProcessor } from "@/lib/arweave/queue-processor";
import { getLastSnapshot, loadRegistry } from "@/lib/arweave/snapshot-registry";
import { loadChatData } from "@/lib/storage/chat-storage";
import type { PipelineResult } from "@/lib/arweave/snapshot-types";
import { loadStoragePolicy } from "@/lib/arweave/storage-policy";

/**
 * Minimum time between automatic snapshot triggers.
 * Prevents rapid-fire snapshots when the user is actively switching
 * conversations or sending multiple messages in quick succession.
 */
const TRIGGER_DEBOUNCE_MS = 10_000; // 10 seconds

/**
 * React hook for managing the Arweave snapshot pipeline.
 *
 * Provides automatic snapshot triggers based on:
 * - Idle timer (5 minutes of inactivity)
 * - Conversation switch detection
 * - Periodic timer (30 minutes)
 * - beforeunload handler (best-effort snapshot before tab close)
 *
 * Also exposes manual trigger and retry functions for UI integration.
 *
 * @param conversations - The current list of all conversations.
 * @param activeId - The currently active conversation ID.
 * @param passphrase - The user's encryption passphrase.
 * @param walletKey - The Arweave wallet key (JWK). Can be null if not yet provided.
 * @returns Snapshot state and control functions.
 *
 * @example
 * ```tsx
 * const { queueStatus, isProcessing, triggerSnapshot } = useSnapshot(
 *   conversations,
 *   activeId,
 *   passphrase,
 *   walletKey
 * );
 * ```
 */
export function useSnapshot(
  conversations: Conversation[],
  activeId: string | null,
  passphrase: string | null,
) {
  const [queueStatus, setQueueStatus] = useState<QueueStatusSummary>({
    total: 0,
    pending: 0,
    uploading: 0,
    done: 0,
    failed: 0,
    lastUploadedAt: null,
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSnapshotVersion, setLastSnapshotVersion] = useState<number | null>(null);

  // Refs for cleanup and debouncing
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const periodicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTriggerTimeRef = useRef<number>(0);
  const isProcessingRef = useRef(false);
  const previousActiveIdRef = useRef<string | null>(null);
  const isHydratedRef = useRef(false);

  // Store latest values in refs for use in callbacks
  const conversationsRef = useRef(conversations);
  const passphraseRef = useRef(passphrase);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    passphraseRef.current = passphrase;
  }, [passphrase]);


  /**
   * Updates the queue status from the upload queue.
   */
  const refreshQueueStatus = useCallback(() => {
    const status = getQueueStatus();
    setQueueStatus(status);
  }, []);

  /**
   * Updates the last snapshot version from the registry.
   */
  const refreshLastSnapshotVersion = useCallback(() => {
    const lastSnapshot = getLastSnapshot();
    setLastSnapshotVersion(lastSnapshot?.version ?? null);
  }, []);

  /**
   * Triggers a snapshot if enough time has passed since the last trigger.
   * This is the core trigger function used by all automatic and manual triggers.
   */
  const triggerSnapshot = useCallback(async (manual = false): Promise<PipelineResult | null> => {
    const now = Date.now();
    const timeSinceLastTrigger = now - lastTriggerTimeRef.current;

    // Debounce: don't trigger if we just triggered recently
    if (timeSinceLastTrigger < TRIGGER_DEBOUNCE_MS) {
      return null;
    }

    // Don't trigger if we don't have a passphrase
    const currentPassphrase = passphraseRef.current;
    if (!currentPassphrase) {
      return null;
    }

    const policy = loadStoragePolicy();
    if (!manual && policy === "manual_backups_only") return null;

    // Don't trigger if already processing
    if (isProcessingRef.current) {
      return null;
    }

    lastTriggerTimeRef.current = now;
    isProcessingRef.current = true;
    setIsProcessing(true);

    try {
      // localStorage is the source of truth. This also ensures an automatic
      // trigger never snapshots the transient streaming assistant message.
      const persistedConversations = loadChatData().conversations;

      const result = await runSnapshotPipeline(
        persistedConversations,
        currentPassphrase,
        undefined,
        manual && policy === "manual_backups_only" ? "store_everything" : policy
      );

      // Refresh status after pipeline completes
      refreshQueueStatus();
      refreshLastSnapshotVersion();
      return result;
    } catch {
      // Pipeline errors are handled internally; we just need to reset processing state
      return null;
    } finally {
      isProcessingRef.current = false;
      setIsProcessing(false);
    }
  }, [refreshQueueStatus, refreshLastSnapshotVersion]);

  /**
   * Resets the idle timer. Called on user activity.
   */
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }

    idleTimerRef.current = setTimeout(() => {
      triggerSnapshot();
    }, IDLE_TRIGGER_MS);
  }, [triggerSnapshot]);

  /**
   * Retries all failed items in the upload queue.
   * Resets their status to "pending" so the queue processor can pick them up.
   */
  const retryFailed = useCallback(() => {
    const retried = retryFailedUploads();
    if (retried > 0 && passphraseRef.current) {
      startProcessor(passphraseRef.current);
    }
    refreshQueueStatus();
  }, [refreshQueueStatus]);

  // -------------------------------------------------------------------------
  // Idle Timer Effect
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Start the idle timer
    resetIdleTimer();

    // Reset idle timer on user activity
    const handleActivity = () => {
      resetIdleTimer();
    };

    // Listen for user activity events
    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("touchstart", handleActivity);

    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
    };
  }, [resetIdleTimer]);

  // -------------------------------------------------------------------------
  // Periodic Timer Effect
  // -------------------------------------------------------------------------
  useEffect(() => {
    const startPeriodicTimer = () => {
      periodicTimerRef.current = setTimeout(() => {
        triggerSnapshot();
        startPeriodicTimer(); // Restart the timer
      }, PERIODIC_TRIGGER_MS);
    };

    startPeriodicTimer();

    return () => {
      if (periodicTimerRef.current) {
        clearTimeout(periodicTimerRef.current);
      }
    };
  }, [triggerSnapshot]);

  // -------------------------------------------------------------------------
  // Conversation Switch Detection Effect
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Skip the first render (hydration)
    if (!isHydratedRef.current) {
      isHydratedRef.current = true;
      previousActiveIdRef.current = activeId;
      return;
    }

    // Detect conversation switch
    if (activeId !== previousActiveIdRef.current && previousActiveIdRef.current !== null) {
      // Conversation switched — trigger snapshot
      triggerSnapshot();
    }

    previousActiveIdRef.current = activeId;
  }, [activeId, triggerSnapshot]);

  // -------------------------------------------------------------------------
  // beforeunload Handler Effect
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Synchronous check: only trigger if we have a passphrase and not already processing
      if (!passphraseRef.current || isProcessingRef.current) {
        return;
      }

      // Fire-and-forget: we can't await in beforeunload
      // The pipeline will run synchronously as much as possible
      // Any async work will be queued and completed later
      const now = Date.now();
      const timeSinceLastTrigger = now - lastTriggerTimeRef.current;

      if (timeSinceLastTrigger >= TRIGGER_DEBOUNCE_MS) {
        lastTriggerTimeRef.current = now;
        isProcessingRef.current = true;
        setIsProcessing(true);
        // Start the pipeline but don't await it
        // The queue will persist even if the tab closes
        runSnapshotPipeline(
          loadChatData().conversations,
          passphraseRef.current,
          undefined
        ).catch(() => {
          // Silently ignore errors during beforeunload
        }).finally(() => {
          isProcessingRef.current = false;
          setIsProcessing(false);
        });
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Initial Status Load Effect
  // -------------------------------------------------------------------------
  useEffect(() => {
    refreshQueueStatus();
    refreshLastSnapshotVersion();
  }, [refreshQueueStatus, refreshLastSnapshotVersion]);

  return {
    /** Current upload queue status (pending, uploading, failed counts). */
    queueStatus,

    /** Whether a snapshot is currently being processed. */
    isProcessing,

    /** Version number of the last successful snapshot, or null. */
    lastSnapshotVersion,

    /** Manually trigger a snapshot (debounced). */
    triggerSnapshot,

    /** Retry all failed items in the upload queue. */
    retryFailed,
  };
}
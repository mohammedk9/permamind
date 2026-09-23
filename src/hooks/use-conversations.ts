"use client";

import { useCallback, useEffect, useState } from "react";

import {
  createConversation,
  sortConversations,
} from "@/lib/chat/conversation";
import { loadChatData, saveChatData } from "@/lib/storage/chat-storage";
import type { Conversation, Project } from "@/types/chat";
import { uploadConversationSummary, deleteConversationSummary } from "@/lib/storage/sync-client";
import { isCloudSyncEnabled } from "@/lib/storage/storage-preferences";
import { confirmCloudSummaryUpload } from "@/lib/storage/sync-consent";

const SAVE_DEBOUNCE_MS = 300;

/**
 * Options for the useConversations hook.
 */
interface UseConversationsOptions {
  /**
   * Optional callback invoked when the active conversation changes.
   * Receives the new active conversation ID (or null if no conversation is active).
   * Used by useSnapshot to detect conversation switches and trigger snapshots.
   */
  onConversationSwitch?: (newActiveId: string | null) => void;
}

export function useConversations(options: UseConversationsOptions = {}) {
  const { onConversationSwitch } = options;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    const { conversations: loaded, activeId: loadedActiveId, projects: loadedProjects } = loadChatData();
    setConversations(loaded);
    setActiveId(loadedActiveId);
    setProjects(loadedProjects);
    setIsHydrated(true);
  }, []);

  const reload = useCallback(() => {
    const loaded = loadChatData();
    setConversations(loaded.conversations);
    setActiveId(loaded.activeId);
    setProjects(loaded.projects);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    const timeout = setTimeout(() => {
      saveChatData(conversations, activeId, projects);
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [conversations, activeId, projects, isHydrated]);

  const sortedConversations = sortConversations(conversations);

  const activeConversation =
    conversations.find((c) => c.id === activeId) ?? null;

  const updateConversation = useCallback(
    (conversationId: string, updater: (c: Conversation) => Conversation) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? updater(c) : c))
      );
    },
    []
  );

  const addConversation = useCallback((conversation: Conversation) => {
    setConversations((prev) => [conversation, ...prev]);
    setActiveId(conversation.id);
    return conversation;
  }, []);

  const createAndSelect = useCallback((title?: string) => {
    const conversation = createConversation(title);
    addConversation(conversation);
    return conversation;
  }, [addConversation]);

  const createProject = useCallback((project: Project) => {
    setProjects((prev) => [project, ...prev]);
    return project;
  }, []);

  const renameConversation = useCallback((id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;

    setConversations((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, title: trimmed, updatedAt: new Date() } : c
      )
    );
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      setActiveId((currentActive) => {
        if (currentActive !== id) return currentActive;
        const newActiveId = next[0]?.id ?? null;
        onConversationSwitch?.(newActiveId);
        return newActiveId;
      });
      return next;
    });
  }, [onConversationSwitch]);

  const selectConversation = useCallback((id: string) => {
    setActiveId(id);
    onConversationSwitch?.(id);
  }, [onConversationSwitch]);

  const getConversation = useCallback(
    (id: string) => conversations.find((c) => c.id === id),
    [conversations]
  );

  const setConversationCloudSync = useCallback((id: string, enabled: boolean) => {
    setConversations((previous) => previous.map((conversation) => (
      conversation.id === id ? { ...conversation, syncToCloud: enabled, updatedAt: new Date() } : conversation
    )));
  }, []);

  const enableConversationCloudSync = useCallback(async (id: string, isConfirmed = false): Promise<"uploaded" | "unchanged" | "pending-summary"> => {
    if (!isCloudSyncEnabled()) {
      throw new Error("Enable cloud storage and select the data you want to sync first");
    }
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) throw new Error("Conversation not found");
    if (!conversation.metadata?.summary?.trim()) {
      setConversationCloudSync(id, true);
      return "pending-summary";
    }
    if (!isConfirmed && !confirmCloudSummaryUpload()) throw new Error("Cloud summary upload cancelled");

    const result = await uploadConversationSummary({ ...conversation, syncToCloud: true });
    setConversationCloudSync(id, true);
    return result;
  }, [conversations, setConversationCloudSync]);

  const disableConversationCloudSync = useCallback(async (id: string): Promise<void> => {
    const conversation = conversations.find((item) => item.id === id);
    if (!conversation) throw new Error("Conversation not found");
    if (conversation.syncToCloud) await deleteConversationSummary(id);
    setConversationCloudSync(id, false);
  }, [conversations, setConversationCloudSync]);

  const syncConversationSummary = useCallback(async (id: string, isConfirmed = false): Promise<"uploaded" | "unchanged"> => {
    const result = await enableConversationCloudSync(id, isConfirmed);
    if (result === "pending-summary") throw new Error("This conversation does not have a summary yet");
    return result;
  }, [enableConversationCloudSync]);

  return {
    conversations: sortedConversations,
    activeConversation,
    activeId,
    isHydrated,
    updateConversation,
    addConversation,
    createAndSelect,
    renameConversation,
    deleteConversation,
    selectConversation,
    getConversation,
    setConversationCloudSync,
    enableConversationCloudSync,
    disableConversationCloudSync,
    syncConversationSummary,
    setActiveId,
    reload,
    projects,
    createProject,
  };
}

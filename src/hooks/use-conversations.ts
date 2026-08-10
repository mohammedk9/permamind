"use client";

import { useCallback, useEffect, useState } from "react";

import {
  createConversation,
  sortConversations,
} from "@/lib/chat/conversation";
import { loadChatData, saveChatData } from "@/lib/storage/chat-storage";
import type { Conversation, Project } from "@/types/chat";

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
    setActiveId,
    reload,
    projects,
    createProject,
  };
}

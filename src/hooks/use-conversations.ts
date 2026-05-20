"use client";

import { useCallback, useEffect, useState } from "react";

import {
  createConversation,
  sortConversations,
} from "@/lib/chat/conversation";
import { loadChatData, saveChatData } from "@/lib/storage/chat-storage";
import type { Conversation } from "@/types/chat";

const SAVE_DEBOUNCE_MS = 300;

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const { conversations: loaded, activeId: loadedActiveId } = loadChatData();
    setConversations(loaded);
    setActiveId(loadedActiveId);
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;

    const timeout = setTimeout(() => {
      saveChatData(conversations, activeId);
    }, SAVE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [conversations, activeId, isHydrated]);

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
        return next[0]?.id ?? null;
      });
      return next;
    });
  }, []);

  const selectConversation = useCallback((id: string) => {
    setActiveId(id);
  }, []);

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
  };
}

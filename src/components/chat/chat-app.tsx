"use client";

import { useCallback, useState } from "react";

import { ChatMain } from "@/components/chat/chat-main";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import type { Conversation, Message } from "@/types/chat";

function createId() {
  return crypto.randomUUID();
}

function createConversation(title = "New conversation"): Conversation {
  const now = new Date();
  return {
    id: createId(),
    title,
    messages: [],
    updatedAt: now,
  };
}

const PLACEHOLDER_REPLY =
  "Thanks for your message. AI responses via OpenRouter will be wired in Phase 2. For now, explore the chat layout — your conversations will become searchable memories soon.";

export function ChatApp() {
  const [conversations, setConversations] = useState<Conversation[]>([
    createConversation("Welcome to PermaMind"),
  ]);
  const [activeId, setActiveId] = useState<string | null>(
    () => conversations[0]?.id ?? null
  );

  const activeConversation =
    conversations.find((c) => c.id === activeId) ?? null;

  const handleNewChat = useCallback(() => {
    const conversation = createConversation();
    setConversations((prev) => [conversation, ...prev]);
    setActiveId(conversation.id);
  }, []);

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const handleSend = useCallback(
    (content: string) => {
      if (!activeId) {
        const conversation = createConversation(
          content.slice(0, 40) + (content.length > 40 ? "…" : "")
        );
        setConversations((prev) => [conversation, ...prev]);
        setActiveId(conversation.id);
        appendMessages(conversation.id, content);
        return;
      }
      appendMessages(activeId, content);
    },
    [activeId]
  );

  function appendMessages(conversationId: string, content: string) {
    const userMessage: Message = {
      id: createId(),
      role: "user",
      content,
      createdAt: new Date(),
    };
    const assistantMessage: Message = {
      id: createId(),
      role: "assistant",
      content: PLACEHOLDER_REPLY,
      createdAt: new Date(),
    };

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== conversationId) return c;
        const title =
          c.messages.length === 0
            ? content.slice(0, 40) + (content.length > 40 ? "…" : "")
            : c.title;
        return {
          ...c,
          title,
          messages: [...c.messages, userMessage, assistantMessage],
          updatedAt: new Date(),
        };
      })
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <ChatSidebar
        className="hidden md:flex"
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        onNewChat={handleNewChat}
      />
      <ChatMain
        conversation={activeConversation}
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        onNewChat={handleNewChat}
        onSend={handleSend}
      />
    </div>
  );
}

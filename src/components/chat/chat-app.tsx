"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { needsSummary } from "@/lib/ai/summarize";

import { ChatMain } from "@/components/chat/chat-main";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { useChatCompletion } from "@/hooks/use-chat-completion";
import { useConversationSummary } from "@/hooks/use-conversation-summary";
import { useConversations } from "@/hooks/use-conversations";
import { createId, truncateTitle } from "@/lib/chat/conversation";
import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { Message } from "@/types/chat";

function toApiMessages(messages: Message[]): ChatCompletionMessage[] {
  return messages
    .filter((m) => !m.isStreaming && m.content.length > 0)
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));
}

export function ChatApp() {
  const {
    conversations,
    activeConversation,
    activeId,
    isHydrated,
    updateConversation,
    createAndSelect,
    renameConversation,
    deleteConversation,
    selectConversation,
    getConversation,
  } = useConversations();

  const { model, setModel, isLoading, error, clearError, sendMessage } =
    useChatCompletion();

  const { queueSummary, isSummarizing } = useConversationSummary(
    getConversation,
    updateConversation
  );

  const backfillDone = useRef(false);

  useEffect(() => {
    if (!isHydrated || backfillDone.current) return;
    backfillDone.current = true;

    for (const conversation of conversations) {
      if (needsSummary(conversation.messages, conversation.metadata)) {
        queueSummary(conversation.id);
      }
    }
  }, [isHydrated, conversations, queueSummary]);

  const handleNewChat = useCallback(() => {
    createAndSelect();
    clearError();
  }, [createAndSelect, clearError]);

  const handleSelect = useCallback(
    (id: string) => {
      selectConversation(id);
      clearError();
    },
    [selectConversation, clearError]
  );

  const handleSend = useCallback(
    async (content: string) => {
      clearError();

      let conversationId = activeId;

      if (!conversationId) {
        const conversation = createAndSelect(truncateTitle(content));
        conversationId = conversation.id;
      }

      const userMessage: Message = {
        id: createId(),
        role: "user",
        content,
        createdAt: new Date(),
      };

      const assistantMessage: Message = {
        id: createId(),
        role: "assistant",
        content: "",
        createdAt: new Date(),
        isStreaming: true,
      };

      const priorMessages =
        conversations.find((c) => c.id === conversationId)?.messages ??
        (activeConversation?.id === conversationId
          ? activeConversation.messages
          : []);

      const apiMessages = toApiMessages([...priorMessages, userMessage]);

      updateConversation(conversationId, (c) => {
        const title =
          c.messages.length === 0 ? truncateTitle(content) : c.title;
        return {
          ...c,
          title,
          messages: [...c.messages, userMessage, assistantMessage],
          updatedAt: new Date(),
        };
      });

      const success = await sendMessage(apiMessages, (chunk) => {
        updateConversation(conversationId!, (c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === assistantMessage.id
              ? { ...m, content: m.content + chunk }
              : m
          ),
          updatedAt: new Date(),
        }));
      });

      updateConversation(conversationId, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistantMessage.id
            ? {
                ...m,
                isStreaming: false,
                content: success
                  ? m.content
                  : m.content || "No response received.",
              }
            : m
        ),
        updatedAt: new Date(),
      }));

      if (success) {
        queueSummary(conversationId);
      }
    },
    [
      activeId,
      activeConversation,
      clearError,
      conversations,
      createAndSelect,
      queueSummary,
      sendMessage,
      updateConversation,
    ]
  );

  if (!isHydrated) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
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
        onRename={renameConversation}
        onDelete={deleteConversation}
        isSummarizing={isSummarizing}
      />
      <ChatMain
        conversation={activeConversation}
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        onNewChat={handleNewChat}
        onRename={renameConversation}
        onDelete={deleteConversation}
        isSummarizing={isSummarizing}
        onSend={handleSend}
        model={model}
        onModelChange={setModel}
        isLoading={isLoading}
        error={error}
        onDismissError={clearError}
      />
    </div>
  );
}

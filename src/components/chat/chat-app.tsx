"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { needsSummary } from "@/lib/ai/summarize";
import { buildMessagesWithMemory } from "@/lib/memory/context";
import { retrieveRelevantMemories } from "@/lib/memory/retrieve";

import { ChatMain } from "@/components/chat/chat-main";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { OnboardingDialog } from "@/components/settings/onboarding-dialog";
import { useAnalytics } from "@/hooks/use-analytics";
import { useApiSettings } from "@/hooks/use-api-settings";
import { useChatCompletion } from "@/hooks/use-chat-completion";
import { useConversationSummary } from "@/hooks/use-conversation-summary";
import { useConversations } from "@/hooks/use-conversations";
import { createId, truncateTitle } from "@/lib/chat/conversation";
import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { Message } from "@/types/chat";
import type { RetrievedMemory } from "@/types/memory";

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

  const [memoriesUsed, setMemoriesUsed] = useState<RetrievedMemory[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const apiSettings = useApiSettings();
  const {
    mode,
    setMode,
    apiKey,
    setApiKey,
    connectionStatus,
    validateKey,
    clearKey,
    getRequestHeaders,
    canSendRequests,
    defaultModelId,
    showOnboarding,
    dismissOnboarding,
    hydrated: apiHydrated,
  } = apiSettings;

  const {
    summary: analyticsSummary,
    recordChat,
    recordSummary,
    recordMemoryRetrieval,
    clearAll: clearAnalytics,
  } = useAnalytics();

  const { model, setModel, isLoading, error, clearError, sendMessage } =
    useChatCompletion({
      mode,
      defaultModelId,
      getRequestHeaders,
    });

  const { queueSummary, isSummarizing } = useConversationSummary(
    getConversation,
    updateConversation,
    getRequestHeaders,
    mode,
    (params) => {
      recordSummary({
        model: params.model,
        conversationId: params.conversationId,
        conversationTitle: params.conversationTitle,
        usage: params.usage,
      });
    }
  );

  const backfillDone = useRef(false);

  useEffect(() => {
    if (!isHydrated || !apiHydrated || backfillDone.current) return;
    backfillDone.current = true;

    for (const conversation of conversations) {
      if (needsSummary(conversation.messages, conversation.metadata)) {
        queueSummary(conversation.id);
      }
    }
  }, [isHydrated, apiHydrated, conversations, queueSummary]);

  const handleNewChat = useCallback(() => {
    createAndSelect();
    clearError();
    setMemoriesUsed([]);
  }, [createAndSelect, clearError]);

  const handleSelect = useCallback(
    (id: string) => {
      selectConversation(id);
      clearError();
      setMemoriesUsed([]);
    },
    [selectConversation, clearError]
  );

  const handleSend = useCallback(
    async (content: string) => {
      if (!canSendRequests) {
        clearError();
        return;
      }

      clearError();

      let conversationId = activeId;

      if (!conversationId) {
        const conversation = createAndSelect(truncateTitle(content));
        conversationId = conversation.id;
      }

      const conv =
        getConversation(conversationId) ??
        conversations.find((c) => c.id === conversationId);
      const conversationTitle = conv?.title ?? truncateTitle(content);

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

      const memories = retrieveRelevantMemories(
        content,
        conversations,
        conversationId
      );
      setMemoriesUsed(memories);

      recordMemoryRetrieval({
        conversationId,
        conversationTitle,
        query: content,
        memories,
      });

      const apiMessages = buildMessagesWithMemory(
        toApiMessages([...priorMessages, userMessage]),
        memories
      );

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

      const result = await sendMessage(apiMessages, (chunk) => {
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
                content: result.success
                  ? m.content
                  : m.content || "No response received.",
              }
            : m
        ),
        updatedAt: new Date(),
      }));

      if (result.success && result.usage) {
        recordChat({
          model,
          conversationId,
          conversationTitle,
          usage: result.usage,
          memories,
        });
        queueSummary(conversationId);
      }
    },
    [
      activeId,
      activeConversation,
      canSendRequests,
      clearError,
      conversations,
      createAndSelect,
      getConversation,
      model,
      queueSummary,
      recordChat,
      recordMemoryRetrieval,
      sendMessage,
      updateConversation,
    ]
  );

  const apiBlockedMessage =
    mode === "byok" && connectionStatus !== "connected"
      ? "Validate your OpenRouter API key in Settings to send messages."
      : !canSendRequests
        ? "Configure free mode (server key) or add your API key in Settings."
        : null;

  if (!isHydrated || !apiHydrated) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <OnboardingDialog
        open={showOnboarding}
        onGetStarted={dismissOnboarding}
        onOpenSettings={() => {
          dismissOnboarding();
          setSettingsOpen(true);
        }}
      />

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
          analyticsSummary={analyticsSummary}
          onClearAnalytics={clearAnalytics}
          mode={mode}
          apiKey={apiKey}
          connectionStatus={connectionStatus}
          onModeChange={setMode}
          onApiKeyChange={setApiKey}
          onValidateKey={validateKey}
          onClearKey={clearKey}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
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
          mode={mode}
          isLoading={isLoading}
          error={error ?? apiBlockedMessage}
          onDismissError={clearError}
          memoriesUsed={memoriesUsed}
          onOpenMemory={handleSelect}
          analyticsSummary={analyticsSummary}
          onClearAnalytics={clearAnalytics}
          canSend={canSendRequests}
          apiKey={apiKey}
          connectionStatus={connectionStatus}
          onModeChange={setMode}
          onApiKeyChange={setApiKey}
          onValidateKey={validateKey}
          onClearKey={clearKey}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
        />
      </div>
    </>
  );
}

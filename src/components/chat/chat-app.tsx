"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { needsSummary } from "@/lib/ai/summarize";
import { buildMessagesWithMemory } from "@/lib/memory/context";
import { isPreviousConversationQuery, previousConversationSearchQuery, retrieveRelevantMemories } from "@/lib/memory/retrieve";

import { ChatMain } from "@/components/chat/chat-main";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { AppShell, type ProductArea } from "@/components/layout/app-shell";
import { HelpSheet } from "@/components/help/how-permamind-works";
import { FirstLaunchOnboarding } from "@/components/settings/first-launch-onboarding";
import { useAnalytics } from "@/hooks/use-analytics";
import { useApiSettings } from "@/hooks/use-api-settings";
import { useChatCompletion } from "@/hooks/use-chat-completion";
import { useConversationSummary } from "@/hooks/use-conversation-summary";
import { useConversations } from "@/hooks/use-conversations";
import { useSnapshot } from "@/hooks/use-snapshot";
import { createId, truncateTitle } from "@/lib/chat/conversation";
import { startProcessor, stopProcessor } from "@/lib/arweave/queue-processor";
import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { Message } from "@/types/chat";
import type { RetrievedMemory } from "@/types/memory";
import { dismissPermanentMemoryWarning, isPermanentMemoryWarningDismissed } from "@/lib/arweave/storage-policy";
import { hasCompletedFirstRun } from "@/lib/settings/first-run";
import { MemoryExperience } from "@/components/memory/memory-experience";
import { SettingsShell } from "@/components/settings/settings-shell";

const SNAPSHOT_AFTER_RESPONSE_DELAY_MS = 350;

function toApiMessages(messages: Message[]): ChatCompletionMessage[] {
  return messages
    .filter((m) => !m.isStreaming && m.content.length > 0)
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));
}

export function ChatApp() {
  const snapshotPassphrase = "";
  const snapshotsEnabled = false;
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

  const togglePermanentMemory = useCallback((id: string, updater: (c: import("@/types/chat").Conversation) => import("@/types/chat").Conversation) => {
    const current = getConversation(id);
    if (current && !current.permanentMemory && !isPermanentMemoryWarningDismissed()) {
      if (!window.confirm("This conversation will be encrypted locally and permanently stored on the Arweave network. Permanent storage cannot be deleted after upload.")) return;
      if (window.confirm("Don't show this warning again?")) dismissPermanentMemoryWarning();
    }
    updateConversation(id, updater);
  }, [getConversation, updateConversation]);

  const snapshot = useSnapshot(
    conversations,
    activeId,
    snapshotsEnabled ? snapshotPassphrase : null
  );

  useEffect(() => {
    if (snapshotsEnabled && snapshotPassphrase) {
      startProcessor(snapshotPassphrase);
    } else {
      stopProcessor();
    }

    return () => stopProcessor();
  }, [snapshotsEnabled, snapshotPassphrase]);

  const [memoriesUsed, setMemoriesUsed] = useState<RetrievedMemory[]>([]);
  const [area, setArea] = useState<ProductArea>("chat");
  const [firstRunOpen, setFirstRunOpen] = useState(false);
  useEffect(() => setFirstRunOpen(!hasCompletedFirstRun()), []);
  useEffect(() => {
    const fromPath = () => (window.location.pathname.split("/")[1] as ProductArea) || "chat";
    const initial = fromPath();
    if (["chat", "memory", "backup", "settings"].includes(initial)) setArea(initial);
    const onPopState = () => setArea(fromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const navigate = useCallback((next: ProductArea) => {
    if (next === "backup") {
      window.location.href = "/backup";
      return;
    }
    setArea(next);
    const path = next === "chat" ? "/chat" : `/${next}`;
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
  }, []);

  const apiSettings = useApiSettings();
  const {
    mode,
    apiKey,
    setApiKey,
    connectionStatus,
    validateKey,
    clearKey,
    getRequestHeaders,
    canSendRequests,
    defaultModelId,
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

      const previousConversationQuery = isPreviousConversationQuery(content);
      const memories = retrieveRelevantMemories(
        previousConversationQuery ? previousConversationSearchQuery(content) || content : content,
        conversations,
        conversationId,
        previousConversationQuery
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
        memories,
        previousConversationQuery
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

      // Wait for useConversations' localStorage debounce to persist the
      // completed assistant response before taking the snapshot. The
      // snapshot hook reads localStorage, so streaming state cannot leak into
      // the snapshot and failed responses never trigger one.
      if (result.success) {
        window.setTimeout(() => {
          void snapshot.triggerSnapshot();
        }, SNAPSHOT_AFTER_RESPONSE_DELAY_MS);
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
      mode,
      snapshot,
      updateConversation,
    ]
  );

  const apiBlockedMessage = !canSendRequests
    ? "Connect an AI provider in Settings to send messages."
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
      <FirstLaunchOnboarding open={firstRunOpen} onComplete={() => setFirstRunOpen(false)} />
      <AppShell activeArea={area} onNavigate={navigate} utility={<HelpSheet triggerClassName="w-full justify-start gap-2" />} sidebar={<ChatSidebar
        className="mt-5 min-h-0 flex-1 border-0 border-t border-sidebar-border pt-4"
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        onNewChat={handleNewChat}
        onRename={renameConversation}
        onDelete={deleteConversation}
        onUpdateConversation={(id, updater) => {
          const conversation = getConversation(id);
          if (updater(conversation ?? { id, title: "", messages: [], createdAt: new Date(), updatedAt: new Date() }).permanentMemory !== conversation?.permanentMemory) togglePermanentMemory(id, updater);
          else updateConversation(id, updater);
        }}
        isSummarizing={isSummarizing}
      />}>
        <div className={area === "chat" ? "flex min-h-0 min-w-0 flex-1 overflow-hidden" : "hidden"} aria-hidden={area !== "chat"}>
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
        />
        </div>
        {area === "memory" && <MemoryExperience conversations={conversations} onOpenConversation={(id) => { selectConversation(id); navigate("chat"); }} />}
        {area === "settings" && <SettingsShell apiKey={apiKey} connectionStatus={connectionStatus} onApiKeyChange={setApiKey} onValidate={validateKey} onClearKey={clearKey} onClearAnalytics={clearAnalytics} />}
      </AppShell>
    </>
  );
}

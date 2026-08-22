"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { needsSummary } from "@/lib/ai/summarize";
import { buildMessagesWithMemory } from "@/lib/memory/context";
import { isPreviousConversationQuery, previousConversationSearchQuery, retrieveRelevantMemories } from "@/lib/memory/retrieve";

import { ChatMain } from "@/components/chat/chat-main";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ProjectWorkspace } from "@/components/chat/project-workspace";
import { WorkspaceStartDialog } from "@/components/chat/workspace-start-dialog";
import { AppShell, type ProductArea } from "@/components/layout/app-shell";
import { HelpSheet } from "@/components/help/how-permamind-works";
import { FirstLaunchOnboarding } from "@/components/settings/first-launch-onboarding";
import { hasCompletedFirstRun } from "@/lib/settings/first-run";
import { useAnalytics } from "@/hooks/use-analytics";
import { useApiSettings } from "@/hooks/use-api-settings";
import { useChatCompletion } from "@/hooks/use-chat-completion";
import { useConversationSummary } from "@/hooks/use-conversation-summary";
import { useConversations } from "@/hooks/use-conversations";
import { useSnapshot } from "@/hooks/use-snapshot";
import { createId, truncateTitle } from "@/lib/chat/conversation";
import { startProcessor, stopProcessor } from "@/lib/arweave/queue-processor";
import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { Message, Project } from "@/types/chat";
import type { RetrievedMemory } from "@/types/memory";
import type { InternetSearchResult } from "@/lib/search/exa";
import { dismissPermanentMemoryWarning, isPermanentMemoryWarningDismissed } from "@/lib/arweave/storage-policy";
import { MemoryExperience } from "@/components/memory/memory-experience";
import { SettingsShell } from "@/components/settings/settings-shell";
import { ChatPolicies } from "@/components/legal/policy-sheets";
import { SnapshotSettings } from "@/components/arweave/snapshot-settings";
import { loadStoragePolicy, saveStoragePolicy, type StoragePolicy } from "@/lib/arweave/storage-policy";

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
  // The passphrase intentionally lives only in React memory. It is never
  // persisted to localStorage, sent to the server, or included in a snapshot.
  const [snapshotPassphrase, setSnapshotPassphrase] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [snapshotsEnabled, setSnapshotsEnabled] = useState(false);
  const [storagePolicy, setStoragePolicy] = useState<StoragePolicy>("manual_backups_only");
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
    setConversationCloudSync,
    syncConversationSummary,
    projects,
    createProject,
  } = useConversations();

  const handleSyncSummary = useCallback(async (id: string, confirmed = false): Promise<"uploaded" | "unchanged"> => {
    try {
      const result = await syncConversationSummary(id, confirmed);
      return result;
    } catch (error) {
      throw error;
    }
  }, [syncConversationSummary]);

  useEffect(() => {
    setStoragePolicy(loadStoragePolicy());
    if (!hasCompletedFirstRun()) setShowOnboarding(true);
  }, []);

  const handleStoragePolicyChange = useCallback((policy: StoragePolicy) => {
    setStoragePolicy(policy);
    saveStoragePolicy(policy);
  }, []);

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
    snapshotsEnabled && snapshotPassphrase.length >= 8 ? snapshotPassphrase : null
  );

  useEffect(() => {
    if (snapshotsEnabled && snapshotPassphrase.length >= 8) {
      startProcessor(snapshotPassphrase);
    } else {
      stopProcessor();
    }

    return () => stopProcessor();
  }, [snapshotsEnabled, snapshotPassphrase]);

  const [memoriesUsed, setMemoriesUsed] = useState<RetrievedMemory[]>([]);
  const [area, setArea] = useState<ProductArea>("chat");
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [searchUsage, setSearchUsage] = useState<{ used: number; limit: number } | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
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
    provider,
    setProvider,
    baseUrl, setBaseUrl, modelName, setModelName,
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
    const conversation = createAndSelect();
    if (activeProjectId) updateConversation(conversation.id, (current) => ({ ...current, projectId: activeProjectId }));
    setActiveProjectId(null);
    setArea("chat");
    clearError();
    setMemoriesUsed([]);
  }, [activeProjectId, createAndSelect, clearError, updateConversation]);

  const handleNewProject = useCallback(() => {
    const name = window.prompt("Project name", "New project")?.trim();
    if (!name) return;
    const project: Project = { id: createId(), name, summary: "", goals: [], tasks: [], decisions: [], openQuestions: [], createdAt: new Date(), updatedAt: new Date() };
    createProject(project);
    setActiveProjectId(project.id);
    setArea("project");
    window.history.pushState({}, "", `/project/${project.id}`);
  }, [createProject]);

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
        if (activeProjectId) updateConversation(conversation.id, (current) => ({ ...current, projectId: activeProjectId }));
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
        previousConversationQuery,
        activeProjectId ? (() => { const project = projects.find((item) => item.id === activeProjectId); return project ? `You are working inside the project "${project.name}". Use this project context when answering.\nSummary: ${project.summary || "Not yet available"}\nGoals: ${project.goals.join(", ") || "None recorded"}\nTasks: ${project.tasks.join(", ") || "None recorded"}\nDecisions: ${project.decisions.join(", ") || "None recorded"}\nOpen questions: ${project.openQuestions.join(", ") || "None recorded"}` : ""; })() : ""
      );

      let messagesForRequest = apiMessages;
      if (webSearchEnabled) {
        const response = await fetch(`/api/search?q=${encodeURIComponent(content)}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error ?? "Web search failed");
        }
        const payload = await response.json() as { results: InternetSearchResult[]; used: number; limit: number };
        setSearchUsage({ used: payload.used, limit: payload.limit });
        if (payload.results.length) {
          const webContext = payload.results.map((item, index) => `${index + 1}. ${item.title}\n${item.text}\nSource: ${item.url}`).join("\n\n");
          messagesForRequest = [...apiMessages.slice(0, -1), { role: "user", content: `Live web context (use only as supporting evidence; cite sources when relevant):\n${webContext}\n\nUser question:\n${content}` }];
        }
      }

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

      const result = await sendMessage(messagesForRequest, (chunk) => {
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
      webSearchEnabled,
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
      <WorkspaceStartDialog open={isHydrated && conversations.length === 0 && projects.length === 0 && !activeConversation} onChat={handleNewChat} onProject={handleNewProject} />
      <FirstLaunchOnboarding open={showOnboarding} onComplete={() => setShowOnboarding(false)} />
      <AppShell activeArea={area} onNavigate={navigate} utility={<div><SnapshotSettings passphrase={snapshotPassphrase} onPassphraseChange={setSnapshotPassphrase} enabled={snapshotsEnabled} onEnabledChange={(enabled) => { if (enabled && snapshotPassphrase.length < 8) { window.alert("Set an encryption passphrase of at least 8 characters before enabling backups."); return; } setSnapshotsEnabled(enabled); }} onSnapshotNow={() => { if (window.confirm("Create an encrypted permanent Arweave backup now? Uploaded backups cannot be deleted.")) void snapshot.triggerSnapshot(true); }} isProcessing={snapshot.isProcessing} storagePolicy={storagePolicy} onStoragePolicyChange={handleStoragePolicyChange} triggerClassName="w-full justify-start gap-2" /><HelpSheet triggerClassName="w-full justify-start gap-2" /><ChatPolicies /></div>} sidebar={<ChatSidebar
        className="mt-5 min-h-0 flex-1 border-0 border-t border-sidebar-border pt-4"
        conversations={conversations}
        activeId={activeId}
        onSelect={handleSelect}
        onNewChat={handleNewChat}
        onNewProject={handleNewProject}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={(id) => { setActiveProjectId(id); setArea("project"); window.history.pushState({}, "", `/project/${id}`); }}
        onRename={renameConversation}
        onDelete={deleteConversation}
        onToggleCloudSync={(id) => setConversationCloudSync(id, !getConversation(id)?.syncToCloud)}
        onSyncSummary={(id, confirmed) => handleSyncSummary(id, confirmed)}
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
          onToggleCloudSync={(id) => setConversationCloudSync(id, !getConversation(id)?.syncToCloud)}
          onSyncSummary={(id, confirmed) => handleSyncSummary(id, confirmed)}
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
          webSearchEnabled={webSearchEnabled}
          onWebSearchChange={setWebSearchEnabled}
          searchUsage={searchUsage}
        />
        </div>
        {area === "memory" && <MemoryExperience conversations={conversations} onOpenConversation={(id) => { selectConversation(id); navigate("chat"); }} />}
        {area === "project" && activeProjectId && (() => { const project = projects.find((item) => item.id === activeProjectId); return project ? <ProjectWorkspace project={project} conversations={conversations.filter((conversation) => conversation.projectId === project.id)} onOpenConversation={(id) => { selectConversation(id); navigate("chat"); }} /> : null; })()}
        {area === "settings" && <SettingsShell conversations={conversations} apiKey={apiKey} provider={provider} onProviderChange={setProvider} baseUrl={baseUrl} onBaseUrlChange={setBaseUrl} modelName={modelName} onModelNameChange={setModelName} connectionStatus={connectionStatus} onApiKeyChange={setApiKey} onValidate={validateKey} onClearKey={clearKey} onClearAnalytics={clearAnalytics} />}
      </AppShell>
    </>
  );
}

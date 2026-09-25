"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { needsSummary } from "@/lib/ai/summarize";
import { buildMessagesWithMemory, linkedConversationContext } from "@/lib/memory/context";
import { projectConversationContext } from "@/lib/projects/context";
import { embedText, syncMemoryEmbeddings, type MemoryEmbeddingDocument } from "@/lib/memory/embeddings";
import { activeMemoryRecords, addMemoryRecord, forgetMemoryRecord, loadMemoryLedger, syncExtractedMemory, updateMemoryRecord } from "@/lib/memory/ledger";
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
import { useLocale } from "@/hooks/use-locale";
import { useSnapshot } from "@/hooks/use-snapshot";
import { createId, truncateTitle } from "@/lib/chat/conversation";
import { QUICK_COMMANDS, buildQuickCommandReply, localCommandMessages, type QuickCommand } from "@/lib/chat/quick-commands";
import { getLastSnapshot } from "@/lib/arweave/snapshot-registry";
import { startProcessor, stopProcessor } from "@/lib/arweave/queue-processor";
import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { Message, Project } from "@/types/chat";
import type { MemoryRecord, RetrievedMemory } from "@/types/memory";
import { applyWebContext, shouldSearchWeb } from "@/lib/search/web-context";
import { dismissPermanentMemoryWarning, isPermanentMemoryWarningDismissed } from "@/lib/arweave/storage-policy";
import { MemoryExperience } from "@/components/memory/memory-experience";
import { MemoryControls } from "@/components/memory/memory-controls";
import { SettingsShell } from "@/components/settings/settings-shell";
import { ChatPolicies } from "@/components/legal/policy-sheets";
import { SnapshotSettings } from "@/components/arweave/snapshot-settings";
import { loadStoragePolicy, saveStoragePolicy, type StoragePolicy } from "@/lib/arweave/storage-policy";

const SNAPSHOT_AFTER_RESPONSE_DELAY_MS = 350;
const SIDEBAR_UTILITY_TRIGGER_CLASS = "w-full justify-start gap-2 rounded-lg border border-sidebar-border/70 bg-sidebar-accent/40 px-3 py-2 text-xs font-medium text-sidebar-foreground shadow-sm transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/50";

function toApiMessages(messages: Message[]): ChatCompletionMessage[] {
  return messages
    .filter((m) => !m.isStreaming && m.content.length > 0)
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));
}

export function ChatApp() {
  const { locale } = useLocale();
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
    projects,
    createProject,
    updateProject,
  } = useConversations();

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
  const [memoryRecords, setMemoryRecords] = useState<MemoryRecord[]>([]);
  const [semanticVectors, setSemanticVectors] = useState<Array<{ id: string; vector: Float32Array }>>([]);
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

  const refreshMemoryIndex = useCallback(async (source = conversations) => {
    let records = loadMemoryLedger();
    for (const conversation of source) records = syncExtractedMemory(conversation);
    setMemoryRecords(records);
    const documents: MemoryEmbeddingDocument[] = [];
    for (const conversation of source) {
      const metadata = conversation.metadata;
      if (!metadata) continue;
      documents.push({ id: `summary:${conversation.id}`, conversationId: conversation.id, conversationTitle: conversation.title, source: "summary", text: [conversation.title, metadata.summary, ...metadata.topics, ...metadata.entities].join(" "), updatedAt: metadata.generatedAt.toISOString() });
    }
    for (const record of records.filter((record) => record.status === "active")) {
      documents.push({ id: record.id, conversationId: record.conversationId, conversationTitle: record.conversationTitle, source: record.kind === "decision" ? "decision" : record.kind === "project" ? "project" : "fact", text: record.text, updatedAt: record.updatedAt });
    }
    await syncMemoryEmbeddings(documents);
    setSemanticVectors(documents.map((document) => ({ id: document.id, vector: embedText(document.text) })));
  }, [conversations]);

  useEffect(() => {
    if (!isHydrated) return;
    const timer = window.setTimeout(() => { void refreshMemoryIndex(); }, 300);
    return () => window.clearTimeout(timer);
  }, [isHydrated, refreshMemoryIndex]);

  const changeMemory = useCallback((change: () => MemoryRecord[]) => setMemoryRecords(change()), []);

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
    },
    projects,
    conversations,
    updateProject,
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

  const handleQuickCommand = useCallback((command: QuickCommand) => {
    let conversationId = activeId;
    if (!conversationId) conversationId = createAndSelect().id;
    const project = projects.find((item) => item.id === activeProjectId) ?? null;
    const prompt = QUICK_COMMANDS.find((item) => item.id === command)?.label ?? command;
    const reply = buildQuickCommandReply(command, { project, conversations, snapshot: getLastSnapshot() });
    const [userMessage, assistantMessage] = localCommandMessages(prompt, reply);
    updateConversation(conversationId, (current) => ({
      ...current,
      title: current.messages.length === 0 ? truncateTitle(prompt) : current.title,
      messages: [...current.messages, userMessage, assistantMessage],
      updatedAt: new Date(),
    }));
  }, [activeId, activeProjectId, conversations, createAndSelect, projects, updateConversation]);

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
    async (content: string, displayContent?: string) => {
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

      const visibleContent = displayContent ?? content;
      const userMessage: Message = {
        id: createId(),
        role: "user",
        content: visibleContent,
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

      const previousConversationQuery = isPreviousConversationQuery(visibleContent);
      const records = activeMemoryRecords();
      const memories = retrieveRelevantMemories(
        previousConversationQuery ? previousConversationSearchQuery(visibleContent) || visibleContent : visibleContent,
        conversations,
        conversationId,
        previousConversationQuery,
        records,
        semanticVectors,
      );
      const project = projects.find((item) => item.id === (conv?.projectId ?? (conversationId === activeId ? activeProjectId : undefined)));
      const projectContext = project ? projectConversationContext(project) : "";
      const linkedContext = linkedConversationContext(conv, conversations);
      setMemoriesUsed(memories);

      recordMemoryRetrieval({
        conversationId,
        conversationTitle,
        query: visibleContent,
        memories,
      });

      const apiMessages = buildMessagesWithMemory(
        toApiMessages([...priorMessages, userMessage]),
        memories,
        previousConversationQuery,
        projectContext,
        records,
        linkedContext,
      );

      let messagesForRequest = apiMessages;
      let sources: Message["sources"];
      if (provider !== "ollama" && shouldSearchWeb(visibleContent, webSearchEnabled)) {
        const response = await fetch(`/api/search?q=${encodeURIComponent(visibleContent)}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error ?? "Web search failed");
        }
        const payload = await response.json() as { results: Array<{ title: string; url: string; text: string }>; used: number; limit: number };
        setSearchUsage({ used: payload.used, limit: payload.limit });
        sources = payload.results.map((item) => ({ title: item.title, url: item.url }));
        messagesForRequest = applyWebContext(apiMessages, content, payload.results);
      }

      updateConversation(conversationId, (c) => {
        const title =
          c.messages.length === 0 ? truncateTitle(visibleContent) : c.title;
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
                sources,
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
      projects,
      activeProjectId,
      semanticVectors,
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
      <AppShell activeArea={area} onNavigate={navigate} utility={<div className="space-y-1.5"><SnapshotSettings passphrase={snapshotPassphrase} onPassphraseChange={setSnapshotPassphrase} enabled={snapshotsEnabled} onEnabledChange={(enabled) => { if (enabled && snapshotPassphrase.length < 8) { window.alert("Set an encryption passphrase of at least 8 characters before enabling backups."); return; } setSnapshotsEnabled(enabled); }} onSnapshotNow={() => { if (window.confirm("Create an encrypted permanent Arweave backup now? Uploaded backups cannot be deleted.")) void snapshot.triggerSnapshot(true); }} isProcessing={snapshot.isProcessing} storagePolicy={storagePolicy} onStoragePolicyChange={handleStoragePolicyChange} triggerClassName={SIDEBAR_UTILITY_TRIGGER_CLASS} /><HelpSheet triggerClassName={SIDEBAR_UTILITY_TRIGGER_CLASS} /><ChatPolicies triggerClassName={SIDEBAR_UTILITY_TRIGGER_CLASS} /></div>} sidebar={<ChatSidebar
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
        onUpdateConversation={(id, updater) => {
          const conversation = getConversation(id);
          if (updater(conversation ?? { id, title: "", messages: [], createdAt: new Date(), updatedAt: new Date() }).permanentMemory !== conversation?.permanentMemory) togglePermanentMemory(id, updater);
          else updateConversation(id, updater);
        }}
        isSummarizing={isSummarizing}
      />}>
        <div className={area === "chat" ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" : "hidden"} aria-hidden={area !== "chat"}>
        <MemoryControls compact records={memoryRecords} onPin={(id, pinned) => changeMemory(() => updateMemoryRecord(id, { pinned }))} onCorrect={(id, text) => changeMemory(() => updateMemoryRecord(id, { text }))} onForget={(id) => changeMemory(() => forgetMemoryRecord(id))} onRestore={(id) => changeMemory(() => updateMemoryRecord(id, { status: "active" }))} />
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
          onQuickCommand={handleQuickCommand}
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
          onLinkedConversationsChange={(ids) => {
            const valid = [...new Set(ids)].filter((id) => id !== activeId && conversations.some((item) => item.id === id));
            if (!activeId) {
              const created = createAndSelect(locale === "ar" ? "محادثة جديدة" : "New conversation");
              updateConversation(created.id, (current) => ({ ...current, linkedConversationIds: valid.filter((id) => id !== created.id) }));
              return;
            }
            updateConversation(activeId, (current) => ({ ...current, linkedConversationIds: valid }));
          }}
        />
        </div>
        {area === "memory" && <MemoryExperience conversations={conversations} records={memoryRecords} onPin={(id, pinned) => changeMemory(() => updateMemoryRecord(id, { pinned }))} onCorrect={(id, text) => changeMemory(() => updateMemoryRecord(id, { text }))} onForget={(id) => changeMemory(() => forgetMemoryRecord(id))} onRestore={(id) => changeMemory(() => updateMemoryRecord(id, { status: "active" }))} onAddDecision={(record) => changeMemory(() => addMemoryRecord(record))} onOpenConversation={(id) => { selectConversation(id); navigate("chat"); }} />}
        {area === "project" && activeProjectId && (() => { const project = projects.find((item) => item.id === activeProjectId); return project ? <ProjectWorkspace project={project} conversations={conversations.filter((conversation) => conversation.projectId === project.id)} unlinkedConversations={conversations.filter((conversation) => conversation.projectId !== project.id)} onOpenConversation={(id) => { selectConversation(id); navigate("chat"); }} onLinkConversation={(id) => updateConversation(id, (conversation) => ({ ...conversation, projectId: project.id, updatedAt: new Date() }))} onAddTask={(task) => updateProject(project.id, (current) => ({ ...current, tasks: [...current.tasks, task.trim()].filter((item, index, all) => item && all.indexOf(item) === index).slice(0, 12), updatedAt: new Date() }))} /> : null; })()}
        {area === "settings" && <SettingsShell conversations={conversations} apiKey={apiKey} provider={provider} onProviderChange={setProvider} baseUrl={baseUrl} onBaseUrlChange={setBaseUrl} modelName={modelName} onModelNameChange={setModelName} connectionStatus={connectionStatus} onApiKeyChange={setApiKey} onValidate={validateKey} onClearKey={clearKey} onClearAnalytics={clearAnalytics} />}
      </AppShell>
    </>
  );
}

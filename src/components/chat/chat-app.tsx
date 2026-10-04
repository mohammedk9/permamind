"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { needsSummary } from "@/lib/ai/summarize";
import { buildMessagesWithMemory, linkedConversationContext } from "@/lib/memory/context";
import { projectConversationContext } from "@/lib/projects/context";
import { embedText, syncMemoryEmbeddings, type MemoryEmbeddingDocument } from "@/lib/memory/embeddings";
import { activeMemoryRecords, addMemoryRecord, forgetMemoryRecord, syncExtractedMemories, updateMemoryRecord } from "@/lib/memory/ledger";
import { isPreviousConversationQuery, previousConversationSearchQuery, retrieveRelevantMemories } from "@/lib/memory/retrieve";

import { ChatMain } from "@/components/chat/chat-main";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { ProjectWorkspace } from "@/components/chat/project-workspace";
import { ProjectNameDialog } from "@/components/chat/project-name-dialog";
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
import { useDeltaSync } from "@/hooks/use-delta-sync";
import { createId, truncateTitle } from "@/lib/chat/conversation";
import { QUICK_COMMANDS, buildQuickCommandReply, localCommandMessages, type QuickCommand } from "@/lib/chat/quick-commands";
import { getLastSnapshot } from "@/lib/arweave/snapshot-registry";
import { startProcessor, stopProcessor } from "@/lib/arweave/queue-processor";
import type { ChatCompletionMessage } from "@/lib/ai/types";
import type { Message, Project } from "@/types/chat";
import type { MemoryRecord, RetrievedMemory, SearchCitation, SearchProvider } from "@/types/memory";
import { applyWebContext, shouldSearchWeb } from "@/lib/search/web-context";
import { DEFAULT_SEARCH_PROVIDER, loadSearchProvider, saveSearchProvider } from "@/lib/search/settings";
import { dismissPermanentMemoryWarning, isPermanentMemoryWarningDismissed } from "@/lib/arweave/storage-policy";
import { MemoryExperience } from "@/components/memory/memory-experience";
import { MemoryControls } from "@/components/memory/memory-controls";
import { SettingsShell } from "@/components/settings/settings-shell";
import { DataExportButton } from "@/components/settings/data-export-button";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { ChatPolicies } from "@/components/legal/policy-sheets";
import { SnapshotSettings } from "@/components/arweave/snapshot-settings";
import { loadStoragePolicy, saveStoragePolicy, type StoragePolicy } from "@/lib/arweave/storage-policy";

const SNAPSHOT_AFTER_RESPONSE_DELAY_MS = 350;
const SIDEBAR_UTILITY_TRIGGER_CLASS = "w-full justify-start gap-2 rounded-lg border border-sidebar-border/70 bg-sidebar-accent/40 px-3 py-2 text-xs font-medium text-sidebar-foreground shadow-sm transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/50";
/* Mirrors `SIDEBAR_UTILITY_TRIGGER_CLASS`, kept separate because the theme switch
   is a persistent control rather than a sheet trigger, and keeping the two in
   one constant would force a shared border treatment on both. */
const SIDEBAR_THEME_TRIGGER_CLASS = "w-full justify-start gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/50";

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
    renameProject,
    deleteProject,
    reload: reloadConversations,
  } = useConversations();

  // Pulls summaries written on another device. The same passphrase used for
  // Arweave backups unlocks the sync rows, so the user is never asked twice.
  // Merged rows are written straight to storage, so the conversation list is
  // reloaded rather than patched, which keeps one source of truth for ordering
  // and dates.
  useDeltaSync({ onApplied: reloadConversations, passphrase: snapshotPassphrase });

  useEffect(() => {
    setStoragePolicy(loadStoragePolicy());
    setSearchProviderState(loadSearchProvider());
    if (!hasCompletedFirstRun()) setShowOnboarding(true);
  }, []);

  const setSearchProvider = useCallback((next: SearchProvider) => {
    setSearchProviderState(next);
    saveSearchProvider(next);
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
  const [searchProvider, setSearchProviderState] = useState<SearchProvider>(DEFAULT_SEARCH_PROVIDER);
  const [searchUsage, setSearchUsage] = useState<{ used: number; limit: number } | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  useEffect(() => {
    const fromPath = () => (window.location.pathname.split("/")[1] as ProductArea) || "chat";
    const initial = fromPath();
    if (["chat", "memory", "backup", "settings", "rooms", "project"].includes(initial)) setArea(initial);
    const onPopState = () => setArea(fromPath());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  /**
   * Restores the project named in the address bar.
   *
   * `/project/<id>` carries the id in the second path segment, which `fromPath` cannot express —
   * it returns `"project"` and stops. Without reading that id back, reloading a project URL left
   * `activeProjectId` null while the bar still said "project": the page rendered nothing and Back
   * had nothing to return to.
   *
   * This waits on `isHydrated` because the project list lives in local storage and is still empty
   * on the first render; restoring an id against an empty list would silently resolve to nothing,
   * which is the same blank page by a slower route.
   */
  useEffect(() => {
    if (!isHydrated || area !== "project") return;
    const segments = window.location.pathname.split("/").filter(Boolean);
    const id = segments[0] === "project" ? segments[1] : null;
    if (id && !projects.some((project) => project.id === id)) return;
    if (id) setActiveProjectId(id);
  }, [isHydrated, area, projects]);
  const navigate = useCallback((next: ProductArea) => {
    // A full page load, like Backup. Rooms are not a view inside this shell: they carry their
    // own key, their own membership and their own lifetime, and the room page has to start
    // from the URL. Pushing a history entry and swapping `area` would leave this shell
    // mounted over a screen it does not know how to render.
    if (next === "backup" || next === "rooms") {
      window.location.href = next === "backup" ? "/backup" : "/rooms/new";
      return;
    }
    setArea(next);
    const path = next === "chat" ? "/chat" : `/${next}`;
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
  }, []);

  /**
   * Cheap signature of everything the memory index actually depends on.
   *
   * The old effect keyed on the `conversations` array itself, so every streamed
   * chunk produced a new array and therefore a full rebuild: one SHA-256 and
   * one AES-GCM encryption per memory, per token. Only the summary fingerprint,
   * the decision count, and the title can change what gets indexed, so a chat
   * that has not been re-summarised keeps the same signature and is skipped.
   */
  const memoryIndexKey = useMemo(
    () =>
      conversations
        .map(
          (conversation) =>
            `${conversation.id}:${conversation.title.length}:${conversation.metadata?.messageFingerprint ?? ""}:${conversation.metadata?.decisions?.length ?? 0}:${conversation.metadata?.facts?.length ?? 0}`,
        )
        .join("|"),
    [conversations],
  );
  const builtIndexKey = useRef("");

  const refreshMemoryIndex = useCallback(async (source = conversations) => {
    const signature = source
      .map(
        (conversation) =>
          `${conversation.id}:${conversation.title.length}:${conversation.metadata?.messageFingerprint ?? ""}:${conversation.metadata?.decisions?.length ?? 0}:${conversation.metadata?.facts?.length ?? 0}`,
      )
      .join("|");

    // Rebuild only when the indexed content actually changed.
    if (builtIndexKey.current === signature) return;
    builtIndexKey.current = signature;

    // One read and one write for the whole batch instead of one per conversation.
    const records = syncExtractedMemories(source);
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
    // memoryIndexKey is the real dependency; conversations would defeat the guard.
  }, [isHydrated, memoryIndexKey, refreshMemoryIndex]);

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

  const { model, setModel, isLoading, error, canRetry, clearError, sendMessage } =
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

  const failedRequestRef = useRef<{
    conversationId: string;
    messagesForRequest: ChatCompletionMessage[];
    sources?: Message["sources"];
    memories: RetrievedMemory[];
    conversationTitle: string;
    model: string;
  } | null>(null);

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

  /**
   * Which project the name dialog is acting on.
   *
   * `null` is closed. The id — rather than a boolean — is carried here so the dialog can show the
   * current name when renaming; a bare `isOpen` flag would leave the rename form starting blank,
   * and a user confirming an empty field would learn nothing.
   */
  const [nameDialog, setNameDialog] = useState<{ mode: "create" | "rename"; projectId: string | null } | null>(null);

  const handleNewProject = useCallback(() => {
    setNameDialog({ mode: "create", projectId: null });
  }, []);

  const handleSubmitProjectName = useCallback((name: string) => {
    if (nameDialog?.mode === "rename" && nameDialog.projectId) {
      renameProject(nameDialog.projectId, name);
      setNameDialog(null);
      return;
    }
    const project: Project = { id: createId(), name, summary: "", goals: [], tasks: [], decisions: [], openQuestions: [], createdAt: new Date(), updatedAt: new Date() };
    createProject(project);
    setActiveProjectId(project.id);
    setArea("project");
    window.history.pushState({}, "", `/project/${project.id}`);
    setNameDialog(null);
  }, [createProject, nameDialog, renameProject]);

  /**
   * Deleting a project asks first, and says exactly what survives.
   *
   * The conversations keep their text and lose only their link to the project, so the confirmation
   * states that rather than the generic "are you sure" — a user who believes the delete will take
   * their conversations with it will not confirm if told plainly, and should not have to guess.
   */
  const handleDeleteProject = useCallback((projectId: string) => {
    const target = projects.find((item) => item.id === projectId);
    if (!target) return;
    const linkedCount = conversations.filter((conversation) => conversation.projectId === projectId).length;
    const confirmed = window.confirm(
      locale === "ar"
        ? `حذف «${target.name}»${linkedCount > 0 ? ` ستبقى ${linkedCount} محادثة لكنها ستصبح خارج أي مشروع.` : ""}`
        : `Delete "${target.name}"?${linkedCount > 0 ? ` Its ${linkedCount} conversation${linkedCount === 1 ? "" : "s"} will stay, just unfiled.` : ""}`
    );
    if (!confirmed) return;
    deleteProject(projectId);
    if (activeProjectId === projectId) {
      setActiveProjectId(null);
      setArea("chat");
      if (window.location.pathname.startsWith("/project/")) window.history.pushState({}, "", "/chat");
    }
  }, [projects, conversations, deleteProject, activeProjectId, locale]);

  const handleSelect = useCallback(
    (id: string) => {
      selectConversation(id);
      clearError();
      setMemoriesUsed([]);
    },
    [selectConversation, clearError]
  );

  const handleSend = useCallback(
    async (
      content: string,
      displayContent?: string,
      options?: { conversationId?: string; baseMessages?: Message[] },
    ) => {
      if (!canSendRequests) {
        clearError();
        return;
      }
      clearError();

      let conversationId = options?.conversationId ?? activeId;

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

      const priorMessages = options?.baseMessages ??
        conversations.find((c) => c.id === conversationId)?.messages ??
        (activeConversation?.id === conversationId ? activeConversation.messages : []);

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
      if (provider !== "ollama" && shouldSearchWeb(visibleContent, webSearchEnabled, searchProvider)) {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(visibleContent)}&provider=${encodeURIComponent(searchProvider)}`
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error ?? "Web search failed");
        }
        const payload = await response.json() as {
          results: SearchCitation[];
          used: number;
          limit: number;
        };
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
          messages: [...(options?.baseMessages ?? c.messages), userMessage, assistantMessage],
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

      if (!result.success) {
        // Keep the user's original message for retry, but never persist a
        // placeholder/partial assistant message as if generation succeeded.
        updateConversation(conversationId, (c) => ({
          ...c,
          messages: c.messages.filter((m) => m.id !== assistantMessage.id),
          updatedAt: new Date(),
        }));
        failedRequestRef.current = result.retryable
          ? { conversationId, messagesForRequest, sources, memories, conversationTitle, model }
          : null;
        return;
      }

      failedRequestRef.current = null;
      updateConversation(conversationId, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistantMessage.id
            ? { ...m, isStreaming: false, sources }
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
      provider,
    ]
  );

  const handleResend = useCallback(
    (message: Message) => {
      if (isLoading || message.role !== "user" || !activeId) return;
      const conversation = getConversation(activeId);
      if (!conversation) return;
      const messageIndex = conversation.messages.findIndex((item) => item.id === message.id);
      if (messageIndex < 0) return;

      void handleSend(message.content, message.content, {
        conversationId: activeId,
        baseMessages: conversation.messages.slice(0, messageIndex),
      });
    },
    [activeId, getConversation, handleSend, isLoading],
  );

  const handleRetry = useCallback(async () => {
    const failed = failedRequestRef.current;
    if (!failed || isLoading) return;

    clearError();
    const assistantMessage: Message = {
      id: createId(),
      role: "assistant",
      content: "",
      createdAt: new Date(),
      isStreaming: true,
    };
    updateConversation(failed.conversationId, (conversation) => ({
      ...conversation,
      messages: [...conversation.messages, assistantMessage],
      updatedAt: new Date(),
    }));

    const result = await sendMessage(failed.messagesForRequest, (chunk) => {
      updateConversation(failed.conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => message.id === assistantMessage.id
          ? { ...message, content: message.content + chunk }
          : message),
        updatedAt: new Date(),
      }));
    });

    if (!result.success) {
      updateConversation(failed.conversationId, (conversation) => ({
        ...conversation,
        messages: conversation.messages.filter((message) => message.id !== assistantMessage.id),
        updatedAt: new Date(),
      }));
      failedRequestRef.current = result.retryable ? failed : null;
      return;
    }

    failedRequestRef.current = null;
    updateConversation(failed.conversationId, (conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) => message.id === assistantMessage.id
        ? { ...message, isStreaming: false, sources: failed.sources }
        : message),
      updatedAt: new Date(),
    }));
    if (result.usage) {
      recordChat({
        model: failed.model,
        conversationId: failed.conversationId,
        conversationTitle: failed.conversationTitle,
        usage: result.usage,
        memories: failed.memories,
      });
      queueSummary(failed.conversationId);
    }
    window.setTimeout(() => {
      void snapshot.triggerSnapshot();
    }, SNAPSHOT_AFTER_RESPONSE_DELAY_MS);
  }, [clearError, isLoading, queueSummary, recordChat, sendMessage, snapshot, updateConversation]);

  const apiBlockedError = !canSendRequests
    ? {
        // English fallback; PROVIDER_ERROR carries the localized copy.
        message: "Connect an AI provider in Settings to send messages.",
        code: "PROVIDER_ERROR" as const,
      }
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
      <AppShell activeArea={area} onNavigate={navigate} utility={<div className="space-y-1.5"><ThemeToggle triggerClassName={SIDEBAR_THEME_TRIGGER_CLASS} /><SnapshotSettings passphrase={snapshotPassphrase} onPassphraseChange={setSnapshotPassphrase} enabled={snapshotsEnabled} onEnabledChange={(enabled) => { if (enabled && snapshotPassphrase.length < 8) { window.alert("Set an encryption passphrase of at least 8 characters before enabling backups."); return; } setSnapshotsEnabled(enabled); }} onSnapshotNow={() => { if (window.confirm("Create an encrypted permanent Arweave backup now? Uploaded backups cannot be deleted.")) void snapshot.triggerSnapshot(true); }} isProcessing={snapshot.isProcessing} storagePolicy={storagePolicy} onStoragePolicyChange={handleStoragePolicyChange} triggerClassName={SIDEBAR_UTILITY_TRIGGER_CLASS} /><DataExportButton triggerClassName={SIDEBAR_UTILITY_TRIGGER_CLASS} /><HelpSheet triggerClassName={SIDEBAR_UTILITY_TRIGGER_CLASS} /><ChatPolicies triggerClassName={SIDEBAR_UTILITY_TRIGGER_CLASS} /></div>} sidebar={<ChatSidebar
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
          error={error ?? apiBlockedError}
          onDismissError={clearError}
          onRetry={canRetry ? handleRetry : undefined}
          onResend={handleResend}
          memoriesUsed={memoriesUsed}
          onOpenMemory={handleSelect}
          analyticsSummary={analyticsSummary}
          onClearAnalytics={clearAnalytics}
          canSend={canSendRequests}
          webSearchEnabled={webSearchEnabled}
          onWebSearchChange={setWebSearchEnabled}
          searchProvider={searchProvider}
          onSearchProviderChange={setSearchProvider}
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
        {area === "project" && activeProjectId && (() => { const project = projects.find((item) => item.id === activeProjectId); return project ? <ProjectWorkspace project={project} conversations={conversations.filter((conversation) => conversation.projectId === project.id)} unlinkedConversations={conversations.filter((conversation) => conversation.projectId !== project.id)} onOpenConversation={(id) => { selectConversation(id); navigate("chat"); }} onLinkConversation={(id) => updateConversation(id, (conversation) => ({ ...conversation, projectId: project.id, updatedAt: new Date() }))} onAddTask={(task) => updateProject(project.id, (current) => ({ ...current, tasks: [...current.tasks, task.trim()].filter((item, index, all) => item && all.indexOf(item) === index).slice(0, 12), updatedAt: new Date() }))} onRename={(name) => renameProject(project.id, name)} onDelete={() => handleDeleteProject(project.id)} /> : null; })()}
              {nameDialog ? (
        <ProjectNameDialog
          open
          mode={nameDialog.mode}
          initialName={nameDialog.projectId ? (projects.find((p) => p.id === nameDialog.projectId)?.name ?? "") : ""}
          onOpenChange={(nextOpen) => { if (!nextOpen) setNameDialog(null); }}
          onSubmit={handleSubmitProjectName}
        />
      ) : null}
{area === "settings" && <SettingsShell conversations={conversations} apiKey={apiKey} provider={provider} onProviderChange={setProvider} baseUrl={baseUrl} onBaseUrlChange={setBaseUrl} modelName={modelName} onModelNameChange={setModelName} connectionStatus={connectionStatus} onApiKeyChange={setApiKey} onValidate={validateKey} onClearKey={clearKey} onClearAnalytics={clearAnalytics} />}
      </AppShell>
    </>
  );
}

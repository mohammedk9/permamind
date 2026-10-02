"use client";

import { MessagesSquare, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

import { ConversationMetadataBar } from "@/components/chat/conversation-metadata";
import { ChatErrorBanner } from "@/components/chat/chat-error-banner";
import type { ChatError } from "@/hooks/use-chat-completion";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessage } from "@/components/chat/chat-message";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { DataExportButton } from "@/components/settings/data-export-button";
import type { ConnectionStatus } from "@/hooks/use-api-settings";
import type { ApiKeyMode } from "@/lib/settings/api-key-storage";
import { MemoriesUsed } from "@/components/chat/memories-used";
import { LocalStorageWarning } from "@/components/chat/local-storage-warning";
import { PageHeader } from "@/components/ui/page-header";
import type { AnalyticsSummary } from "@/types/analytics";
import type { Conversation } from "@/types/chat";
import type { RetrievedMemory, SearchProvider } from "@/types/memory";
import { useLocale } from "@/hooks/use-locale";
import { useOnlineStatus } from "@/hooks/use-online-status";
import type { QuickCommand } from "@/lib/chat/quick-commands";
import { OFFLINE_MODEL_NOTICE } from "@/lib/pwa/cache-scope";
import { DEFAULT_SEARCH_PROVIDER } from "@/lib/search/settings";

interface ChatMainProps {
  conversation: Conversation | null;
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  isSummarizing?: (id: string) => boolean;
  onSend: (content: string, displayContent?: string) => void;
  onQuickCommand: (command: QuickCommand) => void;
  model: string;
  onModelChange: (model: string) => void;
  mode: ApiKeyMode;
  isLoading: boolean;
  error: ChatError | null;
  onDismissError: () => void;
  onRetry?: () => void;
  onResend?: (message: import("@/types/chat").Message) => void;
  canSend?: boolean;
  apiKey?: string;
  connectionStatus?: ConnectionStatus;
  onModeChange?: (mode: ApiKeyMode) => void;
  onApiKeyChange?: (key: string) => void;
  onValidateKey?: () => Promise<boolean>;
  onClearKey?: () => void;
  settingsOpen?: boolean;
  onSettingsOpenChange?: (open: boolean) => void;
  memoriesUsed?: RetrievedMemory[];
  onOpenMemory?: (conversationId: string) => void;
  analyticsSummary: AnalyticsSummary;
  onClearAnalytics: () => void;
  freeMessagesRemaining?: number | null;
  webSearchEnabled?: boolean;
  onWebSearchChange?: (enabled: boolean) => void;
  searchProvider?: SearchProvider;
  onSearchProviderChange?: (provider: SearchProvider) => void;
  searchUsage?: { used: number; limit: number } | null;
  onLinkedConversationsChange: (ids: string[]) => void;
}

export function ChatMain({
  conversation,
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  isSummarizing,
  onSend,
  onQuickCommand,
  model,
  onModelChange,
  mode,
  isLoading,
  error,
  onDismissError,
  onRetry,
  onResend,
  canSend = true,
  apiKey = "",
  connectionStatus = "unknown",
  onModeChange,
  onApiKeyChange,
  onValidateKey,
  onClearKey,
  settingsOpen,
  onSettingsOpenChange,
  memoriesUsed = [],
  onOpenMemory,
  analyticsSummary,
  onClearAnalytics,
  freeMessagesRemaining = null,
  webSearchEnabled = false,
  onWebSearchChange,
  searchProvider = DEFAULT_SEARCH_PROVIDER,
  onSearchProviderChange,
  searchUsage,
  onLinkedConversationsChange,
}: ChatMainProps) {
  const { locale, isRTL } = useLocale();
  const online = useOnlineStatus();
  const ar = locale === "ar";
  const title = conversation?.title ?? (ar ? "محادثة جديدة" : "New conversation");
  const messages = conversation?.messages ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollKey =
    messages.length > 0
      ? `${messages.length}-${messages[messages.length - 1]?.content.length ?? 0}`
      : "empty";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [scrollKey]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-background">
      <PageHeader
        /* `ps` rather than `px`: AppShell already renders a fixed menu button
           at the inline start below `md`, so only that side needs clearance. */
        className="min-h-14 shrink-0 gap-2 border-b bg-card/50 px-3 py-2 ps-14 backdrop-blur sm:flex-row sm:items-center sm:px-4 sm:pb-2 sm:ps-4"
        title={<span className="truncate">{title}</span>}
        actions={<div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
        {!online && <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">{ar ? "غير متصل" : "Offline"}</span>}
        {/* Keeping your own data should never require three clicks of navigation,
            so the export sits in the header rather than only in Settings. */}
        <DataExportButton variant="icon" />
        {/* This sheet lists *conversations*; AppShell owns the product-area
            menu. Both are `md:hidden`, so the two identical hamburger buttons
            used to stack in the same corner. This one now carries a distinct
            icon and label. */}
        <Sheet>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label={ar ? "فتح قائمة المحادثات" : "Open conversations"}
              />
            }
          >
            <MessagesSquare className="size-5" />
          </SheetTrigger>
          <SheetContent side={isRTL ? "right" : "left"} className="w-[min(20rem,calc(100vw-2rem))] p-0">
            <SheetTitle className="sr-only">{ar ? "المحادثات" : "Conversations"}</SheetTitle>
            <ChatSidebar
              conversations={conversations}
              activeId={activeId}
              onSelect={onSelect}
              onNewChat={onNewChat}
              onRename={onRename}
              onDelete={onDelete}
              isSummarizing={isSummarizing}
              className="min-h-0 w-full flex-1 border-0"
            />
          </SheetContent>
        </Sheet>
        </div>}
      />

      {conversation?.metadata && (
        <ConversationMetadataBar metadata={conversation.metadata} />
      )}

      <MemoriesUsed
        memories={memoriesUsed}
        onOpenConversation={onOpenMemory}
      />

      {error && (
        <ChatErrorBanner
          message={error.message}
          code={error.code}
          limit={error.limit}
          onDismiss={onDismissError}
          onRetry={onRetry}
        />
      )}

      <LocalStorageWarning conversations={conversations} />

      <ScrollArea aria-label={ar ? "رسائل المحادثة" : "Conversation messages"} className="min-h-0 flex-1 overflow-hidden [scrollbar-gutter:stable]">
        {messages.length === 0 ? (
          <div className="flex min-h-[46vh] items-center justify-center px-4 py-8">
            <div className="w-full max-w-xl rounded-3xl border border-border/70 bg-card/80 p-6 text-center shadow-sm sm:p-8">
              <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
                <Sparkles aria-hidden="true" className="size-5" />
              </div>
              <h2 className="text-xl font-semibold tracking-tight">{ar ? "ماذا تريد أن تتذكر؟" : "What would you like to remember?"}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{ar ? "ابدأ محادثة. يتم حفظ محادثاتك محليًا وتبقى بعد تحديث الصفحة." : "Start a conversation. Your chats are saved locally and persist across page refreshes."}</p>
              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                {(ar
                  ? [["weekly", "لخّص الأسبوع"], ["decisions", "ما القرارات المعلقة"], ["changes", "ماذا تغيّر منذ آخر نسخة"]]
                  : [["weekly", "Summarize the week"], ["decisions", "Open decisions"], ["changes", "Changes since last snapshot"]]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    disabled={isLoading}
                    className="rounded-2xl border border-border bg-background/60 px-3 py-3 text-sm leading-5 transition-colors hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    onClick={() => onQuickCommand(id as QuickCommand)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
            <div className="mx-auto max-w-3xl space-y-3 px-2 py-4 sm:px-4" aria-live={isLoading ? "polite" : undefined} aria-busy={isLoading}>
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} isLoading={isLoading} onResend={onResend} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      <div className="relative">
        {webSearchEnabled && searchUsage && <p className="absolute bottom-1 right-5 z-20 text-[10px] text-muted-foreground">{ar ? `بحث الويب: ${searchUsage.used}/${searchUsage.limit}` : `Web search: ${searchUsage.used}/${searchUsage.limit}`}</p>}
        <ChatInput onSend={onSend} isLoading={isLoading} disabled={!canSend || !online} webSearchEnabled={webSearchEnabled} onWebSearchChange={onWebSearchChange} searchProvider={searchProvider} onSearchProviderChange={onSearchProviderChange} conversation={conversation} conversations={conversations} onLinkedConversationsChange={onLinkedConversationsChange} />
        {!online && <p className="mx-auto mt-2 max-w-3xl px-2 text-xs text-muted-foreground" role="status">{OFFLINE_MODEL_NOTICE}</p>}
      </div>
    </div>
  );
}

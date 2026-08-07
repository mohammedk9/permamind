"use client";

import { Menu, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

import { ConversationMetadataBar } from "@/components/chat/conversation-metadata";
import { ChatErrorBanner } from "@/components/chat/chat-error-banner";
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
import type { ConnectionStatus } from "@/hooks/use-api-settings";
import type { ApiKeyMode } from "@/lib/settings/api-key-storage";
import { MemoriesUsed } from "@/components/chat/memories-used";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import type { AnalyticsSummary } from "@/types/analytics";
import type { Conversation } from "@/types/chat";
import type { RetrievedMemory } from "@/types/memory";

interface ChatMainProps {
  conversation: Conversation | null;
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  isSummarizing?: (id: string) => boolean;
  onSend: (content: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  mode: ApiKeyMode;
  isLoading: boolean;
  error: string | null;
  onDismissError: () => void;
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
  model,
  onModelChange,
  mode,
  isLoading,
  error,
  onDismissError,
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
}: ChatMainProps) {
  const title = conversation?.title ?? "New conversation";
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
        className="min-h-16 shrink-0 gap-2 border-b px-12 py-3 sm:flex-row sm:items-center sm:px-4 sm:pb-3"
        title={title}
        eyebrow="Chat"
        actions={<div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
        <Sheet>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="Open menu"
              />
            }
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <ChatSidebar
              conversations={conversations}
              activeId={activeId}
              onSelect={onSelect}
              onNewChat={onNewChat}
              onRename={onRename}
              onDelete={onDelete}
              isSummarizing={isSummarizing}
              className="h-full w-full border-0"
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
        <ChatErrorBanner message={error} onDismiss={onDismissError} />
      )}

      <ScrollArea aria-label="Conversation messages" className="min-h-0 flex-1 overflow-hidden [scrollbar-gutter:stable]">
        {messages.length === 0 ? (
          <EmptyState className="mx-auto mt-10 min-h-[38vh] max-w-xl border-0 bg-transparent" icon={Sparkles} title="What would you like to remember?" description="Start a conversation. Your chats are saved locally and persist across page refreshes." />
        ) : (
            <div className="mx-auto max-w-3xl divide-y divide-border/60 px-2 sm:px-4" aria-live={isLoading ? "polite" : undefined} aria-busy={isLoading}>
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>

      <ChatInput onSend={onSend} isLoading={isLoading} disabled={!canSend} />
    </div>
  );
}

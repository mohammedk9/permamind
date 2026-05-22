"use client";

import { Menu, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

import { ConversationMetadataBar } from "@/components/chat/conversation-metadata";
import { ChatErrorBanner } from "@/components/chat/chat-error-banner";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessage } from "@/components/chat/chat-message";
import { ModelSelector } from "@/components/chat/model-selector";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ChatSidebar } from "@/components/chat/chat-sidebar";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import type { ConnectionStatus } from "@/hooks/use-api-settings";
import type { ApiKeyMode } from "@/lib/settings/api-key-storage";
import { UsagePanel } from "@/components/analytics/usage-panel";
import { MemoriesUsed } from "@/components/chat/memories-used";
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
}: ChatMainProps) {
  const title = conversation?.title ?? "New conversation";
  const messages = conversation?.messages ?? [];
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollKey =
    messages.length > 0
      ? `${messages.length}-${messages[messages.length - 1]?.content.length ?? 0}`
      : "empty";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [scrollKey]);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
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
              analyticsSummary={analyticsSummary}
              onClearAnalytics={onClearAnalytics}
              mode={mode}
              apiKey={apiKey}
              connectionStatus={connectionStatus}
              onModeChange={onModeChange!}
              onApiKeyChange={onApiKeyChange!}
              onValidateKey={onValidateKey!}
              onClearKey={onClearKey!}
              className="h-full w-full border-0"
            />
          </SheetContent>
        </Sheet>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </h1>
        <span className="hidden shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground sm:inline">
          {mode === "free" ? "Free" : "BYOK"}
        </span>
        <div className="flex items-center gap-2">
          {onModeChange && onValidateKey && onClearKey && onApiKeyChange && (
            <div className="md:hidden">
              <SettingsDialog
                mode={mode}
                apiKey={apiKey}
                connectionStatus={connectionStatus}
                onModeChange={onModeChange}
                onApiKeyChange={onApiKeyChange}
                onValidate={onValidateKey}
                onClearKey={onClearKey}
                open={settingsOpen}
                onOpenChange={onSettingsOpenChange}
                triggerClassName="w-auto px-2"
              />
            </div>
          )}
          <div className="md:hidden">
            <UsagePanel
              summary={analyticsSummary}
              onClear={onClearAnalytics}
            />
          </div>
          <ModelSelector
            value={model}
            onChange={onModelChange}
            mode={mode}
            disabled={isLoading}
          />
        </div>
      </header>

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

      <ScrollArea className="flex-1">
        {messages.length === 0 ? (
          <div className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
              <Sparkles className="size-7 text-muted-foreground" />
            </div>
            <div className="max-w-md space-y-2">
              <h2 className="text-lg font-semibold">
                What would you like to remember?
              </h2>
              <p className="text-sm text-muted-foreground">
                Start a conversation. Your chats are saved locally and persist
                across page refreshes.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
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

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
import type { ModelId } from "@/lib/ai/models";
import type { Conversation } from "@/types/chat";

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
  model: ModelId;
  onModelChange: (model: ModelId) => void;
  isLoading: boolean;
  error: string | null;
  onDismissError: () => void;
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
  isLoading,
  error,
  onDismissError,
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
              className="h-full w-full border-0"
            />
          </SheetContent>
        </Sheet>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
        </h1>
        <ModelSelector
          value={model}
          onChange={onModelChange}
          disabled={isLoading}
        />
      </header>

      {conversation?.metadata && (
        <ConversationMetadataBar metadata={conversation.metadata} />
      )}

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

      <ChatInput onSend={onSend} isLoading={isLoading} />
    </div>
  );
}

"use client";

import { Menu, Sparkles } from "lucide-react";

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
import type { Conversation } from "@/types/chat";

interface ChatMainProps {
  conversation: Conversation | null;
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onSend: (content: string) => void;
}

export function ChatMain({
  conversation,
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onSend,
}: ChatMainProps) {
  const title = conversation?.title ?? "New conversation";
  const messages = conversation?.messages ?? [];

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
              className="h-full w-full border-0"
            />
          </SheetContent>
        </Sheet>
        <h1 className="truncate text-sm font-medium">{title}</h1>
      </header>

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
                Start a conversation. PermaMind will help you chat, save
                context, and recall memories — built for permanent AI memory.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
          </div>
        )}
      </ScrollArea>

      <ChatInput onSend={onSend} />
    </div>
  );
}

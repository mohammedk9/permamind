"use client";

import { MessageSquarePlus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/lib/constants";
import type { Conversation } from "@/types/chat";

interface ChatSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  className?: string;
}

export function ChatSidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  className,
}: ChatSidebarProps) {
  return (
    <aside
      className={cn(
        "flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        className
      )}
    >
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
          <span className="text-sm font-semibold">P</span>
        </div>
        <span className="font-semibold tracking-tight">{APP_NAME}</span>
      </div>

      <div className="space-y-2 px-3">
        <Button
          className="w-full justify-start gap-2"
          variant="outline"
          onClick={onNewChat}
        >
          <MessageSquarePlus className="size-4" />
          New chat
        </Button>
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 bg-sidebar-accent/50 pl-8"
            placeholder="Search memories..."
            disabled
          />
        </div>
      </div>

      <Separator className="my-3" />

      <ScrollArea className="flex-1 px-2">
        <nav className="space-y-0.5 pb-4">
          {conversations.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No conversations yet
            </p>
          ) : (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onSelect(conversation.id)}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  activeId === conversation.id &&
                    "bg-sidebar-accent text-sidebar-accent-foreground"
                )}
              >
                <span className="line-clamp-1 font-medium">
                  {conversation.title}
                </span>
              </button>
            ))
          )}
        </nav>
      </ScrollArea>

      <div className="border-t border-sidebar-border p-3">
        <p className="text-xs text-muted-foreground">Phase 1 — Foundation</p>
      </div>
    </aside>
  );
}

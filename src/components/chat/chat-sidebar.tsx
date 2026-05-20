"use client";

import { MessageSquarePlus, Search, X } from "lucide-react";

import { ConversationItem } from "@/components/chat/conversation-item";
import { SearchResultItem } from "@/components/chat/search-result-item";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useMemorySearch } from "@/hooks/use-memory-search";
import { APP_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/chat";

interface ChatSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  isSummarizing?: (id: string) => boolean;
  className?: string;
}

export function ChatSidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  isSummarizing,
  className,
}: ChatSidebarProps) {
  const { query, setQuery, results, isActive, clearSearch, resultCount } =
    useMemorySearch(conversations);

  const handleResultSelect = (conversationId: string) => {
    onSelect(conversationId);
    clearSearch();
  };

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
            className="h-8 bg-sidebar-accent/50 pr-8 pl-8"
            placeholder="Search memories..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search conversations and messages"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon-xs"
              className="absolute top-1/2 right-1 -translate-y-1/2"
              onClick={clearSearch}
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <Separator className="my-3" />

      <ScrollArea className="flex-1 px-2">
        {isActive ? (
          <nav className="space-y-0.5 pb-4">
            {results.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No matches for &ldquo;{query}&rdquo;
              </p>
            ) : (
              results.map((result) => (
                <SearchResultItem
                  key={`${result.conversationId}-${result.messageId ?? "title"}-${result.matchStart}`}
                  result={result}
                  onSelect={() => handleResultSelect(result.conversationId)}
                />
              ))
            )}
          </nav>
        ) : (
          <nav className="space-y-0.5 pb-4">
            {conversations.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No conversations yet
              </p>
            ) : (
              conversations.map((conversation) => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={activeId === conversation.id}
                  isSummarizing={isSummarizing?.(conversation.id)}
                  onSelect={() => onSelect(conversation.id)}
                  onRename={(title) => onRename(conversation.id, title)}
                  onDelete={() => onDelete(conversation.id)}
                />
              ))
            )}
          </nav>
        )}
      </ScrollArea>

      <div className="border-t border-sidebar-border p-3">
        <p className="text-xs text-muted-foreground">
          {isActive
            ? `${resultCount} result${resultCount === 1 ? "" : "s"}`
            : `Saved locally · ${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`}
        </p>
      </div>
    </aside>
  );
}

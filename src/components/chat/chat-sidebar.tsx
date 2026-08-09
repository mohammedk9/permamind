"use client";

import { MessageSquarePlus } from "lucide-react";

import { ConversationItem } from "@/components/chat/conversation-item";
import { SearchResultItem } from "@/components/chat/search-result-item";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchField } from "@/components/ui/search-field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useMemorySearch } from "@/hooks/use-memory-search";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/chat";
import { useLocale } from "@/hooks/use-locale";

interface ChatSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onUpdateConversation?: (id: string, updater: (conversation: Conversation) => Conversation) => void;
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
  onUpdateConversation,
  isSummarizing,
  className,
}: ChatSidebarProps) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const { query, setQuery, results, isActive, clearSearch, resultCount } =
    useMemorySearch(conversations);

  const handleResultSelect = (conversationId: string) => {
    onSelect(conversationId);
    clearSearch();
  };

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 w-full shrink-0 flex-col bg-sidebar text-sidebar-foreground",
        className
      )}
    >
      <div className="space-y-3 px-0">
        <Button
          className="w-full justify-start gap-2"
          variant="default"
          onClick={onNewChat}
        >
          <MessageSquarePlus className="size-4" />
          {ar ? "محادثة جديدة" : "New chat"}
        </Button>
        <SearchField
            className="[&_input]:bg-sidebar-accent/50 [&_input]:border-sidebar-border"
            placeholder={ar ? "ابحث في المحادثات..." : "Search conversations..."}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={ar ? "البحث في المحادثات والرسائل" : "Search conversations and messages"}
            onClear={clearSearch}
            resultCount={isActive ? resultCount : undefined}
        />
      </div>

      <Separator className="my-3" />

      <ScrollArea className="flex-1 px-2">
        {isActive ? (
          <nav className="space-y-0.5 pb-4">
            {results.length === 0 ? (
              <EmptyState className="min-h-32 border-0 bg-transparent p-4" title={ar ? "لا توجد نتائج" : "No matches"} description={ar ? `لا يوجد شيء يطابق “${query}”.` : `Nothing in your conversations matches “${query}”.`} />
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
              <EmptyState className="min-h-40 border-0 bg-transparent p-4" title={ar ? "لا توجد محادثات بعد" : "No conversations yet"} description={ar ? "ابدأ محادثة جديدة وستظهر سجلاتك هنا." : "Start a new chat and your local history will appear here."} action={<Button size="sm" variant="outline" onClick={onNewChat}>{ar ? "ابدأ المحادثة" : "Start chatting"}</Button>} />
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
                  onToggleStar={() => onUpdateConversation?.(conversation.id, (c) => ({ ...c, starred: !c.starred }))}
                  onTogglePermanentMemory={() => onUpdateConversation?.(conversation.id, (c) => ({ ...c, permanentMemory: !c.permanentMemory }))}
                />
              ))
            )}
          </nav>
        )}
      </ScrollArea>

    </aside>
  );
}

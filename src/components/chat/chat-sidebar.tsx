"use client";

import { FolderKanban, MessageSquarePlus } from "lucide-react";

import { ConversationItem } from "@/components/chat/conversation-item";
import { SearchResultItem } from "@/components/chat/search-result-item";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchField } from "@/components/ui/search-field";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useMemorySearch } from "@/hooks/use-memory-search";
import { cn } from "@/lib/utils";
import type { Conversation, Project } from "@/types/chat";
import { useLocale } from "@/hooks/use-locale";

interface ChatSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onNewProject?: () => void;
  projects?: Project[];
  activeProjectId?: string | null;
  onSelectProject?: (id: string) => void;
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
  onNewProject = () => undefined,
  projects = [],
  activeProjectId,
  onSelectProject,
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
        "flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-sidebar text-sidebar-foreground",
        className
      )}
    >
      <div className="shrink-0 space-y-3 px-2 pt-2">
        <div className="grid grid-cols-2 gap-2">
          <Button
            className="h-10 w-full min-w-0 justify-start gap-1 overflow-hidden rounded-lg bg-primary px-1.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-sidebar-ring/50"
            variant="default"
            onClick={onNewChat}
            aria-label={ar ? "بدء محادثة جديدة" : "Start a new chat"}
          >
            <MessageSquarePlus className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{ar ? "محادثة جديدة" : "New chat"}</span>
          </Button>
          <Button
            className="h-10 w-full min-w-0 justify-start gap-1 overflow-hidden rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-1.5 py-2 text-xs font-medium text-sidebar-foreground shadow-sm transition-colors hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-sidebar-ring/50"
            variant="outline"
            onClick={onNewProject}
            aria-label={ar ? "إنشاء مشروع جديد" : "Create a new project"}
          >
            <FolderKanban className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{ar ? "مشروع جديد" : "New project"}</span>
          </Button>
        </div>

        <SearchField
          className="[&_input]:h-10 [&_input]:rounded-lg [&_input]:bg-sidebar-accent/50 [&_input]:border-sidebar-border [&_input]:shadow-sm"
          placeholder={ar ? "ابحث في المحادثات..." : "Search conversations..."}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={ar ? "البحث في المحادثات والرسائل" : "Search conversations and messages"}
          onClear={clearSearch}
          resultCount={isActive ? resultCount : undefined}
        />
      </div>

      <Separator className="my-3 shrink-0" />

      {projects.length > 0 && (
        <div className="mb-3 shrink-0">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {ar ? "المشاريع" : "Projects"}
          </p>
          <nav className="space-y-1">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                onClick={() => onSelectProject?.(project.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50",
                  activeProjectId === project.id
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/90 hover:bg-sidebar-accent/60"
                )}
              >
                <FolderKanban className={cn("size-4 shrink-0", activeProjectId === project.id ? "text-sidebar-primary" : "text-sidebar-primary/80")} />
                <span className="truncate">{project.name}</span>
              </button>
            ))}
          </nav>
        </div>
      )}

      <ScrollArea
        aria-label={ar ? "قائمة المحادثات" : "Conversation list"}
        className="min-h-0 flex-1 overflow-hidden px-2"
      >
        {isActive ? (
          <nav className="space-y-1 pb-4">
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
          <nav className="space-y-1.5 pb-4">
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

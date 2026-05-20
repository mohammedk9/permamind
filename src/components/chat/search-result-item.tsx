"use client";

import { HighlightText } from "@/components/chat/highlight-text";
import { cn } from "@/lib/utils";
import type { MemorySearchResult } from "@/lib/search/memory-index";

interface SearchResultItemProps {
  result: MemorySearchResult;
  onSelect: () => void;
}

export function SearchResultItem({ result, onSelect }: SearchResultItemProps) {
  const isTitle = result.matchType === "title";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg px-3 py-2 text-left transition-colors",
        "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      )}
    >
      <p className="line-clamp-1 text-sm font-medium">
        <HighlightText
          text={result.conversationTitle}
          start={
            isTitle
              ? result.matchStart
              : -1
          }
          end={
            isTitle ? result.matchEnd : -1
          }
        />
      </p>
      {!isTitle && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          <span className="mr-1.5 font-medium capitalize text-muted-foreground/80">
            {result.role}:
          </span>
          <HighlightText
            text={result.snippet}
            start={result.matchStart}
            end={result.matchEnd}
          />
        </p>
      )}
      {isTitle && (
        <p className="mt-0.5 text-xs text-muted-foreground">Conversation</p>
      )}
    </button>
  );
}

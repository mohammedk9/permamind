"use client";

import { Brain } from "lucide-react";

import { formatConversationTime } from "@/lib/format/date";
import type { RetrievedMemory } from "@/types/memory";

interface MemoriesUsedProps {
  memories: RetrievedMemory[];
  onOpenConversation?: (conversationId: string) => void;
}

export function MemoriesUsed({
  memories,
  onOpenConversation,
}: MemoriesUsedProps) {
  if (memories.length === 0) return null;

  return (
    <div className="border-b border-border bg-muted/20 px-4 py-2">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Brain className="size-3.5" />
          <span>
            {memories.length} memor{memories.length === 1 ? "y" : "ies"} used
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {memories.map((memory) => (
            <button
              key={memory.conversationId}
              type="button"
              onClick={() => onOpenConversation?.(memory.conversationId)}
              className="max-w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60"
              title={memory.excerpt}
            >
              <span className="line-clamp-1 text-xs font-medium">
                {memory.conversationTitle}
              </span>
              <span className="line-clamp-1 text-[10px] text-muted-foreground">
                {memory.source === "summary" ? "Summary" : "Message"} ·{" "}
                {formatConversationTime(memory.updatedAt)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

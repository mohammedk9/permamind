"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import { useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";

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
  const [open, setOpen] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  if (memories.length === 0) return null;
  const visible = memories.filter((memory) => !excluded.has(memory.conversationId));

  return (
    <div className="border-b border-border bg-muted/20 px-4 py-2">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <button type="button" onClick={() => setOpen((value) => !value)} className="flex items-center justify-between text-left">
          <StatusPill status="protected" label={`${visible.length} ${visible.length === 1 ? "memory" : "memories"} used`} detail="Why this context was selected" />
          <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && <div className="space-y-2">
          {visible.map((memory) => <div key={memory.conversationId} className="rounded-lg border border-border bg-card p-2.5">
            <div className="flex items-start justify-between gap-2"><button type="button" onClick={() => onOpenConversation?.(memory.conversationId)} className="flex min-w-0 items-center gap-1 text-left text-xs font-medium hover:text-primary"><span className="truncate">{memory.conversationTitle}</span><ExternalLink className="size-3 shrink-0" /></button><span className="shrink-0 text-[10px] text-muted-foreground">{Math.round(Math.min(memory.score / 3, 1) * 100)}%</span></div>
            <p className="mt-1 text-[10px] text-muted-foreground">{memory.reason ?? "Relevant context"} · {formatConversationTime(memory.updatedAt)}</p>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{memory.excerpt}</p>
            <button type="button" onClick={() => setExcluded((current) => new Set(current).add(memory.conversationId))} className="mt-1 text-[10px] text-muted-foreground underline hover:text-foreground">Don&apos;t use for this request</button>
          </div>)}
        </div>}
      </div>
    </div>
  );
}

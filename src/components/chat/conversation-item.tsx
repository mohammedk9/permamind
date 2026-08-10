"use client";

import { Check, Loader2, Pencil, Trash2, X, Star, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatConversationTime } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/chat";
import { loadRegistry } from "@/lib/arweave/snapshot-registry";

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  isSummarizing?: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onTogglePermanentMemory?: () => void;
  onToggleStar?: () => void;
}

export function ConversationItem({
  conversation,
  isActive,
  isSummarizing,
  onSelect,
  onRename,
  onDelete,
  onTogglePermanentMemory,
  onToggleStar,
}: ConversationItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const meta = conversation.metadata;
  const hasUploadedBackup = typeof window !== "undefined" && loadRegistry().snapshots.some((snapshot) => snapshot.txId && snapshot.conversationIds.includes(conversation.id));

  useEffect(() => {
    if (!isEditing) setEditTitle(conversation.title);
  }, [conversation.title, isEditing]);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  const commitRename = useCallback(() => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== conversation.title) {
      onRename(trimmed);
    } else {
      setEditTitle(conversation.title);
    }
    setIsEditing(false);
  }, [conversation.title, editTitle, onRename]);

  const cancelRename = useCallback(() => {
    setEditTitle(conversation.title);
    setIsEditing(false);
  }, [conversation.title]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      window.confirm(
        `Delete \"${conversation.title}\" locally? This removes it from this device. ${hasUploadedBackup ? "A previously uploaded encrypted backup may remain permanently on Arweave and cannot be deleted." : "No uploaded Arweave backup was found for this conversation."}`
      )
    ) {
      onDelete();
    }
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 rounded-lg bg-sidebar-accent px-2 py-1.5">
        <Input
          ref={inputRef}
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          className="h-7 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") cancelRename();
          }}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={commitRename}
          aria-label="Save name"
        >
          <Check className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={cancelRename}
          aria-label="Cancel rename"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative rounded-lg transition-colors",
        isActive
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "hover:bg-sidebar-accent/60"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full px-3 py-2 pr-16 text-left"
      >
        <span className="line-clamp-1 text-sm font-medium">
          {conversation.title}
        </span>
        <span className="mt-1 flex gap-1 text-[10px]">
          {conversation.starred && <span className="flex items-center gap-0.5 text-amber-600"><Star className="size-3 fill-current" /> Important</span>}
          {hasUploadedBackup ? <span className="flex items-center gap-0.5 text-primary"><ShieldCheck className="size-3" /> Backed up</span> : conversation.permanentMemory ? <span className="flex items-center gap-0.5 text-muted-foreground"><ShieldCheck className="size-3" /> Backup selected</span> : <span className="text-muted-foreground">Local only</span>}
        </span>
        {isSummarizing ? (
          <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Summarizing…
          </span>
        ) : meta?.summary ? (
          <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {meta.summary}
          </span>
        ) : null}
        {meta && meta.tags.length > 0 && (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {meta.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-sidebar-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </span>
        )}
        <span className="mt-1 block text-[10px] text-muted-foreground/80">
          {formatConversationTime(conversation.updatedAt)}
        </span>
      </button>
      <div className="absolute top-1.5 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); onToggleStar?.(); }} aria-label="Toggle important"><Star className={cn("size-3", conversation.starred && "fill-current text-amber-500")} /></Button>
        <Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); onTogglePermanentMemory?.(); }} aria-label="Toggle permanent memory"><ShieldCheck className={cn("size-3", conversation.permanentMemory && "text-primary")} /></Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          aria-label="Rename conversation"
        >
          <Pencil className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleDelete}
          aria-label="Delete conversation"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </div>
  );
}

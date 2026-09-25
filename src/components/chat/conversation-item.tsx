"use client";

import { Check, HardDrive, Loader2, Pencil, ShieldCheck, Star, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatConversationTime } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/chat";
import { loadRegistry } from "@/lib/arweave/snapshot-registry";
import { useLocale } from "@/hooks/use-locale";

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
  const { locale } = useLocale();
  const ar = locale === "ar";
  const hasUploadedBackup = typeof window !== "undefined" && loadRegistry().snapshots.some((snapshot) => snapshot.txId && snapshot.conversationIds.includes(conversation.id));
  const statusLabel = hasUploadedBackup
    ? ar ? "محفوظة" : "Backed up"
    : conversation.permanentMemory
      ? ar ? "محددة للنسخ" : "Backup selected"
      : ar ? "محلية فقط" : "Local only";

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

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (
      window.confirm(
        ar
          ? `حذف «${conversation.title}» من هذا الجهاز؟ ${hasUploadedBackup ? "قد تبقى نسخة مشفرة مرفوعة سابقًا على Arweave ولا يمكن حذفها." : "لا توجد نسخة Arweave مرفوعة لهذه المحادثة."}`
          : `Delete "${conversation.title}" locally? This removes it from this device. ${hasUploadedBackup ? "A previously uploaded encrypted backup may remain permanently on Arweave and cannot be deleted." : "No uploaded Arweave backup was found for this conversation."}`
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
          aria-label={ar ? "حفظ الاسم" : "Save name"}
        >
          <Check className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={cancelRename}
          aria-label={ar ? "إلغاء إعادة التسمية" : "Cancel rename"}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-transparent transition-colors",
        isActive
          ? "border-primary/30 bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-primary/20"
          : "hover:border-sidebar-border/50 hover:bg-sidebar-accent/60"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full min-w-0 px-3 py-2.5 text-start"
      >
        <span className="block truncate text-sm font-medium">
          {conversation.title}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1 overflow-hidden text-[10px] text-muted-foreground">
          {conversation.starred && <Star className="size-3 shrink-0 fill-current text-amber-500" aria-hidden="true" />}
          <span className={cn("flex min-w-0 items-center gap-0.5", hasUploadedBackup && "text-primary")}>
            {hasUploadedBackup || conversation.permanentMemory ? <ShieldCheck className="size-3 shrink-0" /> : <HardDrive className="size-3 shrink-0" />}
            <span className="truncate">{statusLabel}</span>
          </span>
          <span className="ms-auto shrink-0 tabular-nums text-muted-foreground/80">{formatConversationTime(conversation.updatedAt, ar ? "ar" : "en")}</span>
        </span>
        {isSummarizing ? (
          <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 shrink-0 animate-spin" />
            <span className="truncate">{ar ? "جارٍ التلخيص…" : "Summarizing…"}</span>
          </span>
        ) : meta?.summary ? (
          <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {meta.summary}
          </span>
        ) : null}
        {meta && meta.tags.length > 0 && (
          <span className="mt-1.5 flex flex-nowrap gap-1 overflow-hidden">
            {meta.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="max-w-24 shrink-0 truncate rounded-md bg-sidebar-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </span>
        )}
      </button>
      <div className="absolute top-1.5 end-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); onToggleStar?.(); }} aria-label={ar ? (conversation.starred ? "إلغاء التمييز" : "تمييز كمهم") : (conversation.starred ? "Unmark important" : "Mark important")}><Star className={cn("size-3", conversation.starred && "fill-current text-amber-500")} /></Button>
        <Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); onTogglePermanentMemory?.(); }} aria-label={ar ? (conversation.permanentMemory ? "إلغاء تحديد النسخ" : "تحديد للنسخ") : (conversation.permanentMemory ? "Remove from backup" : "Select for backup")}><ShieldCheck className={cn("size-3", conversation.permanentMemory && "text-primary")} /></Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          aria-label={ar ? "إعادة تسمية المحادثة" : "Rename conversation"}
        >
          <Pencil className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleDelete}
          aria-label={ar ? "حذف المحادثة" : "Delete conversation"}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </div>
  );
}

"use client";

import { Check, Loader2, Pencil, Trash2, X, Star, ShieldCheck, Cloud, HardDrive, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatConversationTime } from "@/lib/format/date";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/chat";
import { loadRegistry } from "@/lib/arweave/snapshot-registry";
import { isCloudSyncEnabled } from "@/lib/storage/storage-preferences";
import { getCloudSummaryWarning } from "@/lib/storage/sync-consent";
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
  onToggleCloudSync?: () => Promise<"uploaded" | "unchanged" | "pending-summary" | void>;
  onDisableCloudSync?: () => Promise<void>;
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
  onToggleCloudSync,
  onDisableCloudSync,
}: ConversationItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [cloudAction, setCloudAction] = useState<"sync" | "remove">("sync");
  const [syncState, setSyncState] = useState<"idle" | "sending" | "success" | "unchanged" | "removed" | "pending" | "error">("idle");
  const [syncError, setSyncError] = useState("");
  const [editTitle, setEditTitle] = useState(conversation.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const meta = conversation.metadata;
  const { locale } = useLocale();
  const ar = locale === "ar";
  const text = {
    select: ar ? "ظ…ط²ط§ظ…ظ†ط© ط§ظ„ظ…ظ„ط®طµ" : "Sync summary",
    local: ar ? "ط¥ظ„ط؛ط§ط، ط§ظ„ظ…ط²ط§ظ…ظ†ط© ط§ظ„ط³ط­ط§ط¨ظٹط©" : "Cancel cloud sync",
    sync: ar ? "ظ…ط²ط§ظ…ظ†ط© ط§ظ„ظ…ظ„ط®طµ" : "Sync summary",
    title: ar ? "ظ…ط²ط§ظ…ظ†ط© ظ…ظ„ط®طµ ط§ظ„ظ…ط­ط§ط¯ط«ط©" : "Sync conversation summary",
    sending: ar ? "ط¬ط§ط±ظچ ط¥ط±ط³ط§ظ„ ط§ظ„ظ…ظ„ط®طµ ط§ظ„ظ…ط´ظپط±â€¦" : "Sending encrypted summaryâ€¦",
    removing: ar ? "ط¬ط§ط±ظچ ط­ط°ظپ ط§ظ„ظ…ظ„ط®طµ ط§ظ„ط³ط­ط§ط¨ظٹâ€¦" : "Removing cloud summaryâ€¦",
    success: ar ? "طھظ… ط¥ط±ط³ط§ظ„ ط§ظ„ظ…ظ„ط®طµ ط¨ظ†ط¬ط§ط­ ط¥ظ„ظ‰ Supabase." : "The summary was sent successfully to Supabase.",
    unchanged: ar ? "ط§ظ„ط¨ظٹط§ظ†ط§طھ ظ…ط­ط¯ط«ط© ظˆظ„ط§ ط­ط§ط¬ط© ظ„ط¥ط¹ط§ط¯ط© ط§ظ„ط¥ط±ط³ط§ظ„." : "The data is up to date; no re-upload is needed.",
    pending: ar ? "ظ„ط§ ظٹظˆط¬ط¯ ظ…ظ„ط®طµ ط¨ط¹ط¯. ط³ظٹطھظ… ط±ظپط¹ظ‡ ط¹ظ†ط¯ ط¥ظ†ط´ط§ط¦ظ‡." : "No summary yet. It will upload after one is created.",
    removePrompt: ar ? "ط³ظٹظڈط­ط°ظپ ط§ظ„ظ…ظ„ط®طµ ط§ظ„ظ…ط´ظپط± ظ…ظ† Supabase. طھط¨ظ‚ظ‰ ط§ظ„ظ…ط­ط§ط¯ط«ط© ط§ظ„ظƒط§ظ…ظ„ط© ط¹ظ„ظ‰ ظ‡ط°ط§ ط§ظ„ط¬ظ‡ط§ط²." : "The encrypted summary will be deleted from Supabase. The full conversation stays on this device.",
    removed: ar ? "طھظ… ط­ط°ظپ ط§ظ„ظ…ظ„ط®طµ ظ…ظ† Supabase ظˆط¥ط¨ظ‚ط§ط، ط§ظ„ظ…ط­ط§ط¯ط«ط© ظ…ط­ظ„ظٹظ‹ط§." : "The cloud summary was deleted. The conversation stays on this device.",
    error: ar ? "طھط¹ط°ط± ظ…ط²ط§ظ…ظ†ط© ط§ظ„ظ…ظ„ط®طµ." : "Could not sync the summary.",
    removeError: ar ? "طھط¹ط°ط± ط­ط°ظپ ط§ظ„ظ…ظ„ط®طµ ط§ظ„ط³ط­ط§ط¨ظٹ." : "Could not remove the cloud summary.",
    cancel: ar ? "ط¥ظ„ط؛ط§ط،" : "Cancel",
    send: ar ? "ط¥ط±ط³ط§ظ„ ط§ظ„ظ…ظ„ط®طµ" : "Send summary",
    remove: ar ? "ط­ط°ظپ ط§ظ„ظ…ظ„ط®طµ ط§ظ„ط³ط­ط§ط¨ظٹ" : "Delete cloud summary",
    close: ar ? "ط¥ط؛ظ„ط§ظ‚" : "Close",
  };
  const canSyncSummary = isCloudSyncEnabled() && Boolean(meta?.summary?.trim());
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

  const openCloudDialog = (action: "sync" | "remove") => {
    setCloudAction(action);
    setSyncState("idle");
    setSyncError("");
    setSyncDialogOpen(true);
  };

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (
      window.confirm(
        `Delete "${conversation.title}" locally? This removes it from this device. ${hasUploadedBackup ? "A previously uploaded encrypted backup may remain permanently on Arweave and cannot be deleted." : "No uploaded Arweave backup was found for this conversation."}`
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
        "group relative rounded-lg border border-transparent transition-colors",
        isActive
          ? "border-sidebar-border/70 bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
          : "hover:border-sidebar-border/50 hover:bg-sidebar-accent/60"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full px-3 py-2.5 pr-28 text-start"
      >
        <span className="line-clamp-1 text-sm font-medium">
          {conversation.title}
        </span>
        <span className="mt-1 flex gap-1 text-[10px]">
          {conversation.starred && <span className="flex items-center gap-0.5 text-amber-600"><Star className="size-3 fill-current" /> Important</span>}
          {hasUploadedBackup ? <span className="flex items-center gap-0.5 text-primary"><ShieldCheck className="size-3" /> Backed up</span> : conversation.permanentMemory ? <span className="flex items-center gap-0.5 text-muted-foreground"><ShieldCheck className="size-3" /> Backup selected</span> : <span className="flex items-center gap-0.5 text-muted-foreground"><HardDrive className="size-3" /> Local only</span>}
          {conversation.syncToCloud && <span className="ml-1 flex items-center gap-0.5 text-primary"><Cloud className="size-3" /> Summary sync selected</span>}
        </span>
        {isSummarizing ? (
          <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Summarizingâ€¦
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
      <div className="flex items-center gap-1 px-3 pb-2 text-[10px]">
        <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); openCloudDialog(conversation.syncToCloud ? "remove" : "sync"); }} aria-label={conversation.syncToCloud ? "Cancel cloud summary sync" : "Sync conversation summary"}>
          {conversation.syncToCloud ? text.local : text.select}
        </button>
        {canSyncSummary && conversation.syncToCloud && <button type="button" className="ms-auto inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); openCloudDialog("sync"); }} aria-label={text.sync}><Upload className="size-3" /> {text.sync}</button>}
      </div>
      {syncDialogOpen && <div role="dialog" aria-modal="true" aria-labelledby={`sync-title-${conversation.id}`} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (syncState !== "sending") setSyncDialogOpen(false); }}>
        <div className="w-full max-w-md rounded-xl border bg-background p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <h2 id={`sync-title-${conversation.id}`} className="text-base font-semibold">{cloudAction === "remove" ? text.local : text.title}</h2>
          {syncState === "idle" && cloudAction === "sync" && <><p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">{getCloudSummaryWarning(locale)}</p><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setSyncDialogOpen(false)}>{text.cancel}</Button><Button type="button" onClick={() => { setSyncState("sending"); void onToggleCloudSync?.().then((result) => setSyncState(result === "pending-summary" ? "pending" : result === "unchanged" ? "unchanged" : "success")).catch((error: unknown) => { setSyncError(error instanceof Error ? error.message : text.error); setSyncState("error"); }); }}>{text.send}</Button></div></>}
          {syncState === "idle" && cloudAction === "remove" && <><p className="mt-3 text-sm text-muted-foreground">{text.removePrompt}</p><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setSyncDialogOpen(false)}>{text.cancel}</Button><Button type="button" variant="destructive" onClick={() => { setSyncState("sending"); void onDisableCloudSync?.().then(() => setSyncState("removed")).catch((error: unknown) => { setSyncError(error instanceof Error ? error.message : text.removeError); setSyncState("error"); }); }}>{text.remove}</Button></div></>}
          {syncState === "sending" && <p className="mt-3 text-sm text-muted-foreground">{cloudAction === "remove" ? text.removing : text.sending}</p>}
          {syncState !== "idle" && syncState !== "sending" && <><p className={cn("mt-3 text-sm", syncState === "error" ? "text-destructive" : "text-status-success")}>{syncState === "success" ? text.success : syncState === "unchanged" ? text.unchanged : syncState === "pending" ? text.pending : syncState === "removed" ? text.removed : syncError || (cloudAction === "remove" ? text.removeError : text.error)}</p><div className="mt-5 flex justify-end"><Button type="button" onClick={() => setSyncDialogOpen(false)}>{text.close}</Button></div></>}
        </div>
      </div>}
      <div className="absolute top-1.5 right-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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

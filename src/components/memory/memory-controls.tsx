"use client";

import { Pin, PinOff, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { MemoryRecord } from "@/types/memory";

interface MemoryControlsProps {
  records: MemoryRecord[];
  onPin: (id: string, pinned: boolean) => void;
  onCorrect: (id: string, text: string) => void;
  onForget: (id: string) => void;
  onRestore: (id: string) => void;
  compact?: boolean;
}

export function MemoryControls({ records, onPin, onCorrect, onForget, onRestore, compact = false }: MemoryControlsProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const visible = compact ? records.filter((record) => record.status === "active").slice(0, 4) : records;
  if (!visible.length) return null;

  return (
    <section className={compact ? "border-b border-border px-4 py-3" : "space-y-2"}>
      <div className={compact ? "mx-auto max-w-3xl space-y-2" : "space-y-2"}>
        <p className="text-xs font-medium text-muted-foreground">Memory used in replies · pin, correct, or forget</p>
        {visible.map((record) => (
          <article key={record.id} className="rounded-lg border border-border bg-card p-2.5">
            {editing === record.id ? (
              <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); onCorrect(record.id, draft); setEditing(null); }}>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} className="min-h-16 w-full rounded-md border bg-background p-2 text-sm" aria-label={`Correct ${record.kind}`} />
                <div className="flex gap-2"><button type="submit" className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground">Save correction</button><button type="button" onClick={() => setEditing(null)} className="text-xs text-muted-foreground">Cancel</button></div>
              </form>
            ) : (
              <>
                <p className={`text-sm ${record.status === "forgotten" ? "text-muted-foreground line-through" : ""}`}>{record.text}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{record.kind} · {record.confidence} confidence · {record.conversationTitle}{record.pinned ? " · pinned" : ""}{record.source === "user" ? " · corrected" : ""}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {record.status === "active" ? <>
                    <button type="button" onClick={() => onPin(record.id, !record.pinned)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">{record.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}{record.pinned ? "Unpin" : "Pin"}</button>
                    <button type="button" onClick={() => { setEditing(record.id); setDraft(record.text); }} className="text-[11px] text-muted-foreground underline hover:text-foreground">Correct</button>
                    <button type="button" onClick={() => onForget(record.id)} className="text-[11px] text-muted-foreground underline hover:text-foreground">Forget</button>
                  </> : <button type="button" onClick={() => onRestore(record.id)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><RotateCcw className="size-3" />Restore</button>}
                </div>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

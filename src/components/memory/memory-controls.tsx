"use client";

import { Pin, PinOff, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useLocale } from "@/hooks/use-locale";
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
  const ar = useLocale().locale === "ar";
  const visible = compact ? records.filter((record) => record.status === "active").slice(0, 4) : records;
  if (!visible.length) return null;

  const kindLabel = (kind: MemoryRecord["kind"]) =>
    ar
      ? { fact: "حقيقة", decision: "قرار", preference: "تفضيل", project: "مشروع" }[kind]
      : kind;
  const confidenceLabel = (confidence: MemoryRecord["confidence"]) =>
    ar
      ? { high: "عالية", medium: "متوسطة", low: "منخفضة" }[confidence]
      : confidence;

  return (
    <section className={compact ? "border-b border-border px-4 py-3" : "space-y-2"}>
      <div className={compact ? "mx-auto max-w-3xl space-y-2" : "space-y-2"}>
        <p className="text-xs font-medium text-muted-foreground">
          {ar ? "الذاكرة المستخدمة في الردود · ثبّت أو صحّح أو انسَ" : "Memory used in replies · pin, correct, or forget"}
        </p>
        {visible.map((record) => (
          <article key={record.id} className="rounded-2xl border border-border/70 bg-card/80 p-3">
            {editing === record.id ? (
              <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); onCorrect(record.id, draft); setEditing(null); }}>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} className="min-h-16 w-full rounded-xl border border-border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={ar ? `تصحيح ${kindLabel(record.kind)}` : `Correct ${record.kind}`} />
                <div className="flex gap-2">
                  <button type="submit" className="rounded-xl bg-primary px-2.5 py-1.5 text-xs text-primary-foreground">{ar ? "حفظ التصحيح" : "Save correction"}</button>
                  <button type="button" onClick={() => setEditing(null)} className="text-xs text-muted-foreground">{ar ? "إلغاء" : "Cancel"}</button>
                </div>
              </form>
            ) : (
              <>
                <p className={`text-sm leading-6 ${record.status === "forgotten" ? "text-muted-foreground line-through" : ""}`}>{record.text}</p>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {kindLabel(record.kind)} · {ar ? `ثقة ${confidenceLabel(record.confidence)}` : `${confidenceLabel(record.confidence)} confidence`} · {record.conversationTitle}
                  {record.pinned ? (ar ? " · مثبتة" : " · pinned") : ""}
                  {record.source === "user" ? (ar ? " · مصححة" : " · corrected") : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {record.status === "active" ? <>
                    <button type="button" onClick={() => onPin(record.id, !record.pinned)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">{record.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}{record.pinned ? (ar ? "إلغاء التثبيت" : "Unpin") : (ar ? "تثبيت" : "Pin")}</button>
                    <button type="button" onClick={() => { setEditing(record.id); setDraft(record.text); }} className="text-[11px] text-muted-foreground underline hover:text-foreground">{ar ? "تصحيح" : "Correct"}</button>
                    <button type="button" onClick={() => onForget(record.id)} className="text-[11px] text-muted-foreground underline hover:text-foreground">{ar ? "نسيان" : "Forget"}</button>
                  </> : <button type="button" onClick={() => onRestore(record.id)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><RotateCcw className="size-3" />{ar ? "استعادة" : "Restore"}</button>}
                </div>
              </>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

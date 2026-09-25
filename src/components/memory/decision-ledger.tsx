"use client";

import { Pin, PinOff, Scale } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocale } from "@/hooks/use-locale";
import { buildDecisionLedger, noteToDecision } from "@/lib/memory/decision-ledger-view";
import { loadApiSettings } from "@/lib/settings/api-key-storage";
import { isCloudSyncEnabled } from "@/lib/storage/storage-preferences";
import type { MemoryRecord } from "@/types/memory";

interface DecisionLedgerProps {
  records: MemoryRecord[];
  onOpenConversation: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onCorrect: (id: string, text: string) => void;
  onAdd: (record: MemoryRecord) => void;
}

function formatDate(value: string, ar: boolean): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(ar ? "ar" : "en", { year: "numeric", month: "short", day: "numeric" });
}

export function DecisionLedger({ records, onOpenConversation, onPin, onCorrect, onAdd }: DecisionLedgerProps) {
  const ar = useLocale().locale === "ar";
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const cards = useMemo(() => buildDecisionLedger(records), [records]);
  const localModel = loadApiSettings().provider === "ollama";
  const cloudOn = isCloudSyncEnabled();

  function saveNote() {
    const record = noteToDecision(note);
    if (!record) return;
    onAdd(record);
    setNote("");
  }

  return (
    <section className="mt-6 rounded-3xl border border-border/70 bg-card/50 p-4" aria-labelledby="decision-ledger-title">
      <h2 id="decision-ledger-title" className="flex items-center gap-2 text-section-title">
        <Scale className="size-4" />{ar ? "دفتر القرارات" : "Decision ledger"}
      </h2>
      <p className="mt-1 text-caption">
        {ar
          ? "القرار الجديد يُحفظ بجانب القديم. القديم يبقى ظاهراً مع مصدره وتاريخه."
          : "A newer decision is kept beside the older one. The older one stays visible with its source and date."}
      </p>
      {localModel && (
        <p className="mt-3 rounded-2xl bg-muted px-3 py-2 text-xs text-muted-foreground">
          {cloudOn
            ? (ar ? "النموذج المحلي يعمل، لكن المزامنة السحابية ما زالت مفتوحة. أغلقها إذا كان يجب أن يبقى هذا الدفتر على الجهاز." : "The local model is on, but cloud sync is still enabled. Turn it off if this ledger must stay on this device.")
            : (ar ? "هذا الدفتر يبقى على هذا الجهاز. بحث الويب متوقف مع النموذج المحلي." : "This ledger stays on this device. Web search is off while the local model is selected.")}
        </p>
      )}
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); saveNote(); }}>
        <label className="sr-only" htmlFor="decision-note">{ar ? "قرار مكتوب" : "Written decision"}</label>
        <textarea id="decision-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={2} placeholder={ar ? "اكتب قراراً قصيراً ليبقى هنا بتاريخ اليوم" : "Write a short decision to keep here with today's date"} className="min-h-16 flex-1 rounded-2xl border border-border bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        <button type="submit" disabled={note.trim().length < 3} className="rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{ar ? "حفظ القرار" : "Save decision"}</button>
      </form>
      <DecisionCards cards={cards} ar={ar} editing={editing} draft={draft} setDraft={setDraft} setEditing={setEditing} onOpenConversation={onOpenConversation} onPin={onPin} onCorrect={onCorrect} />
    </section>
  );
}

function DecisionCards({ cards, ar, editing, draft, setDraft, setEditing, onOpenConversation, onPin, onCorrect }: {
  cards: ReturnType<typeof buildDecisionLedger>;
  ar: boolean;
  editing: string | null;
  draft: string;
  setDraft: (value: string) => void;
  setEditing: (value: string | null) => void;
  onOpenConversation: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onCorrect: (id: string, text: string) => void;
}) {
  if (!cards.length) {
    return <p className="mt-4 text-sm text-muted-foreground">{ar ? "لا توجد قرارات بعد. ستظهر هنا عند استخراجها أو عند كتابتها." : "No decisions yet. They appear here when extracted or when you write one."}</p>;
  }
  return (
    <div className="mt-4 space-y-3">
      {cards.map(({ current, history }) => (
        <article key={current.id} className="rounded-2xl border border-border/70 bg-card/80 p-3">
          {editing === current.id ? (
            <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); onCorrect(current.id, draft); setEditing(null); }}>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={500} className="min-h-16 w-full rounded-xl border border-border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={ar ? "تصحيح القرار" : "Correct decision"} />
              <div className="flex gap-2">
                <button type="submit" className="rounded-xl bg-primary px-2.5 py-1.5 text-xs text-primary-foreground">{ar ? "حفظ التصحيح" : "Save correction"}</button>
                <button type="button" onClick={() => setEditing(null)} className="text-xs text-muted-foreground">{ar ? "إلغاء" : "Cancel"}</button>
              </div>
            </form>
          ) : (
            <DecisionBody current={current} ar={ar} onPin={onPin} onEdit={() => { setEditing(current.id); setDraft(current.text); }} onOpenConversation={onOpenConversation} />
          )}
          <DecisionHistory history={history} ar={ar} />
        </article>
      ))}
    </div>
  );
}

function DecisionBody({ current, ar, onPin, onEdit, onOpenConversation }: {
  current: MemoryRecord;
  ar: boolean;
  onPin: (id: string, pinned: boolean) => void;
  onEdit: () => void;
  onOpenConversation: (id: string) => void;
}) {
  return (
    <>
      <p className="text-sm leading-6">{current.text}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{current.conversationTitle} · {formatDate(current.updatedAt, ar)}{current.pinned ? (ar ? " · مثبت" : " · pinned") : ""}{current.confidence === "low" ? (ar ? " · غير مؤكد" : " · uncertain") : ""}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => onPin(current.id, !current.pinned)} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">{current.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}{current.pinned ? (ar ? "إلغاء التثبيت" : "Unpin") : (ar ? "تثبيت" : "Pin")}</button>
        <button type="button" onClick={onEdit} className="text-[11px] text-muted-foreground underline hover:text-foreground">{ar ? "تصحيح" : "Correct"}</button>
        {current.conversationId !== "ledger-note" && <button type="button" onClick={() => onOpenConversation(current.conversationId)} className="text-[11px] text-muted-foreground underline hover:text-foreground">{ar ? "فتح المصدر" : "Open source"}</button>}
      </div>
    </>
  );
}

function DecisionHistory({ history, ar }: { history: MemoryRecord[]; ar: boolean }) {
  if (!history.length) return null;
  return (
    <div className="mt-3 border-t border-border/70 pt-2">
      <p className="text-[11px] font-medium text-muted-foreground">{ar ? "قرارات سابقة بقيت محفوظة" : "Earlier decisions kept"}</p>
      {history.map((record) => (
        <p key={record.id} className="mt-1 text-xs text-muted-foreground"><span className="line-through">{record.text}</span> · {record.conversationTitle} · {formatDate(record.updatedAt, ar)} · {ar ? "مستبدل" : "superseded"}</p>
      ))}
    </div>
  );
}




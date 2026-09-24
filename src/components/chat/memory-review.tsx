"use client";

import { Button } from "@/components/ui/button";
import type { MemoryRecord, RetrievedMemory } from "@/types/memory";

export interface MemoryReviewItem {
  id: string;
  label: string;
  detail: string;
}

interface MemoryReviewProps {
  items: MemoryReviewItem[];
  onConfirm: (excludedIds: string[]) => void;
  onCancel: () => void;
}

export function memoryReviewItems(memories: RetrievedMemory[], records: MemoryRecord[], projectSummary: string): MemoryReviewItem[] {
  return [
    ...memories.map((memory) => ({ id: `memory:${memory.conversationId}:${memory.messageId ?? memory.recordId ?? memory.source}`, label: memory.conversationTitle, detail: memory.excerpt })),
    ...records.filter((record) => record.status === "active").map((record) => ({ id: `record:${record.id}`, label: record.conversationTitle, detail: record.text })),
    ...(projectSummary ? [{ id: "project:summary", label: "Project summary", detail: projectSummary }] : []),
  ];
}

export function MemoryReview({ items, onConfirm, onCancel }: MemoryReviewProps) {
  return <form className="mx-auto mb-3 max-w-3xl rounded-xl border bg-card p-4" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onConfirm(items.filter((item) => form.get(item.id) !== "on").map((item) => item.id));
  }}>
    <h2 className="font-semibold">What will I use?</h2>
    <p className="mt-1 text-sm text-muted-foreground">Uncheck anything that should stay out of this message only. Nothing is deleted.</p>
    <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{items.map((item) => <label key={item.id} className="flex gap-2 rounded-lg border p-2 text-sm"><input name={item.id} type="checkbox" defaultChecked /><span><span className="font-medium">{item.label}</span><span className="mt-1 line-clamp-2 block text-muted-foreground">{item.detail}</span></span></label>)}</div>
    <div className="mt-3 flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="submit">Send with selected context</Button></div>
  </form>;
}

"use client";

import { ArrowLeft, Brain, CheckCircle2, ChevronRight, MessageSquare, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SearchField } from "@/components/ui/search-field";
import { StatusPill } from "@/components/ui/status-pill";
import { SurfaceCard } from "@/components/ui/surface-card";
import { useLocale } from "@/hooks/use-locale";
import { formatConversationTime } from "@/lib/format/date";
import { buildMemoryIndex, searchMemoryIndex, type MemorySearchResult } from "@/lib/search/memory-index";
import { generateMemoryInsights } from "@/lib/memory/insights";
import type { Conversation } from "@/types/chat";
import type { MemoryRecord } from "@/types/memory";
import { MemoryControls } from "@/components/memory/memory-controls";
import { DecisionLedger } from "@/components/memory/decision-ledger";

type MemoryExperienceProps = {
  conversations: Conversation[];
  records?: MemoryRecord[];
  onOpenConversation: (id: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
  onCorrect?: (id: string, text: string) => void;
  onForget?: (id: string) => void;
  onRestore?: (id: string) => void;
  onAddDecision?: (record: MemoryRecord) => void;
  initialConversationId?: string | null;
};

function ChipList({ values }: { values: string[] }) {
  const uniqueValues = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!uniqueValues.length) return null;
  return (
    <div className="flex flex-nowrap gap-1.5 overflow-hidden">
      {uniqueValues.slice(0, 6).map((value, index) => (
        <span key={`${value}-${index}`} className="max-w-28 truncate rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
          {value}
        </span>
      ))}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 p-4">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function StructuredMemory({ conversation, ar }: { conversation: Conversation; ar: boolean }) {
  const metadata = conversation.metadata;
  const facts = metadata?.facts ?? [];
  const decisions = metadata?.decisions ?? [];
  const project = metadata?.project;
  if (!facts.length && !decisions.length && !project) return null;
  return <div className="mt-5 grid gap-3 sm:grid-cols-2">
    {project && <SurfaceCard className="rounded-2xl border-border/70 bg-card/80" title={ar ? "المشروع" : "Project"} description={project.goal || (ar ? "سياق المشروع المستخرج من هذه المحادثة." : "Project context extracted from this conversation.")}><p className="font-medium">{project.name}</p>{project.tasks?.length ? <ul className="mt-3 list-disc space-y-1 ps-5 text-sm text-muted-foreground">{project.tasks.map((task) => <li key={task}>{task}</li>)}</ul> : null}</SurfaceCard>}
    {facts.length > 0 && <SurfaceCard className="rounded-2xl border-border/70 bg-card/80" title={ar ? "الحقائق" : "Facts"}><ul className="space-y-2 text-sm">{facts.map((fact) => <li key={`${fact.category}-${fact.value}`} className="flex gap-2"><span className="mt-1 size-2 shrink-0 rounded-full bg-primary" /><span><span className="font-medium">{fact.category}: </span>{fact.value}</span></li>)}</ul></SurfaceCard>}
    {decisions.length > 0 && <SurfaceCard className="rounded-2xl border-border/70 bg-card/80" title={ar ? "القرارات" : "Decisions"}><ul className="space-y-3 text-sm">{decisions.map((decision) => <li key={decision.decision}><div className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /><span className="font-medium">{decision.decision}</span></div>{decision.reason && <p className="mt-1 ps-6 text-muted-foreground">{decision.reason}</p>}<StatusPill status={decision.status === "active" ? "success" : "neutral"} label={decision.status === "active" ? (ar ? "نشط" : "Active") : (ar ? "مؤرشف" : "Archived")} /></li>)}</ul></SurfaceCard>}
  </div>;
}

function MemoryCard({ conversation, excerpt, ar, onOpen }: { conversation: Conversation; excerpt?: string; ar: boolean; onOpen: () => void }) {
  const metadata = conversation.metadata;
  return <button type="button" onClick={onOpen} className="w-full rounded-2xl border border-border/70 bg-card/80 p-4 text-start transition-colors hover:border-primary/40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{conversation.title}</h2></div><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" /></div>
    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground"><MessageSquare className="size-3 shrink-0" aria-hidden="true" /><span className="truncate">{ar ? "محادثة محفوظة" : "Saved conversation"}</span><span aria-hidden="true">·</span><span className="shrink-0">{formatConversationTime(conversation.updatedAt, ar ? "ar" : "en")}</span></p>
    <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">{excerpt || metadata?.summary || conversation.messages.find((message) => !message.isStreaming)?.content || (ar ? "سياق محادثة محفوظ" : "Saved conversation context")}</p>
    <div className="mt-3"><ChipList values={[...(metadata?.topics ?? []), ...(metadata?.tags ?? [])]} /></div>
  </button>;
}

export function MemoryExperience({ conversations, records = [], onOpenConversation, onPin, onCorrect, onForget, onRestore, onAddDecision, initialConversationId }: MemoryExperienceProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId ?? null);
  const ar = useLocale().locale === "ar";
  const index = useMemo(() => buildMemoryIndex(conversations), [conversations]);
  const insights = useMemo(() => generateMemoryInsights(conversations), [conversations]);
  const results = useMemo(() => searchMemoryIndex(index, query), [index, query]);
  const selected = selectedId ? conversations.find((conversation) => conversation.id === selectedId) : undefined;

  if (selected) return (
    <main className="h-full overflow-y-auto bg-background px-4 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 md:px-8">
      <div className="mx-auto max-w-5xl">
        <button type="button" onClick={() => setSelectedId(null)} className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4 rtl:rotate-180" />{ar ? "العودة إلى الذاكرة" : "Back to Memory"}</button>
        <PageHeader className="rounded-3xl border border-border/70 bg-card/80 px-5 py-5" eyebrow={ar ? "تفاصيل الذاكرة" : "Memory detail"} title={selected.title} description={ar ? "سياق محفوظ من محادثة محلية." : "Remembered context from a saved conversation."} actions={<StatusPill status={selected.permanentMemory ? "protected" : "neutral"} label={selected.permanentMemory ? (ar ? "محددة للنسخ" : "Backup selected") : (ar ? "محلية فقط" : "Local only")} />} />
        <StructuredMemory conversation={selected} ar={ar} />
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_18rem]">
          <SurfaceCard className="rounded-2xl border-border/70 bg-card/80" title={ar ? "المحتوى المحفوظ" : "Remembered content"} description={selected.metadata ? (ar ? "ملخص المحادثة والسياق المتاح" : "Conversation summary and available context") : (ar ? "محتوى المحادثة المتاح" : "Available conversation content")}>
            <div className="space-y-3 text-sm leading-7">{selected.metadata?.summary && <p>{selected.metadata.summary}</p>}{selected.messages.filter((message) => !message.isStreaming && message.content.trim()).map((message) => <div key={message.id} className="rounded-2xl bg-background/60 p-3"><p className="mb-1 text-xs font-medium text-muted-foreground">{message.role === "user" ? (ar ? "أنت" : "You") : "PermaMind"}</p><p className="whitespace-pre-wrap">{message.content}</p></div>)}</div>
          </SurfaceCard>
          <SurfaceCard className="rounded-2xl border-border/70 bg-card/80" title={ar ? "المصدر" : "Provenance"}>
            <dl className="space-y-3 text-sm"><div><dt className="text-xs text-muted-foreground">{ar ? "المصدر" : "Source"}</dt><dd>{ar ? "محادثة محفوظة محليًا" : "Saved conversation"}</dd></div><div><dt className="text-xs text-muted-foreground">{ar ? "آخر تحديث" : "Updated"}</dt><dd>{formatConversationTime(selected.updatedAt, ar ? "ar" : "en")}</dd></div></dl>
            <div className="mt-5"><button type="button" onClick={() => onOpenConversation(selected.id)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90">{ar ? "فتح المحادثة" : "View conversation"} <ChevronRight className="size-4 rtl:rotate-180" /></button></div>
          </SurfaceCard>
        </div>
      </div>
    </main>
  );

  const cards: Array<{ conversation: Conversation; excerpt?: string }> = query
    ? results
        .map((result: MemorySearchResult) => ({
          conversation: conversations.find((item) => item.id === result.conversationId),
          excerpt: result.snippet,
        }))
        .filter(
          (item): item is { conversation: Conversation; excerpt: string } =>
            Boolean(item.conversation)
        )
    : conversations.slice(0, 12).map((conversation) => ({ conversation }));
  const structuredCount = conversations.reduce((total, conversation) => total + (conversation.metadata?.facts?.length ?? 0) + (conversation.metadata?.decisions?.length ?? 0) + (conversation.metadata?.project ? 1 : 0), 0);
  const canReview = Boolean(onPin && onCorrect && onForget && onRestore);

  return (
    <main className="h-full overflow-y-auto bg-background px-4 py-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 md:px-8">
      <div className="mx-auto max-w-6xl">
        <PageHeader className="rounded-3xl border border-border/70 bg-card/80 px-5 py-5" eyebrow={ar ? "ذاكرتك" : "Your memory"} title={ar ? "الذاكرة" : "Memory"} description={ar ? "استكشف المحادثات والحقائق والقرارات والمشاريع التي يستطيع PermaMind تذكّرها." : "Explore conversations, facts, decisions, and projects PermaMind can recall."} />
        <div className="mt-5 max-w-2xl">
          <SearchField value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} placeholder={ar ? "ابحث في المحادثات أو المواضيع أو الوسوم أو الكيانات" : "Search remembered conversations, topics, tags, or entities"} resultCount={query ? cards.length : undefined} aria-label={ar ? "البحث في الذاكرة" : "Search memory"} />
        </div>
        {canReview && onAddDecision && <DecisionLedger records={records} onOpenConversation={onOpenConversation} onPin={onPin!} onCorrect={onCorrect!} onAdd={onAddDecision} />}
        {canReview && <div className="mt-5 rounded-3xl border border-border/70 bg-card/50 p-4"><MemoryControls records={records} onPin={onPin!} onCorrect={onCorrect!} onForget={onForget!} onRestore={onRestore!} /></div>}
        {!conversations.length ? (
          <div className="mt-6"><EmptyState className="rounded-3xl border-border/70 bg-card/40" icon={Brain} title={ar ? "ذاكرتك جاهزة للنمو" : "Your memory is ready to grow"} description={ar ? "عند حفظ المحادثات، سيجعل PermaMind سياقها المفيد أسهل للمراجعة هنا." : "As you save conversations, PermaMind will make their useful context easier to revisit here."} /></div>
        ) : (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label={ar ? "المحادثات" : "Conversations"} value={insights.conversationStats.conversations} hint={ar ? "مصادر محفوظة" : "saved sources"} />
              <StatCard label={ar ? "المواضيع" : "Topics"} value={insights.topics.length} hint={ar ? "مواضيع متاحة" : "available topics"} />
              <StatCard label={ar ? "الكيانات" : "Entities"} value={insights.entities.length} hint={ar ? "كيانات معروفة" : "recognized entities"} />
              <StatCard label={ar ? "الذاكرة المنظمة" : "Structured memory"} value={structuredCount} hint={ar ? "حقائق وقرارات ومشاريع" : "facts, decisions, projects"} />
            </div>
            <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_18rem]">
              <section>
                <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-section-title">{query ? (ar ? "نتائج البحث" : "Search results") : (ar ? "أحدث الذكريات" : "Recent memories")}</h2>{query && <StatusPill status="neutral" label={ar ? `${cards.length} نتيجة` : `${cards.length} found`} />}</div>
                {!cards.length ? (
                  <EmptyState className="rounded-3xl border-border/70 bg-card/40" icon={Search} title={ar ? "لم يتم العثور على ذكريات" : "No memories found"} description={ar ? "جرّب كلمة أخرى أو ابحث في عنوان محادثة أو موضوع أو وسم أو كيان." : "Try a different word or search a saved conversation title, topic, tag, or entity."} action={<button type="button" onClick={() => setQuery("")} className="rounded-2xl border border-border px-3 py-2 text-sm hover:bg-accent">{ar ? "مسح البحث" : "Clear search"}</button>} />
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">{cards.map(({ conversation, excerpt }) => <MemoryCard key={conversation.id} conversation={conversation} excerpt={excerpt} ar={ar} onOpen={() => setSelectedId(conversation.id)} />)}</div>
                )}
              </section>
              <aside className="space-y-3">
                <SurfaceCard className="rounded-2xl border-border/70 bg-card/80" title={ar ? "أبرز المواضيع" : "Top topics"}><ChipList values={insights.topics.map((item) => item.name)} /></SurfaceCard>
                <SurfaceCard className="rounded-2xl border-border/70 bg-card/80" title={ar ? "أبرز الكيانات" : "Top entities"}><ChipList values={insights.entities.map((item) => item.name)} /></SurfaceCard>
              </aside>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

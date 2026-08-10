"use client";

import { ArrowLeft, Brain, CheckCircle2, ChevronRight, MessageSquare, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SearchField } from "@/components/ui/search-field";
import { StatusPill } from "@/components/ui/status-pill";
import { SurfaceCard } from "@/components/ui/surface-card";
import { formatConversationTime } from "@/lib/format/date";
import { buildMemoryIndex, searchMemoryIndex, type MemorySearchResult } from "@/lib/search/memory-index";
import { generateMemoryInsights } from "@/lib/memory/insights";
import type { Conversation } from "@/types/chat";

type MemoryExperienceProps = { conversations: Conversation[]; onOpenConversation: (id: string) => void; initialConversationId?: string | null };

function ChipList({ values }: { values: string[] }) {
  const uniqueValues = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!uniqueValues.length) return null;
  return <div className="flex flex-wrap gap-1.5">{uniqueValues.map((value, index) => <span key={`${value}-${index}`} className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{value}</span>)}</div>;
}

function StructuredMemory({ conversation }: { conversation: Conversation }) {
  const metadata = conversation.metadata;
  const facts = metadata?.facts ?? [];
  const decisions = metadata?.decisions ?? [];
  const project = metadata?.project;
  if (!facts.length && !decisions.length && !project) return null;
  return <div className="mt-4 grid gap-3 sm:grid-cols-2">
    {project && <SurfaceCard title="Project" description={project.goal || "Project context extracted from this conversation."}><p className="font-medium">{project.name}</p>{project.tasks?.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{project.tasks.map((task) => <li key={task}>{task}</li>)}</ul> : null}</SurfaceCard>}
    {facts.length > 0 && <SurfaceCard title="Facts"><ul className="space-y-2 text-sm">{facts.map((fact) => <li key={`${fact.category}-${fact.value}`} className="flex gap-2"><span className="mt-1 size-2 shrink-0 rounded-full bg-primary" /><span><span className="font-medium">{fact.category}: </span>{fact.value}</span></li>)}</ul></SurfaceCard>}
    {decisions.length > 0 && <SurfaceCard title="Decisions"><ul className="space-y-3 text-sm">{decisions.map((decision) => <li key={decision.decision}><div className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /><span className="font-medium">{decision.decision}</span></div>{decision.reason && <p className="mt-1 pl-6 text-muted-foreground">{decision.reason}</p>}<StatusPill status={decision.status === "active" ? "success" : "neutral"} label={decision.status} /></li>)}</ul></SurfaceCard>}
  </div>;
}

function MemoryCard({ conversation, excerpt, onOpen }: { conversation: Conversation; excerpt?: string; onOpen: () => void }) {
  const metadata = conversation.metadata;
  return <button type="button" onClick={onOpen} className="surface-card w-full p-5 text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate font-semibold">{conversation.title}</h2><p className="mt-1 text-xs text-muted-foreground">Updated {formatConversationTime(conversation.updatedAt)}</p></div><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /></div>
    <p className="mt-4 line-clamp-3 text-sm text-muted-foreground">{excerpt || metadata?.summary || conversation.messages.find((message) => !message.isStreaming)?.content || "Saved conversation context"}</p>
    <div className="mt-4 space-y-2"><ChipList values={[...(metadata?.topics ?? []), ...(metadata?.tags ?? [])]} /><div className="flex items-center gap-2 text-xs text-muted-foreground"><MessageSquare className="size-3.5" aria-hidden="true" />Source conversation</div></div>
  </button>;
}

export function MemoryExperience({ conversations, onOpenConversation, initialConversationId }: MemoryExperienceProps) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId ?? null);
  const index = useMemo(() => buildMemoryIndex(conversations), [conversations]);
  const insights = useMemo(() => generateMemoryInsights(conversations), [conversations]);
  const results = useMemo(() => searchMemoryIndex(index, query), [index, query]);
  const selected = selectedId ? conversations.find((conversation) => conversation.id === selectedId) : undefined;

  if (selected) return (
    <main className="mx-auto h-full max-w-5xl overflow-y-auto p-4 pt-14 pb-8 sm:p-6 sm:pt-8 md:p-10">
      <button type="button" onClick={() => setSelectedId(null)} className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Back to Memory</button>
      <PageHeader eyebrow="Memory detail" title={selected.title} description="Remembered context from a saved conversation." actions={<StatusPill status={selected.permanentMemory ? "protected" : "neutral"} label={selected.permanentMemory ? "Protected" : "Saved locally"} />} />
      <StructuredMemory conversation={selected} />
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_18rem]">
        <SurfaceCard title="Remembered content" description={selected.metadata ? "Conversation summary and available context" : "Available conversation content"}>
          <div className="space-y-4 text-sm leading-7">{selected.metadata?.summary && <p>{selected.metadata.summary}</p>}{selected.messages.filter((message) => !message.isStreaming && message.content.trim()).map((message) => <div key={message.id} className="rounded-lg bg-muted/40 p-3"><p className="mb-1 text-xs font-medium text-muted-foreground">{message.role === "user" ? "You" : "PermaMind"}</p><p className="whitespace-pre-wrap">{message.content}</p></div>)}</div>
        </SurfaceCard>
        <SurfaceCard title="Provenance"><dl className="space-y-3 text-sm"><div><dt className="text-xs text-muted-foreground">Source</dt><dd>Saved conversation</dd></div><div><dt className="text-xs text-muted-foreground">Updated</dt><dd>{formatConversationTime(selected.updatedAt)}</dd></div></dl><div className="mt-5"><button type="button" onClick={() => onOpenConversation(selected.id)} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary/90">View conversation <ChevronRight className="size-4" /></button></div></SurfaceCard>
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
  return <main className="mx-auto h-full max-w-6xl overflow-y-auto p-5 md:p-10"><PageHeader eyebrow="Your memory" title="Memory" description="Explore conversations, facts, decisions, and projects PermaMind can recall." /><div className="mt-6 max-w-2xl"><SearchField value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} placeholder="Search remembered conversations, topics, tags, or entities" resultCount={query ? cards.length : undefined} /></div>{!conversations.length ? <div className="mt-8"><EmptyState icon={Brain} title="Your memory is ready to grow" description="As you save conversations, PermaMind will make their useful context easier to revisit here." /></div> : <><div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><SurfaceCard title="Conversations"><p className="text-2xl font-semibold">{insights.conversationStats.conversations}</p><p className="text-xs text-muted-foreground">saved sources</p></SurfaceCard><SurfaceCard title="Topics"><p className="text-2xl font-semibold">{insights.topics.length}</p><p className="text-xs text-muted-foreground">available topics</p></SurfaceCard><SurfaceCard title="Entities"><p className="text-2xl font-semibold">{insights.entities.length}</p><p className="text-xs text-muted-foreground">recognized entities</p></SurfaceCard><SurfaceCard title="Structured memory"><p className="text-2xl font-semibold">{structuredCount}</p><p className="text-xs text-muted-foreground">facts, decisions, projects</p></SurfaceCard></div><div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]"><section><div className="mb-3 flex items-center justify-between"><h2 className="text-section-title">{query ? "Search results" : "Recent memories"}</h2>{query && <StatusPill status="neutral" label={`${cards.length} found`} />}</div>{!cards.length ? <EmptyState icon={Search} title="No memories found" description="Try a different word or search a saved conversation title, topic, tag, or entity." action={<button type="button" onClick={() => setQuery("")} className="rounded-md border px-3 py-2 text-sm">Clear search</button>} /> : <div className="grid gap-4 md:grid-cols-2">{cards.map(({ conversation, excerpt }) => <MemoryCard key={conversation.id} conversation={conversation} excerpt={excerpt} onOpen={() => setSelectedId(conversation.id)} />)}</div>}</section><aside className="space-y-4"><SurfaceCard title="Top topics"><ChipList values={insights.topics.map((item) => item.name)} /></SurfaceCard><SurfaceCard title="Top entities"><ChipList values={insights.entities.map((item) => item.name)} /></SurfaceCard></aside></div></>}</main>;
  return <main className="mx-auto h-full max-w-6xl overflow-y-auto p-5 md:p-10"><PageHeader eyebrow="Your memory" title="Memory" description="Explore context PermaMind can recall from your saved conversations." /><div className="mt-6 max-w-2xl"><SearchField value={query} onChange={(event) => setQuery(event.target.value)} onClear={() => setQuery("")} placeholder="Search remembered conversations, topics, tags, or entities" resultCount={query ? cards.length : undefined} /></div>{!conversations.length ? <div className="mt-8"><EmptyState icon={Brain} title="Your memory is ready to grow" description="As you save conversations, PermaMind will make their useful context easier to revisit here." /></div> : <><div className="mt-8 grid gap-4 sm:grid-cols-3"><SurfaceCard title="Conversations"><p className="text-2xl font-semibold">{insights.conversationStats.conversations}</p><p className="text-xs text-muted-foreground">saved sources</p></SurfaceCard><SurfaceCard title="Topics"><p className="text-2xl font-semibold">{insights.topics.length}</p><p className="text-xs text-muted-foreground">available topics</p></SurfaceCard><SurfaceCard title="Entities"><p className="text-2xl font-semibold">{insights.entities.length}</p><p className="text-xs text-muted-foreground">recognized entities</p></SurfaceCard></div><div className="mt-6 grid gap-6 lg:grid-cols-[1fr_18rem]"><section><div className="mb-3 flex items-center justify-between"><h2 className="text-section-title">{query ? "Search results" : "Recent memories"}</h2>{query && <StatusPill status="neutral" label={`${cards.length} found`} />}</div>{!cards.length ? <EmptyState icon={Search} title="No memories found" description="Try a different word or search a saved conversation title, topic, tag, or entity." action={<button type="button" onClick={() => setQuery("")} className="rounded-md border px-3 py-2 text-sm">Clear search</button>} /> : <div className="grid gap-4 md:grid-cols-2">{cards.map(({ conversation, excerpt }) => <MemoryCard key={conversation.id} conversation={conversation} excerpt={excerpt} onOpen={() => setSelectedId(conversation.id)} />)}</div>}</section><SurfaceCard title="What you talk about" description="Available from conversation metadata"><div className="space-y-4"><div><p className="mb-2 text-xs font-medium text-muted-foreground">Topics</p><ChipList values={insights.topics.slice(0, 12).map((item) => item.name)} /></div><div><p className="mb-2 text-xs font-medium text-muted-foreground">Tags</p><ChipList values={insights.tags.slice(0, 12).map((item) => item.name)} /></div><div><p className="mb-2 text-xs font-medium text-muted-foreground">Entities</p><ChipList values={insights.entities.slice(0, 12).map((item) => item.name)} /></div></div></SurfaceCard></div></>}</main>;
}
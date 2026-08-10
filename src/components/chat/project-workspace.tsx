"use client";

import { FolderKanban, MessageSquare, Plus, Target, CheckSquare, Scale, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Conversation, Project } from "@/types/chat";

export function ProjectWorkspace({ project, conversations, onOpenConversation }: { project: Project; conversations: Conversation[]; onOpenConversation: (id: string) => void }) {
  const sections = [
    ["Goals", project.goals, Target], ["Tasks", project.tasks, CheckSquare], ["Decisions", project.decisions, Scale], ["Open questions", project.openQuestions, HelpCircle],
  ] as const;
  return <section className="min-h-0 flex-1 overflow-y-auto p-6 lg:p-10">
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><FolderKanban className="size-4 text-primary" /> Project workspace</div><h1 className="text-3xl font-semibold tracking-tight">{project.name}</h1><p className="mt-2 max-w-2xl text-muted-foreground">{project.description || "A persistent workspace for your long-term context."}</p></div><Button variant="outline"><Plus className="mr-2 size-4" /> Add to project</Button></header>
      <div className="rounded-xl border bg-card p-5"><h2 className="font-semibold">Current status</h2><p className="mt-2 leading-7 text-muted-foreground">{project.summary || "Your project summary will grow as you chat, record decisions, and complete tasks."}</p></div>
      <div className="grid gap-4 md:grid-cols-2">{sections.map(([title, items, Icon]) => <div key={title} className="rounded-xl border bg-card p-5"><h2 className="flex items-center gap-2 font-semibold"><Icon className="size-4 text-primary" />{title}</h2>{items.length ? <ul className="mt-4 space-y-2 text-sm text-muted-foreground">{items.map((item) => <li key={item} className="rounded-md bg-muted/50 px-3 py-2">{item}</li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">Nothing added yet.</p>}</div>)}</div>
      <div className="rounded-xl border bg-card p-5"><h2 className="flex items-center gap-2 font-semibold"><MessageSquare className="size-4 text-primary" /> Conversations</h2><div className="mt-4 grid gap-2 sm:grid-cols-2">{conversations.length ? conversations.map((conversation) => <button key={conversation.id} onClick={() => onOpenConversation(conversation.id)} className="rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted"><span className="font-medium">{conversation.title}</span><span className="mt-1 block text-xs text-muted-foreground">{conversation.messages.length} messages</span></button>) : <p className="text-sm text-muted-foreground">Start a conversation to build this project&apos;s context.</p>}</div></div>
    </div>
  </section>;
}
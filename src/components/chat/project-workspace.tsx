"use client";

import { FolderKanban, MessageSquare, Plus, Target, CheckSquare, Scale, HelpCircle, Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { buildWeeklyPlan, exportProjectMarkdown } from "@/lib/projects/context";
import { downloadBlob } from "@/lib/storage/download";
import type { Conversation, Project } from "@/types/chat";

export function ProjectWorkspace({ project, conversations, unlinkedConversations, onOpenConversation, onLinkConversation, onAddTask }: { project: Project; conversations: Conversation[]; unlinkedConversations: Conversation[]; onOpenConversation: (id: string) => void; onLinkConversation: (conversationId: string) => void; onAddTask: (task: string) => void }) {
  const [conversationId, setConversationId] = useState("");
  const [task, setTask] = useState("");
  const [weeklyPlan, setWeeklyPlan] = useState("");
  const sections = [
    ["Goals", project.goals, Target], ["Tasks", project.tasks, CheckSquare], ["Decisions", project.decisions, Scale], ["Open questions", project.openQuestions, HelpCircle],
  ] as const;
  const exportMarkdown = () => {
    downloadBlob(
      new Blob([exportProjectMarkdown(project, conversations)], { type: "text/markdown;charset=utf-8" }),
      `${project.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "project"}.md`,
    );
  };
  return <section className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-10">
    <div className="mx-auto max-w-5xl space-y-6 sm:space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><FolderKanban className="size-4 shrink-0 text-primary" /> Project workspace</div><h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{project.name}</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">{project.description || "A persistent workspace for your long-term context."}</p></div><div className="flex w-full gap-2 sm:w-auto"><Button variant="outline" className="flex-1 sm:flex-none" onClick={exportMarkdown}><Download className="mr-2 size-4" /> Export Markdown</Button><Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setWeeklyPlan(buildWeeklyPlan(project.tasks))}>Weekly plan</Button></div></header>
      {/* `w-full` + `min-w-0` on the inputs: `min-w-48` alone (192px) plus the
          select plus the button overflowed a 360px screen even while wrapping. */}
      <form className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" onSubmit={(event) => { event.preventDefault(); if (conversationId) { onLinkConversation(conversationId); setConversationId(""); } if (task.trim()) { onAddTask(task); setTask(""); } }}>
        <select value={conversationId} onChange={(event) => setConversationId(event.target.value)} aria-label="Link an existing conversation" className="h-9 w-full min-w-0 rounded-lg border bg-background px-2 text-sm sm:w-auto"><option value="">Link existing conversation</option>{unlinkedConversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}</select>
        <input value={task} onChange={(event) => setTask(event.target.value)} placeholder="Add a task" aria-label="Add a task" className="h-9 w-full min-w-0 rounded-lg border bg-background px-2 text-base sm:w-auto sm:min-w-48 sm:text-sm" />
        <Button type="submit" variant="outline" className="h-9 justify-center"><Plus className="mr-2 size-4" /> Add to project</Button>
      </form>
      <div className="rounded-xl border bg-card p-4 sm:p-5"><h2 className="font-semibold">Current status</h2><p className="mt-2 leading-7 text-muted-foreground">{project.summary || "Your project summary will grow as you chat, record decisions, and complete tasks."}</p></div>
      {weeklyPlan && <div className="rounded-xl border bg-card p-4 sm:p-5"><h2 className="font-semibold">Weekly plan</h2><pre className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{weeklyPlan}</pre></div>}
      <div className="grid gap-4 sm:gap-4 md:grid-cols-2">{sections.map(([title, items, Icon]) => <div key={title} className="rounded-xl border bg-card p-4 sm:p-5"><h2 className="flex items-center gap-2 font-semibold"><Icon className="size-4 shrink-0 text-primary" />{title}</h2>{items.length ? <ul className="mt-4 space-y-2 text-sm text-muted-foreground">{items.map((item) => <li key={item} className="break-words rounded-md bg-muted/50 px-3 py-2">{item}</li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">Nothing added yet.</p>}</div>)}</div>
      <div className="rounded-xl border bg-card p-4 sm:p-5"><h2 className="flex items-center gap-2 font-semibold"><MessageSquare className="size-4 shrink-0 text-primary" /> Conversations</h2><div className="mt-4 grid gap-2 sm:grid-cols-2">{conversations.length ? conversations.map((conversation) => <button key={conversation.id} onClick={() => onOpenConversation(conversation.id)} className="min-w-0 rounded-lg border p-3 text-start text-sm transition-colors hover:bg-muted"><span className="block break-words font-medium">{conversation.title}</span><span className="mt-1 block text-xs text-muted-foreground">{conversation.messages.length} messages</span></button>) : <p className="text-sm text-muted-foreground">Start a conversation to build this project&apos;s context.</p>}</div></div>
    </div>
  </section>;
}
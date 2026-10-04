"use client";

import { FolderKanban, MessageSquare, Plus, Target, CheckSquare, Scale, HelpCircle, Download, CalendarRange, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { buildWeeklyPlan, exportProjectMarkdown } from "@/lib/projects/context";
import { downloadBlob } from "@/lib/storage/download";
import type { Conversation, Project } from "@/types/chat";
import { useLocale } from "@/hooks/use-locale";

/**
 * ## Every string here goes through `useLocale`
 *
 * This file was the one page in the app with no `useLocale` call at all, which is why an Arabic
 * user landed on an English "New project" heading with English buttons underneath. The translation
 * is held in one `t` map rather than inlined ternaries at each use site: a page this size would
 * otherwise carry sixty `ar ? … : …` pairs, and a missing one is invisible until someone reads
 * the page in the other language.
 */
export function ProjectWorkspace({ project, conversations, unlinkedConversations, onOpenConversation, onLinkConversation, onAddTask, onRename, onDelete }: { project: Project; conversations: Conversation[]; unlinkedConversations: Conversation[]; onOpenConversation: (id: string) => void; onLinkConversation: (conversationId: string) => void; onAddTask: (task: string) => void; onRename?: (name: string) => void; onDelete?: () => void }) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [conversationId, setConversationId] = useState("");
  const [task, setTask] = useState("");
  const [weeklyPlan, setWeeklyPlan] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  const t = {
    workspace: ar ? "مساحة المشروع" : "Project workspace",
    export: ar ? "تصدير Markdown" : "Export Markdown",
    weekly: ar ? "خطة الأسبوع" : "Weekly plan",
    link: ar ? "اربط محادثة" : "Link existing conversation",
    addTask: ar ? "أضف مهمة" : "Add a task",
    addTo: ar ? "أضف إلى المشروع" : "Add to project",
    currentStatus: ar ? "الحالة الحالية" : "Current status",
    statusEmpty: ar ? "ملخص مشروعك سينمو كلما chattedت وسجلت قرارات وأتممت مهام." : "Your project summary will grow as you chat, record decisions, and complete tasks.",
    rename: ar ? "إعادة تسمية المشروع" : "Rename project",
    renameShort: ar ? "إعادة تسمية" : "Rename",
    del: ar ? "حذف المشروع" : "Delete project",
    nothing: ar ? "لا شيء بعد." : "Nothing added yet.",
    conversations: ar ? "المحادثات" : "Conversations",
    noConvos: ar ? "ابدأ محادثة لتبني سياق هذا المشروع." : "Start a conversation to build this project's context.",
    goals: ar ? "الأهداف" : "Goals",
    tasks: ar ? "المهام" : "Tasks",
    decisions: ar ? "القرارات" : "Decisions",
    questions: ar ? "أسئلة مفتوحة" : "Open questions",
    workspaceFallback: ar ? "مساحة دائمة لسياقك طويل المدى." : "A persistent workspace for your long-term context.",
  };

  const sections = [
    [t.goals, project.goals, Target],
    [t.tasks, project.tasks, CheckSquare],
    [t.decisions, project.decisions, Scale],
    [t.questions, project.openQuestions, HelpCircle],
  ] as const;

  const exportMarkdown = () => {
    downloadBlob(
      new Blob([exportProjectMarkdown(project, conversations)], { type: "text/markdown;charset=utf-8" }),
      `${project.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "project"}.md`,
    );
  };

  return <section className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-10">
    <div className="mx-auto max-w-5xl space-y-6 sm:space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"><FolderKanban className="size-4 shrink-0 text-primary" /> {t.workspace}</div>
          <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{project.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">{project.description || t.workspaceFallback}</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {onRename ? <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setIsRenaming(true)}><Pencil className="mx-2 size-4 rtl:mx-0" /> {t.renameShort}</Button> : null}
          {onDelete ? <Button variant="outline" className="flex-1 text-destructive hover:bg-destructive/10 hover:text-destructive sm:flex-none" onClick={onDelete}><Trash2 className="mx-2 size-4 rtl:mx-0" /> {ar ? "حذف" : "Delete"}</Button> : null}
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={exportMarkdown}><Download className="mx-2 size-4 rtl:mx-0" /> {t.export}</Button>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => setWeeklyPlan(buildWeeklyPlan(project.tasks))}><CalendarRange className="mx-2 size-4 rtl:mx-0" /> {t.weekly}</Button>
        </div>
      </header>

      {/* `w-full` + `min-w-0` on the inputs: `min-w-48` alone (192px) plus the
          select plus the button overflowed a 360px screen even while wrapping. */}
      <form className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" onSubmit={(event) => { event.preventDefault(); if (conversationId) { onLinkConversation(conversationId); setConversationId(""); } if (task.trim()) { onAddTask(task); setTask(""); } }}>
        <select value={conversationId} onChange={(event) => setConversationId(event.target.value)} aria-label={t.link} className="h-9 w-full min-w-0 rounded-lg border bg-background px-2 text-sm sm:w-auto"><option value="">{t.link}</option>{unlinkedConversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}</select>
        <input value={task} onChange={(event) => setTask(event.target.value)} placeholder={t.addTask} aria-label={t.addTask} className="h-9 w-full min-w-0 rounded-lg border bg-background px-2 text-base sm:w-auto sm:min-w-48 sm:text-sm" />
        <Button type="submit" variant="outline" className="h-9 justify-center"><Plus className="mx-2 size-4 rtl:mx-0" /> {t.addTo}</Button>
      </form>

      <div className="rounded-xl border bg-card p-4 sm:p-5"><h2 className="font-semibold">{t.currentStatus}</h2><p className="mt-2 leading-7 text-muted-foreground">{project.summary || t.statusEmpty}</p></div>
      {weeklyPlan ? <div className="rounded-xl border bg-card p-4 sm:p-5"><h2 className="font-semibold">{t.weekly}</h2><pre className="mt-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">{weeklyPlan}</pre></div> : null}

      <div className="grid gap-4 sm:gap-4 md:grid-cols-2">{sections.map(([title, items, Icon]) => <div key={title} className="rounded-xl border bg-card p-4 sm:p-5"><h2 className="flex items-center gap-2 font-semibold"><Icon className="size-4 shrink-0 text-primary" />{title}</h2>{items.length ? <ul className="mt-4 space-y-2 text-sm text-muted-foreground">{items.map((item) => <li key={item} className="break-words rounded-md bg-muted/50 px-3 py-2">{item}</li>)}</ul> : <p className="mt-4 text-sm text-muted-foreground">{t.nothing}</p>}</div>)}</div>

      <div className="rounded-xl border bg-card p-4 sm:p-5"><h2 className="flex items-center gap-2 font-semibold"><MessageSquare className="size-4 shrink-0 text-primary" /> {t.conversations}</h2><div className="mt-4 grid gap-2 sm:grid-cols-2">{conversations.length ? conversations.map((conversation) => <button key={conversation.id} onClick={() => onOpenConversation(conversation.id)} className="min-w-0 rounded-lg border p-3 text-start text-sm transition-colors hover:bg-muted"><span className="block break-words font-medium">{conversation.title}</span><span className="mt-1 block text-xs text-muted-foreground">{ar ? `${conversation.messages.length} رسالة` : `${conversation.messages.length} messages`}</span></button>) : <p className="text-sm text-muted-foreground">{t.noConvos}</p>}</div></div>
    </div>

    {isRenaming && onRename ? <InlineRename open={isRenaming} initialName={project.name} ar={ar} title={t.rename} onClose={() => setIsRenaming(false)} onSubmit={(name) => { onRename(name); setIsRenaming(false); }} /> : null}
  </section>;
}

/**
 * The rename field, kept local rather than lifted into the page.
 *
 * It appears and disappears on a single button, so lifting it into `ProjectWorkspace` state would
 * mean threading a `mode` flag through the header just to reach one form. Duplicating a dialog is
 * cheaper than making every parent aware of an edit that is almost never open.
 */
function InlineRename({ open, initialName, ar, title, onClose, onSubmit }: { open: boolean; initialName: string; ar: boolean; title: string; onClose: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState(initialName);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form role="dialog" aria-modal="true" className="surface-card surface-elevated w-full max-w-md p-6" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(name.trim()); }}>
        <h2 className="text-section-title">{title}</h2>
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={120} aria-label={title} className="mt-4 h-9 w-full rounded-lg border bg-background px-2 text-sm" onKeyDown={(event) => { if (event.key === "Escape") onClose(); }} />
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>{ar ? "إلغاء" : "Cancel"}</Button>
          <Button type="submit">{ar ? "حفظ" : "Save"}</Button>
        </div>
      </form>
    </div>
  );
}
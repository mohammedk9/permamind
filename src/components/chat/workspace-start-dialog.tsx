"use client";

import { FolderKanban, MessageSquare, Sparkles } from "lucide-react";

export function WorkspaceStartDialog({ open, onChat, onProject }: { open: boolean; onChat: () => void; onProject: () => void }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/90 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="workspace-start-title">
    <div className="w-full max-w-2xl rounded-2xl border bg-card p-6 shadow-2xl sm:p-9">
      <div className="text-center"><div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="size-6" /></div><h1 id="workspace-start-title" className="mt-4 text-2xl font-semibold">How would you like to use PermaMind?</h1><p className="mt-2 text-muted-foreground">Choose a quick conversation or a persistent workspace for long-term work.</p></div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <button onClick={onChat} className="group rounded-xl border p-5 text-left transition-colors hover:border-primary hover:bg-primary/5"><MessageSquare className="size-6 text-primary" /><h2 className="mt-4 font-semibold">New chat</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">For quick, standalone questions and everyday conversations.</p><span className="mt-5 block text-sm font-medium text-primary">Start chatting →</span></button>
        <button onClick={onProject} className="group rounded-xl border p-5 text-left transition-colors hover:border-primary hover:bg-primary/5"><FolderKanban className="size-6 text-primary" /><h2 className="mt-4 font-semibold">New project</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Organize conversations, goals, tasks, decisions, files, and project context in one place.</p><span className="mt-5 block text-sm font-medium text-primary">Create workspace →</span></button>
      </div>
    </div>
  </div>;
}
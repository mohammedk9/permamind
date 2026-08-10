"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { completeFirstRun } from "@/lib/settings/first-run";

const screens = [
  ["Welcome to PermaMind", "Chat naturally.\nPermaMind keeps your conversations organized and helps you continue where you left off."],
  ["Your AI remembers", "Unlike traditional AI chats,\nPermaMind can search previous conversations,\ncontinue old projects,\nand reconnect past context."],
  ["Encrypted, portable memory", "Your conversations stay local by default and can be exported or restored.\n\nOptional backups are encrypted locally before upload. After a backup is uploaded to Arweave, it is permanent and cannot be deleted or undone."],
  ["Connect your AI", "Connect an AI provider API key in Settings when you are ready."],
] as const;

export function FirstLaunchOnboarding({ open, onComplete }: { open: boolean; onComplete: () => void }) {
  const [step, setStep] = useState(0);
  if (!open) return null;
  const finish = () => { completeFirstRun(); onComplete(); };
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/95 p-4" role="dialog" aria-modal="true" aria-labelledby="first-launch-title">
    <div className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-2xl sm:p-8">
      <div className="mb-8 flex justify-center gap-2" aria-label={`Step ${step + 1} of 4`}>{screens.map((_, index) => <span key={index} className={`h-1.5 w-10 rounded-full ${index === step ? "bg-primary" : "bg-muted"}`} />)}</div>
      <h1 id="first-launch-title" className="text-center text-2xl font-semibold">{screens[step][0]}</h1>
      <p className="mt-5 min-h-32 whitespace-pre-line text-center text-base leading-7 text-muted-foreground">{screens[step][1]}</p>
      <div className="mt-8 flex items-center justify-between gap-2"><Button variant="ghost" onClick={() => step === 0 ? undefined : setStep(step - 1)} disabled={step === 0}>Back</Button><div className="flex gap-2"><Button variant="ghost" onClick={finish}>Skip</Button>{step < 3 ? <Button onClick={() => setStep(step + 1)}>Next</Button> : <Button onClick={finish}>Get Started</Button>}</div></div>
    </div>
  </div>;
}

"use client";

import { ChevronDown, LockKeyhole, RotateCcw, UploadCloud } from "lucide-react";
import { useState } from "react";
import type { ConnectionStatus } from "@/hooks/use-api-settings";
import { resetFirstRun } from "@/lib/settings/first-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { StatusPill } from "@/components/ui/status-pill";

type Props = {
  apiKey: string; connectionStatus: ConnectionStatus;
  onApiKeyChange: (key: string) => void;
  onValidate: () => Promise<boolean>; onClearKey: () => void;
  onClearAnalytics: () => void;
};

function Row({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><p className="text-label">{label}</p><p className="mt-1 text-caption">{description}</p></div><div className="shrink-0">{children}</div></div>;
}

export function SettingsShell({ apiKey, connectionStatus, onApiKeyChange, onValidate, onClearKey, onClearAnalytics }: Props) {
  const [section, setSection] = useState("ai");
  const [advanced, setAdvanced] = useState(false);
  const [validating, setValidating] = useState(false);
  const validate = async () => { setValidating(true); await onValidate(); setValidating(false); };
  const status = connectionStatus === "connected" ? "success" : connectionStatus === "checking" ? "active" : connectionStatus === "invalid" ? "error" : "neutral";
  const sections = [{ id: "ai", label: "AI providers", summary: "Connection management" }, { id: "memory", label: "Memory", summary: "Presentation preferences" }, { id: "privacy", label: "Privacy", summary: "Data boundaries" }];
  return <main className="min-h-0 flex-1 overflow-y-auto p-4 pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-8 sm:pt-8"><div className="mx-auto max-w-6xl space-y-6">
    <PageHeader eyebrow="Preferences" title="Settings" description="Configure PermaMind without changing how your conversations, memory, or backups work." />
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Settings sections" className="space-y-1">{sections.map((item) => <button key={item.id} type="button" onClick={() => setSection(item.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm ${section === item.id ? "bg-secondary font-medium" : "hover:bg-muted"}`} aria-current={section === item.id ? "page" : undefined}><span>{item.label}</span><span className="mt-0.5 block text-xs text-muted-foreground">{item.summary}</span></button>)}<button type="button" onClick={() => setAdvanced(!advanced)} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted" aria-expanded={advanced}>Advanced <ChevronDown className={`size-4 transition-transform ${advanced ? "rotate-180" : ""}`} /></button></nav>
      <div className="space-y-4">
        {section === "ai" && <SurfaceCard title="AI providers" description="Connect the providers you choose. Provider credentials stay local and use the existing connection flow."><div className="grid gap-3 sm:grid-cols-2">{["OpenAI", "Claude", "Gemini", "Grok"].map((provider) => <div key={provider} className="rounded-lg border p-4"><div className="flex items-center justify-between"><p className="font-medium">{provider}</p><StatusPill status="neutral" label="Not connected" /></div><Input className="mt-3" type="password" placeholder={`${provider} API key`} disabled aria-label={`${provider} API key`} /><Button className="mt-3" size="sm" variant="outline" disabled>Validate</Button></div>)}<div className="rounded-lg border border-primary/40 bg-primary/5 p-4 sm:col-span-2"><div className="flex items-center justify-between"><p className="font-medium">OpenRouter</p><StatusPill status={status} label={connectionStatus === "connected" ? "Connected" : connectionStatus === "checking" ? "Checking" : connectionStatus === "invalid" ? "Invalid key" : "Not connected"} /></div><Input className="mt-3" type="password" value={apiKey} onChange={(e) => onApiKeyChange(e.target.value)} autoComplete="off" placeholder="OpenRouter API key" aria-label="OpenRouter API key" /><div className="mt-3 flex gap-2"><Button size="sm" onClick={validate} disabled={!apiKey.trim() || validating}>{validating ? "Validating…" : "Validate"}</Button>{apiKey && <Button size="sm" variant="outline" onClick={onClearKey}>Clear</Button>}</div></div></div></SurfaceCard>}
        {section === "memory" && <SurfaceCard title="Memory" description="Control how remembered context is presented while keeping retrieval behavior unchanged."><Row label="Memory visibility" description="Memory indicators and explanations remain available in Chat and Memory."><StatusPill status="protected" label="Existing behavior" /></Row><p className="pt-4 text-caption">Search, recall, provenance, and memory presentation controls remain owned by their existing experiences.</p></SurfaceCard>}
        {section === "privacy" && <SurfaceCard title="Privacy" description="Understand where your data lives and what backup means."><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-md border p-4"><p className="text-label">Local storage</p><p className="mt-2 text-caption">Conversations remain available in your browser/device storage.</p></div><div className="rounded-md border p-4"><LockKeyhole className="size-4" /><p className="mt-2 text-label">Encrypted backup</p><p className="mt-2 text-caption">Backups are encrypted before upload and depend on your passphrase.</p></div><div className="rounded-md border p-4"><UploadCloud className="size-4" /><p className="mt-2 text-label">Permanent storage</p><p className="mt-2 text-caption">Uploaded permanent data may be irreversible; Backup Center explains consequences.</p></div></div></SurfaceCard>}
        {advanced && <SurfaceCard title="Advanced" description="These actions can affect your local experience. Review the consequence before continuing."><Row label="Diagnostics and analytics" description="Use the existing analytics controls and stored diagnostics behavior."><Button size="sm" variant="outline" onClick={onClearAnalytics}>Clear analytics</Button></Row><Row label="Reset onboarding" description="Show the first-run onboarding again on the next load."><Button size="sm" variant="outline" onClick={() => { resetFirstRun(); window.location.reload(); }}><RotateCcw className="size-4" />Reset onboarding</Button></Row></SurfaceCard>}
      </div>
    </div>
  </div></main>;
}
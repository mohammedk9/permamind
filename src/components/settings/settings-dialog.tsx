"use client";

import {
  Cloud,
  HardDrive,
  CheckCircle2,
  KeyRound,
  Settings,
  Sparkles,
  XCircle,
  Zap,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { ConnectionStatus } from "@/hooks/use-api-settings";
import type { ApiKeyMode } from "@/lib/settings/api-key-storage";
import { cn } from "@/lib/utils";
import { HelpSheet } from "@/components/help/how-permamind-works";
import { resetFirstRun } from "@/lib/settings/first-run";
import {
  DEFAULT_STORAGE_PREFERENCES,
  loadStoragePreferences,
  saveStoragePreferences,
  type StoragePreferences,
} from "@/lib/storage/storage-preferences";
import { setSyncPassphrase } from "@/lib/storage/sync-encryption";

interface SettingsDialogProps {
  mode: ApiKeyMode;
  apiKey: string;
  connectionStatus: ConnectionStatus;
  onModeChange: (mode: ApiKeyMode) => void;
  onApiKeyChange: (key: string) => void;
  onValidate: () => Promise<boolean>;
  onClearKey: () => void;
  triggerClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

function StatusBadge({ status }: { status: ConnectionStatus }) {
  if (status === "checking") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <span className="size-2 animate-pulse rounded-full bg-amber-500" />
        Checking…
      </span>
    );
  }
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
        <CheckCircle2 className="size-3.5" />
        Connected
      </span>
    );
  }
  if (status === "invalid") {
    return (
      <span className="flex items-center gap-1 text-xs text-destructive">
        <XCircle className="size-3.5" />
        Invalid key
      </span>
    );
  }
  if (status === "not_set") {
    return (
      <span className="text-xs text-muted-foreground">No key saved</span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground">Not validated</span>
  );
}

function StoragePreferencesPanel() {
  const [preferences, setPreferences] = useState<StoragePreferences>(loadStoragePreferences);
  const [syncPassphrase, setSyncPassphraseState] = useState("");

  const update = (change: Partial<StoragePreferences>) => {
    const next = { ...preferences, ...change };
    setPreferences(next);
    saveStoragePreferences(next);
  };
  return (
    <div className="space-y-3 text-xs">
      <p className="text-muted-foreground">Choose where selected data may be used. Changing this setting never uploads anything automatically.</p>
      <label className={cn("block cursor-pointer rounded-lg border p-3 transition-colors", preferences.syncMode === "local" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}>
        <span className="flex items-start gap-2">
          <input
          type="radio"
          name="storage-mode"
          checked={preferences.syncMode === "local"}
          onChange={() => update({ syncMode: "local" })}
          />
          <span><span className="flex items-center gap-1 font-medium"><HardDrive className="size-3.5" />Local storage <span className="text-muted-foreground">(default)</span></span><span className="mt-1 block text-muted-foreground">Your data stays on this device. Later, you can choose important conversations to send their summary to Supabase or save an encrypted backup on Arweave.</span></span>
        </span>
      </label>
      <label className={cn("block cursor-pointer rounded-lg border p-3 transition-colors", preferences.syncMode === "supabase" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}>
        <span className="flex items-start gap-2"><input
          type="radio"
          name="storage-mode"
          checked={preferences.syncMode === "supabase"}
          onChange={() => update({ syncMode: "supabase" })}
        /> <span><span className="flex items-center gap-1 font-medium"><Cloud className="size-3.5" />Cloud storage</span><span className="mt-1 block text-muted-foreground">Use the data you choose from another device. Nothing is uploaded automatically.</span></span></span>
      </label>
      {preferences.syncMode === "supabase" && (
        <div className="ml-5 space-y-1 border-l pl-3">
          <Input type="password" value={syncPassphrase} onChange={(event) => { setSyncPassphraseState(event.target.value); setSyncPassphrase(event.target.value); }} placeholder="Sync passphrase (kept in memory only)" autoComplete="off" />
          <p className="text-muted-foreground">This passphrase is never saved or sent to Supabase. You need it again on another device.</p>
          <p className="rounded-md bg-primary/5 p-2 text-muted-foreground">Supabase receives only the selected encrypted summary after a separate warning and your confirmation. The full conversation is not sent by default. You can delete Supabase data later.</p>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={preferences.syncConversations} onChange={(event) => update({ syncConversations: event.target.checked })} />
            Conversations
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={preferences.syncMemories} onChange={(event) => update({ syncMemories: event.target.checked })} />
            Memories
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={preferences.syncProjects} onChange={(event) => update({ syncProjects: event.target.checked })} />
            Projects
          </label>
        </div>
      )}
      <p className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-muted-foreground">Arweave is separate from Supabase and is available in both modes. It remains controlled by the existing Backup storage policy. Arweave data is permanent and cannot be deleted.</p>
      <Button size="sm" variant="ghost" onClick={() => { setPreferences(DEFAULT_STORAGE_PREFERENCES); saveStoragePreferences(DEFAULT_STORAGE_PREFERENCES); }}>
        Reset storage choices
      </Button>
    </div>
  );
}

export function SettingsDialog({
  mode,
  apiKey,
  connectionStatus,
  onModeChange,
  onApiKeyChange,
  onValidate,
  onClearKey,
  triggerClassName,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: SettingsDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = controlledOnOpenChange ?? setInternalOpen;
  const [validating, setValidating] = useState(false);

  const handleValidate = async () => {
    setValidating(true);
    await onValidate();
    setValidating(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn("w-full justify-start gap-2 text-xs", triggerClassName)}
          />
        }
      >
        <Settings className="size-4" />
        Settings
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>API settings</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto py-2">
          <section className="space-y-3">
            <h3 className="text-sm font-medium">Mode</h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onModeChange("free")}
                className={cn(
                  "rounded-lg border p-3 text-left text-sm transition-colors",
                  mode === "free"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                )}
              >
                <Sparkles className="mb-1.5 size-4" />
                <p className="font-medium">Free</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  DeepSeek &amp; other free models
                </p>
              </button>
              <button
                type="button"
                onClick={() => onModeChange("byok")}
                className={cn(
                  "rounded-lg border p-3 text-left text-sm transition-colors",
                  mode === "byok"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                )}
              >
                <KeyRound className="mb-1.5 size-4" />
                <p className="font-medium">Your key</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Bring your own OpenRouter key
                </p>
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-medium">Getting started</h3>
            <HelpSheet triggerClassName="w-full justify-start gap-2" />
            <section className="space-y-3 rounded-lg border border-border p-3">
              <h4 className="text-sm font-medium">Data storage and privacy</h4>
              <p className="text-xs text-muted-foreground">
                Local-only storage is the default. Choose exactly what may leave this device. Supabase sync is optional; Arweave backups are encrypted and permanent.
              </p>
              <StoragePreferencesPanel />
            </section>
            <section className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <h4 className="mb-1 font-semibold text-foreground">Privacy</h4>
              <p>Your memory is encrypted, portable, and user-controlled. Conversations stay in your browser/device by default; you can export and restore them, and use a different AI provider. Only the context needed for an AI request is sent, and your API key and encryption passphrase stay local rather than on our servers.</p>
            </section>
            <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
              <h4 className="mb-1 font-semibold text-foreground">Permanent storage</h4>
              <p>Permanent backups are optional and encrypted locally. After a backup is uploaded to Arweave, it cannot be deleted or undone. You can stop future uploads, but this does not remove previous Arweave data.</p>
            </section>
            <Button size="sm" variant="outline" onClick={() => { resetFirstRun(); setOpen(false); window.location.reload(); }}>
              Reset onboarding
            </Button>
          </section>

          {mode === "byok" && (
            <>
              <Separator />
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">OpenRouter API key</h3>
                  <StatusBadge status={connectionStatus} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Stored only in your browser (localStorage). Sent per request to
                  our API route — never saved on our servers.
                </p>
                <Input
                  type="password"
                  placeholder="sk-or-v1-…"
                  value={apiKey}
                  onChange={(e) => onApiKeyChange(e.target.value)}
                  autoComplete="off"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleValidate}
                    disabled={!apiKey.trim() || validating}
                  >
                    {validating ? "Validating…" : "Validate key"}
                  </Button>
                  {apiKey && (
                    <Button size="sm" variant="outline" onClick={onClearKey}>
                      Clear
                    </Button>
                  )}
                </div>
                <a
                  href="https://openrouter.ai/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline"
                >
                  Get a key at openrouter.ai →
                </a>
              </section>

              <section className="rounded-lg border border-border bg-muted/30 p-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Zap className="size-3.5" />
                  Why use your own key?
                </h4>
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  <li>• Access premium models (Claude, GPT-4o, Gemini)</li>
                  <li>• Higher rate limits on your OpenRouter account</li>
                  <li>• Often faster responses with paid tiers</li>
                  <li>• You control billing directly with OpenRouter</li>
                </ul>
              </section>
            </>
          )}

          {mode === "free" && (
            <section className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p>
                Free mode uses OpenRouter&apos;s free model tier. Default:{" "}
                <strong className="text-foreground">DeepSeek Chat (Free)</strong>
                , with automatic fallback if a model is unavailable.
              </p>
            </section>
          )}

        </div>
      </SheetContent>
    </Sheet>
  );
}

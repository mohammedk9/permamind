"use client";

import {
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

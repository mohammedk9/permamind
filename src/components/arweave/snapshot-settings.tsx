"use client";

import { Camera, KeyRound, Upload } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { StoragePolicy } from "@/lib/arweave/storage-policy";

interface SnapshotSettingsProps {
  passphrase: string;
  onPassphraseChange: (passphrase: string) => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onSnapshotNow: () => void;
  isProcessing: boolean;
  triggerClassName?: string;
  storagePolicy?: StoragePolicy;
  onStoragePolicyChange?: (policy: StoragePolicy) => void;
}

/**
 * Settings panel for Arweave snapshot configuration.
 * Allows users to set their encryption passphrase, enable/disable automatic
 * snapshots, and trigger manual snapshots.
 */
export function SnapshotSettings({
  passphrase,
  onPassphraseChange,
  enabled,
  onEnabledChange,
  onSnapshotNow,
  isProcessing,
  triggerClassName,
  storagePolicy = "store_everything",
  onStoragePolicyChange,
}: SnapshotSettingsProps) {
  const [internalOpen, setInternalOpen] = useState(false);

  return (
    <Sheet open={internalOpen} onOpenChange={setInternalOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn("w-full justify-start gap-2 text-xs", triggerClassName)}
          />
        }
      >
        <Camera className="size-4" />
        Snapshots
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Snapshot settings</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto py-2">
          {/* Enable/Disable Toggle */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Automatic snapshots</h3>
              <button
                type="button"
                onClick={() => onEnabledChange(!enabled)}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  enabled ? "bg-primary" : "bg-muted"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block size-5 transform rounded-full bg-background shadow-lg ring-0 transition-transform",
                    enabled ? "translate-x-5" : "translate-x-0"
                  )}
                />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Automatically save conversations to Arweave when idle or switching chats.
            </p>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="text-sm font-medium">Permanent storage policy</h3>
            <select className="w-full rounded-md border bg-background p-2 text-sm" value={storagePolicy} onChange={(e) => onStoragePolicyChange?.(e.target.value as StoragePolicy)} aria-label="Permanent storage policy">
              <option value="store_everything">Store everything</option>
              <option value="starred_only">Store only starred conversations</option>
              <option value="manual_only">Store only manually selected conversations</option>
              <option value="manual_backups_only">Manual backups only (no automatic uploads)</option>
            </select>
          </section>

          <Separator />

          {/* Encryption Passphrase */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Encryption passphrase</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Used to encrypt your snapshots before uploading. Keep this safe — 
              you&apos;ll need it to restore your data.
            </p>
            <Input
              type="password"
              placeholder="Enter a strong passphrase"
              value={passphrase}
              onChange={(e) => onPassphraseChange(e.target.value)}
              autoComplete="off"
            />
          </section>

          <Separator />

          {/* Manual Snapshot */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Upload className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-medium">Manual snapshot</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Create a snapshot of your current conversations immediately.
            </p>
            <Button
              size="sm"
              onClick={onSnapshotNow}
              disabled={!passphrase || !enabled || isProcessing}
            >
              {isProcessing ? "Creating snapshot…" : "Snapshot now"}
            </Button>
          </section>

          {/* Info Box */}
          <section className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p className="mb-2 font-semibold text-foreground">How it works:</p>
            <ul className="space-y-1.5">
              <li>• Conversations are encrypted with your passphrase</li>
              <li>• Snapshots are uploaded to Arweave for permanent storage</li>
              <li>• Only you can decrypt your data with your passphrase</li>
              <li>• Automatic snapshots trigger after 5 minutes of inactivity</li>
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
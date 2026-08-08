"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, CheckCircle2, Eye, EyeOff, LockKeyhole, RefreshCw, RotateCcw, UploadCloud } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { PageHeader } from "@/components/ui/page-header";
import { SurfaceCard } from "@/components/ui/surface-card";
import { StorageMeter } from "@/components/ui/storage-meter";
import { StatusPill, type Status } from "@/components/ui/status-pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConversations } from "@/hooks/use-conversations";
import { useSnapshot } from "@/hooks/use-snapshot";
import { getStorageUsage, type StorageUsage } from "@/lib/arweave/storage-quota";
import { getAllSnapshots, getLastSnapshot } from "@/lib/arweave/snapshot-registry";
import { loadStoragePolicy, saveStoragePolicy, type StoragePolicy } from "@/lib/arweave/storage-policy";
import { getQueueStatus } from "@/lib/arweave/upload-queue";
import { restoreLatestSnapshot, type RestoreResult } from "@/lib/arweave/restore";
import type { QueueStatusSummary } from "@/lib/arweave/snapshot-types";
import { startProcessor, stopProcessor } from "@/lib/arweave/queue-processor";

const emptyQueue: QueueStatusSummary = { total: 0, pending: 0, uploading: 0, done: 0, failed: 0, lastUploadedAt: null };
const BACKUP_PASSPHRASE_STORAGE_KEY = "permamind.backup-passphrase";

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Never";
}

function queueState(queue: QueueStatusSummary, processing: boolean): { label: string; status: Status } {
  if (queue.failed > 0) return { label: "Failed", status: "error" };
  if (processing || queue.uploading > 0) return { label: "Uploading", status: "active" };
  if (queue.pending > 0) return { label: "Pending", status: "attention" };
  if (queue.done > 0) return { label: "Success", status: "success" };
  return { label: "Idle", status: "neutral" };
}

export default function BackupPage() {
  const conversations = useConversations();
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [policy, setPolicy] = useState<StoragePolicy>("store_everything");
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [queue, setQueue] = useState<QueueStatusSummary>(emptyQueue);
  // Browser-only registry data must not be read during the initial render.
  // Reading it here makes the server render "Not created yet" while the
  // browser can immediately render an existing version, causing hydration
  // to fail.
  const [lastSnapshot, setLastSnapshot] = useState<ReturnType<typeof getLastSnapshot>>(null);
  const [confirm, setConfirm] = useState<"backup" | "restore" | null>(null);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [restoreWorking, setRestoreWorking] = useState(false);
  const [passphraseHydrated, setPassphraseHydrated] = useState(false);
  const [browserReady, setBrowserReady] = useState(false);
  const snapshot = useSnapshot(conversations.conversations, conversations.activeId, passphrase || null);

  // Keep the passphrase on this browser so leaving and reopening the page does
  // not clear it. It is never read by the server or included in API requests.
  useEffect(() => {
    const savedPassphrase = window.localStorage.getItem(BACKUP_PASSPHRASE_STORAGE_KEY);
    if (savedPassphrase) setPassphrase(savedPassphrase);
    setPassphraseHydrated(true);
  }, []);

  useEffect(() => {
    if (!passphraseHydrated) return;
    if (passphrase) {
      window.localStorage.setItem(BACKUP_PASSPHRASE_STORAGE_KEY, passphrase);
    } else {
      window.localStorage.removeItem(BACKUP_PASSPHRASE_STORAGE_KEY);
    }
  }, [passphrase, passphraseHydrated]);

  // The backup page is also a queue-worker host. Without this processor,
  // manual backups are encrypted and persisted locally but never uploaded.
  useEffect(() => {
    if (passphrase.length >= 8) {
      startProcessor(passphrase);
    } else {
      stopProcessor();
    }

    return () => stopProcessor();
  }, [passphrase]);

  const refresh = useCallback(() => {
    setUsage(getStorageUsage());
    setQueue(getQueueStatus());
    setLastSnapshot(getLastSnapshot());
  }, []);
  useEffect(() => {
    setPolicy(loadStoragePolicy());
    refresh();
    setBrowserReady(true);
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => { refresh(); }, [snapshot.isProcessing, snapshot.lastSnapshotVersion, refresh]);

  const state = queueState(queue, snapshot.isProcessing);
  const latestAvailable = browserReady ? getAllSnapshots().filter((item) => item.txId).at(-1) ?? null : null;
  const savePolicy = (value: StoragePolicy) => { setPolicy(value); saveStoragePolicy(value); };
  const manualBackup = async () => { setConfirm(null); await snapshot.triggerSnapshot(true); refresh(); };
  const restore = async () => {
    setConfirm(null); setRestoreWorking(true); setRestoreResult(null);
    const result = await restoreLatestSnapshot({ passphrase, confirm: true });
    setRestoreResult(result); setRestoreWorking(false);
    if (result.status === "restored") conversations.reload();
  };
  const percentage = usage?.percentageUsed ?? 0;
  const quotaStatus: Status = percentage >= 100 ? "error" : percentage >= 80 ? "attention" : "success";

  return <AppShell activeArea="backup" onNavigate={(area) => { window.location.href = `/${area}`; }}>
    <main className="min-h-0 flex-1 overflow-y-auto p-4 pt-14 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-8 sm:pt-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <PageHeader eyebrow="Permanent storage" title="Backup Center" description="Keep an encrypted, permanent copy of your local conversations while staying in control of the passphrase and restore process." />

        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <SurfaceCard title="Backup overview" description="Local conversations remain available even when a backup is queued or unavailable." actions={<StatusPill status={state.status} label={state.label} />}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div><p className="text-caption">Current snapshot</p><p className="mt-1 text-lg font-semibold">{lastSnapshot ? `Version ${lastSnapshot.version}` : "Not created yet"}</p></div>
              <div><p className="text-caption">Last successful upload</p><p className="mt-1 font-medium">{formatDate(queue.lastUploadedAt)}</p></div>
              <div><p className="text-caption">Conversations ready</p><p className="mt-1 font-medium">{conversations.conversations.length}</p></div>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button onClick={() => setConfirm("backup")} disabled={!passphrase || snapshot.isProcessing} aria-label="Create a manual encrypted backup"><UploadCloud className="size-4" />{snapshot.isProcessing ? "Creating backup…" : "Back up now"}</Button>
              <Button variant="outline" onClick={() => setConfirm("restore")} disabled={!passphrase || !latestAvailable || restoreWorking} aria-label="Restore the latest backup"><RotateCcw className="size-4" />Restore latest</Button>
            </div>
            <div className="sr-only" aria-live="polite">{snapshot.isProcessing ? "Backup is in progress" : restoreWorking ? "Restore is in progress" : restoreResult?.message ?? ""}</div>
          </SurfaceCard>

          <SurfaceCard title="Storage usage" description="Existing quota and usage from your local storage account.">
            {usage && <StorageMeter used={`${usage.usedMb.toFixed(2)} MB`} total={`${(usage.effectiveQuotaBytes / 1024 / 1024).toFixed(0)} MB quota`} percentage={usage.percentageUsed} status={quotaStatus} />}
            {usage && usage.percentageUsed >= 80 && <p className="mt-4 text-sm text-status-attention">{usage.percentageUsed >= 100 ? "Storage is full. New uploads may be blocked; local conversations are not deleted." : "Storage is nearly full. Review usage before creating more backups."}</p>}
          </SurfaceCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SurfaceCard title="Backup policy" description="Choose which existing conversations the snapshot pipeline includes automatically.">
            <label htmlFor="backup-policy" className="text-label">Permanent storage policy</label>
            <select id="backup-policy" className="mt-2 w-full rounded-md border bg-background p-2.5 text-sm" value={policy} onChange={(event) => savePolicy(event.target.value as StoragePolicy)}>
              <option value="store_everything">Store everything</option><option value="starred_only">Store starred conversations only</option><option value="manual_only">Store manually selected conversations only</option><option value="manual_backups_only">Manual backups only</option>
            </select>
            <p className="mt-2 text-caption">Manual backups use the existing pipeline and can include everything when this policy is manual-only.</p>
          </SurfaceCard>

          <SurfaceCard title="Queue health" description="Upload activity is persisted locally and survives browser restarts." actions={<StatusPill status={state.status} label={state.label} />}>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><p className="text-caption">Pending</p><p className="font-semibold">{queue.pending}</p></div><div><p className="text-caption">Uploading</p><p className="font-semibold">{queue.uploading}</p></div><div><p className="text-caption">Completed</p><p className="font-semibold">{queue.done}</p></div><div><p className="text-caption">Failed</p><p className="font-semibold">{queue.failed}</p></div></div>
            {queue.failed > 0 && <Button className="mt-4" variant="outline" onClick={snapshot.retryFailed}><RefreshCw className="size-4" />Retry failed uploads</Button>}
          </SurfaceCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <SurfaceCard title="Encryption and recovery" description="Understand what is required before you create a backup or restore one.">
            <div className="flex gap-3"><LockKeyhole className="mt-0.5 size-5 shrink-0 text-status-protected" /><div className="space-y-2 text-sm"><p>Backups are encrypted locally before upload. Your passphrase is required to restore the data.</p><p className="font-medium text-status-attention">If you lose the passphrase, the encrypted backup cannot be recovered.</p></div></div>
            <label htmlFor="backup-passphrase" className="mt-5 block text-label">Backup passphrase</label>
            <div className="relative mt-2"><Input id="backup-passphrase" type={showPassphrase ? "text" : "password"} value={passphrase} onChange={(event) => setPassphrase(event.target.value)} aria-describedby="passphrase-help" aria-invalid={passphrase.length > 0 && passphrase.length < 8} autoComplete="off" placeholder="Enter your recovery passphrase" className="pr-11" /><button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1" onClick={() => setShowPassphrase((visible) => !visible)} aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}>{showPassphrase ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div>
            <p id="passphrase-help" className="mt-2 text-caption">Use the same passphrase for restore. It is never displayed after you hide it.</p>{passphrase.length > 0 && passphrase.length < 8 && <p className="mt-1 text-sm text-status-error" role="alert">Use at least 8 characters for a stronger recovery passphrase.</p>}
          </SurfaceCard>
          <SurfaceCard title="Latest restore" description="Restoring replaces the current local conversation data with the latest available encrypted snapshot.">
            {latestAvailable ? <div className="space-y-3 text-sm"><div className="flex items-center gap-2"><CheckCircle2 className="size-4 text-status-success" /><span>Version {latestAvailable.version} is available</span></div><p className="text-muted-foreground">Created {formatDate(latestAvailable.createdAt)} · {latestAvailable.conversationIds.length} conversations · {latestAvailable.messageCount} messages</p><p className="text-status-attention">Restore is destructive to current local data and cannot be undone by this UI.</p></div> : <div className="flex items-center gap-3 text-sm text-muted-foreground"><Archive className="size-5" />Create and upload a backup before restoring.</div>}
            {restoreResult && <p className={restoreResult.status === "restored" ? "mt-4 text-sm text-status-success" : "mt-4 text-sm text-status-error"} role="status">{restoreResult.message}{restoreResult.error ? `: ${restoreResult.error}` : ""}</p>}
          </SurfaceCard>
        </div>
      </div>
    </main>
    <ConfirmDialog open={confirm === "backup"} onOpenChange={(open) => !open && setConfirm(null)} title="Create a permanent backup?" consequence="This will encrypt your current local conversations and queue them for permanent storage. Permanent uploads cannot be deleted from this screen." confirmLabel="Create backup" onConfirm={manualBackup} />
    <ConfirmDialog open={confirm === "restore"} onOpenChange={(open) => !open && setConfirm(null)} title="Restore the latest backup?" consequence="Restore will replace your current local conversations with the selected encrypted snapshot. This action cannot be undone by this UI." confirmLabel="Restore backup" severity="destructive" submitting={restoreWorking} onConfirm={restore} />
  </AppShell>;
}
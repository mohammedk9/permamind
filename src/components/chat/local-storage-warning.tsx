"use client";

import { Download, HardDrive, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { StorageMeter } from "@/components/ui/storage-meter";
import { useLocale } from "@/hooks/use-locale";
import { buildConversationExport, conversationExportFileName } from "@/lib/storage/chat-export";
import { downloadBlob } from "@/lib/storage/download";
import {
  formatBytes,
  measureStorageBreakdown,
  watchLocalStorage,
  type LocalStorageUsage,
  type StorageBreakdown,
  type StorageFullDetail,
} from "@/lib/storage/storage-health";
import type { Conversation } from "@/types/chat";

/**
 * Reports real browser storage usage.
 *
 * The existing `StorageMeter` in the Backup Center measures the Arweave upload
 * allowance, which is a different budget entirely. A user can be at 4% of their
 * paid Arweave quota while their browser origin is at 92% and silently dropping
 * every new message. This component measures the second one.
 *
 * The banner only becomes interactive once a write has actually failed, so it
 * does not compete with the conversation for attention during normal use.
 */
export function LocalStorageWarning({ conversations }: { conversations: Conversation[] }) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [usage, setUsage] = useState<LocalStorageUsage | null>(null);
  const [failed, setFailed] = useState<StorageFullDetail | null>(null);
  /**
   * Per-store breakdown. Answering "which store filled my browser?" with data
   * is what decides whether an IndexedDB migration is worth the churn, so the
   * user is able to see it instead of the project guessing.
   */
  const [breakdown, setBreakdown] = useState<StorageBreakdown>(() => ({
    usedBytes: 0,
    quotaBytes: 0,
    ratio: 0,
    level: "ok",
    entries: [],
  }));
  const [showBreakdown, setShowBreakdown] = useState(false);

  useEffect(
    () =>
      watchLocalStorage(
        (next) => {
          setUsage(next);
          setBreakdown(measureStorageBreakdown());
        },
        (detail) => setFailed(detail),
      ),
    [],
  );

  const exportAll = useCallback(() => {
    // The shared helper is used deliberately: this banner is the one export a
    // user reaches for when their storage is already full, so it is the worst
    // possible place for a download to silently produce nothing.
    downloadBlob(
      new Blob([JSON.stringify(buildConversationExport(conversations), null, 2)], {
        type: "application/json",
      }),
      conversationExportFileName(),
    );
  }, [conversations]);

  if (!usage || !usage.available || usage.level === "ok") return null;

  const critical = usage.level === "critical" || failed !== null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-3 border-b border-status-attention/30 bg-status-attention/10 px-4 py-3 text-sm"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-status-attention" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">
          {critical
            ? ar
              ? "امتلأت مساحة التخزين المحلية"
              : "Local storage is full"
            : ar
              ? "مساحة التخزين المحلية تكاد تمتلئ"
              : "Local storage is nearly full"}
        </p>
        <p className="mt-0.5 text-muted-foreground">
          {failed
            ? ar
              ? "تعذّر حفظ رسالتك الأخيرة. صدّر محادثاتك الآن لتفقد أي شيء."
              : "Your last message could not be saved. Export your conversations now so nothing is lost."
            : ar
              ? `المساحة المستخدمة ${formatBytes(usage.usedBytes)} من حد تقريبي ${formatBytes(usage.quotaBytes)}.`
              : `Using ${formatBytes(usage.usedBytes)} of an estimated ${formatBytes(usage.quotaBytes)}.`}
        </p>
        <StorageMeter
          className="mt-2 max-w-xs"
          label={ar ? "المساحة المستخدمة" : "Storage used"}
          used={formatBytes(usage.usedBytes)}
          total={formatBytes(usage.quotaBytes)}
          percentage={usage.ratio * 100}
          status={critical ? "attention" : "neutral"}
        />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setShowBreakdown((current) => !current)} aria-expanded={showBreakdown}>
          {ar ? "التفاصيل" : "Details"}
        </Button>
        <Button size="sm" variant="outline" onClick={exportAll} aria-label={ar ? "تصدير المحادثات" : "Export conversations"}>
          {critical ? <Download className="size-4" /> : <HardDrive className="size-4" />}
          {ar ? "تصدير المحادثات" : "Export chats"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setFailed(null)} aria-label={ar ? "إخفاء" : "Dismiss"}>
          {ar ? "لاحقاً" : "Later"}
        </Button>
      </div>
      {showBreakdown && (
        <dl className="w-full basis-full space-y-1 border-t border-border/60 pt-2 text-xs">
          {breakdown.entries.slice(0, 6).map((entry) => (
            <div key={entry.key} className="flex items-center justify-between gap-3">
              <dt className="truncate font-mono text-[11px] text-muted-foreground">{entry.role}</dt>
              <dd className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(entry.bytes)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

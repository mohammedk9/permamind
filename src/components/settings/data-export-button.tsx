"use client";

import { Check, Download } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";
import {
  buildFullExport,
  downloadBlob,
  plainExportFileName,
  serializePlainExport,
} from "@/lib/storage/full-export";

type Phase = "idle" | "done" | "error";

interface DataExportButtonProps {
  /** Styling hook for the sidebar, matching the other utility triggers. */
  triggerClassName?: string;
  /** `icon` renders a compact square button for a page header. */
  variant?: "trigger" | "icon";
  className?: string;
}

/** How long the confirmation stays on screen before the icon resets. */
const CONFIRM_MS = 1800;

/**
 * One-click download of the whole local archive.
 *
 * The same action already exists inside `full-export-panel`, but that panel is a
 * third-level destination: Settings, then the "Export & import" tab, then the
 * button. A user who has never read the navigation should still be able to keep
 * their own data, so this surfaces the identical operation in the two places
 * people actually look — the sidebar utilities and the chat header.
 *
 * It deliberately writes the plain JSON variant, not the encrypted archive: the
 * quick action should never demand a passphrase before it does anything, and
 * the encrypted form needs a passphrase chosen per export anyway. The panel
 * remains the route for the encrypted variant.
 */
export function DataExportButton({
  triggerClassName,
  variant = "trigger",
  className,
}: DataExportButtonProps) {
  const { locale } = useLocale();
  const ar = locale === "ar";
  const [phase, setPhase] = useState<Phase>("idle");
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const exportNow = useCallback(() => {
    try {
      const data = buildFullExport();
      downloadBlob(
        new Blob([serializePlainExport(data)], { type: "application/json" }),
        plainExportFileName(),
      );
      setPhase("done");
    } catch {
      // The archive is built from local storage, so this is only reachable if a
      // stored payload is corrupt. Saying so beats silently doing nothing.
      setPhase("error");
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setPhase("idle"), CONFIRM_MS);
  }, []);

  const label =
    phase === "error"
      ? ar
        ? "تعذّر التصدير"
        : "Export failed"
      : phase === "done"
        ? ar
          ? "تم تنزيل البيانات"
          : "Data downloaded"
        : ar
          ? "تنزيل البيانات"
          : "Download data";

  const icon = phase === "done" ? <Check className="size-4" /> : <Download className="size-4" />;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={variant === "icon" ? "icon" : "sm"}
        onClick={exportNow}
        aria-label={label}
        title={label}
        className={cn(
          variant === "trigger" &&
            "w-full justify-start gap-2 text-xs",
          phase === "error" && "text-destructive",
          phase === "done" && "text-status-success",
          variant === "trigger" ? triggerClassName : className,
        )}
      >
        {icon}
        {variant === "trigger" && <span>{label}</span>}
      </Button>
      <span className="sr-only" role="status">
        {phase === "idle" ? "" : label}
      </span>
    </>
  );
}
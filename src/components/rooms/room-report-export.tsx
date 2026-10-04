"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/storage/download";
import {
  buildRoomReport,
  renderRoomReportHtml,
  type ReportLocale,
  type RoomReportInput,
} from "@/lib/rooms/report";

/**
 * The host's way out of a room.
 *
 * ## This is the only door, and it is deliberately a door
 *
 * Everything else in a room is deleted when the room closes. What the host keeps is this file,
 * and they keep it because they pressed a button — not because the system decided a brainstorm
 * was worth remembering. Section 9's warning is the reason: a room that quietly becomes
 * permanent memory is how a memory system fills with noise.
 *
 * ## Why the PDF is a print, and not a library
 *
 * Arabic needs contextual letter shaping and right-to-left layout. Browsers do both as part of
 * rendering text. PDF libraries have to be given a font and a shaper to do it separately, and
 * the ones that get it wrong emit a page of disconnected letters reading left to right.
 *
 * So this opens the rendered document and lets the browser print it. The result is a real PDF
 * with correctly shaped, selectable Arabic in it, produced by the best Arabic typesetter
 * already installed on the machine.
 */
export function RoomReportExport({
  roomId,
  summary,
  ideas,
  contributorLabels,
  hoursOpen,
  locale,
  ar,
}: {
  roomId: string;
  summary: string;
  ideas: RoomReportInput["ideas"];
  contributorLabels: string[];
  hoursOpen: number;
  locale: ReportLocale;
  ar: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const report = () => {
    setError("");
    return buildRoomReport({
      roomId,
      summary,
      ideas,
      contributorLabels,
      hoursOpen,
      createdAt: new Date().toISOString(),
      locale,
    });
  };

  /** The HTML file. Kept as a file because a file can be re-read, edited, and deleted. */
  const exportHtml = () => {
    try {
      const html = renderRoomReportHtml(report(), locale);
      // `text/html` rather than `text/plain`: the file opens styled, which is the point of
      // rendering it at all. The report is self-contained, so it needs no network to read.
      downloadBlob(
        new Blob([html], { type: "text/html;charset=utf-8" }),
        `permamind-room-${roomId}.html`,
      );
    } catch {
      setError(ar ? "تعذر إنشاء التقرير." : "The report could not be produced.");
    }
  };

  /**
   * The PDF. Opens the same document in a new window and prints it.
   *
   * A new window rather than an iframe: a print dialog for an iframe belongs to the parent
   * document, so the host would get a dialog titled after the room rather than after the
   * report, and a background tab would find the dialog attributed to nothing at all.
   */
  const exportPdf = () => {
    setBusy(true);
    try {
      const html = renderRoomReportHtml(report(), locale);
      const win = window.open("", "_blank", "noopener,noreferrer");
      if (!win) {
        // A popup blocker, not a failure of the report. Saying so beats a button that
        // appears broken.
        setError(
          ar
            ? "المتصفح منع النافذة. اسمح بالنوافذ المنبثقة أو صدر HTML."
            : "The browser blocked the window. Allow pop-ups, or export the HTML file instead.",
        );
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      // Written after the document exists, so the print stylesheet has applied and the
      // fonts have settled. Printing synchronously here produces a blank first page in some
      // engines.
      win.focus();
      win.print();
    } catch {
      setError(ar ? "تعذر إنشاء التقرير." : "The report could not be produced.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 border-t border-border px-4 py-3">
      <h3 className="text-sm font-medium">
        {ar ? "تقرير الغرفة" : "Room report"}
      </h3>

      <p className="text-xs text-muted-foreground">
        {ar
          ? "الملف الوحيد الذي يخرج من هذه الغرفة. كل ما عدا ذلك يحذف عند إغلاقها."
          : "The only thing that leaves this room. Everything else is deleted when it closes."}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={exportHtml}>
          {ar ? "تصدير HTML" : "Export HTML"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={exportPdf}>
          {ar ? "حفظ PDF" : "Save as PDF"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
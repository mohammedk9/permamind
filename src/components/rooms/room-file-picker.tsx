"use client";

import { useRef, useState } from "react";

import { composeRoomBodyWithFiles, prepareRoomFiles, type PendingRoomFile } from "@/lib/rooms/attachments";
import { attachmentSizeLimit, attachmentKind, MAX_ATTACHMENT_COUNT } from "@/lib/documents/limits";

/**
 * Sharing a file into the room conversation.
 *
 * ## What happens to the file
 *
 * The browser reads it — a PDF, a Word document, a spreadsheet, or a photograph through OCR — and
 * **only the extracted text** is folded into the message, which is then sealed under the room
 * key exactly like every other message. The file itself is never uploaded anywhere.
 *
 * That is a deliberate trade rather than a limitation to apologise for: the room key never
 * reaches the server, so a file kept as bytes would need its own encrypted store and its own
 * deletion sweep. Text-in-the-payload needs neither, and a database dump stays as opaque as it
 * is for everything else in the room.
 *
 * ## What a reader gets
 *
 * The filename is inside the sealed message, not in a column. A filename is room content — it
 * can carry a message, and a member who writes their opinion into `final_v2_REVISED.docx`
 * should have it read by the same eyes as everything else they said.
 */
export function RoomFilePicker({
  onAttach,
  busy,
  ar,
}: {
  /** Receives the body to send, already carrying the file text. */
  onAttach: (body: string) => void;
  busy: boolean;
  ar: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<PendingRoomFile[]>([]);
  const [reading, setReading] = useState(false);

  const pick = async (chosen: FileList | null) => {
    if (!chosen || chosen.length === 0) return;
    setReading(true);
    const room = files.length;
    // The count is checked before reading rather than after: five large PDFs would otherwise
    // all be extracted before the fifth was refused.
    const room_ = chosen.length > MAX_ATTACHMENT_COUNT - room ? chosen.length - (MAX_ATTACHMENT_COUNT - room) : chosen.length;
    const accepted = Array.from(chosen).slice(0, Math.max(0, room_));
    const prepared = await prepareRoomFiles(accepted);
    setFiles((current) => [...current, ...prepared].slice(0, MAX_ATTACHMENT_COUNT));
    setReading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const attach = () => {
    const { body } = composeRoomBodyWithFiles("", files);
    if (!body.trim()) return;
    onAttach(body);
    setFiles([]);
  };

  const ready = files.filter((file) => file.status === "ready");
  const failed = files.filter((file) => file.status === "error");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy || reading || files.length >= MAX_ATTACHMENT_COUNT}
          className="inline-flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
          title={ar ? "أرفق ملفا" : "Attach a file"}
        >
          <Paperclip className="size-3.5" aria-hidden />
          <span>{reading ? (ar ? "جار القراءة…" : "Reading…") : ar ? "إرفاق" : "Attach"}</span>
        </button>

        {ready.length > 0 ? (
          <button
            type="button"
            onClick={attach}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {ar ? `أرفق ${ready.length} ملفا` : `Attach ${ready.length} file${ready.length === 1 ? "" : "s"}`}
          </button>
        ) : null}

        {files.length > 0 ? (
          <button
            type="button"
            onClick={() => setFiles([])}
            disabled={busy}
            className="text-xs text-muted-foreground underline disabled:opacity-50"
          >
            {ar ? "مسح" : "Clear"}
          </button>
        ) : null}
      </div>

      {files.length > 0 ? (
        <ul className="space-y-1">
          {files.map((file) => (
            <li
              key={file.id}
              className={`flex items-center gap-2 text-xs ${file.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
            >
              <span className="truncate">{file.name}</span>
              <span className="shrink-0">
                {file.status === "reading"
                  ? ar ? "جار القراءة…" : "Reading…"
                  : file.status === "error"
                    ? file.error
                    : ar ? "جاهز" : "ready"}
              </span>
              <button
                type="button"
                onClick={() => setFiles((current) => current.filter((f) => f.id !== file.id))}
                className="shrink-0 text-muted-foreground underline"
                aria-label={ar ? `إزالة ${file.name}` : `Remove ${file.name}`}
              >
                {ar ? "إزالة" : "remove"}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {failed.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {ar
            ? "الملفات المرفقة نصها فقط والحد ٥ ملفات. ملف بلا نص لا يرفق."
            : "Files are shared as their text, up to five. A file with no readable text is not attached."}
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        // Documents and images only. The accept list is a convenience, not the guard: the
        // server-side and reader-side checks are `attachmentKind`, and a hand-crafted request
        // is refused there regardless of what this attribute says.
        accept=".pdf,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif,.bmp"
        onChange={(event) => void pick(event.target.files)}
      />
    </div>
  );
}

function Paperclip(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden {...props}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

export { attachmentKind, attachmentSizeLimit };
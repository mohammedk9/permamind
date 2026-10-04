/**
 * A file shared into a room, after the browser has read it.
 *
 * ## Why only the text survives
 *
 * The room key lives in the browser and never reaches the server, so a file uploaded as bytes
 * would have to be encrypted client-side and stored somewhere the server cannot read. That is
 * a storage format, a size ceiling, and a second thing to delete when the room closes.
 *
 * Instead the browser reads the file first and **only the extracted text is sent**, inside the
 * same sealed payload as the message. That text is then encrypted and stored exactly like every
 * other room message: a database dump reveals nothing, and the room's deletion removes it with
 * no second sweep to forget.
 *
 * The trade is stated rather than hidden: a PDF, a Word file, a spreadsheet or a photographed
 * page all arrive as their words. A diagram arrives as whatever text was printed on it. That is
 * what a text model can be given, and pretending otherwise would fail at the model.
 *
 * Extraction runs locally — `unpdf`, `mammoth`, and `tesseract.js` — so the document is never
 * uploaded anywhere to be read. A file that is too large, too long, or of a kind we cannot read
 * says so rather than arriving empty.
 */
import {
  attachmentKind,
  attachmentSizeLimit,
  composeMessageContent,
  type AttachmentInput,
} from "@/lib/documents/limits";
import { extractAttachmentText } from "@/lib/documents/extract";

/** A file being read, so the composer can show it and wait for it. */
export interface PendingRoomFile extends AttachmentInput {
  id: string;
  status: "reading" | "ready" | "error";
}

/**
 * Reads a chosen file into text.
 *
 * Rejected for the same reasons the private chat rejects one: an unsupported kind, or a size
 * over the limit. Both are refused here rather than discovered by the model, which would see
 * an empty attachment and answer as though the document had said nothing.
 */
export async function prepareRoomFile(file: File): Promise<PendingRoomFile> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const kind = attachmentKind(file);

  if (kind === "unsupported") {
    return { id, name: file.name, type: file.type, size: file.size, status: "error", error: "Unsupported file type" };
  }
  if (file.size > attachmentSizeLimit(kind)) {
    return { id, name: file.name, type: file.type, size: file.size, status: "error", error: "File exceeds the size limit" };
  }

  try {
    const text = await extractAttachmentText(file);
    if (!text.trim()) {
      // A scanned page with no lettering, or a PDF that is only images. A real outcome, and
      // saying "no text found" is far more useful than attaching an empty document.
      return { id, name: file.name, type: file.type, size: file.size, status: "error", error: "No text found" };
    }
    return {
      id,
      name: file.name,
      type: file.type,
      size: file.size,
      text: text.slice(0, 12_000),
      status: "ready",
    };
  } catch {
    return { id, name: file.name, type: file.type, size: file.size, status: "error", error: "The file could not be read" };
  }
}

/** Reads several at once. Sequentially, because each one spins up an extractor. */
export async function prepareRoomFiles(files: File[]): Promise<PendingRoomFile[]> {
  const out: PendingRoomFile[] = [];
  for (const file of files) {
    out.push(await prepareRoomFile(file));
  }
  return out;
}

/**
 * Folds the prepared files into the message body.
 *
 * The result is one string, which is then sealed as the rest of the message is. The visible
 * `[Attachments: …]` marker goes in as part of the text rather than as a separate column, so
 * a reader can see what was attached without the server holding a list of filenames — the
 * filenames are room content too, and a filename can be a message.
 */
export function composeRoomBodyWithFiles(
  question: string,
  files: PendingRoomFile[],
): { body: string; display: string } {
  const usable = files.filter((file) => file.status === "ready" && file.text);
  const composed = composeMessageContent(
    question,
    usable.map((file) => ({ name: file.name, text: file.text ?? "", truncated: false })),
  );
  return { body: composed.content, display: composed.displayContent };
}
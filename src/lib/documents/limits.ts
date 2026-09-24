export const MAX_ATTACHMENT_COUNT = 5;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENT_TEXT_CHARS = 12_000;
export const MAX_REQUEST_CONTENT_CHARS = 20_000;

export const DOCUMENT_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".csv"] as const;
export const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"] as const;

export interface AttachmentInput {
  name: string;
  type: string;
  size: number;
  text?: string;
  error?: string;
}

export interface PreparedAttachment {
  name: string;
  text: string;
  truncated: boolean;
  error?: string;
}

export interface PreparedMessageContent {
  content: string;
  displayContent: string;
  truncated: boolean;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export function attachmentKind(file: Pick<AttachmentInput, "name" | "type">): "document" | "image" | "unsupported" {
  const extension = extensionOf(file.name);
  if (file.type === "application/pdf" || extension === ".pdf") return "document";
  if (
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === ".docx"
  ) return "document";
  if (file.type.startsWith("text/") || DOCUMENT_EXTENSIONS.includes(extension as typeof DOCUMENT_EXTENSIONS[number])) {
    return "document";
  }
  if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.includes(extension as typeof IMAGE_EXTENSIONS[number])) {
    return "image";
  }
  return "unsupported";
}

export function attachmentSizeLimit(kind: ReturnType<typeof attachmentKind>): number {
  return kind === "image" ? MAX_IMAGE_BYTES : MAX_DOCUMENT_BYTES;
}

export function prepareAttachments(files: AttachmentInput[]): PreparedAttachment[] {
  return files.slice(0, MAX_ATTACHMENT_COUNT).map((file) => {
    const kind = attachmentKind(file);
    if (kind === "unsupported") {
      return { name: file.name, text: "", truncated: false, error: "Unsupported file type" };
    }
    if (file.size > attachmentSizeLimit(kind)) {
      return { name: file.name, text: "", truncated: false, error: "File exceeds the size limit" };
    }
    if (file.error) return { name: file.name, text: "", truncated: false, error: file.error };
    const text = (file.text ?? "").replace(/\u0000/g, "").trim();
    if (!text) return { name: file.name, text: "", truncated: false, error: "No text found" };
    return {
      name: file.name,
      text: text.slice(0, MAX_ATTACHMENT_TEXT_CHARS),
      truncated: text.length > MAX_ATTACHMENT_TEXT_CHARS,
    };
  });
}

export function composeMessageContent(question: string, attachments: PreparedAttachment[]): PreparedMessageContent {
  const cleanQuestion = question.replace(/\u0000/g, "").trim();
  const usable = attachments.filter((item) => item.text);
  const names = attachments.map((item) => item.name);
  const visible = [cleanQuestion, names.length ? `[Attachments: ${names.join(", ")}]` : ""]
    .filter(Boolean)
    .join("\n\n");
  const blocks = usable.map((item) => {
    const note = item.truncated ? " (truncated)" : "";
    return `----- ${item.name}${note} -----\n${item.text}`;
  });
  const attachmentText = blocks.length ? `\n\n[Extracted attachment text]\n${blocks.join("\n\n")}` : "";
  const reserved = Math.min(cleanQuestion.length, MAX_REQUEST_CONTENT_CHARS);
  const room = Math.max(0, MAX_REQUEST_CONTENT_CHARS - reserved - (blocks.length ? 32 : 0));
  const boundedAttachment = attachmentText.slice(0, room);
  const content = `${cleanQuestion}${boundedAttachment}`.trim().slice(0, MAX_REQUEST_CONTENT_CHARS);
  return {
    content,
    displayContent: visible.slice(0, MAX_REQUEST_CONTENT_CHARS),
    truncated: content.length < `${cleanQuestion}${attachmentText}`.trim().length,
  };
}

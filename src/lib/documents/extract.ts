import { extractRawText } from "mammoth";
import { createWorker, type Worker } from "tesseract.js";
import { extractText } from "unpdf";

import { attachmentKind } from "./limits";

export interface TextExtractor {
  extractPdf(data: ArrayBuffer): Promise<string>;
  extractDocx(data: ArrayBuffer): Promise<string>;
  extractPlainText(data: ArrayBuffer): Promise<string>;
  extractImageText(data: Blob, signal?: AbortSignal): Promise<string>;
}

const textDecoder = new TextDecoder("utf-8", { fatal: false });

export const localTextExtractor: TextExtractor = {
  async extractPdf(data) {
    const { text } = await extractText(new Uint8Array(data), { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  },
  async extractDocx(data) {
    const result = await extractRawText({ arrayBuffer: data });
    return result.value;
  },
  async extractPlainText(data) {
    return textDecoder.decode(data);
  },
  async extractImageText(data, signal) {
    if (signal?.aborted) throw new DOMException("OCR cancelled", "AbortError");
    const worker = await createWorker("eng+ara");
    const cancel = () => void worker.terminate();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      if (signal?.aborted) throw new DOMException("OCR cancelled", "AbortError");
      const result = await worker.recognize(data);
      return result.data.text;
    } finally {
      signal?.removeEventListener("abort", cancel);
      await worker.terminate();
    }
  },
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

export async function extractAttachmentText(
  file: File,
  extractor: TextExtractor = localTextExtractor,
  signal?: AbortSignal,
): Promise<string> {
  const kind = attachmentKind(file);
  if (kind === "unsupported") throw new Error("Unsupported file type");
  const data = await file.arrayBuffer();
  if (signal?.aborted) throw new DOMException("Reading cancelled", "AbortError");
  const extension = extensionOf(file.name);
  if (file.type === "application/pdf" || extension === ".pdf") return extractor.extractPdf(data);
  if (extension === ".docx") return extractor.extractDocx(data);
  if (kind === "image") {
    if (signal?.aborted) throw new DOMException("OCR cancelled", "AbortError");
    return extractor.extractImageText(new Blob([data], { type: file.type }), signal);
  }
  return extractor.extractPlainText(data);
}

export type { Worker };

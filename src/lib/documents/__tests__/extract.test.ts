import { describe, expect, it, vi } from "vitest";
import { extractAttachmentText, type TextExtractor } from "../extract";

function file(name: string, type: string, content = "ignored"): File {
  const value = new File([content], name, { type });
  if (typeof value.arrayBuffer !== "function") {
    Object.defineProperty(value, "arrayBuffer", {
      value: async () => new TextEncoder().encode(content).buffer,
    });
  }
  return value;
}

function extractor(overrides: Partial<TextExtractor> = {}): TextExtractor {
  return {
    extractPdf: vi.fn(async () => "pdf text"),
    extractDocx: vi.fn(async () => "docx text"),
    extractPlainText: vi.fn(async () => "plain text"),
    extractImageText: vi.fn(async () => "image text"),
    ...overrides,
  };
}

describe("attachment extraction", () => {
  it("routes PDF, Word, text, and images to their extractors", async () => {
    const fake = extractor();
    await expect(extractAttachmentText(file("a.pdf", "application/pdf"), fake)).resolves.toBe("pdf text");
    await expect(extractAttachmentText(file("a.docx", "application/octet-stream"), fake)).resolves.toBe("docx text");
    await expect(extractAttachmentText(file("a.md", "text/markdown"), fake)).resolves.toBe("plain text");
    await expect(extractAttachmentText(file("a.png", "image/png"), fake)).resolves.toBe("image text");
    expect(fake.extractPdf).toHaveBeenCalledOnce();
    expect(fake.extractDocx).toHaveBeenCalledOnce();
    expect(fake.extractImageText).toHaveBeenCalledOnce();
  });

  it("rejects unsupported files before reading extracted content", async () => {
    const fake = extractor();
    await expect(extractAttachmentText(file("a.exe", "application/octet-stream"), fake)).rejects.toThrow("Unsupported");
    expect(fake.extractPlainText).not.toHaveBeenCalled();
  });

  it("stops image OCR when extraction is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = extractor({
      extractImageText: vi.fn(async (_data, signal) => {
        if (signal?.aborted) throw new DOMException("OCR cancelled", "AbortError");
        return "late text";
      }),
    });
    await expect(extractAttachmentText(file("a.jpg", "image/jpeg"), fake, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

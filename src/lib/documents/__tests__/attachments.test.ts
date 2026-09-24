import { describe, expect, it } from "vitest";
import { composeMessageContent, prepareAttachments } from "../limits";

describe("document attachments", () => {
  it("keeps extracted text and caps each file before composing the request", () => {
    const prepared = prepareAttachments([
      { name: "notes.txt", type: "text/plain", size: 100, text: ` ${"a".repeat(12_100)} ` },
    ]);
    expect(prepared[0]?.text).toHaveLength(12_000);
    expect(prepared[0]?.truncated).toBe(true);

    const message = composeMessageContent("Question", prepared);
    expect(message.content.startsWith("Question")).toBe(true);
    expect(message.content).toContain("----- notes.txt (truncated) -----");
    expect(message.displayContent).toBe("Question\n\n[Attachments: notes.txt]");
  });

  it("rejects unsupported, oversized, and empty files", () => {
    const prepared = prepareAttachments([
      { name: "script.exe", type: "application/octet-stream", size: 10, text: "secret" },
      { name: "large.pdf", type: "application/pdf", size: 6 * 1024 * 1024, text: "too big" },
      { name: "blank.md", type: "text/markdown", size: 0, text: "   " },
    ]);
    expect(prepared.map((item) => item.error)).toEqual([
      "Unsupported file type",
      "File exceeds the size limit",
      "No text found",
    ]);
    expect(composeMessageContent("", prepared).content).toBe("");
  });

  it("preserves the user's question when attachment text reaches the request limit", () => {
    const message = composeMessageContent("Keep me", [
      { name: "report.docx", text: "x".repeat(25_000), truncated: false },
    ]);
    expect(message.content.startsWith("Keep me")).toBe(true);
    expect(message.content.length).toBeLessThanOrEqual(20_000);
    expect(message.truncated).toBe(true);
  });
});

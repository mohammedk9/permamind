import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadBlob, downloadJson } from "../download";

/**
 * The bug these tests guard against: revoking the object URL in the same task as
 * `click()` can cancel the download before the browser has read the blob. The
 * symptom is an export button that intermittently produces no file at all, which
 * is exactly the failure users report as "the export button is broken".
 */
describe("download helpers", () => {
  const created: string[] = [];
  let revokedAt: Array<string | undefined>;
  let clicks: HTMLAnchorElement[];
  let appended: string[];

  beforeEach(() => {
    clicks = [];
    appended = [];
    revokedAt = [];
    created.length = 0;

    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => {
        const url = `blob:mock/${created.length}`;
        created.push(url);
        return url;
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revokedAt.push(url);
      }),
    });

    // Record every anchor click, whether or not it was attached to the document.
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const element = originalCreate(tag, options);
      if (tag === "a") {
        const anchor = element as HTMLAnchorElement;
        anchor.click = vi.fn(() => clicks.push(anchor));
      }
      return element;
    });

    const originalAppend = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, "appendChild").mockImplementation((node) => {
      appended.push((node as Element).tagName);
      return originalAppend(node);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("attaches the anchor to the document so the click is not ignored", () => {
    downloadBlob(new Blob(["x"]), "file.json");

    expect(appended).toContain("A");
    expect(clicks).toHaveLength(1);
  });

  it("sets the requested file name on the anchor", () => {
    downloadBlob(new Blob(["x"]), "permamind-full.json");
    expect(clicks[0].download).toBe("permamind-full.json");
  });

  it("does not revoke the object URL in the same task as the click", () => {
    downloadBlob(new Blob(["x"]), "file.json");

    // The URL is still live at the moment the browser receives the click; this is
    // the assertion that fails against the old three-liner.
    expect(revokedAt).toEqual([]);
  });

  it("revokes the URL on a later task and then releases it", () => {
    vi.useFakeTimers();
    try {
      downloadBlob(new Blob(["x"]), "file.json");
      expect(revokedAt).toEqual([]);

      vi.runAllTimers();
      expect(revokedAt).toEqual([created[0]]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no anchor behind in the document", () => {
    downloadBlob(new Blob(["x"]), "file.json");
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("downloads JSON values as pretty-printed application/json", () => {
    downloadJson({ hello: "world" }, "data.json");
    expect(clicks).toHaveLength(1);
    expect(clicks[0].download).toBe("data.json");
  });

  it("gives each export its own URL, so two exports never share a blob", () => {
    // The MCP panel fires two downloads back to back from one click.
    downloadJson({ a: 1 }, "a.json");
    downloadJson({ b: 2 }, "b.json");

    expect(created).toHaveLength(2);
    expect(clicks.map((anchor) => anchor.download)).toEqual(["a.json", "b.json"]);
  });
});

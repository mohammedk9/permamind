/**
 * Browser download helper.
 *
 * Every export in the app goes through here, because the obvious three-liner is
 * silently unreliable:
 *
 *   const url = URL.createObjectURL(blob);
 *   link.click();
 *   URL.revokeObjectURL(url);          // <-- cancels the download
 *
 * Revoking in the same task as `click()` tears the blob down before the browser
 * has finished reading it. Chrome usually wins that race, but other engines
 * deliver nothing, so the button reads as broken rather than flaky. The URL is
 * therefore revoked on a later task, once the download has been handed off.
 *
 * The anchor is attached to the document for the duration of the click and then
 * removed. A detached anchor works in current browsers, but attaching it matches
 * the behaviour the spec describes and costs nothing.
 */

/** Milliseconds to wait before releasing the object URL. */
const REVOKE_DELAY_MS = 1000;

export function downloadBlob(blob: Blob, fileName: string): void {
  if (typeof document === "undefined") return;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Downloads any JSON-serialisable value.
 *
 * Used by the MCP and project exports, which build plain objects rather than
 * Blobs and were repeating the same unsafe revoke-by-hand.
 */
export function downloadJson(value: unknown, fileName: string): void {
  downloadBlob(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    fileName,
  );
}

import { describe, expect, it, vi } from "vitest";
import { readBodyWithLimit } from "../upload/route";

describe("snapshot upload body limit", () => {
  it("cancels the stream as soon as the byte limit is exceeded", async () => {
    const cancel = vi.fn(async () => undefined);
    let reads = 0;
    const reader = {
      read: vi.fn(async () => {
        reads += 1;
        return { done: false, value: new Uint8Array([1, 2, 3]) };
      }),
      releaseLock: vi.fn(),
      cancel,
    };
    const request = { body: { getReader: () => reader } } as unknown as Request;

    await expect(readBodyWithLimit(request, 5)).resolves.toBeNull();
    expect(reads).toBe(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });

  it("returns the complete body when it stays within the limit", async () => {
    const request = new Request("https://example.test/upload", { method: "POST", body: "{\"ok\":true}" });
    await expect(readBodyWithLimit(request, 20)).resolves.toBe("{\"ok\":true}");
  });
});

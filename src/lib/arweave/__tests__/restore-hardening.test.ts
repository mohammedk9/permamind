import { beforeEach, describe, expect, it, vi } from "vitest";

const { registry, saveChatData, payload } = vi.hoisted(() => ({
  registry: { snapshots: [{ version: 1, epoch: 1, type: "full", parentVersion: null, parentTxId: null, createdAt: "2026-01-01T00:00:00.000Z", contentHash: "a".repeat(64), conversationIds: [], messageCount: 0, compressedSize: 0, encryptedSize: 0, txId: "tx" }] },
  saveChatData: vi.fn(),
  payload: { value: { version: 1, epoch: 1, type: "full", createdAt: "2026-01-01T00:00:00.000Z", conversations: [], deletions: [] } as unknown },
}));
vi.mock("@/lib/storage/chat-storage", () => ({ saveChatData }));
vi.mock("../snapshot-registry", () => ({ loadRegistry: () => registry, validateSnapshotChain: vi.fn() }));
vi.mock("../encryption", () => ({ deriveKey: vi.fn(), decrypt: vi.fn(async () => new Uint8Array([1])) }));
vi.mock("../compression", () => ({ decompress: vi.fn(async () => new TextEncoder().encode(JSON.stringify(payload.value))), bytesToJson: <T>(bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)) as T }));
vi.mock("../dedup", () => ({ canonicalJSON: (value: unknown) => JSON.stringify(value), computeContentHash: vi.fn(async () => "a".repeat(64)) }));

import { previewSnapshotByTxId, restoreLatestSnapshot } from "../restore";
import { MAX_ENCRYPTED_PAYLOAD_BYTES } from "../constants";

describe("restore hardening", () => {
  beforeEach(() => { saveChatData.mockClear(); });

  it("rejects invalid ISO dates before replacing local data", async () => {
    payload.value = { version: 1, epoch: 1, type: "full", createdAt: "not-a-date", conversations: [], deletions: [] };
    const result = await restoreLatestSnapshot({ passphrase: "pass", confirm: true, fetcher: async () => new Response(JSON.stringify({ iv: "", salt: "", ciphertext: "AA==" }), { status: 200 }) });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("invalid payload date");
    expect(saveChatData).not.toHaveBeenCalled();
    payload.value = { version: 1, epoch: 1, type: "full", createdAt: "2026-01-01T00:00:00.000Z", conversations: [], deletions: [] };
  });

  it("rejects malformed encrypted snapshots without replacing local data", async () => {
    const result = await restoreLatestSnapshot({ passphrase: "pass", confirm: true, fetcher: async () => new Response(JSON.stringify({ nope: true }), { status: 200 }) });
    expect(result.status).toBe("failed");
    expect(saveChatData).not.toHaveBeenCalled();
  });

  it("rejects oversized encrypted payloads before decryption", async () => {
    const result = await restoreLatestSnapshot({ passphrase: "pass", confirm: true, fetcher: async () => new Response(JSON.stringify({ iv: "", salt: "", ciphertext: "A".repeat(Math.ceil(MAX_ENCRYPTED_PAYLOAD_BYTES * 4 / 3) + 4) }), { status: 200 }) });
    expect(result.status).toBe("failed");
    expect(result.error).toContain("encrypted payload exceeds");
    expect(saveChatData).not.toHaveBeenCalled();
  });

  it("rejects an invalid transaction id before downloading", async () => {
    const fetcher = vi.fn();
    await expect(previewSnapshotByTxId({ txId: "wrong-id", passphrase: "pass", fetcher })).rejects.toThrow("invalid Arweave transaction ID");
    expect(fetcher).not.toHaveBeenCalled();
    expect(saveChatData).not.toHaveBeenCalled();
  });

  it("does not write local data when the downloaded snapshot is modified", async () => {
    payload.value = { version: 1, epoch: 1, type: "full", createdAt: "2026-01-01T00:00:00.000Z", conversations: [], deletions: [] };
    const fetcher = async (input: RequestInfo | URL) => input.toString().includes("/tx/")
      ? new Response(JSON.stringify({ tags: [
        { name: "App-Name", value: "PermaMind" }, { name: "Snapshot-Version", value: "1" },
        { name: "Snapshot-Epoch", value: "1" }, { name: "Snapshot-Type", value: "full" },
        { name: "Content-Hash", value: "different" },
      ] }), { status: 200 })
      : new Response(JSON.stringify({ iv: "", salt: "", ciphertext: "AA==" }), { status: 200 });
    await expect(previewSnapshotByTxId({ txId: "A".repeat(43), passphrase: "pass", fetcher })).rejects.toThrow();
    expect(saveChatData).not.toHaveBeenCalled();
  });

  it("does not write local data during a successful preview", async () => {
    const fetcher = async (input: RequestInfo | URL) => input.toString().includes("/tx/")
      ? new Response(JSON.stringify({ tags: [
        { name: "App-Name", value: "PermaMind" }, { name: "Snapshot-Version", value: "1" },
        { name: "Snapshot-Epoch", value: "1" }, { name: "Snapshot-Type", value: "full" },
        { name: "Content-Hash", value: "a".repeat(64) },
      ] }), { status: 200 })
      : new Response(JSON.stringify({ iv: "", salt: "", ciphertext: "AA==" }), { status: 200 });
    const preview = await previewSnapshotByTxId({ txId: "A".repeat(43), passphrase: "pass", fetcher });
    expect(preview.conversations).toHaveLength(0);
    expect(saveChatData).not.toHaveBeenCalled();
  });
});
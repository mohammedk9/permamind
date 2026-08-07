import { beforeEach, describe, expect, it, vi } from "vitest";

const { registry, saveChatData, payload } = vi.hoisted(() => ({
  registry: { snapshots: [{ version: 1, epoch: 1, type: "full", parentVersion: null, parentTxId: null, createdAt: "2026-01-01T00:00:00.000Z", contentHash: "hash", conversationIds: [], messageCount: 0, compressedSize: 0, encryptedSize: 0, txId: "tx" }] },
  saveChatData: vi.fn(),
  payload: { value: { version: 1, epoch: 1, type: "full", createdAt: "2026-01-01T00:00:00.000Z", conversations: [], deletions: [] } as unknown },
}));
vi.mock("@/lib/storage/chat-storage", () => ({ saveChatData }));
vi.mock("../snapshot-registry", () => ({ loadRegistry: () => registry, validateSnapshotChain: vi.fn() }));
vi.mock("../encryption", () => ({ deriveKey: vi.fn(), decrypt: vi.fn(async () => new Uint8Array([1])) }));
vi.mock("../compression", () => ({ decompress: vi.fn(async () => new TextEncoder().encode(JSON.stringify(payload.value))), bytesToJson: <T>(bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)) as T }));
vi.mock("../dedup", () => ({ canonicalJSON: (value: unknown) => JSON.stringify(value), computeContentHash: vi.fn(async () => "hash") }));

import { restoreLatestSnapshot } from "../restore";
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
});
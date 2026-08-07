import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "@/types/chat";
import type { JWKInterface } from "arweave/node/lib/wallet";
import type { QueueItem, SnapshotMeta } from "../snapshot-types";

const { uploadedTxId, createTransactionMock, uploadTransactionMock, fetchMock } = vi.hoisted(() => {
  const txId = "integration-tx-id";
  return {
    uploadedTxId: txId,
    createTransactionMock: vi.fn(async (data: Uint8Array) => ({
      transaction: { id: txId, data },
      txId,
    })),
    uploadTransactionMock: vi.fn(async () => txId),
    fetchMock: vi.fn(async () => new Response(JSON.stringify({ txId }), { status: 200 })),
  };
});

vi.mock("../arweave-client", () => ({
  buildTags: vi.fn(() => [{ name: "Test", value: "integration" }]),
  createTransaction: createTransactionMock,
  uploadTransaction: uploadTransactionMock,
}));

import { runSnapshotPipeline } from "../pipeline";
import { startProcessor, stopProcessor } from "../queue-processor";
import { getQueueStatus } from "../upload-queue";
import { loadRegistry } from "../snapshot-registry";
import { restoreLatestSnapshot } from "../restore";
import { loadChatData } from "@/lib/storage/chat-storage";

const storage = (() => {
  let values: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => values[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { values[key] = value; }),
    removeItem: vi.fn((key: string) => { delete values[key]; }),
    clear: vi.fn(() => { values = {}; }),
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
vi.stubGlobal("fetch", fetchMock);

function conversation(): Conversation {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: "conversation-1",
    title: "Integration conversation",
    messages: [
      { id: "message-1", role: "user", content: "Remember this", createdAt },
      { id: "message-2", role: "assistant", content: "I will remember it", createdAt },
    ],
    createdAt,
    updatedAt: createdAt,
  };
}

describe("Arweave pipeline integration", () => {
  beforeEach(() => {
    stopProcessor();
    storage.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("creates, queues, uploads, registers, downloads, and restores a snapshot", async () => {
    const passphrase = "integration-passphrase";
    const source = [conversation()];

    // Snapshot creation includes compression, encryption, queue persistence, and registry metadata.
    const pipelineResult = await runSnapshotPipeline(source, passphrase, {});
    expect(pipelineResult).toMatchObject({ status: "queued", snapshotVersion: 1, txId: null });

    const queued = JSON.parse(storage.getItem("permamind:upload:queue:v1")!).items as QueueItem[];
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ snapshotVersion: 1, status: "pending", attempts: 0 });
    const encryptedEnvelope = JSON.parse(queued[0].encryptedPayload);

    const registryBeforeUpload = loadRegistry();
    expect(registryBeforeUpload.snapshots).toHaveLength(1);
    expect(registryBeforeUpload.snapshots[0]).toMatchObject({ version: 1, type: "full", txId: null });

    // Queue processing is deterministic: Arweave transaction creation/upload are mocked.
    startProcessor({} as JWKInterface, passphrase);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledOnce();
    const requestInit = (fetchMock.mock.calls[0] as unknown as [string, { body?: string }])[1];
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      encryptedPayload: queued[0].encryptedPayload,
    });
    expect(getQueueStatus().total).toBe(0);
    expect(loadRegistry().snapshots[0].txId).toBe(uploadedTxId);

    // The mock gateway returns the encrypted object persisted by the queue, as Arweave would.
    const fetcher = vi.fn(async () => new Response(JSON.stringify(encryptedEnvelope), { status: 200 }));
    const restoreResult = await restoreLatestSnapshot({
      passphrase,
      confirm: true,
      fetcher,
      gateway: "https://mock.arweave.test",
    });

    expect(fetcher).toHaveBeenCalledWith(`https://mock.arweave.test/${uploadedTxId}/data`);
    expect(restoreResult).toMatchObject({ status: "restored", conversationCount: 1, snapshotVersion: 1 });
    expect(loadChatData().conversations).toEqual(source);
  });

  it("does not replace chat data when restore confirmation is declined", async () => {
    const passphrase = "integration-passphrase";
    await runSnapshotPipeline([conversation()], passphrase, {});
    const queued = JSON.parse(storage.getItem("permamind:upload:queue:v1")!).items as QueueItem[];
    const meta = loadRegistry().snapshots[0] as SnapshotMeta;
    meta.txId = uploadedTxId;
    storage.setItem("permamind:snapshots:meta:v1", JSON.stringify({ version: 1, snapshots: [meta] }));
    storage.setItem("permamind:chat:v1", JSON.stringify({ version: 1, conversations: [], activeId: null }));

    const result = await restoreLatestSnapshot({
      passphrase,
      confirm: false,
      fetcher: async () => new Response(queued[0].encryptedPayload, { status: 200 }),
    });

    expect(result.status).toBe("cancelled");
    expect(loadChatData().conversations).toHaveLength(0);
  });

  it("does not retry an upload when completion is ambiguous", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ txId: uploadedTxId }), { status: 200 }));
    const result = await runSnapshotPipeline([conversation()], "integration-passphrase", {});
    expect(result.status).toBe("queued");

    startProcessor({} as JWKInterface, "integration-passphrase");
    await vi.advanceTimersByTimeAsync(1000);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getQueueStatus().total).toBe(0);
    expect(loadRegistry().snapshots[0].txId).toBe(uploadedTxId);
  });
});
import { describe, expect, it } from "vitest";
import { validateDurableQueueInput } from "../durable-queue";
import type { SnapshotMeta } from "../snapshot-types";

const metadata = {
  version: 1,
  epoch: 1,
  type: "full",
  parentVersion: null,
  parentTxId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  contentHash: "a".repeat(64),
  conversationIds: ["conversation-1"],
  messageCount: 1,
  compressedSize: 10,
  encryptedSize: 20,
  txId: null,
} satisfies SnapshotMeta;

describe("durable queue validation", () => {
  it("accepts an encrypted envelope and rejects plaintext fields", () => {
    const valid = validateDurableQueueInput({
      id: "11111111-1111-4111-8111-111111111111",
      contentHash: metadata.contentHash,
      snapshotVersion: 1,
      ciphertext: JSON.stringify({ iv: "aXY=", ciphertext: "Y2lwaGVy", salt: "c2FsdA==" }),
      metadata,
    });
    expect(valid).toBeNull();

    const plaintext = validateDurableQueueInput({
      id: "11111111-1111-4111-8111-111111111111",
      contentHash: metadata.contentHash,
      snapshotVersion: 1,
      ciphertext: JSON.stringify({ conversations: [], messages: [] }),
      metadata,
    });
    expect(plaintext).toMatch(/envelope/);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildSnapshot } from "../snapshot-builder";
import type { Conversation } from "@/types/chat";
import type { SnapshotRegistry } from "../snapshot-types";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
});

describe("snapshot-builder", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  const createConversation = (
    id: string,
    messages: Array<{ id: string; role: "user" | "assistant"; content: string }>
  ): Conversation => ({
    id,
    title: `Conversation ${id}`,
    messages: messages.map((m) => ({
      ...m,
      createdAt: new Date(),
    })),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  describe("buildSnapshot", () => {
    it("should return null when no conversations exist", async () => {
      const conversations: Conversation[] = [];
      const registry: SnapshotRegistry = { version: 1, snapshots: [] };

      const result = await buildSnapshot(conversations, registry);

      expect(result).toBeNull();
    });

    it("should build a full snapshot for first run", async () => {
      const conversations = [
        createConversation("conv1", [
          { id: "msg1", role: "user", content: "Hello" },
          { id: "msg2", role: "assistant", content: "Hi there" },
        ]),
      ];
      const registry: SnapshotRegistry = { version: 1, snapshots: [] };

      const result = await buildSnapshot(conversations, registry);

      expect(result).not.toBeNull();
      expect(result?.meta.type).toBe("full");
      expect(result?.meta.version).toBe(1);
      expect(result?.meta.epoch).toBe(1);
      expect(result?.payload.conversations).toHaveLength(1);
      expect(result?.payload.conversations[0].id).toBe("conv1");
    });

    it("should detect new conversations", async () => {
      // First snapshot
      const conv1 = createConversation("conv1", [
        { id: "msg1", role: "user", content: "Hello" },
      ]);
      const registry1: SnapshotRegistry = { version: 1, snapshots: [] };
      await buildSnapshot([conv1], registry1);

      // Add a new conversation
      const conv2 = createConversation("conv2", [
        { id: "msg2", role: "user", content: "New conversation" },
      ]);
      const registry2: SnapshotRegistry = {
        version: 1,
        snapshots: [
          {
            version: 1,
            epoch: 1,
            type: "full",
            parentVersion: null,
            parentTxId: null,
            createdAt: new Date().toISOString(),
            contentHash: "hash1",
            conversationIds: ["conv1"],
            messageCount: 1,
            compressedSize: 100,
            encryptedSize: 150,
            txId: "tx1",
          },
        ],
      };

      const result = await buildSnapshot([conv1, conv2], registry2);

      expect(result).not.toBeNull();
      expect(result?.meta.type).toBe("delta");
      expect(result?.payload.conversations).toHaveLength(1);
      expect(result?.payload.conversations[0].id).toBe("conv2");
    });

    it("should detect modified conversations", async () => {
      // First snapshot
      const conv1 = createConversation("conv1", [
        { id: "msg1", role: "user", content: "Hello" },
      ]);
      const registry1: SnapshotRegistry = { version: 1, snapshots: [] };
      await buildSnapshot([conv1], registry1);

      // Modify the conversation
      const conv1Modified = createConversation("conv1", [
        { id: "msg1", role: "user", content: "Hello" },
        { id: "msg2", role: "assistant", content: "Hi" },
        { id: "msg3", role: "user", content: "How are you?" },
      ]);
      const registry2: SnapshotRegistry = {
        version: 1,
        snapshots: [
          {
            version: 1,
            epoch: 1,
            type: "full",
            parentVersion: null,
            parentTxId: null,
            createdAt: new Date().toISOString(),
            contentHash: "hash1",
            conversationIds: ["conv1"],
            messageCount: 1,
            compressedSize: 100,
            encryptedSize: 150,
            txId: "tx1",
          },
        ],
      };

      const result = await buildSnapshot([conv1Modified], registry2);

      expect(result).not.toBeNull();
      expect(result?.meta.type).toBe("delta");
      expect(result?.payload.conversations).toHaveLength(1);
      expect(result?.payload.conversations[0].messages).toHaveLength(3);
    });

    it("should detect deleted conversations", async () => {
      // First snapshot with two conversations
      const conv1 = createConversation("conv1", [
        { id: "msg1", role: "user", content: "Hello" },
      ]);
      const conv2 = createConversation("conv2", [
        { id: "msg2", role: "user", content: "World" },
      ]);
      const registry1: SnapshotRegistry = { version: 1, snapshots: [] };
      await buildSnapshot([conv1, conv2], registry1);

      // Delete conv2
      const registry2: SnapshotRegistry = {
        version: 1,
        snapshots: [
          {
            version: 1,
            epoch: 1,
            type: "full",
            parentVersion: null,
            parentTxId: null,
            createdAt: new Date().toISOString(),
            contentHash: "hash1",
            conversationIds: ["conv1", "conv2"],
            messageCount: 2,
            compressedSize: 100,
            encryptedSize: 150,
            txId: "tx1",
          },
        ],
      };

      const result = await buildSnapshot([conv1], registry2);

      expect(result).not.toBeNull();
      expect(result?.meta.type).toBe("delta");
      expect(result?.payload.deletions).toHaveLength(1);
      expect(result?.payload.deletions[0].conversationId).toBe("conv2");
    });

    it("should return null when no changes detected", async () => {
      const conv1 = createConversation("conv1", [
        { id: "msg1", role: "user", content: "Hello" },
      ]);
      const registry1: SnapshotRegistry = { version: 1, snapshots: [] };
      await buildSnapshot([conv1], registry1);

      // Try to build again with same data
      const registry2: SnapshotRegistry = {
        version: 1,
        snapshots: [
          {
            version: 1,
            epoch: 1,
            type: "full",
            parentVersion: null,
            parentTxId: null,
            createdAt: new Date().toISOString(),
            contentHash: "hash1",
            conversationIds: ["conv1"],
            messageCount: 1,
            compressedSize: 100,
            encryptedSize: 150,
            txId: "tx1",
          },
        ],
      };

      const result = await buildSnapshot([conv1], registry2);

      expect(result).toBeNull();
    });

    it("should handle empty conversations (no messages)", async () => {
      const conv1 = createConversation("conv1", []);
      const registry: SnapshotRegistry = { version: 1, snapshots: [] };

      const result = await buildSnapshot([conv1], registry);

      // Empty conversations should still be included
      expect(result).not.toBeNull();
      expect(result?.payload.conversations).toHaveLength(1);
      expect(result?.payload.conversations[0].messages).toHaveLength(0);
    });

    it("should increment version numbers correctly", async () => {
      const conv1 = createConversation("conv1", [
        { id: "msg1", role: "user", content: "Hello" },
      ]);
      const registry1: SnapshotRegistry = { version: 1, snapshots: [] };
      const result1 = await buildSnapshot([conv1], registry1);
      expect(result1?.meta.version).toBe(1);

      // Second snapshot
      const conv1Modified = createConversation("conv1", [
        { id: "msg1", role: "user", content: "Hello" },
        { id: "msg2", role: "assistant", content: "Hi" },
      ]);
      const registry2: SnapshotRegistry = {
        version: 1,
        snapshots: [
          {
            version: 1,
            epoch: 1,
            type: "full",
            parentVersion: null,
            parentTxId: null,
            createdAt: new Date().toISOString(),
            contentHash: "hash1",
            conversationIds: ["conv1"],
            messageCount: 1,
            compressedSize: 100,
            encryptedSize: 150,
            txId: "tx1",
          },
        ],
      };

      const result2 = await buildSnapshot([conv1Modified], registry2);
      expect(result2?.meta.version).toBe(2);
    });

    it("should set parent version correctly", async () => {
      const conv1 = createConversation("conv1", [
        { id: "msg1", role: "user", content: "Hello" },
      ]);
      const registry1: SnapshotRegistry = { version: 1, snapshots: [] };
      const result1 = await buildSnapshot([conv1], registry1);
      expect(result1?.meta.parentVersion).toBeNull();

      // Second snapshot
      const conv1Modified = createConversation("conv1", [
        { id: "msg1", role: "user", content: "Hello" },
        { id: "msg2", role: "assistant", content: "Hi" },
      ]);
      const registry2: SnapshotRegistry = {
        version: 1,
        snapshots: [
          {
            version: 1,
            epoch: 1,
            type: "full",
            parentVersion: null,
            parentTxId: "tx1",
            createdAt: new Date().toISOString(),
            contentHash: "hash1",
            conversationIds: ["conv1"],
            messageCount: 1,
            compressedSize: 100,
            encryptedSize: 150,
            txId: "tx1",
          },
        ],
      };

      const result2 = await buildSnapshot([conv1Modified], registry2);
      expect(result2?.meta.parentVersion).toBe(1);
      expect(result2?.meta.parentTxId).toBe("tx1");
    });
  });
});
import { describe, it, expect, beforeEach, vi } from "vitest";
import { runSnapshotPipeline } from "../pipeline";
import type { Conversation } from "@/types/chat";
import { DEDUP_REGISTRY_KEY, SNAPSHOT_REGISTRY_KEY, UPLOAD_QUEUE_KEY } from "../constants";

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

// Mock crypto.subtle for jsdom environment
const mockSubtle = {
  digest: vi.fn(async (_algorithm: string, data: ArrayBuffer) => {
    const bytes = new Uint8Array(data);
    const hash = new Uint8Array(32);
    bytes.forEach((byte, index) => {
      hash[index % 32] = (hash[index % 32] + byte + index) % 256;
    });
    return hash.buffer;
  }),
  importKey: vi.fn(async () => ({} as CryptoKey)),
  deriveKey: vi.fn(async () => ({} as CryptoKey)),
  encrypt: vi.fn(async () => new Uint8Array(100).buffer),
  decrypt: vi.fn(async () => new Uint8Array(50).buffer),
};

Object.defineProperty(global, "crypto", {
  value: {
    subtle: mockSubtle,
    getRandomValues: vi.fn((arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 256);
      }
      return arr;
    }),
    randomUUID: vi.fn(() => "mock-uuid-" + Math.random()),
  },
});

describe("pipeline", () => {
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

  describe("runSnapshotPipeline", () => {
    it("should return skipped-no-changes when no conversations exist", async () => {
      const conversations: Conversation[] = [];
      const passphrase = "test-passphrase";
      const walletKey = {};

      const result = await runSnapshotPipeline(conversations, passphrase, walletKey);

      expect(result.status).toBe("skipped-no-changes");
      expect(result.snapshotVersion).toBeNull();
      expect(result.txId).toBeNull();
    });

    it("should queue a snapshot when conversations exist", async () => {
      const conversations = [
        createConversation("conv1", [
          { id: "msg1", role: "user", content: "Hello" },
          { id: "msg2", role: "assistant", content: "Hi there" },
        ]),
      ];
      const passphrase = "test-passphrase";
      const walletKey = {};

      const result = await runSnapshotPipeline(conversations, passphrase, walletKey);

      expect(result.status).toBe("queued");
      expect(result.snapshotVersion).toBe(1);
      expect(result.txId).toBeNull(); // txId is set by queue processor, not pipeline
      expect(result.error).toBeNull();

      const dedup = JSON.parse(localStorage.getItem(DEDUP_REGISTRY_KEY)!);
      const registry = JSON.parse(localStorage.getItem(SNAPSHOT_REGISTRY_KEY)!);
      const queue = JSON.parse(localStorage.getItem(UPLOAD_QUEUE_KEY)!);
      expect(dedup.entries).toHaveLength(1);
      expect(dedup.entries[0]).toMatchObject({ snapshotVersion: 1, txId: null });
      expect(registry.snapshots).toHaveLength(1);
      expect(queue.items).toHaveLength(1);
    });

    it("should handle multiple conversations", async () => {
      const conversations = [
        createConversation("conv1", [
          { id: "msg1", role: "user", content: "Hello" },
        ]),
        createConversation("conv2", [
          { id: "msg2", role: "user", content: "World" },
        ]),
        createConversation("conv3", [
          { id: "msg3", role: "user", content: "Test" },
        ]),
      ];
      const passphrase = "test-passphrase";
      const walletKey = {};

      const result = await runSnapshotPipeline(conversations, passphrase, walletKey);

      expect(result.status).toBe("queued");
      expect(result.snapshotVersion).toBe(1);
    });

    it("should return skipped-no-changes on second run with same data", async () => {
      const conversations = [
        createConversation("conv1", [
          { id: "msg1", role: "user", content: "Hello" },
        ]),
      ];
      const passphrase = "test-passphrase";
      const walletKey = {};

      // First run
      const result1 = await runSnapshotPipeline(conversations, passphrase, walletKey);
      expect(result1.status).toBe("queued");

      // Second run with same data
      const result2 = await runSnapshotPipeline(conversations, passphrase, walletKey);
      expect(result2.status).toBe("skipped-no-changes");
    });

    it("should queue a new snapshot when conversation is modified", async () => {
      const conv1 = createConversation("conv1", [
        { id: "msg1", role: "user", content: "Hello" },
      ]);
      const passphrase = "test-passphrase";
      const walletKey = {};

      // First run
      const result1 = await runSnapshotPipeline([conv1], passphrase, walletKey);
      expect(result1.status).toBe("queued");
      expect(result1.snapshotVersion).toBe(1);

      // Modify conversation
      const conv1Modified = createConversation("conv1", [
        { id: "msg1", role: "user", content: "Hello" },
        { id: "msg2", role: "assistant", content: "Hi" },
      ]);

      // Second run with modified data
      const result2 = await runSnapshotPipeline([conv1Modified], passphrase, walletKey);
      expect(result2.status).toBe("queued");
      expect(result2.snapshotVersion).toBe(2);
    });

    it("should handle empty passphrase gracefully", async () => {
      const conversations = [
        createConversation("conv1", [
          { id: "msg1", role: "user", content: "Hello" },
        ]),
      ];
      const passphrase = "";
      const walletKey = {};

      const result = await runSnapshotPipeline(conversations, passphrase, walletKey);

      // Should still queue (encryption will use empty passphrase)
      expect(result.status).toBe("queued");
    });

    it("should handle null walletKey", async () => {
      const conversations = [
        createConversation("conv1", [
          { id: "msg1", role: "user", content: "Hello" },
        ]),
      ];
      const passphrase = "test-passphrase";
      const walletKey = null;

      const result = await runSnapshotPipeline(conversations, passphrase, walletKey);

      // Should still queue (walletKey is not used in pipeline, only in queue processor)
      expect(result.status).toBe("queued");
    });

    it("should increment version numbers across multiple runs", async () => {
      const passphrase = "test-passphrase";
      const walletKey = {};

      // Run 1
      const conv1 = createConversation("conv1", [
        { id: "msg1", role: "user", content: "Hello" },
      ]);
      const result1 = await runSnapshotPipeline([conv1], passphrase, walletKey);
      expect(result1.snapshotVersion).toBe(1);

      // Run 2 - add new conversation
      const conv2 = createConversation("conv2", [
        { id: "msg2", role: "user", content: "World" },
      ]);
      const result2 = await runSnapshotPipeline([conv1, conv2], passphrase, walletKey);
      expect(result2.snapshotVersion).toBe(2);

      // Run 3 - modify conversation
      const conv1Modified = createConversation("conv1", [
        { id: "msg1", role: "user", content: "Hello" },
        { id: "msg3", role: "assistant", content: "Hi" },
      ]);
      const result3 = await runSnapshotPipeline([conv1Modified, conv2], passphrase, walletKey);
      expect(result3.snapshotVersion).toBe(3);
    });

    it("should handle conversations with metadata", async () => {
      const conversations: Conversation[] = [
        {
          id: "conv1",
          title: "Test Conversation",
          messages: [
            { id: "msg1", role: "user", content: "Hello", createdAt: new Date() },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            summary: "A test conversation",
            topics: ["testing"],
            tags: ["test"],
            entities: ["user"],
            messageFingerprint: "fp1",
            generatedAt: new Date(),
          },
        },
      ];
      const passphrase = "test-passphrase";
      const walletKey = {};

      const result = await runSnapshotPipeline(conversations, passphrase, walletKey);

      expect(result.status).toBe("queued");
      expect(result.snapshotVersion).toBe(1);
    });
  });
});
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  enqueue,
  dequeue,
  peek,
  updateStatus,
  recordFailedAttempt,
  resetStaleUploading,
  coalesceSuperseded,
  clearCompleted,
  getQueueStatus,
} from "../upload-queue";
import type { QueueItem } from "../snapshot-types";

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

describe("upload-queue", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  const createQueueItem = (overrides: Partial<QueueItem> = {}): QueueItem => ({
    queueId: `queue-${Date.now()}-${Math.random()}`,
    snapshotVersion: 1,
    snapshotHash: "hash123",
    encryptedPayload: "encrypted-data",
    status: "pending",
    attempts: 0,
    maxAttempts: 5,
    nextRetryAt: null,
    createdAt: new Date().toISOString(),
    txId: null,
    ...overrides,
  });

  describe("enqueue / dequeue", () => {
    it("should enqueue and dequeue items in FIFO order", () => {
      const item1 = createQueueItem({ queueId: "item1" });
      const item2 = createQueueItem({ queueId: "item2" });
      const item3 = createQueueItem({ queueId: "item3" });

      enqueue(item1);
      enqueue(item2);
      enqueue(item3);

      const dequeued1 = dequeue();
      expect(dequeued1?.queueId).toBe("item1");

      const dequeued2 = dequeue();
      expect(dequeued2?.queueId).toBe("item2");

      const dequeued3 = dequeue();
      expect(dequeued3?.queueId).toBe("item3");
    });

    it("should return null when queue is empty", () => {
      const result = dequeue();
      expect(result).toBeNull();
    });

    it("should mark dequeued item as uploading", () => {
      const item = createQueueItem();
      enqueue(item);

      const dequeued = dequeue();
      expect(dequeued?.status).toBe("uploading");
    });

    it("should keep an uploading item persisted until the upload succeeds", () => {
      const item = createQueueItem({ queueId: "item1" });
      enqueue(item);

      expect(dequeue()?.queueId).toBe("item1");
      expect(getQueueStatus().uploading).toBe(1);

      // A new queue read (simulating a browser restart) still sees the item.
      expect(getQueueStatus().total).toBe(1);
      updateStatus("item1", "done", "tx123");
      expect(getQueueStatus().total).toBe(0);
    });
  });

  describe("peek", () => {
    it("should return next item without removing it", () => {
      const item = createQueueItem({ queueId: "item1" });
      enqueue(item);

      const peeked = peek();
      expect(peeked?.queueId).toBe("item1");

      // Item should still be in queue
      const dequeued = dequeue();
      expect(dequeued?.queueId).toBe("item1");
    });

    it("should return null when queue is empty", () => {
      const result = peek();
      expect(result).toBeNull();
    });
  });

  describe("updateStatus", () => {
    it("should update item status to done and remove from queue", () => {
      const item = createQueueItem({ queueId: "item1" });
      enqueue(item);

      updateStatus("item1", "done", "tx123");

      const status = getQueueStatus();
      expect(status.total).toBe(0);
    });

    it("should update item status to failed when max attempts reached", () => {
      const item = createQueueItem({ queueId: "item1", attempts: 5, maxAttempts: 5 });
      enqueue(item);

      updateStatus("item1", "failed");

      const status = getQueueStatus();
      expect(status.failed).toBe(1);
    });

    it("should schedule retry when failed but attempts remain", () => {
      const item = createQueueItem({ queueId: "item1", attempts: 2, maxAttempts: 5 });
      enqueue(item);

      updateStatus("item1", "failed");

      const status = getQueueStatus();
      // Should be pending (scheduled for retry), not failed
      expect(status.pending).toBe(1);
      expect(status.failed).toBe(0);
    });

    it("should schedule retry with backoff when status is pending", () => {
      const item = createQueueItem({ queueId: "item1", attempts: 1 });
      enqueue(item);

      updateStatus("item1", "pending");

      // Item should still be in queue with nextRetryAt set
      const peeked = peek();
      expect(peeked).toBeNull(); // Not ready yet due to backoff
    });
  });

  describe("recordFailedAttempt", () => {
    it("should increment attempts and schedule retry", () => {
      const item = createQueueItem({ queueId: "item1", attempts: 0 });
      enqueue(item);

      recordFailedAttempt("item1");

      const status = getQueueStatus();
      expect(status.pending).toBe(1);
    });

    it("should leave a failed upload retryable", () => {
      const item = createQueueItem({
        queueId: "item1",
        status: "uploading",
        attempts: 0,
      });
      enqueue(item);

      vi.useFakeTimers();
      recordFailedAttempt("item1");
      vi.advanceTimersByTime(2_000);
      const stored = peek();
      vi.useRealTimers();

      expect(stored?.queueId).toBe("item1");
      expect(stored?.status).toBe("pending");
      expect(stored?.attempts).toBe(1);
      expect(stored?.nextRetryAt).not.toBeNull();
    });

    it("should mark as failed when max attempts reached", () => {
      const item = createQueueItem({ queueId: "item1", attempts: 4, maxAttempts: 5 });
      enqueue(item);

      recordFailedAttempt("item1");

      const status = getQueueStatus();
      expect(status.failed).toBe(1);
    });
  });

  describe("resetStaleUploading", () => {
    it("should reset stale uploading items to pending", () => {
      const staleTime = new Date(Date.now() - 3 * 60 * 1000).toISOString(); // 3 minutes ago
      const item = createQueueItem({
        queueId: "item1",
        status: "uploading",
        createdAt: staleTime,
      });
      enqueue(item);

      resetStaleUploading();

      const status = getQueueStatus();
      expect(status.pending).toBe(1);
      expect(status.uploading).toBe(0);
    });

    it("should not reset recent uploading items", () => {
      const item = createQueueItem({
        queueId: "item1",
        status: "uploading",
        createdAt: new Date().toISOString(),
      });
      enqueue(item);

      resetStaleUploading();

      const status = getQueueStatus();
      expect(status.uploading).toBe(1);
      expect(status.pending).toBe(0);
    });
  });

  describe("coalesceSuperseded", () => {
    it("should keep only the most recent item for each hash", () => {
      const item1 = createQueueItem({
        queueId: "item1",
        snapshotHash: "hash1",
        createdAt: new Date(Date.now() - 2000).toISOString(),
      });
      const item2 = createQueueItem({
        queueId: "item2",
        snapshotHash: "hash1",
        createdAt: new Date(Date.now() - 1000).toISOString(),
      });
      const item3 = createQueueItem({
        queueId: "item3",
        snapshotHash: "hash1",
        createdAt: new Date().toISOString(),
      });

      enqueue(item1);
      enqueue(item2);
      enqueue(item3);

      coalesceSuperseded();

      const status = getQueueStatus();
      expect(status.total).toBe(1);

      const peeked = peek();
      expect(peeked?.queueId).toBe("item3");
    });

    it("should keep items with different hashes", () => {
      const item1 = createQueueItem({ queueId: "item1", snapshotHash: "hash1" });
      const item2 = createQueueItem({ queueId: "item2", snapshotHash: "hash2" });
      const item3 = createQueueItem({ queueId: "item3", snapshotHash: "hash3" });

      enqueue(item1);
      enqueue(item2);
      enqueue(item3);

      coalesceSuperseded();

      const status = getQueueStatus();
      expect(status.total).toBe(3);
    });
  });

  describe("clearCompleted", () => {
    it("should remove done and superseded items", () => {
      const item1 = createQueueItem({ queueId: "item1", status: "done" });
      const item2 = createQueueItem({ queueId: "item2", status: "superseded" });
      const item3 = createQueueItem({ queueId: "item3", status: "pending" });

      enqueue(item1);
      enqueue(item2);
      enqueue(item3);

      clearCompleted();

      const status = getQueueStatus();
      expect(status.total).toBe(1);
      expect(status.pending).toBe(1);
    });
  });

  describe("getQueueStatus", () => {
    it("should return correct counts for each status", () => {
      enqueue(createQueueItem({ queueId: "item1", status: "pending" }));
      enqueue(createQueueItem({ queueId: "item2", status: "pending" }));
      enqueue(createQueueItem({ queueId: "item3", status: "uploading" }));
      enqueue(createQueueItem({ queueId: "item4", status: "failed" }));

      const status = getQueueStatus();

      expect(status.total).toBe(4);
      expect(status.pending).toBe(2);
      expect(status.uploading).toBe(1);
      expect(status.failed).toBe(1);
    });

    it("should return zeros for empty queue", () => {
      const status = getQueueStatus();

      expect(status.total).toBe(0);
      expect(status.pending).toBe(0);
      expect(status.uploading).toBe(0);
      expect(status.failed).toBe(0);
    });
  });

  describe("persistence", () => {
    it("should persist queue across simulated reloads", () => {
      const item = createQueueItem({ queueId: "item1" });
      enqueue(item);

      // Simulate reload by clearing mocks but keeping localStorage
      vi.clearAllMocks();

      const status = getQueueStatus();
      expect(status.total).toBe(1);

      const dequeued = dequeue();
      expect(dequeued?.queueId).toBe("item1");
    });

    it("should recover an in-flight upload after a browser restart", () => {
      const staleTime = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      enqueue(createQueueItem({
        queueId: "item1",
        status: "uploading",
        createdAt: staleTime,
      }));

      // Loading the queue after restart resets the stale in-flight item.
      expect(peek()?.queueId).toBe("item1");
      expect(peek()?.status).toBe("pending");
    });
  });
});
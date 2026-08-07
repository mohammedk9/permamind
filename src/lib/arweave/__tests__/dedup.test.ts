import { describe, it, expect } from "vitest";
import { canonicalJSON, computeContentHash, isDuplicate } from "../dedup";
import type { DedupEntry } from "../snapshot-types";

describe("dedup", () => {
  describe("canonicalJSON", () => {
    it("should produce identical output for same data regardless of key order", () => {
      const obj1 = { b: 2, a: 1, c: 3 };
      const obj2 = { a: 1, c: 3, b: 2 };
      const obj3 = { c: 3, b: 2, a: 1 };
      
      const json1 = canonicalJSON(obj1);
      const json2 = canonicalJSON(obj2);
      const json3 = canonicalJSON(obj3);
      
      expect(json1).toBe(json2);
      expect(json2).toBe(json3);
    });

    it("should sort nested object keys recursively", () => {
      const obj1 = {
        z: { b: 2, a: 1 },
        a: { d: 4, c: 3 },
      };
      const obj2 = {
        a: { c: 3, d: 4 },
        z: { a: 1, b: 2 },
      };
      
      const json1 = canonicalJSON(obj1);
      const json2 = canonicalJSON(obj2);
      
      expect(json1).toBe(json2);
    });

    it("should preserve array order", () => {
      const obj1 = { items: [1, 2, 3] };
      const obj2 = { items: [3, 2, 1] };
      
      const json1 = canonicalJSON(obj1);
      const json2 = canonicalJSON(obj2);
      
      expect(json1).not.toBe(json2);
    });

    it("should handle empty objects", () => {
      const obj = {};
      const json = canonicalJSON(obj);
      expect(json).toBe("{}");
    });

    it("should handle null values", () => {
      const obj = { value: null };
      const json = canonicalJSON(obj);
      expect(json).toBe('{"value":null}');
    });

    it("should handle deeply nested structures", () => {
      const obj1 = {
        level1: {
          level2: {
            level3: {
              z: 3,
              a: 1,
              m: 2,
            },
          },
        },
      };
      const obj2 = {
        level1: {
          level2: {
            level3: {
              a: 1,
              m: 2,
              z: 3,
            },
          },
        },
      };
      
      const json1 = canonicalJSON(obj1);
      const json2 = canonicalJSON(obj2);
      
      expect(json1).toBe(json2);
    });

    it("should handle mixed arrays and objects", () => {
      const obj1 = {
        items: [
          { b: 2, a: 1 },
          { d: 4, c: 3 },
        ],
      };
      const obj2 = {
        items: [
          { a: 1, b: 2 },
          { c: 3, d: 4 },
        ],
      };
      
      const json1 = canonicalJSON(obj1);
      const json2 = canonicalJSON(obj2);
      
      expect(json1).toBe(json2);
    });
  });

  describe("computeContentHash", () => {
    it("should produce consistent hashes for same input", async () => {
      const data = "test data";
      const hash1 = await computeContentHash(data);
      const hash2 = await computeContentHash(data);
      
      expect(hash1).toBe(hash2);
    });

    it("should produce different hashes for different input", async () => {
      const hash1 = await computeContentHash("data1");
      const hash2 = await computeContentHash("data2");
      
      expect(hash1).not.toBe(hash2);
    });

    it("should return a 64-character hex string", async () => {
      const hash = await computeContentHash("test");
      
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should produce same hash for canonically equivalent JSON", async () => {
      const obj1 = { b: 2, a: 1 };
      const obj2 = { a: 1, b: 2 };
      
      const json1 = canonicalJSON(obj1);
      const json2 = canonicalJSON(obj2);
      
      const hash1 = await computeContentHash(json1);
      const hash2 = await computeContentHash(json2);
      
      expect(hash1).toBe(hash2);
    });
  });

  describe("isDuplicate", () => {
    it("should return true if hash exists in registry", () => {
      const registry: DedupEntry[] = [
        {
          contentHash: "abc123",
          snapshotVersion: 1,
          txId: "tx1",
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          contentHash: "def456",
          snapshotVersion: 2,
          txId: "tx2",
          createdAt: "2024-01-02T00:00:00Z",
        },
      ];
      
      expect(isDuplicate("abc123", registry)).toBe(true);
      expect(isDuplicate("def456", registry)).toBe(true);
    });

    it("should return false if hash does not exist in registry", () => {
      const registry: DedupEntry[] = [
        {
          contentHash: "abc123",
          snapshotVersion: 1,
          txId: "tx1",
          createdAt: "2024-01-01T00:00:00Z",
        },
      ];
      
      expect(isDuplicate("xyz789", registry)).toBe(false);
    });

    it("should return false for empty registry", () => {
      const registry: DedupEntry[] = [];
      
      expect(isDuplicate("abc123", registry)).toBe(false);
    });
  });
});
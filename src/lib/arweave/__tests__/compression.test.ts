import { describe, it, expect } from "vitest";
import { compress, decompress, jsonToBytes, bytesToJson } from "../compression";

describe("compression", () => {
  describe("jsonToBytes / bytesToJson", () => {
    it("should roundtrip a simple object", () => {
      const obj = { name: "test", value: 42 };
      const bytes = jsonToBytes(obj);
      const result = bytesToJson(bytes);
      expect(result).toEqual(obj);
    });

    it("should handle nested objects", () => {
      const obj = {
        level1: {
          level2: {
            level3: { value: "deep" },
          },
        },
      };
      const bytes = jsonToBytes(obj);
      const result = bytesToJson(bytes);
      expect(result).toEqual(obj);
    });

    it("should handle arrays", () => {
      const obj = { items: [1, 2, 3, "four", { five: 5 }] };
      const bytes = jsonToBytes(obj);
      const result = bytesToJson(bytes);
      expect(result).toEqual(obj);
    });

    it("should handle empty objects", () => {
      const obj = {};
      const bytes = jsonToBytes(obj);
      const result = bytesToJson(bytes);
      expect(result).toEqual(obj);
    });

    it("should handle null values", () => {
      const obj = { value: null };
      const bytes = jsonToBytes(obj);
      const result = bytesToJson(bytes);
      expect(result).toEqual(obj);
    });

    it("should throw on invalid JSON in bytesToJson", () => {
      const invalidBytes = new TextEncoder().encode("not valid json");
      expect(() => bytesToJson(invalidBytes)).toThrow();
    });
  });

  describe("compress / decompress", () => {
    it("should roundtrip compress and decompress", async () => {
      const original = jsonToBytes({ message: "Hello, World!" });
      const compressed = await compress(original);
      const decompressed = await decompress(compressed);
      // Compare as arrays since Uint8Array instances may have different buffer references
      expect(Array.from(decompressed)).toEqual(Array.from(original));
    });

    it("should handle empty input", async () => {
      const empty = new Uint8Array(0);
      const compressed = await compress(empty);
      expect(compressed.byteLength).toBe(0);
      const decompressed = await decompress(compressed);
      expect(decompressed.byteLength).toBe(0);
    });

    it("should compress repetitive data effectively", async () => {
      // Create data with high redundancy
      const repetitive = "a".repeat(10000);
      const original = jsonToBytes({ data: repetitive });
      const compressed = await compress(original);
      
      // Compressed should be significantly smaller
      expect(compressed.byteLength).toBeLessThan(original.byteLength);
      expect(compressed.byteLength).toBeLessThan(original.byteLength * 0.5);
    });

    it("should handle large payloads", async () => {
      // Create a ~100KB payload
      const largeData = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          description: `This is a description for item ${i} with some padding text to make it larger.`,
        })),
      };
      const original = jsonToBytes(largeData);
      const compressed = await compress(original);
      const decompressed = await decompress(compressed);
      const result = bytesToJson(decompressed);
      expect(result).toEqual(largeData);
    });

    it("should produce different output than input", async () => {
      const original = jsonToBytes({ test: "data" });
      const compressed = await compress(original);
      
      // Compressed data should be different from original
      expect(compressed).not.toEqual(original);
    });

    it("should handle unicode content", async () => {
      const unicode = { 
        emoji: "🎉🚀💻", 
        chinese: "你好世界",
        arabic: "مرحبا بالعالم",
        mixed: "Hello 世界 🌍"
      };
      const original = jsonToBytes(unicode);
      const compressed = await compress(original);
      const decompressed = await decompress(compressed);
      const result = bytesToJson(decompressed);
      expect(result).toEqual(unicode);
    });
  });
});
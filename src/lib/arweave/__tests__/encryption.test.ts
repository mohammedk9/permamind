import { describe, it, expect } from "vitest";
import {
  encrypt,
  decrypt,
  deriveKey,
  generateSalt,
  generateIV,
} from "../encryption";
import { jsonToBytes } from "../compression";

describe("encryption", () => {
  const testPassphrase = "test-passphrase-123";

  describe("generateSalt", () => {
    it("should generate a 16-byte salt", () => {
      const salt = generateSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.byteLength).toBe(16);
    });

    it("should generate unique salts", () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1).not.toEqual(salt2);
    });
  });

  describe("generateIV", () => {
    it("should generate a 12-byte IV", () => {
      const iv = generateIV();
      expect(iv).toBeInstanceOf(Uint8Array);
      expect(iv.byteLength).toBe(12);
    });

    it("should generate unique IVs", () => {
      const iv1 = generateIV();
      const iv2 = generateIV();
      expect(iv1).not.toEqual(iv2);
    });
  });

  describe("deriveKey", () => {
    it("should derive a CryptoKey from passphrase and salt", async () => {
      const salt = generateSalt();
      const key = await deriveKey(testPassphrase, salt);

      expect(key).toBeInstanceOf(CryptoKey);
      expect(key.algorithm.name).toBe("AES-GCM");
    });

    it("should derive the same key for the same passphrase and salt", async () => {
      const salt = generateSalt();
      const key1 = await deriveKey(testPassphrase, salt);
      const key2 = await deriveKey(testPassphrase, salt);

      expect(key1.algorithm).toEqual(key2.algorithm);
    });

    it("should derive different keys for different salts", async () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();

      const key1 = await deriveKey(testPassphrase, salt1);
      const key2 = await deriveKey(testPassphrase, salt2);

      expect(key1.algorithm.name).toBe(key2.algorithm.name);
      expect(key1).not.toBe(key2);
    });
  });

  describe("encrypt / decrypt", () => {
    it("should roundtrip encrypt and decrypt", async () => {
      const salt = generateSalt();
      const key = await deriveKey(testPassphrase, salt);
      const plaintext = jsonToBytes({ message: "Hello, World!" });

      const encrypted = await encrypt(plaintext, key, salt);

      expect(encrypted.iv).toBeDefined();
      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.salt).toBeDefined();

      const decrypted = await decrypt(encrypted, key);

      expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    });

    it("should handle empty input", async () => {
      const salt = generateSalt();
      const key = await deriveKey(testPassphrase, salt);
      const plaintext = new Uint8Array(0);

      const encrypted = await encrypt(plaintext, key, salt);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted.byteLength).toBe(0);
    });

    it("should handle large payloads", async () => {
      const salt = generateSalt();
      const key = await deriveKey(testPassphrase, salt);

      const largeData = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          data: `Item ${i} with some padding text`,
        })),
      };

      const plaintext = jsonToBytes(largeData);

      const encrypted = await encrypt(plaintext, key, salt);
      const decrypted = await decrypt(encrypted, key);

      expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    });

    it("should fail to decrypt with wrong key", async () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();

      const key1 = await deriveKey(testPassphrase, salt1);
      const key2 = await deriveKey(testPassphrase, salt2);

      const plaintext = jsonToBytes({ secret: "data" });

      const encrypted = await encrypt(plaintext, key1, salt1);

      await expect(decrypt(encrypted, key2)).rejects.toThrow();
    });

    it("should fail to decrypt with wrong passphrase", async () => {
      const salt = generateSalt();

      const key1 = await deriveKey("correct-passphrase", salt);
      const key2 = await deriveKey("wrong-passphrase", salt);

      const plaintext = jsonToBytes({ secret: "data" });

      const encrypted = await encrypt(plaintext, key1, salt);

      await expect(decrypt(encrypted, key2)).rejects.toThrow();
    });

    it("should produce different ciphertexts for same plaintext (unique IV)", async () => {
      const salt = generateSalt();
      const key = await deriveKey(testPassphrase, salt);

      const plaintext = jsonToBytes({ message: "Same message" });

      const encrypted1 = await encrypt(plaintext, key, salt);
      const encrypted2 = await encrypt(plaintext, key, salt);

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });

    it("should handle unicode content", async () => {
      const salt = generateSalt();
      const key = await deriveKey(testPassphrase, salt);

      const unicode = {
        emoji: "🎉🚀💻",
        chinese: "你好世界",
        arabic: "مرحبا بالعالم",
      };

      const plaintext = jsonToBytes(unicode);

      const encrypted = await encrypt(plaintext, key, salt);
      const decrypted = await decrypt(encrypted, key);

      expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
    });
  });
});
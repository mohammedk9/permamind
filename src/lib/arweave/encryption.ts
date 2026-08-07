/**
 * Encryption and decryption utilities for the Arweave snapshot pipeline.
 *
 * Uses the Web Crypto API with AES-256-GCM for authenticated encryption
 * and PBKDF2 for key derivation from a user passphrase.
 *
 * Security properties:
 * - The encryption key is NEVER stored — it is derived from the passphrase every time.
 * - A unique IV is generated for every encryption call; IVs are never reused.
 * - A unique salt is generated for every key derivation; salts are never reused.
 * - AES-GCM provides both confidentiality and integrity (authenticated encryption).
 *
 * Pipeline position:
 *   compress → encrypt → upload
 *   download → decrypt → decompress
 */

import type { EncryptedPayload } from "./snapshot-types";
import {
  AES_IV_LENGTH,
  AES_KEY_LENGTH,
  ENCRYPTION_ALGORITHM,
  KDF_ALGORITHM,
  KDF_HASH,
  KDF_ITERATIONS,
  KDF_SALT_LENGTH,
   AES_GCM_ALGORITHM_NAME,
} from "./constants";

// ---------------------------------------------------------------------------
// Base64 Utilities (internal)
// ---------------------------------------------------------------------------

/**
 * Encodes a Uint8Array to a base64 string.
 *
 * Uses `btoa` with a binary string intermediate for broad browser compatibility.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Decodes a base64 string to a Uint8Array.
 *
 * Uses `atob` with a binary string intermediate for broad browser compatibility.
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Key Derivation
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically random salt for PBKDF2 key derivation.
 *
 * @returns A Uint8Array of {@link KDF_SALT_LENGTH} random bytes.
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KDF_SALT_LENGTH));
}

/**
 * Generates a cryptographically random initialization vector for AES-GCM.
 *
 * @returns A Uint8Array of {@link AES_IV_LENGTH} random bytes.
 */
export function generateIV(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
}

/**
 * Derives an AES-256-GCM CryptoKey from a user passphrase and salt using PBKDF2.
 *
 * The key is never stored — it must be re-derived from the passphrase every time
 * encryption or decryption is needed. The salt is stored alongside the encrypted
 * payload so the same key can be re-derived during decryption.
 *
 * @param passphrase - The user's passphrase string. Must be kept secret.
 * @param salt - A unique salt (typically from {@link generateSalt}).
 * @returns A non-extractable CryptoKey suitable for AES-GCM encrypt/decrypt.
 *
 * @example
 * ```ts
 * const salt = generateSalt();
 * const key = await deriveKey("my-secret-passphrase", salt);
 * ```
 */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  // Step 1: Import the passphrase as a raw key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    KDF_ALGORITHM,
    false,
    ["deriveKey"]
  );

  // Step 2: Derive an AES-GCM key using PBKDF2.
  // Pass the Uint8Array directly as BufferSource instead of using .buffer,
  // which could include unintended extra bytes if the view doesn't cover
  // the entire underlying ArrayBuffer.
  return crypto.subtle.deriveKey(
    {
      name: KDF_ALGORITHM,
      salt: salt as BufferSource,
      iterations: KDF_ITERATIONS,
      hash: KDF_HASH,
    },
    keyMaterial,
   {
  name: AES_GCM_ALGORITHM_NAME,
  length: AES_KEY_LENGTH,
},
    false, // non-extractable — the raw key bytes cannot be read
    ["encrypt", "decrypt"]
  );
}

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

/**
 * Encrypts plaintext using AES-256-GCM with a unique IV.
 *
 * A fresh 12-byte IV is generated for every call. The IV is never reused with
 * the same key, which is a critical security requirement for AES-GCM.
 *
 * The returned {@link EncryptedPayload} contains:
 * - `iv` — the unique initialization vector (base64)
 * - `ciphertext` — the encrypted data including the GCM authentication tag (base64)
 * - `salt` — the PBKDF2 salt used to derive the key (base64)
 *
 * The salt is included so that the key can be re-derived during decryption
 * using only the passphrase and the payload.
 *
 * @param plaintext - The raw bytes to encrypt (typically compressed snapshot data).
 * @param key - A CryptoKey derived via {@link deriveKey}.
 * @param salt - The salt that was used to derive the key (included in the output).
 * @returns An {@link EncryptedPayload} containing iv, ciphertext, and salt as base64 strings.
 *
 * @example
 * ```ts
 * const salt = generateSalt();
 * const key = await deriveKey(passphrase, salt);
 * const payload = await encrypt(compressedBytes, key, salt);
 * ```
 */
export async function encrypt(
  plaintext: Uint8Array,
  key: CryptoKey,
  salt: Uint8Array
): Promise<EncryptedPayload> {
  // Generate a unique IV for this encryption operation
  const iv = generateIV();

  // Encrypt with AES-256-GCM — output includes the authentication tag.
  // Pass Uint8Arrays directly as BufferSource to avoid including
  // unintended bytes from the underlying ArrayBuffer.
  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: AES_GCM_ALGORITHM_NAME,
      iv: iv as BufferSource,
    },
    key,
    plaintext as BufferSource
  );

  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertextBuffer)),
    salt: bytesToBase64(salt),
  };
}

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------

/**
 * Decrypts an {@link EncryptedPayload} using AES-256-GCM.
 *
 * The IV and ciphertext are extracted from the payload. The key must have been
 * derived using the same passphrase and salt that were used during encryption.
 *
 * @param payload - The encrypted payload containing iv, ciphertext, and salt (all base64).
 * @param key - A CryptoKey derived via {@link deriveKey} using the passphrase
 *              and the salt from `payload.salt`.
 * @returns The original plaintext bytes.
 * @throws {OperationError} If the key is incorrect or the ciphertext has been tampered with.
 *         AES-GCM authentication will reject any modification to the ciphertext or IV.
 *
 * @example
 * ```ts
 * const salt = base64ToBytes(payload.salt);
 * const key = await deriveKey(passphrase, salt);
 * const plaintext = await decrypt(payload, key);
 * ```
 */
export async function decrypt(
  payload: EncryptedPayload,
  key: CryptoKey
): Promise<Uint8Array> {
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);

  // Pass Uint8Arrays directly as BufferSource to avoid including
  // unintended bytes from the underlying ArrayBuffer.
  const plaintextBuffer = await crypto.subtle.decrypt(
    {
      name: AES_GCM_ALGORITHM_NAME,
      iv: iv as BufferSource,
    },
    key,
    ciphertext as BufferSource
  );

  return new Uint8Array(plaintextBuffer);
}
/**
 * Room cryptography.
 *
 * A room has one long-lived secret — the room key — that encrypts every message in it. It
 * is generated on the host's device and never leaves it, which is the property the whole
 * feature rests on: if the database leaks, the messages stay unreadable.
 *
 * Guests cannot hold the room key, because a guest is a stranger. So the key is *wrapped*:
 * sealed under a key derived from the invite code. A guest unwraps it locally, and if the
 * link and the code both leak, an attacker still holds only the wrapper.
 *
 * The primitive layer (AES-256-GCM, PBKDF2) is imported from `lib/arweave/encryption`
 * rather than reimplemented, so a room and a backup are encrypted by the same reviewed code
 * and a change to the primitive reaches both.
 */

import {
  AES_KEY_LENGTH,
  KDF_HASH,
  KDF_ITERATIONS,
} from "@/lib/arweave/constants";
import {
  decrypt,
  encrypt,
  generateSalt,
} from "@/lib/arweave/encryption";
import type { EncryptedPayload } from "@/lib/arweave/snapshot-types";

/** Bytes of entropy in a room key. 32 gives a 256-bit key, matching AES-256. */
export const ROOM_KEY_BYTES = 32;

/** Bumped if the room key or wrap format changes incompatibly. */
export const ROOM_CRYPTO_VERSION = 1;

/**
 * A room key.
 *
 * Every function in this module takes the handle rather than raw bytes, so a caller cannot
 * pass them into a payload or a log by accident. The one exception is `exportRoomKey`,
 * which is the host's own escape hatch and is named for what it does.
 */
export interface RoomKeyHandle {
  readonly key: CryptoKey;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Room key
// ---------------------------------------------------------------------------

/**
 * Creates a room key from the platform CSPRNG.
 *
 * The key is importable-as-extractable for exactly one reason: the host has to seal it under
 * the invite code so guests can join, and `subtle.encrypt` can only encrypt with a handle it
 * can read. The alternative — keeping a separate raw copy around — is strictly worse,
 * because that copy has no protection and can be read by anything holding the variable.
 *
 * The key is never written to storage. It lives in the host's tab for as long as the room
 * is open, which is also what bounds the damage from a compromised script: closing the tab
 * ends it.
 */
export async function createRoomKey(): Promise<RoomKeyHandle> {
  const material = crypto.getRandomValues(new Uint8Array(ROOM_KEY_BYTES));
  const key = await crypto.subtle.importKey(
    "raw",
    material as BufferSource,
    "AES-GCM",
    true,
    ["encrypt", "decrypt"],
  );
  return { key };
}

/**
 * Restores a room key the host kept for the life of the tab.
 *
 * `extractable` is true for the same wrapping reason as `createRoomKey`, and callers should
 * treat the returned bytes as the secret they are: the host needs them to re-wrap the key if
 * the invite code is changed.
 */
export async function importRoomKey(raw: Uint8Array): Promise<RoomKeyHandle> {
  if (raw.byteLength !== ROOM_KEY_BYTES) {
    throw new Error(`Room key must be ${ROOM_KEY_BYTES} bytes`);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    "AES-GCM",
    true,
    ["encrypt", "decrypt"],
  );
  return { key };
}

// ---------------------------------------------------------------------------
// Message payloads
// ---------------------------------------------------------------------------

/** The shape stored in `room_messages.ciphertext`. */
export interface RoomMessagePayload {
  body: string;
  replyToId?: string;
  threadRootId?: string;
  alias?: string;
}

/**
 * A sealed message, ready to be written to the database.
 *
 * The IV travels with the ciphertext. It is not secret — it is the reason a single room key
 * can safely encrypt many messages — so it is stored in the clear next to the ciphertext and
 * parsed out on open.
 */
export interface SealedMessage {
  /** base64 ciphertext, prefixed with the IV so one column round-trips. */
  ciphertext: string;
  ciphertextBytes: number;
  /** SHA-256 of the plaintext, for dedup and integrity checks. */
  contentHash: string;
}

/** Separates the IV from the ciphertext inside the stored string. */
const IV_LENGTH = 12;

/**
 * Encrypts one message under the room key.
 *
 * A fresh IV is generated per call. Reusing an IV under the same AES-GCM key leaks the XOR
 * of the two plaintexts and can expose the authentication key, so the IV is never derived
 * from anything reusable.
 */
export async function sealMessage(
  payload: RoomMessagePayload,
  roomKey: RoomKeyHandle,
): Promise<SealedMessage> {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const salt = new Uint8Array(0);
  const sealed = await encrypt(plaintext, roomKey.key, salt);
  const iv = base64ToBytes(sealed.iv);
  const combined = new Uint8Array(iv.byteLength + base64ToBytes(sealed.ciphertext).byteLength);
  combined.set(iv, 0);
  combined.set(base64ToBytes(sealed.ciphertext), iv.byteLength);
  const encoded = bytesToBase64(combined);

  return {
    ciphertext: encoded,
    ciphertextBytes: base64ToBytes(sealed.ciphertext).byteLength,
    contentHash: await hashPlaintext(payload),
  };
}

/**
 * Decrypts one message.
 *
 * A wrong key, a tampered ciphertext, and a modified IV all fail here, because AES-GCM
 * authenticates as well as encrypts. The error is deliberately generic: a decryption
 * failure must never yield partial plaintext, and telling a guest that their code is "close"
 * would help someone guessing it.
 */
export async function openMessage(
  sealed: string,
  roomKey: RoomKeyHandle,
): Promise<RoomMessagePayload> {
  try {
    const combined = base64ToBytes(sealed);
    if (combined.byteLength <= IV_LENGTH) {
      throw new Error("Ciphertext is too short to contain an IV");
    }
    const iv = combined.subarray(0, IV_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH);
    const plaintext = await decrypt(
      {
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(ciphertext),
        salt: "",
      } as EncryptedPayload,
      roomKey.key,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as RoomMessagePayload;
  } catch {
    throw new Error("This message could not be decrypted");
  }
}

/** Reads the raw room key bytes. Host-only: the result is the room's master secret. */
export async function exportRoomKey(roomKey: RoomKeyHandle): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey("raw", roomKey.key);
  return new Uint8Array(raw);
}

// ---------------------------------------------------------------------------
// Wrapping, for guests
// ---------------------------------------------------------------------------

/** A room key sealed under a code the guest knows. */
export interface WrappedRoomKey {
  version: number;
  /** base64 ciphertext of the room key. */
  wrapped: string;
  /** base64 IV used for the wrap. */
  iv: string;
  /** base64 PBKDF2 salt, stored alongside so a guest can re-derive the wrap key. */
  salt: string;
}

/**
 * Derives the key that seals the room key under an invite code.
 *
 * This is deliberately not `deriveKey` from the Arweave pipeline. That helper enforces
 * an eight-character minimum, because its input is a backup passphrase a person chose
 * and remembered, and a six-digit invite code would be refused outright. Six digits is
 * also genuinely low entropy — a million possibilities — so it is stretched rather than
 * used as key material directly.
 *
 * The iteration count is the same 310,000 the backup pipeline uses. That is what makes
 * guessing a code expensive rather than free, and the salt is per-room, so a table
 * precomputed for one room is useless against the next.
 */
const ROOM_WRAP_ITERATIONS = KDF_ITERATIONS;

async function deriveWrapKey(
  inviteCode: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(inviteCode) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: ROOM_WRAP_ITERATIONS,
      hash: KDF_HASH,
    },
    material,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Seals a room key under the invite code.
 *
 * The wrapper is all the server ever holds, and on its own it is useless: it needs the
 * invite code, which is hashed before storage, and it yields the room key, which is
 * still the thing that decrypts the room.
 */
export async function wrapRoomKey(
  roomKey: RoomKeyHandle,
  inviteCode: string,
  salt: Uint8Array,
): Promise<WrappedRoomKey> {
  const raw = await exportRoomKey(roomKey);
  const wrapKey = await deriveWrapKey(inviteCode, salt);
  const sealed = await encrypt(raw, wrapKey, salt);
  return {
    version: ROOM_CRYPTO_VERSION,
    wrapped: sealed.ciphertext,
    iv: sealed.iv,
    salt: bytesToBase64(salt),
  };
}

/**
 * Unseals a room key using the invite code. The guest's entry point.
 *
 * This is the moment a guest becomes able to read the room, and it happens entirely on their
 * own device. The server never sees the invite code's contribution to the key material.
 */
export async function unwrapRoomKey(
  wrapped: WrappedRoomKey,
  inviteCode: string,
): Promise<RoomKeyHandle> {
  if (wrapped.version !== ROOM_CRYPTO_VERSION) {
    throw new Error("This room was created by a newer version of the app");
  }
  const salt = base64ToBytes(wrapped.salt);
  const wrapKey = await deriveWrapKey(inviteCode, salt);
  try {
    const raw = await decrypt(
      { iv: wrapped.iv, ciphertext: wrapped.wrapped, salt: wrapped.salt } as EncryptedPayload,
      wrapKey,
    );
    return await importRoomKey(raw);
  } catch {
    // Almost always a wrong invite code. Saying so would confirm the code is close, so the
    // message stays generic.
    throw new Error("This invite code is not valid for this room");
  }
}

/** Creates a fresh salt for wrapping. A new salt per room defeats precomputation. */
export function createWrapSalt(): Uint8Array {
  return generateSalt();
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** SHA-256 of the canonical JSON, hex encoded. Mirrors the snapshot dedup hash. */
export async function hashPlaintext(payload: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

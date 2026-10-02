/**
 * Envelope encryption for a host's provider key stored on our servers (Option B).
 *
 * ## Why this is not just an AES column
 *
 * The design promises the host that a key kept here is "stored encrypted". The question a
 * reader should ask is: encrypted with *what*? If the row held a ciphertext whose key sat
 * in the same database, or was derived from a secret the application hard-codes, then a
 * database leak is a key leak wearing a disguise, and the disclosure on screen would be
 * describing a protection that does not exist.
 *
 * So this is real envelope encryption:
 *
 *   - A **DEK** is generated per host, in memory, and is what encrypts the provider key.
 *   - The DEK is sealed under a **KEK** derived from `ROOM_KEY_MASTER_SECRET`, an
 *     environment secret that is never stored in the database.
 *   - The row holds the sealed DEK and the sealed key. Neither opens without that value.
 *
 * The property this buys is the one the design needs: **a leaked database yields nothing
 * usable.** An attacker with the whole `host_ai_keys` table cannot decrypt a single key,
 * because the only half they lack never touches the disk.
 *
 * ## What this does not protect against
 *
 * An attacker who controls the running application and can read its environment. At that
 * point they have the KEK. Nothing short of the host re-entering the key on every request
 * prevents that, and that is Option A — which is why both exist.
 *
 * ## Nothing is memoised
 *
 * Each operation derives the KEK, unwraps the DEK, uses it, and drops it. There is no cache
 * ## Why there is no `server-only` guard here
 *
 * The usual marker is right for a module that touches the database or the environment at
 * import time. This one does neither: it is Web Crypto plus a `process.env` read inside
 * `deriveKek`, and that read throws when the secret is absent. Adding the guard would make
 * the module unimportable from a test, and these tests are the only thing that can prove the
 * envelope actually holds rather than merely being labelled "encrypted".
 *
 * The rule this replaces: never import this from a client component. `host-key-store.ts` is
 * the module that reaches the database, and it is guarded.
 */

import { AES_KEY_LENGTH, KDF_HASH } from "@/lib/arweave/constants";
import { decrypt, encrypt, generateSalt } from "@/lib/arweave/encryption";
import type { EncryptedPayload } from "@/lib/arweave/snapshot-types";

/** Bumped if the stored shape changes incompatibly. A row written under 1 is re-asked. */
export const HOST_KEY_VERSION = 1;

/** Provider keys are short. A generous bound that still refuses a pasted document. */
const MAX_KEY_LENGTH = 512;

export class HostKeyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "HostKeyError";
  }
}

/**
 * Derives the key-encryption key from the environment secret.
 *
 * Throws rather than returning null, because a caller that quietly skipped encryption would
 * store the provider key in the clear while every screen still claimed it was encrypted.
 * Failing here is the only safe behaviour; the caller turns this into a 503.
 */
async function deriveKek(): Promise<CryptoKey> {
  const secret = process.env.ROOM_KEY_MASTER_SECRET?.trim();
  if (!secret) {
    throw new HostKeyError(
      "Storing a key on our servers is not configured",
      503,
      "HOST_KEY_UNAVAILABLE",
    );
  }

  // A fixed application salt rather than a per-value one: this derives a *key* from a
  // secret, not a key from a password, so there is no dictionary to slow down. The
  // confidentiality comes from the secret's entropy, and the per-value salt comes from the
  // DEK's own encryption below.
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`permamind:host-key:v${HOST_KEY_VERSION}:${secret}`) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode("permamind:room-kek") as BufferSource,
      iterations: 310_000,
      hash: KDF_HASH,
    },
    material,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

/** The sealed form written to `host_ai_keys`. */
export interface SealedHostKey {
  version: number;
  /** The DEK, sealed under the environment KEK. */
  sealedDek: EncryptedPayload;
  /** The provider key, sealed under the DEK. */
  sealedKey: EncryptedPayload;
}

/**
 * Encrypts a provider key for storage.
 *
 * The DEK is generated here and nowhere else: 32 bytes of CSPRNG output, so two hosts never
 * share one and a compromise of one does not reach the other. The plaintext DEK exists only
 * inside the two `encrypt` calls below and goes out of scope when this returns.
 */
export async function sealHostKey(providerKey: string): Promise<SealedHostKey> {
  const key = providerKey.trim();
  if (!key || key.length > MAX_KEY_LENGTH) {
    throw new HostKeyError("That provider key is not valid", 400, "KEY_INVALID");
  }

  const kek = await deriveKek();
  const dek = crypto.getRandomValues(new Uint8Array(32));
  const dekKey = await importAesKey(dek);

  // `encrypt` takes a salt because it was written for the snapshot pipeline, where the
  // salt is part of the passphrase derivation. Here the key is already a raw DEK and the
  // salt is carried in the payload rather than fed into a KDF, so this one is recorded for
  // format consistency and never participates in deriving anything. A fresh one per call
  // keeps that field from becoming a stable identifier for a stored key.
  const sealedKey = await encrypt(
    new TextEncoder().encode(key),
    dekKey,
    generateSalt(),
  );
  const sealedDek = await encrypt(dek, kek, generateSalt());

  return { version: HOST_KEY_VERSION, sealedDek, sealedKey };
}

/**
 * Opens a stored provider key.
 *
 * Used only on the path where the host is absent and the room must still answer (section 5,
 * Option B). A failure here means the master secret changed or the row is malformed; both
 * are handled the same way by the caller, which is to fall back to Option A rather than fail
 * the room.
 */
export async function openHostKey(sealed: SealedHostKey): Promise<string> {
  if (sealed.version !== HOST_KEY_VERSION) {
    throw new HostKeyError("This stored key was written by a newer version", 409, "KEY_VERSION");
  }

  const kek = await deriveKek();
  const rawDek = await decrypt(sealed.sealedDek, kek);
  const dekKey = await importAesKey(new Uint8Array(rawDek));
  const plaintext = await decrypt(sealed.sealedKey, dekKey);
  return new TextDecoder().decode(plaintext).trim();
}

/**
 * True when the application can store a key at all.
 *
 * Drives the UI only. It is never a boundary: `deriveKek` re-reads the environment and
 * throws, so a host who reaches the route without the secret still gets a refusal rather
 * than a plaintext write.
 */
export function hostKeyStorageAvailable(): boolean {
  return Boolean(process.env.ROOM_KEY_MASTER_SECRET?.trim());
}

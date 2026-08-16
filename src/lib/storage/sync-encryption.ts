import { decrypt, deriveKey, encrypt, generateSalt } from "@/lib/arweave/encryption";
import type { EncryptedPayload } from "@/lib/arweave/snapshot-types";

export const SYNC_ENCRYPTION_VERSION = 1;

let sessionPassphrase: string | null = null;

export function setSyncPassphrase(passphrase: string | null): void {
  sessionPassphrase = passphrase?.trim() || null;
}

export function hasSyncPassphrase(): boolean {
  return Boolean(sessionPassphrase);
}

export async function encryptSyncValue(value: unknown): Promise<string> {
  if (!sessionPassphrase) throw new Error("Set a sync passphrase before syncing");
  const salt = generateSalt();
  const key = await deriveKey(sessionPassphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const payload = await encrypt(plaintext, key, salt);
  return JSON.stringify({ version: SYNC_ENCRYPTION_VERSION, ...payload });
}

export async function decryptSyncValue<T>(serialized: string): Promise<T> {
  if (!sessionPassphrase) throw new Error("Set a sync passphrase before restoring sync data");
  const payload = JSON.parse(serialized) as EncryptedPayload & { version?: number };
  if (payload.version !== SYNC_ENCRYPTION_VERSION) throw new Error("Unsupported sync encryption version");
  const salt = Uint8Array.from(atob(payload.salt), (character) => character.charCodeAt(0));
  const key = await deriveKey(sessionPassphrase, salt);
  const plaintext = await decrypt(payload, key);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  HOST_KEY_VERSION,
  openHostKey,
  sealHostKey,
  HostKeyError,
} from "@/lib/rooms/host-key";

/**
 * Option B, section 5: a host's provider key kept on our servers.
 *
 * The disclosure on screen says three things — encrypted, deleted on a date, removable at
 * any time. The first is the one a code review will assume rather than verify, so it gets
 * the test that matters here: **a full dump of the stored row yields no key.**
 *
 * That is the same shape of argument as the existing "a total database leak yields nothing
 * readable" test for rooms. Both exist because the alternative — trusting that the
 * encryption is right because it is labelled encrypted — is exactly the assumption that
 * fails silently.
 */

const SECRET = "master-secret-for-this-test-only";
const PROVIDER_KEY = "sk-live-9f3c2a7be4510d8f6c2a";

let original: string | undefined;

beforeEach(() => {
  original = process.env.ROOM_KEY_MASTER_SECRET;
  process.env.ROOM_KEY_MASTER_SECRET = SECRET;
});

afterEach(() => {
  if (original === undefined) delete process.env.ROOM_KEY_MASTER_SECRET;
  else process.env.ROOM_KEY_MASTER_SECRET = original;
});

describe("a stored host key cannot be recovered from the row alone", () => {
  it("keeps the provider key out of everything the database holds", async () => {
    const sealed = await sealHostKey(PROVIDER_KEY);

    // Everything the table stores, copied out verbatim.
    const row = {
      user_id: "3f1c9a20-6f0e-4a4b-9d2b-7c1e5f0a9b31",
      key_version: sealed.version,
      sealed_dek: JSON.stringify(sealed.sealedDek),
      sealed_key: JSON.stringify(sealed.sealedKey),
      expires_at: "2026-08-01T00:00:00.000Z",
      created_at: "2026-07-01T00:00:00.000Z",
    };
    const dump = JSON.stringify(row);

    // Not the whole key, and not a distinctive fragment of it. An attacker with the dump
    // should not learn the key's length or its first few characters either, which a partial
    // leak would.
    expect(dump).not.toContain(PROVIDER_KEY);
    expect(dump).not.toContain(PROVIDER_KEY.slice(0, 8));
    expect(dump).not.toContain(PROVIDER_KEY.slice(-8));
    expect(dump).not.toContain("9f3c2a7b");
  });

  it("still opens with the environment secret, which is the half that is not in the row", async () => {
    const sealed = await sealHostKey(PROVIDER_KEY);
    expect(await openHostKey(sealed)).toBe(PROVIDER_KEY);
  });

  it("cannot be opened without the environment secret", async () => {
    const sealed = await sealHostKey(PROVIDER_KEY);
    delete process.env.ROOM_KEY_MASTER_SECRET;

    // This is the property the whole design turns on: the database and the ability to read
    // the database are different things.
    await expect(openHostKey(sealed)).rejects.toThrow();
  });

  it("cannot be opened with the wrong secret", async () => {
    const sealed = await sealHostKey(PROVIDER_KEY);
    process.env.ROOM_KEY_MASTER_SECRET = `${SECRET}-rotated`;

    await expect(openHostKey(sealed)).rejects.toThrow();
  });

  it("uses a fresh data key per host, so one leaked row does not reach the next", async () => {
    const first = await sealHostKey(PROVIDER_KEY);
    const second = await sealHostKey(PROVIDER_KEY);

    // Same plaintext, different ciphertext. If these matched, a single recovery would open
    // every stored key at once, which is the failure mode envelope encryption exists to
    // prevent.
    expect(first.sealedKey.ciphertext).not.toBe(second.sealedKey.ciphertext);
    expect(first.sealedDek.ciphertext).not.toBe(second.sealedDek.ciphertext);

    // And both still open, so the difference is not simply that one is broken.
    expect(await openHostKey(first)).toBe(PROVIDER_KEY);
    expect(await openHostKey(second)).toBe(PROVIDER_KEY);
  });

  it("refuses to store an empty or absurdly long key", async () => {
    await expect(sealHostKey("   ")).rejects.toThrow(HostKeyError);
    await expect(sealHostKey("x".repeat(5_000))).rejects.toThrow(HostKeyError);
  });
});

describe("the disclosure on screen is kept honest by the code", () => {
  it("refuses to seal anything when the master secret is not configured", async () => {
    // Without this, a deployment that forgot the variable would store provider keys under a
    // derived key of "" — still ciphertext, still labelled encrypted, and worthless.
    delete process.env.ROOM_KEY_MASTER_SECRET;
    await expect(sealHostKey(PROVIDER_KEY)).rejects.toThrow(/not configured/);
  });

  it("carries a version, so a format change cannot silently misread an old row", async () => {
    const sealed = await sealHostKey(PROVIDER_KEY);
    expect(sealed.version).toBe(HOST_KEY_VERSION);

    // A row from a future version is refused rather than parsed on a guess.
    await expect(
      openHostKey({ ...sealed, version: sealed.version + 1 }),
    ).rejects.toThrow(/newer version/);
  });

  it("does not accept a tampered ciphertext", async () => {
    const sealed = await sealHostKey(PROVIDER_KEY);
    const bytes = Buffer.from(sealed.sealedKey.ciphertext, "base64");
    bytes[0] = bytes[0] ^ 0xff;
    const tampered = {
      ...sealed,
      sealedKey: { ...sealed.sealedKey, ciphertext: bytes.toString("base64") },
    };

    // AES-GCM is authenticated, so a flipped bit fails to open rather than returning
    // altered plaintext.
    await expect(openHostKey(tampered)).rejects.toThrow();
  });
});

import { beforeEach, describe, expect, it } from "vitest";

import {
  createRoomKey,
  createWrapSalt,
  exportRoomKey,
  importRoomKey,
  openMessage,
  sealMessage,
  unwrapRoomKey,
  wrapRoomKey,
  type RoomMessagePayload,
} from "@/lib/rooms/crypto";

/**
 * Phase 0 of docs/group-rooms-design.md.
 *
 * The claim these tests protect is the one the whole feature rests on: the room key never
 * leaves the host, so a full database leak yields ciphertext. Phase 2 adds the end-to-end
 * version of that claim; here we prove the primitives behave as the design assumes.
 */
describe("room key", () => {
  it("generates a 256-bit key", async () => {
    const raw = await exportRoomKey(await createRoomKey());
    expect(raw.byteLength).toBe(32);
  });

  it("generates a different key each time", async () => {
    const first = await exportRoomKey(await createRoomKey());
    const second = await exportRoomKey(await createRoomKey());
    expect(first).not.toEqual(second);
  });

  it("round trips through export and import", async () => {
    const original = await createRoomKey();
    const restored = await importRoomKey(await exportRoomKey(original));

    const sealed = await sealMessage({ body: "hello" }, original);
    expect((await openMessage(sealed.ciphertext, restored)).body).toBe("hello");
  });

  it("rejects a key of the wrong length", async () => {
    await expect(importRoomKey(new Uint8Array(16))).rejects.toThrow(/32 bytes/);
  });
});

describe("message sealing", () => {
  let roomKey: Awaited<ReturnType<typeof createRoomKey>>;

  beforeEach(async () => {
    roomKey = await createRoomKey();
  });

  it("round trips a message and its threading fields", async () => {
    const payload: RoomMessagePayload = {
      body: "ما قررنا بشأن إطلاق أطلس؟",
      replyToId: "message-1",
      threadRootId: "message-0",
      alias: "سارة",
    };

    const sealed = await sealMessage(payload, roomKey);
    expect(await openMessage(sealed.ciphertext, roomKey)).toEqual(payload);
  });

  it("produces a content hash matching the dedup format", async () => {
    const sealed = await sealMessage({ body: "x" }, roomKey);
    expect(sealed.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives identical plaintexts the same hash, so dedup can work", async () => {
    const first = await sealMessage({ body: "same" }, roomKey);
    const second = await sealMessage({ body: "same" }, roomKey);
    expect(first.contentHash).toBe(second.contentHash);
  });

  it("uses a fresh IV for every message", async () => {
    // Reusing an IV under one AES-GCM key leaks the XOR of the two plaintexts, so two
    // encryptions of the same text must not produce the same ciphertext.
    const first = await sealMessage({ body: "same" }, roomKey);
    const second = await sealMessage({ body: "same" }, roomKey);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("refuses a message sealed under a different key", async () => {
    const sealed = await sealMessage({ body: "private" }, roomKey);
    const other = await createRoomKey();

    await expect(openMessage(sealed.ciphertext, other)).rejects.toThrow(
      /could not be decrypted/,
    );
  });

  it("refuses a tampered ciphertext", async () => {
    const sealed = await sealMessage({ body: "private" }, roomKey);
describe("wrapping the key for guests", () => {
  const INVITE = "483921";

  it("lets a guest with the right code read the room", async () => {
    const roomKey = await createRoomKey();
    const salt = createWrapSalt();
    const wrapped = await wrapRoomKey(roomKey, INVITE, salt);

    // The guest arrives with the wrapper and the code, and knows nothing else.
    const guestKey = await unwrapRoomKey(wrapped, INVITE);
    const sealed = await sealMessage({ body: "welcome" }, roomKey);

    expect((await openMessage(sealed.ciphertext, guestKey)).body).toBe("welcome");
  });

  it("rejects a wrong invite code", async () => {
    const wrapped = await wrapRoomKey(await createRoomKey(), INVITE, createWrapSalt());
    await expect(unwrapRoomKey(wrapped, "000000")).rejects.toThrow(
      /not valid for this room/,
    );
  });

  it("does not reveal whether a wrong code was close", async () => {
    // A message that distinguishes "wrong code" from "wrong room" would let someone
    // brute force the code one character at a time.
    const wrapped = await wrapRoomKey(await createRoomKey(), INVITE, createWrapSalt());
    await expect(unwrapRoomKey(wrapped, "48392")).rejects.toThrow(
      "This invite code is not valid for this room",
    );
  });

  it("yields a wrapper that is not itself usable as a room key", async () => {
    // The wrapper must not decrypt anything on its own. This is what makes a leaked
    // database harmless: the server holds wrappers, not room keys.
    const roomKey = await createRoomKey();
    const wrapped = await wrapRoomKey(roomKey, INVITE, createWrapSalt());

    // Importing the wrapper's raw ciphertext as a key is what an attacker with database
    // access could attempt. It is the wrong key material, so it decrypts nothing.
    const bytes = new Uint8Array(atob(wrapped.wrapped).length);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = atob(wrapped.wrapped).charCodeAt(i);
    const forgedKey = await importRoomKey(bytes.slice(0, 32));

    const sealed = await sealMessage({ body: "the room" }, roomKey);
    await expect(openMessage(sealed.ciphertext, forgedKey)).rejects.toThrow(
      /could not be decrypted/,
    );
  });

  it("rejects a wrapper from a newer format", async () => {
    const wrapped = await wrapRoomKey(await createRoomKey(), INVITE, createWrapSalt());
    await expect(unwrapRoomKey({ ...wrapped, version: 99 }, INVITE)).rejects.toThrow(
      /newer version/,
    );
  });

  it("uses a fresh salt per room so precomputation does not carry over", () => {
    expect(createWrapSalt()).not.toEqual(createWrapSalt());
  });

  it("rejects a wrapper whose salt was swapped", async () => {
    const wrapped = await wrapRoomKey(await createRoomKey(), INVITE, createWrapSalt());
    const tampered = { ...wrapped, salt: btoa("\0".repeat(16)) };
    await expect(unwrapRoomKey(tampered, INVITE)).rejects.toThrow(
      /not valid for this room/,
    );
  });
});


    // Flip one base64 character in the ciphertext half of the stored blob.
    const bytes = atob(sealed.ciphertext);
    const flipped = `${bytes.slice(0, 20)}${bytes[20] === "A" ? "B" : "A"}${bytes.slice(21)}`;

    await expect(openMessage(flipped, roomKey)).rejects.toThrow(
      /could not be decrypted/,
    );
  });

  it("refuses a ciphertext too short to hold an IV", async () => {
    await expect(openMessage(btoa("short"), roomKey)).rejects.toThrow(
      /could not be decrypted/,
    );
  });
});

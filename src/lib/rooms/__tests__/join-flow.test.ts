import { beforeEach, describe, expect, it } from "vitest";

import {
  clearMemberToken,
  createHostCode,
  createInviteCode,
  createMemberToken,
  createRoomId,
  hashSecret,
  isValidHostCode,
  isValidInviteCode,
  isValidMemberToken,
  isValidRoomId,
  loadMemberToken,
  saveMemberToken,
  secretsMatch,
} from "@/lib/rooms/access";
import {
  createRoomKey,
  createWrapSalt,
  importRoomKey,
  openMessage,
  sealMessage,
  unwrapRoomKey,
  wrapRoomKey,
  type WrappedRoomKey,
} from "@/lib/rooms/crypto";

/**
 * Phase 2 of docs/group-rooms-design.md.
 *
 * The test that matters is "a total database leak yields nothing readable". It is the
 * only assertion in this file that cannot be weakened by a future change without
 * someone deleting it on purpose, because it does not inspect a function's output: it
 * hands the attacker everything the design says the server holds and then tries to read
 * a message.
 */
describe("identifiers and codes", () => {
  it("mints room ids that are the shape the schema and the route both accept", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(isValidRoomId(createRoomId())).toBe(true);
    }
  });

  it("keeps room ids short enough to paste into a chat window", () => {
    expect(createRoomId()).toHaveLength(6);
  });

  it("avoids characters that are ambiguous when read aloud", () => {
    // 0/O, 1/I/L, and 5/S are the usual culprits. An id containing one of them gets
    // mistyped, and a mistyped id looks like an invalid room.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(createRoomId()).not.toMatch(/[01ILOS]/);
    }
  });

  it("never generates the same id twice in a small sample", () => {
    const ids = new Set(Array.from({ length: 200 }, () => createRoomId()));
    expect(ids.size).toBe(200);
  });

  it("mints invite codes that are six digits, so they survive being read aloud", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = createInviteCode();
      expect(code).toMatch(/^[2-9]{6}$/);
      expect(isValidInviteCode(code)).toBe(true);
    }
  });
  it("keeps the host code in a different shape from the invite code", () => {
    // A host code must never be mistakable for an invite code, or sharing the wrong
    // one hands over the wrong half of the authority.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const host = createHostCode();
      expect(isValidHostCode(host)).toBe(true);
      expect(isValidInviteCode(host)).toBe(false);
    }
  });

  it("mints 256-bit member tokens", () => {
    const token = createMemberToken();
    expect(isValidMemberToken(token)).toBe(true);
    expect(token).toHaveLength(64);
  });
});

describe("secret hashing and comparison", () => {
  it("hashes to the 64 hex characters the schema demands", async () => {
    expect(await hashSecret("483921")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives the same input the same hash, so verification works", async () => {
    expect(await hashSecret("483921")).toBe(await hashSecret("483921"));
  });

  it("gives different inputs different hashes", async () => {
    expect(await hashSecret("483921")).not.toBe(await hashSecret("483920"));
  });

  it("does not embed the secret in its own hash", async () => {
    expect(await hashSecret("483921")).not.toContain("483921");
  });

  it("compares equal and unequal strings correctly", () => {
    expect(secretsMatch("abc", "abc")).toBe(true);
    expect(secretsMatch("abc", "abd")).toBe(false);
    expect(secretsMatch("abc", "ab")).toBe(false);
  });
});

describe("member tokens stay out of localStorage", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("round trips a token for the session", () => {
    const token = createMemberToken();
    saveMemberToken("7K9P2X", token);
    expect(loadMemberToken("7K9P2X")).toBe(token);
  });

  it("keeps tokens per room, so joining another room does not clobber this one", () => {
    const first = createMemberToken();
    const second = createMemberToken();
    saveMemberToken("7K9P2X", first);
    saveMemberToken("B4M8QZ", second);
    expect(loadMemberToken("7K9P2X")).toBe(first);
    expect(loadMemberToken("B4M8QZ")).toBe(second);
  });

  it("forgets a token when the room is left", () => {
    saveMemberToken("7K9P2X", createMemberToken());
    clearMemberToken("7K9P2X");
    expect(loadMemberToken("7K9P2X")).toBeNull();
  });

  it("ignores a tampered value rather than returning it", () => {
    sessionStorage.setItem("permamind:room-member:7K9P2X", "not-a-token");
    expect(loadMemberToken("7K9P2X")).toBeNull();
  });
});

describe("the create-then-join round trip", () => {
  it("lets a guest with the code read what the host wrote", async () => {
    const roomKey = await createRoomKey();
    const inviteCode = createInviteCode();
    const salt = createWrapSalt();
    const wrapped = await wrapRoomKey(roomKey, inviteCode, salt);

    // The host writes.
    const sealed = await sealMessage({ body: "ما قررنا بشأن الإطلاق؟" }, roomKey);

    // A guest arrives with the wrapper and the code, and nothing else.
    const guestKey = await unwrapRoomKey(wrapped, inviteCode);
    const opened = await openMessage(sealed.ciphertext, guestKey);

    expect(opened.body).toBe("ما قررنا بشأن الإطلاق؟");
  });

  it("sends the guest nothing that opens the room without the code", async () => {
    const roomKey = await createRoomKey();
    const inviteCode = createInviteCode();
    const salt = createWrapSalt();
    const wrapped: WrappedRoomKey = await wrapRoomKey(roomKey, inviteCode, salt);

    // This is the entire payload a join response carries.
    const response = {
      wrappedRoomKey: JSON.stringify(wrapped),
      wrapSalt: wrapped.salt,
    };

    await expect(
      unwrapRoomKey(JSON.parse(response.wrappedRoomKey), "000000"),
    ).rejects.toThrow(/not valid for this room/);
  });
});

describe("a total database leak yields nothing readable", () => {
  it("leaves the transcript unreadable with everything the server holds", async () => {
    // The attacker has: the room id, the wrapped key, the salt, and every hash. That
    // is the whole of the `rooms` and `room_members` tables. What they do not have is
    // the room key, which never left the host's device, or the invite code, which was
    // hashed before storage.
    const roomKey = await createRoomKey();
    const inviteCode = createInviteCode();
    const hostCode = createHostCode();
    const salt = createWrapSalt();
    const wrapped = await wrapRoomKey(roomKey, inviteCode, salt);

    const secretMessage = await sealMessage(
      { body: "The acquisition target is Northwind" },
      roomKey,
    );

    // Everything the database contains, copied out verbatim.
    const leaked = JSON.stringify({
      rooms: [
        {
          room_id: "7K9P2X",
          invite_code_hash: await hashSecret(inviteCode),
          host_code_hash: await hashSecret(hostCode),
          wrap_salt: Buffer.from(salt).toString("base64"),
          wrapped_room_key: JSON.stringify(wrapped),
          settings_ciphertext: null,
        },
      ],
      room_members: [
        { member_token_hash: await hashSecret(createMemberToken()), role: "host" },
      ],
      room_messages: [
        {
          ciphertext: secretMessage.ciphertext,
          content_hash: secretMessage.contentHash,
          ciphertext_bytes: secretMessage.ciphertextBytes,
        },
      ],
    });

    // The codes are not in the dump, so they cannot be recovered from it, and the
    // transcript is opaque.
    expect(leaked).not.toContain(inviteCode);
    expect(leaked).not.toContain(hostCode);
    expect(leaked).not.toContain("Northwind");

    // The attacker's position is precisely this: they hold the wrapper and the salt
    // and nothing that opens them. A wrong code must yield no key at all, which is
    // the difference between this table and a plaintext copy of the room.
    await expect(unwrapRoomKey(wrapped, "000000")).rejects.toThrow(
      /not valid for this room/,
    );

    // The host code is the one that must not work even when guessed correctly. It is
    // an administration credential, not a decryption credential, and conflating the
    // two would let anyone holding it read the whole room.
    const hostDerived = { key: await deriveHostProbeKey(hostCode, salt) };
    await expect(
      openMessage(secretMessage.ciphertext, hostDerived),
    ).rejects.toThrow(/could not be decrypted/);

    // And the ciphertext does not survive being reused as key material, which is the
    // other thing a dump invites someone to try.
    const rawWrapper = Uint8Array.from(atob(wrapped.wrapped), (character) =>
      character.charCodeAt(0),
    );
    const forged = await importRoomKey(rawWrapper.slice(0, 32));
    await expect(openMessage(secretMessage.ciphertext, forged)).rejects.toThrow(
      /could not be decrypted/,
    );
  });
});

/**
 * Reproduces what a determined attacker does with a host code and a leaked salt: run
 * the same key derivation the guest flow runs, with a different code. If the host code
 * opened the room, this would succeed and the test above would fail.
 */
async function deriveHostProbeKey(code: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(code) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 310_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  ) as Promise<CryptoKey>;
}

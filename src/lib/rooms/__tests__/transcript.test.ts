import { describe, expect, it } from "vitest";

import {
  createRoomKey,
  createWrapSalt,
  hashPlaintext,
  openMessage,
  sealMessage,
  unwrapRoomKey,
  wrapRoomKey,
  type RoomMessagePayload,
} from "@/lib/rooms/crypto";
import { createInviteCode, hashSecret } from "@/lib/rooms/access";
import { announceRoomChange } from "@/lib/rooms/realtime";

/**
 * Phase 4 of docs/group-rooms-design.md.
 *
 * The transcript is the first place where a real person reads what other people wrote,
 * so these cover the two things that would matter most if they broke: a message must
 * open for every member, and it must not open for anyone who is not one.
 */
describe("a message written by one member opens for every member", () => {
  it("round trips through the same key twice, which is what every poll does", async () => {
    const roomKey = await createRoomKey();
    const payload: RoomMessagePayload = { body: "اقتراح: نبدأ بالسوق الأول" };

    // The host writes once; the row is fetched on every poll for every member.
    const sealed = await sealMessage(payload, roomKey);
    expect((await openMessage(sealed.ciphertext, roomKey)).body).toBe(payload.body);
    expect((await openMessage(sealed.ciphertext, roomKey)).body).toBe(payload.body);
  });

  it("carries threading fields through encryption, not around it", async () => {
    // reply_to_id is a cleartext column so a thread can render without decrypting
    // everything, but the link back into the thread lives in the payload too, and
    // that part must survive the round trip.
    const roomKey = await createRoomKey();
    const payload: RoomMessagePayload = {
      body: "أوافق",
      replyToId: "11111111-1111-4111-8111-111111111111",
      threadRootId: "22222222-2222-4222-8222-222222222222",
    };
    const opened = await openMessage((await sealMessage(payload, roomKey)).ciphertext, roomKey);
    expect(opened).toEqual(payload);
  });
});

describe("a member who joins later reads the history, not an empty room", () => {
  it("opens messages sealed before they arrived", async () => {
    const roomKey = await createRoomKey();
    const inviteCode = createInviteCode();
    const salt = createWrapSalt();
    const wrapped = await wrapRoomKey(roomKey, inviteCode, salt);

    // History is written first.
    const first = await sealMessage({ body: "الرسالة الأولى" }, roomKey);
    const second = await sealMessage({ body: "الرسالة الثانية" }, roomKey);

    // A guest arrives afterwards and unwraps the same key.
    const guestKey = await unwrapRoomKey(wrapped, inviteCode);
    expect((await openMessage(first.ciphertext, guestKey)).body).toBe("الرسالة الأولى");
    expect((await openMessage(second.ciphertext, guestKey)).body).toBe("الرسالة الثانية");
  });
});

describe("undecryptable rows are dropped rather than shown as errors", () => {
  it("ignores a row sealed under a different key instead of failing the load", async () => {
    // This is the real case: a host who closes the tab and reopens the room makes a
    // new key, and every earlier message becomes unreadable. The transcript must still
    // render the rows it can read.
    const current = await createRoomKey();
    const previous = await createRoomKey();

    const readable = await sealMessage({ body: "بعد إعادة الفتح" }, current);
    const stale = await sealMessage({ body: "قبل إعادة الفتح" }, previous);

    const rows = [stale, readable];
    const decoded: string[] = [];
    for (const row of rows) {
      try {
        decoded.push((await openMessage(row.ciphertext, current)).body);
      } catch {
        // Dropped, by design. See the note on useRoomTranscript.
      }
    }

    expect(decoded).toEqual(["بعد إعادة الفتح"]);
  });
});

describe("the content hash matches what the schema requires", () => {
  it("is 64 hex characters for a sealed message", async () => {
    const roomKey = await createRoomKey();
    const sealed = await sealMessage({ body: "x" }, roomKey);
    expect(sealed.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable for identical payloads, so a retry cannot look like a new message", async () => {
    const a = await hashPlaintext({ body: "same" });
    const b = await hashPlaintext({ body: "same" });
    expect(a).toBe(b);
  });
});

describe("two members hold different keys and still share a room", () => {
  it("a member token never substitutes for the room key", async () => {
    // The member token authorises reading the ciphertext. It is not, and must never
    // become, something that can decrypt it.
    const roomKey = await createRoomKey();
    const sealed = await sealMessage({ body: "confidential" }, roomKey);

    const memberToken = "a".repeat(64);
    await expect(openMessage(sealed.ciphertext, { key: await importKeyFrom(memberToken) })).rejects.toThrow(
      /could not be decrypted/,
    );
  });
});

/** A stand-in for "the token was used as key material", which is the attack. */
async function importKeyFrom(hex: string) {
  const bytes = new Uint8Array(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));
  return crypto.subtle.importKey("raw", bytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/**
 * Phase 3 of docs/group-rooms-design.md: the Realtime signal.
 *
 * The design rests on one claim — that the channel tells a subscriber to re-read the
 * transcript and carries nothing itself. These assert it directly, against the actual
 * request body the server builds, rather than describing it in a comment that a later
 * change could contradict.
 */
describe("the realtime signal announces a change and discloses nothing", () => {
  it("sends an event name and an empty payload, with no room and no content", async () => {
    const sent = await captureBroadcast(async () => {
      await announceRoomChange("3f1c9a20-6f0e-4a4b-9d2b-7c1e5f0a9b31");
    });

    const body = sent.body as { messages: { topic: string; event: string; payload: unknown }[] };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].event).toBe("changed");
    // The payload is the whole point: there is nothing in it to read, even by someone who
    // has the channel. The subscriber learns that something changed and nothing else.
    expect(body.messages[0].payload).toEqual({});
  });

  it("names the channel by feed id, never by room id", async () => {
    // A room id is six characters chosen to be read aloud over a phone. Broadcasting on
    // it would let anyone who saw a pasted link subscribe to the room's channel.
    const sent = await captureBroadcast(async () => {
      await announceRoomChange("3f1c9a20-6f0e-4a4b-9d2b-7c1e5f0a9b31");
    });

    const body = sent.body as { messages: { topic: string }[] };
    expect(body.messages[0].topic).toBe("room:3f1c9a20-6f0e-4a4b-9d2b-7c1e5f0a9b31");
    expect(body.messages[0].topic).not.toMatch(/^[A-Z2-9]{6}$/);
  });

  it("puts no ciphertext, no token, and no author in the request body", async () => {
    // A real transcript is built first, so the assertion runs against the exact thing
    // that would leak if the signal ever grew a body.
    const roomKey = await createRoomKey();
    const message = await sealMessage({ body: "الاستحواذ على نورث ويند" }, roomKey);
    const memberToken = "b".repeat(64);

    const sent = await captureBroadcast(async () => {
      await announceRoomChange("3f1c9a20-6f0e-4a4b-9d2b-7c1e5f0a9b31");
    });

    const raw = JSON.stringify(sent.body);
    expect(raw).not.toContain(message.ciphertext);
    expect(raw).not.toContain(message.contentHash);
    expect(raw).not.toContain(memberToken);
    expect(raw).not.toContain("نورث ويند");
    expect(raw).not.toContain(await hashSecret(memberToken));
  });

  it("never lets a failed signal fail the message that triggered it", async () => {
    // A Realtime node that is slow or down must not cost a member their message. The
    // subscriber catches up on its next poll, so swallowing here is correct.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;
    try {
      await expect(announceRoomChange("3f1c9a20-6f0e-4a4b-9d2b-7c1e5f0a9b31")).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does nothing when Supabase is not configured, rather than throwing", async () => {
    const originalFetch = globalThis.fetch;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      return Promise.reject(new Error("should not be called"));
    }) as typeof fetch;
    try {
      await expect(announceRoomChange("3f1c9a20-6f0e-4a4b-9d2b-7c1e5f0a9b31")).resolves.toBeUndefined();
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      if (url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = url;
      if (key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    }
  });
});

/**
 * Runs `announceRoomChange` against a stubbed fetch and returns what it sent.
 *
 * The service key is injected rather than read from the environment, so the test does
 * not depend on a `.env` file being present. No real network call is made.
 */
async function captureBroadcast(run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-for-test";

  let captured: { url: string; body: unknown } | null = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    captured = { url: String(input), body: JSON.parse(String(init?.body ?? "{}")) };
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  }

  expect(captured, "the broadcast was never sent").not.toBeNull();
  return captured as unknown as { url: string; body: unknown };
}

describe("a display name travels encrypted and never as a column", () => {
  // Section 4: a room of "Guest 4f2" cannot be moderated, so every guest is asked for a name
  // and it is required by default. The design is equally explicit about where the name
  // lives: inside the encrypted payload, never in a column, so the server can enforce that
  // one was supplied without ever learning what it was.

  it("round trips the name through encryption", async () => {
    const roomKey = await createRoomKey();
    const sealed = await sealMessage({ body: "on my way", alias: "Yara" }, roomKey);
    expect((await openMessage(sealed.ciphertext, roomKey)).alias).toBe("Yara");
  });

  it("keeps the name out of the ciphertext payload a reader can see", async () => {
    // The name is inside the ciphertext, not beside it. A dump of the row shows the sealed
    // bytes and nothing that names a person.
    const roomKey = await createRoomKey();
    const sealed = await sealMessage({ body: "on my way", alias: "Yara" }, roomKey);

    expect(sealed.ciphertext).not.toContain("Yara");
    expect(JSON.stringify(sealed)).not.toContain("Yara");
    // And it is unreadable without the room key, so it cannot be harvested from storage.
    const other = await createRoomKey();
    await expect(openMessage(sealed.ciphertext, other)).rejects.toThrow();
  });

  it("omits the field entirely when no name was given", async () => {
    // A nameless member falls back to the generated "Guest xxxx" label at render time, so an
    // empty string must not become a stored alias that overrides that fallback.
    const roomKey = await createRoomKey();
    const named = await sealMessage({ body: "x", alias: undefined }, roomKey);
    expect((await openMessage(named.ciphertext, roomKey)).alias).toBeUndefined();
  });

  it("carries Arabic names unchanged", async () => {
    // The name is the one field a person types in their own script, so encoding a round trip
    // that mangles it would make the feature useless in the Arabic interface.
    const roomKey = await createRoomKey();
    const sealed = await sealMessage({ body: "قريبا", alias: "سارة" }, roomKey);
    expect((await openMessage(sealed.ciphertext, roomKey)).alias).toBe("سارة");
  });
});

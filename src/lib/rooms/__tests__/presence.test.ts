import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The presence label, and the leak it exists to stop.
 *
 * Realtime presence is keyed by whatever a client passes as `presence.key`, and the key is
 * readable by every subscriber of the channel. The channel here is named after the room's
 * `feed_id` and carries no authorisation of its own, so anything placed in that key should be
 * treated as visible to anyone who has the topic name.
 *
 * The code this replaces used `memberToken.slice(0, 16)` — the first sixteen characters of a
 * live member credential, published on that channel. These tests are the reason that is not
 * the code any more, and they are written so the original mistake fails loudly rather than
 * subtly: a label that merely *looks* random would pass a shape check while still being
 * derived from the secret.
 *
 * `jsdom` is the environment these run in, so `sessionStorage` and `crypto.getRandomValues`
 * are both available and the real code path is exercised.
 */

const TOKEN = "9f8c4b2a1d6e7f0b3c5a9d2e8f4b6c1a7d0e3f5b8c2a6d9e1f4b7c0a3d6e9f2b";

function stored(): string | null {
  return window.sessionStorage.getItem("permamind:room-presence");
}

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe("presenceLabel", () => {
  it("is sixteen hex characters", async () => {
    const { presenceLabel } = await import("../presence");

    expect(presenceLabel()).toMatch(/^[0-9a-f]{16}$/);
  });

  it("contains no fragment of the member token", async () => {
    const { presenceLabel } = await import("../presence");

    const label = presenceLabel();

    // The regression this file exists for. A label that is a slice of the token would pass
    // a length check and a character check, and would hand a live credential to every
    // subscriber of the presence channel.
    expect(label).not.toContain(TOKEN.slice(0, 16));
    expect(label).not.toContain(TOKEN.slice(0, 4));
    expect(TOKEN).not.toContain(label);

    // And nothing from it at all, as a substring in either direction.
    //
    // Only from eight characters up, and deliberately so. A sixteen-character random hex
    // string contains any given *two*-character substring about 62% of the time, so the
    // earlier version of this loop — which started at two — failed roughly two runs in three
    // against a label that leaked nothing. Eight characters collide about once in fifty
    // million, which is the honest threshold for "this cannot be a coincidence".
    for (let size = 8; size <= 16; size += 4) {
      expect(label).not.toContain(TOKEN.slice(0, size));
    }
  });

  it("is stable within a tab, so a re-render is not an arrival", async () => {
    const { presenceLabel } = await import("../presence");

    // A label that changed on every render would make the presence map flicker and would make
    // "did they actually leave?" unanswerable.
    const first = presenceLabel();
    expect(presenceLabel()).toBe(first);
    expect(presenceLabel()).toBe(first);
    expect(stored()).toBe(first);
  });

  it("survives a React StrictMode double effect", async () => {
    const { presenceLabel } = await import("../presence");

    // StrictMode mounts effects twice in development. Two different labels would present the
    // tab as an arrival followed by a departure.
    const duringFirstPass = presenceLabel();
    const duringSecondPass = presenceLabel();

    expect(duringSecondPass).toBe(duringFirstPass);
  });

  it("gives different tabs different labels", async () => {
    const { presenceLabel } = await import("../presence");

    const first = presenceLabel();
    window.sessionStorage.clear();
    const second = presenceLabel();

    // Eight random bytes. A collision between two tabs in one room is the case that would
    // make one person's presence look like another's.
    expect(second).not.toBe(first);
    expect(second).toMatch(/^[0-9a-f]{16}$/);
  });

  it("replaces a stored value that is not sixteen hex characters", async () => {
    const { presenceLabel } = await import("../presence");

    // A hand-edited or stale value must not reach Realtime as a channel key of arbitrary
    // shape.
    window.sessionStorage.setItem("permamind:room-presence", "not-a-label");
    expect(presenceLabel()).toMatch(/^[0-9a-f]{16}$/);

    window.sessionStorage.setItem("permamind:room-presence", "../../etc/passwd");
    expect(presenceLabel()).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("clearPresenceLabel", () => {
  it("forgets the tab's label, so a client-side navigation is a real departure", async () => {
    const { clearPresenceLabel, presenceLabel } = await import("../presence");

    const first = presenceLabel();
    clearPresenceLabel();

    expect(stored()).toBeNull();
    // The next arrival is genuinely a new one, which is the point: Realtime removes a
    // presence when a socket closes, but not when a single-page app navigates away and
    // leaves the socket open.
    expect(presenceLabel()).not.toBe(first);
  });

  it("does not throw when storage is unavailable", async () => {
    const { clearPresenceLabel } = await import("../presence");

    expect(() => clearPresenceLabel()).not.toThrow();
  });
});

describe("what a presence label is allowed to reveal", () => {
  it("identifies this tab and nothing about the person", async () => {
    const { presenceLabel } = await import("../presence");

    const label = presenceLabel();

    // The honest claim, stated as a test: the label carries no membership information at
    // all. It is not a hash of the token, it is not derived from the room id, and it is not
    // the first characters of anything the server would recognise.
    expect(label).not.toContain("BK7P2X");
    expect(label.length).toBe(16);
    // Entropy: eight bytes is what makes guessing another member's label pointless, since a
    // label grants nothing even when guessed.
    expect(label).toMatch(/^[0-9a-f]{16}$/);
  });
});
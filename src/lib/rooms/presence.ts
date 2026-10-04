/**
 * The presence label a browser announces itself with.
 *
 * ## What this must never be
 *
 * Not a slice of the member token. Not a hash of it. Not anything derived from a secret.
 *
 * The presence channel is keyed by `roomFeedTopic(feedId)`, and Realtime presence state is
 * readable by every subscriber of that topic. A subscriber is not always a member: the topic
 * name is the only thing standing between an outsider and the presence map, so anything put
 * here is treated as visible to whoever guessed or obtained the feed id. Deriving the key
 * from the member token would publish the first sixteen characters of a live credential on a
 * channel with no authorisation check on it.
 *
 * ## What it is instead
 *
 * Sixteen random hex characters, generated once per tab and reused for the tab's lifetime.
 * It identifies *this tab*, not *this person*, which is the honest claim: one person in two
 * tabs is two presences, and presence is a statement about who is looking right now.
 *
 * The label is meaningless on its own. A member who wanted to name another member would need
 * to link a label to a token, and the only place that link exists is the local map in
 * `use-room-transcript`, which is why the host — and not a guest — is the only client that can
 * turn a label into a display name.
 */

/** Sixteen hex characters: eight random bytes, enough to be unguessable in a room. */
const LABEL_BYTES = 8;

/**
 * Returns this tab's presence label, creating it on first call.
 *
 * The value is cached in `sessionStorage` rather than generated per call so that a React
 * re-render, a StrictMode double-effect, or a reconnect does not present the tab as a new
 * arrival. A label that changed on every render would make the presence map flicker and would
 * make "did they actually leave?" unanswerable.
 *
 * `sessionStorage` is the right scope rather than `localStorage`: the label should not
 * outlive the tab, so closing the browser clears it and the next visit is a fresh arrival.
 */
export function presenceLabel(): string {
  if (typeof window === "undefined") return "";

  const KEY = "permamind:room-presence";
  try {
    const existing = window.sessionStorage.getItem(KEY);
    // Validated on read, because a hand-edited value would otherwise reach Realtime as a
    // channel key of arbitrary shape.
    if (existing && /^[0-9a-f]{16}$/.test(existing)) return existing;

    const bytes = new Uint8Array(LABEL_BYTES);
    crypto.getRandomValues(bytes);
    const label = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    window.sessionStorage.setItem(KEY, label);
    return label;
  } catch {
    // Private browsing, or storage disabled. A per-call label still works; it only means a
    // re-render can look like a departure followed by an arrival.
    const bytes = new Uint8Array(LABEL_BYTES);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}

/**
 * Forgets this tab's presence label.
 *
 * Called when a client deliberately leaves a room. Realtime removes a presence on its own
 * when a socket closes, which covers the tab being closed, but not a member who navigates
 * away inside a single-page app: the socket stays open and the label would linger until the
 * page is finally torn down.
 */
export function clearPresenceLabel(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem("permamind:room-presence");
  } catch {
    // Nothing to do. The label is not a secret and its absence is harmless.
  }
}
/**
 * The room change signal.
 *
 * Everything about this module exists because the obvious approach was rejected. Adding
 * `room_messages` to the `supabase_realtime` publication and subscribing to database
 * changes would stream whole rows to every subscriber of a public channel, including
 * `author_token_hash` and `wrapped_room_key`. It would also not work: `room_token_hash()`
 * reads `request.headers`, and a WebSocket handshake does not carry the member token the
 * way a REST call does, so a guest's subscription would resolve to no role and receive
 * nothing regardless.
 *
 * So nothing is published and the tables are never touched by Realtime. The server sends
 * one word on a channel named after the room's `feed_id`, and a subscriber that hears it
 * re-reads the transcript through `/api/rooms/messages` — the endpoint that resolves the
 * member token properly and returns ciphertext.
 *
 * What a channel subscriber learns: that a room exists and changed. What it cannot do:
 * read anything, because the signal body is empty and the fetch behind it needs a token.
 *
 * This file deliberately does not import `server-only`. It reads the service role key,
 * so it must never be imported by a client component, but keeping it out of the
 * `server.ts` dependency graph is what lets the safety assertions in
 * `__tests__/transcript.test.ts` run against the real function rather than a copy of it.
 * The one rule that follows: only ever call this from a route handler or a
 * `"use server"` module.
 */

/** The channel a room announces itself on. Namespaced so it cannot collide. */
export function roomFeedTopic(feedId: string): string {
  return `room:${feedId}`;
}

/**
 * Tells subscribers that the room changed, without saying what changed.
 *
 * Failure is swallowed on purpose. The message is already stored by the time this runs,
 * so a Realtime node that is slow or down must not cost a member their message; the
 * subscriber catches up on its next poll. The two-second timeout exists for the same
 * reason — a slow node must not hold a message post open.
 */
export async function announceRoomChange(feedId: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [{ topic: roomFeedTopic(feedId), event: "changed", payload: {} }],
      }),
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // Deliberately swallowed. See the note above.
  }
}
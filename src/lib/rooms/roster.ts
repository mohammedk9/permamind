import "server-only";

import { hashSecret } from "@/lib/rooms/access";
import { RoomError } from "@/lib/rooms/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * The sealed roster: who is in a room, by name, without the server ever reading a name.
 *
 * ## Why names are sealed
 *
 * Section 4 promises that the server never learns what anyone is called, and the transcript
 * keeps that promise by carrying each name inside the message payload. A roster cannot do the
 * same, because a member who has not spoken has no message to carry their name — and the host
 * is explicitly to see names whether or not anyone has written anything.
 *
 * So the name is sealed once, at join, into `room_members.alias_ciphertext`. The server stores
 * a string it cannot open and serves it back only to the host. That is the same relationship
 * the transcript has with its ciphertext, applied to a name instead of a sentence.
 *
 * ## Who may read the roster
 *
 * The host, and only the host. A guest is served a count from the presence channel and never
 * receives a single sealed alias. That is not a UI decision: `readRoster` refuses before it
 * queries, so a guest calling the endpoint directly gets the same refusal as a stranger.
 *
 * This is the one place the design lets the server know *who is in the room* and *what they
 * are called*, and it is bounded in two ways: the name is ciphertext at rest, and only the
 * host can obtain the key material to read it.
 */

/**
 * The longest name this module will seal.
 *
 * Not exported. The client owns the name it sends — `room-presence-strip` truncates to the same
 * figure before sealing — and re-exporting it produced a second public copy of a number nobody
 * imported. The route validates the stored length separately, against the schema's own bound,
 * so there was never a caller here to serve.
 */
const MAX_ALIAS_LENGTH = 40;

export interface SealedRosterEntry {
  /** The host's six-character label for this member, matching the members panel. */
  label: string;
  role: "host" | "trusted" | "guest";
  /** Sealed under the room key. Null for a member who gave no name. */
  aliasCiphertext: string | null;
  joinedAt: string;
}

function admin() {
  const client = getSupabaseAdminClient();
  if (!client) throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");
  return client;
}

/**
 * Seals a member's name into their row. Called once at join.
 *
 * A member with no name stores nothing: the columns stay null and the host's list shows the
 * generated "Guest xxxx" label instead. Storing an empty string would be indistinguishable
 * from storing a real empty name, and would make "has this member chosen a name" a question
 * the schema cannot answer.
 */
export async function setMemberAlias(input: {
  roomId: string;
  memberToken: string;
  aliasCiphertext: string;
  aliasBytes: number;
}): Promise<void> {
  if (!input.aliasCiphertext || input.aliasBytes <= 0 || input.aliasBytes > 1024) {
    throw new RoomError("That name could not be saved", 400, "ALIAS_INVALID");
  }

  const { error } = await admin()
    .from("room_members")
    .update({
      alias_ciphertext: input.aliasCiphertext,
      alias_bytes: input.aliasBytes,
    })
    .eq("room_id", input.roomId)
    .eq("member_token_hash", await hashSecret(input.memberToken));

  if (error) throw new RoomError("That name could not be saved", 503, "ALIAS_FAILED");
}

/**
 * Reads the sealed roster. Host only.
 *
 * Returns ciphertext, never a name. The caller opens each entry with the room key, which the
 * host holds and a guest is never served.
 */
export async function readRoster(input: {
  roomId: string;
  memberToken: string;
}): Promise<SealedRosterEntry[]> {
  await assertHost(input);

  const { data, error } = await admin()
    .from("room_members")
    .select("member_token_hash,role,alias_ciphertext,joined_at")
    .eq("room_id", input.roomId);

  if (error || !data) return [];

  return (data as Record<string, unknown>[])
    .map((row) => ({
      label: String(row.member_token_hash).slice(0, 6),
      role: String(row.role) as SealedRosterEntry["role"],
      aliasCiphertext: row.alias_ciphertext ? String(row.alias_ciphertext) : null,
      joinedAt: String(row.joined_at),
    }))
    .sort((a, b) => {
      const rank = { host: 0, trusted: 1, guest: 2 } as const;
      return rank[a.role] - rank[b.role] || b.joinedAt.localeCompare(a.joinedAt);
    });
}

/**
 * Confirms the caller is the room's host.
 *
 * A non-member and a non-host get the same refusal, so this endpoint cannot be used to learn
 * whether a room exists or who is in it. `trusted` is deliberately excluded: a trusted member
 * may spend the host's key, which is a cost decision, not authority over who the room calls
 * itself.
 */
async function assertHost(input: { roomId: string; memberToken: string }): Promise<void> {
  const { data } = await admin()
    .from("room_members")
    .select("role")
    .eq("room_id", input.roomId)
    .eq("member_token_hash", await hashSecret(input.memberToken))
    .maybeSingle();

  if (!data || String((data as Record<string, unknown>).role) !== "host") {
    throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");
  }
}
import "server-only";

import { hashSecret } from "@/lib/rooms/access";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { RoomMemberView } from "@/types/room";

/**
 * Host member administration (section 4, "Roles and the AI permission").
 *
 * ## The identification problem, and why it is not a vulnerability
 *
 * The host has to be able to say "trust that person". They cannot do it by display name,
 * because names live encrypted inside message payloads and never reach the database. So
 * members are listed by a short label derived from their own member token, and the host
 * selects one.
 *
 * A reader reasonably asks whether a six-character label can be guessed by someone outside
 * the room. It cannot be used to gain anything, because **authorisation on every function
 * here is by the caller's member token, never by the label**. The label is a selector the
 * host uses; it grants nothing on its own. An outsider who enumerated every label in a room
 * could still not call any of these, and a guest who copied another guest's label could not
 * promote themselves, because the caller is checked against the host row before the label is
 * looked at.
 *
 * Six hex characters is chosen over four so that a room of ordinary size has no realistic
 * chance of two members sharing one, which would make the host's click ambiguous.
 *
 * ## What the host cannot do
 *
 * - Promote anyone to `host`. There is one host per room, enforced by a unique index, and
 *   the schema also requires a host row to have a null `invited_by`. Attempting it is
 *   rejected here rather than left to surface as a constraint violation.
 * - Demote or remove the host, including by demoting themselves. Removing the host row
 *   would leave a room nobody administers, and the host can end the room outright instead.
 * - Learn anything about a member beyond their label and when they joined. The token hash
 *   is never returned: a host who saw every hash could correlate a member across rooms.
 */

export class MemberAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "MemberAdminError";
  }
}

/** Characters in a member's label. Hex keeps it readable when read aloud over a call. */
const LABEL_LENGTH = 6;

function admin() {
  const client = getSupabaseAdminClient();
  if (!client) throw new MemberAdminError("Rooms are unavailable", 503, "ROOMS_UNAVAILABLE");
  return client;
}

/**
 * The label a host sees.
 *
 * Derived from the stored hash rather than the token, because the server never has the token
 * back. It is a prefix of a value the host could already not use, and it is not reversible
 * into a token without the secret that produced the hash.
 */
function labelFor(tokenHash: string): string {
  return tokenHash.slice(0, LABEL_LENGTH);
}

/** Every member of a room, for the host only. */
export async function listRoomMembers(input: {
  roomId: string;
  memberToken: string;
}): Promise<RoomMemberView[]> {
  await assertHost(input);

  const { data, error } = await admin()
    .from("room_members")
    .select("member_token_hash,role,joined_at,last_seen_at")
    .eq("room_id", input.roomId);

  if (error || !data) return [];

  return (data as Record<string, unknown>[])
    .map((row) => ({
      label: labelFor(String(row.member_token_hash)),
      role: String(row.role) as RoomMemberView["role"],
      joinedAt: String(row.joined_at),
      lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
    }))
    // The host first, then trusted, then newest guests. The ordering is the one a host
    // needs: their own row at the top and the people they granted access beneath it.
    .sort((a, b) => {
      const rank = { host: 0, trusted: 1, guest: 2 } as const;
      return rank[a.role] - rank[b.role] || b.joinedAt.localeCompare(a.joinedAt);
    });
}

/**
 * Promotes a guest to `trusted`, or returns them to `guest`.
 *
 * `trusted` is the whole of the AI permission, so this is the only lever on the host's
 * spend: the number of people who can spend their key is the number of rows promoted.
 */
export async function setMemberRole(input: {
  roomId: string;
  memberToken: string;
  targetLabel: string;
  role: "trusted" | "guest";
}): Promise<RoomMemberView> {
  await assertHost(input);

  const label = input.targetLabel.trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(label)) {
    throw new MemberAdminError("That member is not in this room", 404, "MEMBER_NOT_FOUND");
  }

  // The route validates this too, but a type annotation is not a runtime check and this
  // module is the layer everything else calls. Without the guard, a caller that reached past
  // the route — a future internal caller, or anything bypassing it — could write `role:
  // "host"` onto a second row and break the one-host-per-room invariant at the database.
  if (input.role !== "trusted" && input.role !== "guest") {
    throw new MemberAdminError("A member can only be trusted or a guest", 400, "ROLE_INVALID");
  }

  const { data: target, error: lookupError } = await admin()
    .from("room_members")
    .select("member_token_hash,role,joined_at,last_seen_at")
    .eq("room_id", input.roomId)
    .like("member_token_hash", `${label}%`)
    .maybeSingle();

  if (lookupError || !target) {
    throw new MemberAdminError("That member is not in this room", 404, "MEMBER_NOT_FOUND");
  }

  const currentRole = String((target as Record<string, unknown>).role);
  if (currentRole === "host") {
    throw new MemberAdminError("The host cannot change their own role", 403, "ROLE_HOST_LOCKED");
  }

  const { error } = await admin()
    .from("room_members")
    .update({ role: input.role })
    .eq("room_id", input.roomId)
    .eq("member_token_hash", (target as Record<string, unknown>).member_token_hash);

  if (error) throw new MemberAdminError("That change could not be saved", 503, "ROLE_UPDATE_FAILED");

  const row = target as Record<string, unknown>;
  return {
    label,
    role: input.role,
    joinedAt: String(row.joined_at),
    lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
  };
}

/**
 * Removes a member. Their token stops working on the next request.
 *
 * Revocation is the point: the design says a host may revoke "at any moment by removing the
 * member row". Nothing else is deleted, so the transcript they already wrote remains, which
 * is the honest outcome for the people still in the room.
 */
export async function removeMember(input: {
  roomId: string;
  memberToken: string;
  targetLabel: string;
}): Promise<void> {
  await assertHost(input);

  const label = input.targetLabel.trim().toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(label)) {
    throw new MemberAdminError("That member is not in this room", 404, "MEMBER_NOT_FOUND");
  }

  const { data: target } = await admin()
    .from("room_members")
    .select("member_token_hash,role")
    .eq("room_id", input.roomId)
    .like("member_token_hash", `${label}%`)
    .maybeSingle();

  if (!target) {
    throw new MemberAdminError("That member is not in this room", 404, "MEMBER_NOT_FOUND");
  }
  if (String((target as Record<string, unknown>).role) === "host") {
    throw new MemberAdminError("The host cannot remove themselves", 403, "ROLE_HOST_LOCKED");
  }

  await admin()
    .from("room_members")
    .delete()
    .eq("room_id", input.roomId)
    .eq("member_token_hash", (target as Record<string, unknown>).member_token_hash);
}

/**
 * Confirms the caller is the room's host.
 *
 * Membership alone is not enough for any of this. A `trusted` member can invoke the model
 * and therefore spend the key, but granting that power to other people, and ending other
 * people's access, is the host's alone.
 */
async function assertHost(input: { roomId: string; memberToken: string }): Promise<void> {
  const { data } = await admin()
    .from("room_members")
    .select("role")
    .eq("room_id", input.roomId)
    .eq("member_token_hash", await hashSecret(input.memberToken))
    .maybeSingle();

  // A non-member and a wrong role produce the same refusal, so this endpoint cannot be used
  // to find out whether a room exists or who is in it.
  if (!data || String((data as Record<string, unknown>).role) !== "host") {
    throw new MemberAdminError("This invite is not valid", 404, "INVITE_INVALID");
  }
}
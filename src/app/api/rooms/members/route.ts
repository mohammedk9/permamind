import { NextResponse } from "next/server";

import { isValidRoomId, isValidMemberToken } from "@/lib/rooms/access";
import {
  listRoomMembers,
  MemberAdminError,
  removeMember,
  setMemberRole,
} from "@/lib/rooms/members";

export const runtime = "nodejs";

/**
 * GET, PATCH, DELETE /api/rooms/members — who is in a room, and what they may do.
 *
 * Host-only, and the check is the same one the transcript uses: a member token in a header.
 * That is why this endpoint takes the caller's token and not a room id alone — a room id is
 * six characters and appears in every shared link, so it authorises nothing.
 *
 * Three verbs, one file, because the three actions are one decision from the host's point of
 * view: who may spend my key, and who may still read at all. Splitting them across files
 * would mean three copies of the same "is this the host" check.
 */

function fail(error: unknown) {
  if (error instanceof MemberAdminError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: "The room is unavailable" }, { status: 500 });
}

/** Shape check shared by every verb, so a malformed request never reaches the database. */
function identify(request: Request) {
  const roomId = new URL(request.url).searchParams.get("roomId") ?? "";
  const memberToken = request.headers.get("x-room-member") ?? "";
  if (!isValidRoomId(roomId) || !isValidMemberToken(memberToken)) {
    return null;
  }
  return { roomId, memberToken };
}

/**
 * GET — the member list, for the host.
 *
 * Returns labels and roles only. The token hash is deliberately absent: a host who held every
 * hash could recognise the same member in a second room, which is exactly the correlation
 * this design refuses to make possible.
 */
export async function GET(request: Request) {
  const who = identify(request);
  if (!who) {
    return NextResponse.json({ error: "This invite is not valid", code: "INVITE_INVALID" }, { status: 404 });
  }
  try {
    return NextResponse.json({ members: await listRoomMembers(who) });
  } catch (error) {
    return fail(error);
  }
}

/**
 * PATCH — promote a member to `trusted`, or return them to `guest`.
 *
 * `trusted` is the entire AI permission, so this call is the only thing that widens who can
 * spend the host's key. It is deliberately a single field: a body naming any other role is
 * refused rather than interpreted.
 */
export async function PATCH(request: Request) {
  const who = identify(request);
  if (!who) {
    return NextResponse.json({ error: "This invite is not valid", code: "INVITE_INVALID" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const targetLabel = typeof body?.targetLabel === "string" ? body.targetLabel : "";
  const role = body?.role;

  if (!/^[0-9a-f]{6}$/i.test(targetLabel.trim())) {
    return NextResponse.json({ error: "That member is not in this room", code: "MEMBER_NOT_FOUND" }, { status: 404 });
  }
  // `host` is not offered here and is not silently coerced. There is one host per room, and
  // a caller who asks for it has misunderstood what this endpoint does.
  if (role !== "trusted" && role !== "guest") {
    return NextResponse.json({ error: "A member can only be trusted or a guest", code: "ROLE_INVALID" }, { status: 400 });
  }

  try {
    return NextResponse.json({
      member: await setMemberRole({ ...who, targetLabel, role }),
    });
  } catch (error) {
    return fail(error);
  }
}

/**
 * DELETE — remove a member.
 *
 * Their token stops working on their next request. Nothing they already wrote is deleted:
 * the people still in the room have read it, and quietly rewriting the transcript under them
 * would be a worse outcome than a former member's sentences staying put.
 */
export async function DELETE(request: Request) {
  const who = identify(request);
  if (!who) {
    return NextResponse.json({ error: "This invite is not valid", code: "INVITE_INVALID" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const targetLabel = typeof body?.targetLabel === "string" ? body.targetLabel : "";
  if (!/^[0-9a-f]{6}$/i.test(targetLabel.trim())) {
    return NextResponse.json({ error: "That member is not in this room", code: "MEMBER_NOT_FOUND" }, { status: 404 });
  }

  try {
    await removeMember({ ...who, targetLabel });
    return NextResponse.json({ removed: true });
  } catch (error) {
    return fail(error);
  }
}
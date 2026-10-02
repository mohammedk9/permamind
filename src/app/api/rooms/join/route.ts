import { NextResponse } from "next/server";

import { isValidInviteCode, isValidRoomId } from "@/lib/rooms/access";
import { joinRoom, RoomError } from "@/lib/rooms/server";

export const runtime = "nodejs";

/**
 * POST /api/rooms/join — exchange a room id and invite code for a member token.
 *
 * No account, no email, no password. That is the point of a guest: the only thing
 * standing between a stranger and the room is a six-digit code the host chose to share.
 *
 * The response carries the wrapped room key, not the key. A caller who has the response
 * body and nothing else still cannot read a single message.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const roomId = typeof body.roomId === "string" ? body.roomId : "";
  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : "";

  // Shape is checked here so a malformed request never reaches the database, and the
  // error is deliberately the same one a wrong code produces.
  if (!isValidRoomId(roomId) || !isValidInviteCode(inviteCode)) {
    return NextResponse.json(
      { error: "This invite is not valid", code: "INVITE_INVALID" },
      { status: 404 },
    );
  }

  try {
    const result = await joinRoom({ roomId, inviteCode });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof RoomError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "This room could not be joined" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { isValidMemberToken, isValidRoomId } from "@/lib/rooms/access";
import { readRoomModels, RoomError } from "@/lib/rooms/server";

export const runtime = "nodejs";

/**
 * GET /api/rooms/models — every model in this room, and what each owner agreed about it.
 *
 * **Open to every member, a guest included.** Knowing who else is answering is the point of a
 * panel: a member who cannot see the cast cannot choose who speaks, and a room where the models
 * are invisible is the random-reply room the addressing feature exists to prevent.
 *
 * A model whose owner set `silent` is still listed. It is shown as silent rather than hidden,
 * because a member who pressed a name and found nothing there learns less than one who is told
 * the model is there and may not be asked.
 */
export async function GET(request: Request) {
  const roomId = new URL(request.url).searchParams.get("roomId") ?? "";
  const memberToken = request.headers.get("x-room-member") ?? "";

  if (!isValidRoomId(roomId) || !isValidMemberToken(memberToken)) {
    return NextResponse.json({ error: "This invite is not valid", code: "INVITE_INVALID" }, { status: 404 });
  }

  try {
    return NextResponse.json({ models: await readRoomModels({ roomId, memberToken }) });
  } catch (error) {
    if (error instanceof RoomError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "The room is unavailable" }, { status: 500 });
  }
}
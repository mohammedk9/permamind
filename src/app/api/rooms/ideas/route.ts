import { NextResponse } from "next/server";

import { isValidMemberToken, isValidRoomId } from "@/lib/rooms/access";
import { createIdea, readIdeas, RoomError } from "@/lib/rooms/server";

export const runtime = "nodejs";

/**
 * GET, POST /api/rooms/ideas — the room's board.
 *
 * ## Any member may propose, and a guest is a member
 *
 * Adding an idea spends nobody's key and creates no task, so the panel rules do not apply and
 * neither does section 4's restriction on guests invoking the model. A guest proposing an idea
 * is a guest taking part. What a guest cannot do is accept, drop, or convert — those are host
 * only, and the boundary matters because acceptance is what moves something into the host's
 * permanent memory.
 *
 * ## The body arrives sealed
 *
 * `ciphertext` is written by the browser under the room key. This route never sees the idea,
 * only that a row was added — the same property `postMessage` has, and for the same reason.
 */
function identify(request: Request) {
  const roomId = new URL(request.url).searchParams.get("roomId") ?? "";
  const memberToken = request.headers.get("x-room-member") ?? "";
  if (!isValidRoomId(roomId) || !isValidMemberToken(memberToken)) return null;
  return { roomId, memberToken };
}

function fail(error: unknown) {
  if (error instanceof RoomError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: "The room is unavailable" }, { status: 500 });
}

export async function GET(request: Request) {
  const who = identify(request);
  if (!who) {
    return NextResponse.json(
      { error: "This invite is not valid", code: "INVITE_INVALID" },
      { status: 404 },
    );
  }
  try {
    return NextResponse.json({ ideas: await readIdeas(who) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const who = identify(request);
  if (!who) {
    return NextResponse.json(
      { error: "This invite is not valid", code: "INVITE_INVALID" },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const ciphertext = typeof body?.ciphertext === "string" ? body.ciphertext : "";

  // Shape only. Whether the room is still live, and whether this member has filled their
  // quota, are answered by the server — the client is not the authority on either.
  if (!ciphertext) {
    return NextResponse.json({ error: "That idea could not be added", code: "IDEA_INVALID" }, { status: 400 });
  }

  try {
    return NextResponse.json(await createIdea({ ...who, ciphertext }), { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
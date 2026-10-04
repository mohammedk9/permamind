import { NextResponse } from "next/server";

import { isValidRoomId, isValidMemberToken } from "@/lib/rooms/access";
import { readRoomSpend, RoomError, setRoomReadOnly } from "@/lib/rooms/server";

export const runtime = "nodejs";

/**
 * GET, PATCH /api/rooms/settings — what the host controls, and what a room has cost.
 *
 * Both verbs are host-only, and the check lives in the server functions rather than here, so
 * there is one rule rather than two that can drift.
 *
 * Spend is reported as **counts, not money**. The server knows how many calls were made and
 * which model answered; it does not know what the host's key costs per token, because that is
 * their provider's contract and not ours. A currency figure here would be a guess wearing a
 * currency symbol, so the response says what is actually knowable and the panel says plainly
 * what it is not.
 */

function fail(error: unknown) {
  if (error instanceof RoomError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: "The room is unavailable" }, { status: 500 });
}

function identify(request: Request) {
  const roomId = new URL(request.url).searchParams.get("roomId") ?? "";
  const memberToken = request.headers.get("x-room-member") ?? "";
  if (!isValidRoomId(roomId) || !isValidMemberToken(memberToken)) return null;
  return { roomId, memberToken };
}

/**
 * GET — the host's spend summary.
 *
 * A guest gets the same 404 a stranger would, because `readRoomSpend` returns null for
 * anything but a host. The panel relies on that rather than on hiding itself.
 */
export async function GET(request: Request) {
  const who = identify(request);
  if (!who) {
    return NextResponse.json({ error: "This invite is not valid", code: "INVITE_INVALID" }, { status: 404 });
  }

  try {
    const spend = await readRoomSpend(who);
    if (!spend) {
      return NextResponse.json({ error: "This invite is not valid", code: "INVITE_INVALID" }, { status: 404 });
    }
    return NextResponse.json({ spend });
  } catch (error) {
    return fail(error);
  }
}

/**
 * PATCH — the read-only switch.
 *
 * One field, and it must be a real boolean. A truthy string would otherwise turn "off" into
 * "on", and the host would believe a room was closed when it was open.
 */
export async function PATCH(request: Request) {
  const who = identify(request);
  if (!who) {
    return NextResponse.json({ error: "This invite is not valid", code: "INVITE_INVALID" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.readOnly !== "boolean") {
    return NextResponse.json({ error: "That change could not be made", code: "READ_ONLY_INVALID" }, { status: 400 });
  }

  try {
    return NextResponse.json(await setRoomReadOnly({ ...who, readOnly: body.readOnly }));
  } catch (error) {
    return fail(error);
  }
}
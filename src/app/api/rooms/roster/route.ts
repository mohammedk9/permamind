import { NextResponse } from "next/server";

import { isValidRoomId, isValidMemberToken } from "@/lib/rooms/access";
import { readRoster, setMemberAlias } from "@/lib/rooms/roster";
import { RoomError } from "@/lib/rooms/server";

export const runtime = "nodejs";

/**
 * The roster: sealed names, served to the host alone.
 *
 * One file for two verbs because they are two ends of the same fact. A member seals their name
 * once at join; the host reads the sealed set to show who is in the room. Splitting them would
 * mean a guest-facing write path and a host-only read path with no single place to see that
 * only one of them is restricted.
 *
 * Nothing here returns a name. `GET` returns ciphertext that only the host can open, and the
 * guest's client never calls it at all.
 */

function fail(error: unknown) {
  if (error instanceof RoomError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: "The room is unavailable" }, { status: 500 });
}

function identify(request: Request, url: URL) {
  const roomId = url.searchParams.get("roomId") ?? "";
  const memberToken = request.headers.get("x-room-member") ?? "";
  if (!isValidRoomId(roomId) || !isValidMemberToken(memberToken)) return null;
  return { roomId, memberToken };
}

/**
 * GET — the sealed roster. Host only.
 *
 * A guest calling this directly gets the same 404 a stranger would, because `readRoster`
 * checks the role before it queries. That is the property the host-only names view depends
 * on, and it is asserted in `lib/rooms/__tests__/roster.test.ts` rather than trusted.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const who = identify(request, url);
  if (!who) {
    return NextResponse.json({ error: "This invite is not valid", code: "INVITE_INVALID" }, { status: 404 });
  }

  try {
    return NextResponse.json({ roster: await readRoster(who) });
  } catch (error) {
    return fail(error);
  }
}

/**
 * POST — seals the caller's own name into their member row.
 *
 * Any member may write here, because it is their own name and nobody else's. The update is
 * scoped to the caller's own token hash in the server function, so a crafted body cannot
 * write a name onto somebody else's row — there is no member identifier in the request at
 * all.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const who = identify(request, url);
  if (!who) {
    return NextResponse.json({ error: "This invite is not valid", code: "INVITE_INVALID" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const aliasCiphertext = typeof body?.aliasCiphertext === "string" ? body.aliasCiphertext : "";
  const aliasBytes = typeof body?.aliasBytes === "number" ? body.aliasBytes : 0;

  if (!aliasCiphertext || aliasBytes <= 0 || aliasBytes > 1024) {
    return NextResponse.json({ error: "That name could not be saved", code: "ALIAS_INVALID" }, { status: 400 });
  }

  try {
    await setMemberAlias({ ...who, aliasCiphertext, aliasBytes });
    return NextResponse.json({ saved: true });
  } catch (error) {
    return fail(error);
  }
}
import { NextResponse } from "next/server";

import { isValidRoomId, isValidMemberToken } from "@/lib/rooms/access";
import { postMessage, readMessages, setMessagePinned, RoomError } from "@/lib/rooms/server";

export const runtime = "nodejs";

/**
 * GET and POST /api/rooms/messages — the room transcript.
 *
 * The member token travels in the `x-room-member` header rather than the query string
 * or the body. A token in a URL ends up in server logs and in the browser history; a
 * token in a body can end up in whatever logs the body. A header is the least bad of
 * the three, and it is the same header the RLS policies read.
 *
 * The room key is never involved here. The client encrypted before calling and decrypts
 * after, so this route moves ciphertext it cannot read.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: unknown) {
  if (error instanceof RoomError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return NextResponse.json({ error: "The room is unavailable" }, { status: 500 });
}

export async function GET(request: Request) {
  const roomId = new URL(request.url).searchParams.get("roomId") ?? "";
  const memberToken = request.headers.get("x-room-member") ?? "";

  if (!isValidRoomId(roomId) || !isValidMemberToken(memberToken)) {
    return NextResponse.json(
      { error: "This invite is not valid", code: "INVITE_INVALID" },
      { status: 404 },
    );
  }

  try {
    const result = await readMessages({ roomId, memberToken });
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const memberToken = request.headers.get("x-room-member") ?? "";
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body || !isValidRoomId(body.roomId) || !isValidMemberToken(memberToken)) {
    return NextResponse.json(
      { error: "This invite is not valid", code: "INVITE_INVALID" },
      { status: 404 },
    );
  }

  const ciphertext = typeof body.ciphertext === "string" ? body.ciphertext : "";
  const contentHash = typeof body.contentHash === "string" ? body.contentHash : "";
  if (!ciphertext || !/^[0-9a-f]{64}$/.test(contentHash)) {
    return NextResponse.json(
      { error: "That message could not be saved", code: "MESSAGE_INVALID" },
      { status: 400 },
    );
  }

  // A reply target must be a uuid or absent. Checking it here means a malformed id
  // fails as a bad request rather than as a foreign key violation, which would be a
  // confusing 500 for something the client got wrong.
  const replyToId = typeof body.replyToId === "string" && UUID.test(body.replyToId)
    ? body.replyToId
    : null;
  const threadRootId =
    typeof body.threadRootId === "string" && UUID.test(body.threadRootId)
      ? body.threadRootId
      : null;

  try {
    const message = await postMessage({
      roomId: body.roomId,
      memberToken,
      ciphertext,
      contentHash,
      replyToId,
      threadRootId,
      // `kind` is narrowed here rather than passed through, so no caller can write a value
      // the schema's own check would refuse. The server still decides what is *valid* for
      // that kind — this only removes a shape that never was one.
      kind: body.kind === "ai" ? "ai" : "human",
      modelLabel: typeof body.modelLabel === "string" ? body.modelLabel : null,
      modelSpecialty:
        typeof body.modelSpecialty === "string" ? body.modelSpecialty : null,
    });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

/**
 * PATCH /api/rooms/messages — pins or unpins a message. Host only.
 *
 * PATCH rather than a `/pin` subroute, because pinning is a field on a message and this is
 * the message resource. The body names one message and one boolean; there is no bulk form,
 * because "pin everything" is not a thing the design wants and a shape that does not exist
 * cannot be called by a future caller who assumed it did.
 *
 * The room id travels in the body here, as it does in POST, so that this verb and the one
 * that appends to the same table read the same way. It authorises nothing: the caller's role
 * comes from the member token in the header.
 */
export async function PATCH(request: Request) {
  const memberToken = request.headers.get("x-room-member") ?? "";
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

  if (!body || !isValidRoomId(body.roomId) || !isValidMemberToken(memberToken)) {
    return NextResponse.json(
      { error: "This invite is not valid", code: "INVITE_INVALID" },
      { status: 404 },
    );
  }

  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  if (!UUID.test(messageId)) {
    // Same reasoning as the reply target: a malformed id is the client's mistake, and
    // answering 404 keeps it indistinguishable from a message that is genuinely gone.
    return NextResponse.json(
      { error: "That message is not in this room", code: "MESSAGE_NOT_FOUND" },
      { status: 404 },
    );
  }

  // `pinned` must be an actual boolean. A truthy string would otherwise pin when the caller
  // meant to unpin, and this is a toggle where the two directions must not be guessed at.
  if (typeof body.pinned !== "boolean") {
    return NextResponse.json(
      { error: "That message could not be pinned", code: "PIN_INVALID" },
      { status: 400 },
    );
  }

  try {
    const result = await setMessagePinned({
      roomId: body.roomId,
      memberToken,
      messageId,
      pinned: body.pinned,
    });
    return NextResponse.json(result);
  } catch (error) {
    return fail(error);
  }
}

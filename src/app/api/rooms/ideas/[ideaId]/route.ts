import { NextResponse } from "next/server";

import { isValidMemberToken, isValidRoomId } from "@/lib/rooms/access";
import { attachIdeaTask, RoomError, setIdeaStatus } from "@/lib/rooms/server";

export const runtime = "nodejs";

/**
 * PATCH /api/rooms/ideas/[ideaId] — the host's two decisions about an idea.
 *
 * Both are host-only, and both are the boundary section 9 draws: only a host-approved item
 * becomes permanent memory, and only the host creates a real task. A member can propose and
 * can vote; they cannot decide.
 *
 * Accepting and converting are separate verbs rather than one `status` field with side
 * effects, because they move the idea to two different places — the host's memory ledger and
 * the host's task list — and a request that silently did both would be a request whose effect
 * the caller could not see before making it.
 */
function identify(request: Request, ideaId: string) {
  const roomId = new URL(request.url).searchParams.get("roomId") ?? "";
  const memberToken = request.headers.get("x-room-member") ?? "";
  if (!isValidRoomId(roomId) || !isValidMemberToken(memberToken)) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ideaId)) return null;
  return { roomId, memberToken, ideaId };
}

function fail(error: unknown) {
  if (error instanceof RoomError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return NextResponse.json({ error: "The room is unavailable" }, { status: 500 });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ ideaId: string }> },
) {
  const { ideaId } = await context.params;
  const who = identify(request, ideaId);
  if (!who) {
    return NextResponse.json(
      { error: "This invite is not valid", code: "INVITE_INVALID" },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    // A `taskId` is the convert verb: the host already created the task on their own device
    // and is telling the room which one. Only the id is stored.
    if (typeof body.taskId === "string" && body.taskId) {
      await attachIdeaTask({ ...who, taskId: body.taskId });
      return NextResponse.json({ linked: true });
    }

    const status = body.status;
    if (status !== "open" && status !== "accepted" && status !== "dropped") {
      return NextResponse.json(
        { error: "That idea could not be changed", code: "IDEA_STATUS_INVALID" },
        { status: 400 },
      );
    }

    await setIdeaStatus({ ...who, status });
    return NextResponse.json({ status });
  } catch (error) {
    return fail(error);
  }
}
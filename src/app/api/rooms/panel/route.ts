import { NextResponse } from "next/server";

import { isValidMemberToken, isValidRoomId } from "@/lib/rooms/access";
import { registerPanelModel, RoomError, setModelSharing, withdrawPanelModel } from "@/lib/rooms/server";

export const runtime = "nodejs";

/**
 * POST, DELETE /api/rooms/panel — bring a model to a panel room, or take it away.
 *
 * ## What this endpoint will not do
 *
 * It has no parameter through which a caller can name *whose* model is being registered. The
 * row written is found by the caller's own member token, and the account on that seat must
 * match the signed-in user. That is what makes `panel-rooms-proposal.md` section 5 a property
 * of the interface rather than a rule somebody has to remember to enforce:
 *
 * > No one spends someone else's key.
 *
 * A member without a model is not an error state to be worked around here. They simply cannot
 * invoke anything, which section 6.1 treats as correct.
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

export async function POST(request: Request) {
  const who = identify(request);
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

  const modelId = typeof body.modelId === "string" ? body.modelId : "";
  const modelLabel = typeof body.modelLabel === "string" ? body.modelLabel : "";
  const specialty = typeof body.specialty === "string" ? body.specialty : "";

  // Shape only. Whether the model is real, and whether the speciality is one the host
  // offered, are answered by the server — both depend on the room row, which the client
  // does not get to speak for.
  if (!modelId || !modelLabel || !specialty) {
    return NextResponse.json(
      { error: "That model could not be registered", code: "MODEL_INVALID" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await registerPanelModel({ ...who, modelId, modelLabel, specialty }),
      { status: 201 },
    );
  } catch (error) {
    return fail(error);
  }
}

/**
 * PATCH /api/rooms/panel — what this member agreed about their own model.
 *
 * Separate from POST because it is a different promise. Registering a model says "here is
 * one"; this says "and you may ask me, this often, and not more than this". A member who
 * registers and changes nothing has agreed to nothing, which is the whole of the consent
 * default being safe.
 */
export async function PATCH(request: Request) {
  const roomId = new URL(request.url).searchParams.get("roomId") ?? "";
  const memberToken = request.headers.get("x-room-member") ?? "";
  if (!isValidRoomId(roomId) || !isValidMemberToken(memberToken)) {
    return NextResponse.json({ error: "This invite is not valid", code: "INVITE_INVALID" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const sharing = body?.sharing;
  if (sharing !== "silent" && sharing !== "on_request" && sharing !== "always") {
    return NextResponse.json({ error: "That choice cannot be read", code: "SHARING_INVALID" }, { status: 400 });
  }

  const asLimit = (value: unknown): number | null =>
    value === null || value === undefined || value === "" ? null : Number(value);

  try {
    return NextResponse.json(
      await setModelSharing({
        roomId,
        memberToken,
        sharing,
        callLimit: asLimit(body?.callLimit),
        dailyLimit: asLimit(body?.dailyLimit),
      }),
    );
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  const who = identify(request);
  if (!who) {
    return NextResponse.json(
      { error: "This invite is not valid", code: "INVITE_INVALID" },
      { status: 404 },
    );
  }

  try {
    await withdrawPanelModel(who);
    return NextResponse.json({ withdrawn: true });
  } catch (error) {
    return fail(error);
  }
}
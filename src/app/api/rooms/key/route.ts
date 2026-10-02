import { NextResponse } from "next/server";

import {
  deleteHostKey,
  hostKeyStatus,
  storeHostKey,
} from "@/lib/rooms/host-key-store";
import { hostKeyStorageAvailable, HostKeyError } from "@/lib/rooms/host-key";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET, POST, DELETE /api/rooms/key — the host's stored provider key (Option B).
 *
 * ## What this route exists to honour
 *
 * Section 5 makes three promises about a key kept on our servers: it is encrypted, it is
 * deleted on a date the host picks, and the host can remove it at any time. A route that
 * only offered "store" would satisfy none of them fully, because the third promise is the
 * one a host needs when they change their mind.
 *
 * ## What never happens here
 *
 * The provider key is never echoed back. `GET` returns an existence flag and an expiry
 * date, never the key itself: the Settings screen needs to render a checkbox and a date, and
 * has no reason to hold the credential in browser memory to do it. A response that returned
 * the key would put it in a place it is not needed and would defeat the point of sealing it.
 *
 * ## Authentication
 *
 * An account, always. This is the one credential in the room feature that is not governed by
 * a member token, because it belongs to an account rather than to a room: a guest's token
 * must not be able to reach it, and a host's token must not reach another host's.
 */

function fail(error: unknown) {
  if (error instanceof HostKeyError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return NextResponse.json({ error: "The key could not be saved" }, { status: 500 });
}

/** GET — is a key stored, and when does it go? Never the key itself. */
export async function GET() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  if (!hostKeyStorageAvailable()) {
    return NextResponse.json(
      { error: "Storing a key on our servers is not configured", code: "HOST_KEY_UNAVAILABLE" },
      { status: 503 },
    );
  }

  try {
    return NextResponse.json(await hostKeyStatus(user.id));
  } catch (error) {
    return fail(error);
  }
}

/** POST — store or replace, with a mandatory end date. */
export async function POST(request: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const providerKey = typeof body?.providerKey === "string" ? body.providerKey : "";
  const expiresAt = typeof body?.expiresAt === "string" ? body.expiresAt : "";

  // Shape first. `storeHostKey` re-checks both, but reaching the database with a malformed
  // body wastes a round trip and makes the logs noisier than the failure warrants.
  if (!providerKey.trim() || !expiresAt) {
    return NextResponse.json(
      { error: "A key and an end date are both required", code: "KEY_INVALID" },
      { status: 400 },
    );
  }

  try {
    const result = await storeHostKey({ userId: user.id, providerKey, expiresAt });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}

/**
 * DELETE — remove the stored key.
 *
 * Idempotent, and returns success whether or not a row existed. A host who clicks "remove"
 * twice, or clicks it when nothing is stored, has still achieved the state they asked for;
 * answering with 404 would make the button look broken for a condition that is fine.
 *
 * Room transcripts are untouched. The design is explicit that removing the key stops the
 * model and does not discard what was already said.
 */
export async function DELETE() {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  try {
    await deleteHostKey(user.id);
    return NextResponse.json({ present: false, expiresAt: null });
  } catch (error) {
    return fail(error);
  }
}

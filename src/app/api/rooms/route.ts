import { NextResponse } from "next/server";

import { getByokModels } from "@/lib/ai/models";
import { isValidHostCode, isValidInviteCode } from "@/lib/rooms/access";
import { hostKeyStatus } from "@/lib/rooms/host-key-store";
import { createRoom, RoomError } from "@/lib/rooms/server";
import { requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Bounds mirroring the service layer, so a hostile body is rejected before any work. */
const MAX_TITLE = 120;
const MAX_TOPIC = 500;
const MAX_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000;
/** A wrapped 32-byte key is well under 200 characters of base64. */
const MAX_WRAPPED_KEY = 1024;

/**
 * POST /api/rooms — create a room.
 *
 * The invite code is generated in the caller's browser, not here, and that is forced by
 * the cryptography: the client must seal the room key under the invite code, which it
 * cannot do until it knows the code. So the client sends the two codes once over TLS and
 * the server hashes them before writing. The plaintext exists in exactly two requests —
 * this one, and the one that ends a room's life.
 *
 * The room key itself is never sent in either direction. The client sends only the
 * wrapped form, which the server stores without being able to open it.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim().slice(0, MAX_TITLE) : "";
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, MAX_TOPIC) : "";
  // Option B is available again now that a stored key exists: `host_ai_keys`, the envelope
  // encryption in `lib/rooms/host-key`, and a deletion route. It was refused earlier because
  // accepting it then would have written `key_mode = 'server'` with no key anywhere and no
  // route to store one, which is a room that claims to outlive its host and cannot.
  //
  // The check is a read of the host's own stored key, not of the request. A client that
  // declares `keyMode: "server"` without having saved a key is refused here, so a room can
  // never exist in the state where it promised the model would keep answering and would not.
  const keyMode = body.keyMode === "server" ? "server" : "browser";
  if (keyMode === "server") {
    const { user } = await requireUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }
    const stored = await hostKeyStatus(user.id);
    if (!stored.present) {
      return NextResponse.json(
        { error: "Save your key for server use in Settings before choosing this option" },
        { status: 400 },
      );
    }
  }
  const aiProvider = typeof body.aiProvider === "string" ? body.aiProvider.slice(0, 64) : "";
  const aiModel = typeof body.aiModel === "string" ? body.aiModel.slice(0, 200) : "";
  const inviteCode = typeof body.inviteCode === "string" ? body.inviteCode : "";
  const hostCode = typeof body.hostCode === "string" ? body.hostCode : "";
  const wrappedRoomKey = typeof body.wrappedRoomKey === "string" ? body.wrappedRoomKey : "";
  const wrapSalt = typeof body.wrapSalt === "string" ? body.wrapSalt : "";

  if (!aiProvider || !aiModel) {
    return NextResponse.json(
      { error: "Choose an AI provider and model before opening a room" },
      { status: 400 },
    );
  }

  // A room runs on the host's key, so it must be a model that key can actually serve.
  //
  // This matters because `isValidModelId` is an allowlist across *all* tiers, free ones
  // included, and a room that landed on a `:free` id would be answered by the app's shared
  // key rather than the host's. The design is explicit that a room never touches the free
  // tier; without this check that is a UI habit rather than a rule.
  //
  // Providers the host configures by hand (`custom`, `ollama`, and any custom endpoint) are
  // exempt: their model names are the host's own strings and are not in our catalogue at
  // all. Everything else must be a model we know the host can pay for.
  const CUSTOM_PROVIDERS = new Set(["custom", "ollama"]);
  if (
    !CUSTOM_PROVIDERS.has(aiProvider) &&
    !getByokModels().some((model) => model.id === aiModel)
  ) {
    return NextResponse.json(
      { error: "A room must use a model from your own provider key" },
      { status: 400 },
    );
  }
  if (!isValidInviteCode(inviteCode) || !isValidHostCode(hostCode)) {
    return NextResponse.json({ error: "The room codes are not valid" }, { status: 400 });
  }
  if (!wrappedRoomKey || !wrapSalt) {
    return NextResponse.json({ error: "The room key is missing" }, { status: 400 });
  }
  if (wrappedRoomKey.length > MAX_WRAPPED_KEY) {
    return NextResponse.json({ error: "The wrapped room key is too large" }, { status: 400 });
  }

  const expiresAt = typeof body.expiresAt === "string" ? body.expiresAt : "";
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Choose when the room ends" }, { status: 400 });
  }
  if (expiry.getTime() - Date.now() > MAX_LIFETIME_MS) {
    return NextResponse.json(
      { error: "A room cannot last longer than a month" },
      { status: 400 },
    );
  }

  // With the server mode refused above, `keyMode` is always "browser", so there is no
  // expiry to enforce here. The schema still requires one for a server key, which is the
  // check that matters the day the mode is turned back on.
  const keyExpiresAt = null;

  try {
    const result = await createRoom({
      title,
      topic,
      expiresAt: expiry.toISOString(),
      aiProvider,
      aiModel,
      // Forwarded as-is. Shape, length, and de-duplication are decided by
      // `normaliseSpecialities` in the server module rather than here, so the rules live in one
      // place and a second caller cannot get a laxer answer than this route.
      aiSpecialties: Array.isArray(body.aiSpecialties) ? body.aiSpecialties : [],
      aiMaxModels: typeof body.aiMaxModels === "number" ? body.aiMaxModels : null,
      // Only the literal "panel" selects the other kind. Anything else — an absent field from
      // an older client, a typo, a forged value — produces a guest room, which is the kind
      // that promises no identity and collects none.
      roomKind: body.roomKind === "panel" ? "panel" : "guest",
      keyMode,
      keyExpiresAt,
      allowGuestWrite: body.allowGuestWrite !== false,
      requireDisplayName: body.requireDisplayName !== false,
      inviteCode,
      hostCode,
      wrappedRoomKey,
      wrapSalt,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof RoomError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "The room could not be created" }, { status: 500 });
  }
}

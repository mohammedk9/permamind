/**
 * Server-side room operations.
 *
 * Everything here runs with the service role, which bypasses row level security, so
 * every check the RLS policies express in SQL is repeated here as code. That is
 * duplication on purpose: the policies are the last line of defence against a stray
 * client call, and these functions are the first line for a real request. If the two
 * ever disagree, the stricter one has to be the one the route calls.
 *
 * The client never talks to Supabase directly. It goes through the `/api/rooms` routes,
 * which is what keeps the room key on the host's device and gives one place to verify a
 * code against a hash.
 */

import "server-only";

import { requireUser } from "@/lib/supabase/server";
import { announceRoomChange } from "@/lib/rooms/realtime";
import {
  createMemberToken,
  createRoomId,
  hashSecret,
  isValidInviteCode,
  isValidRoomId,
} from "@/lib/rooms/access";
// The same validator the guest room uses, so a member cannot register a model id the room
// itself would have refused. Two lists would be two definitions of "a real model".
import { isValidModelId } from "@/lib/ai/models";

/** The failure every room operation reports through. */
export class RoomError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "RoomError";
  }
}

export interface CreateRoomInput {
  title: string;
  topic: string;
  /** ISO timestamp. Required: the schema has no open-ended room. */
  expiresAt: string;
  aiProvider: string;
  aiModel: string;
  /** Where the AI key lives. See section 5 of the design document. */
  keyMode: "browser" | "server";
  /** Required when keyMode is "server". There is no "forever". */
  keyExpiresAt: string | null;
  allowGuestWrite: boolean;
  requireDisplayName: boolean;
  /**
   * The roles the host is offering the room's model, in display order.
   *
   * Bounded here as well as in the schema so a malformed body is answered with an
   * explanation instead of a constraint violation. Empty means the room is an ordinary one
   * that simply has no roles, which is not an error.
   */
  aiSpecialties?: string[];
  /** How many models the room may run at once. Null when no panel feature is enabled. */
  aiMaxModels?: number | null;
  /**
   * Which kind of room to create. Defaults to `guest`, which is every room that has ever
   * existed.
   *
   * A `panel` room requires at least one speciality — the schema refuses one without, and the
   * check is repeated here so the host reads an explanation rather than a constraint
   * violation. A panel whose members may only pick "nothing" is an ordinary room with extra
   * steps and a sign-in requirement.
   */
  roomKind?: "guest" | "panel";
  /**
   * The two codes and the sealed key, all produced by the caller.
   *
   * The client generates these rather than this module, because only the client holds
   * the room key and therefore only the client can wrap it. Asking the server for the
   * invite code first would mean a second round trip and, more importantly, a code the
   * server handled in plaintext before the key was sealed under it.
   */
  inviteCode: string;
  hostCode: string;
  wrappedRoomKey: string;
  wrapSalt: string;
}

/** How many specialities a room may offer. Matches the schema's array bound. */
const MAX_SPECIALTIES = 8;

/** Length of one speciality. Matches the schema's column bound. */
const MAX_SPECIALTY_LENGTH = 60;

/**
 * Cleans a host's list of specialities: trimmed, de-duplicated, order preserved.
 *
 * Order is preserved because the list is what the host sees and what a member picks from;
 * sorting it would reorder the roles the host chose to put first.
 */
function normaliseSpecialties(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of input) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_SPECIALTY_LENGTH) {
      throw new RoomError("That role name is too long", 400, "SPECIALTY_TOO_LONG");
    }
    // Case-insensitive, so "Marketing" and "marketing" do not render as two options.
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }

  if (out.length > MAX_SPECIALTIES) {
    throw new RoomError(
      `A room can offer at most ${MAX_SPECIALTIES} roles`,
      400,
      "TOO_MANY_SPECIALTIES",
    );
  }
  return out;
}

/**
 * Validates the model cap.
 *
 * Null means "no panel here", which is the default for every room that predates this feature
 * and for every host who never fills the field in. A zero or negative number is a
 * contradiction rather than a limit, so it is refused instead of coerced to null.
 */
function normaliseMaxModels(input: number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (!Number.isInteger(input) || input < 1) {
    throw new RoomError(
      "The model limit must be a whole number above zero",
      400,
      "MAX_MODELS_INVALID",
    );
  }
  // A cap above the number of roles is meaningless, so it is clamped rather than refused.
  return Math.min(input, MAX_SPECIALTIES);
}
function assertWindow(expiresAt: string, now: Date): Date {
  const expiry = new Date(expiresAt);
  if (Number.isNaN(expiry.getTime())) {
    throw new RoomError("The room needs a valid end time", 400, "INVALID_EXPIRY");
  }
  const delta = expiry.getTime() - now.getTime();
  if (delta < MIN_ROOM_LIFETIME_MS) {
    throw new RoomError("A room must last at least five minutes", 400, "EXPIRY_TOO_SOON");
  }
  if (delta > MAX_ROOM_LIFETIME_MS) {
    throw new RoomError("A room cannot last longer than a month", 400, "EXPIRY_TOO_LONG");
  }
  return expiry;
}

/** Rooms this host currently holds, counting only live ones. */
async function activeRoomCount(ownerId: string): Promise<number> {
  const { supabase } = await requireUser();
  if (!supabase) return 0;
  const { count } = await supabase
    .from("rooms")
    .select("room_id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .is("closed_at", null)
    .gt("expires_at", new Date().toISOString());
  return count ?? 0;
}

/**
 * Creates a room and hands back the two codes.
 *
 * Both codes are generated here, hashed, and written. The cleartext is returned once
 * and never stored, which is why the host sees them a single time with no way to ask
 * for them again. Losing the host code is not recoverable; it is recoverable by asking
 * the host for a new one, which is why the host is also the only party who can reset it.
 */
export async function createRoom(input: CreateRoomInput): Promise<CreateRoomResult> {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    throw new RoomError("Sign in required", 401, "SIGNIN_REQUIRED");
  }

  if (input.keyMode === "server" && !input.keyExpiresAt) {
    // The schema refuses this too. The check is repeated here so the host gets an
    // explanation rather than a constraint violation.
    throw new RoomError(
      "A key kept on our servers must have an end date",
      400,
      "KEY_EXPIRY_REQUIRED",
    );
  }

  const now = new Date();
  const expiry = assertWindow(input.expiresAt, now);

  // Specialities: trimmed, de-duplicated, and bounded.
  //
  // Normalised rather than rejected, because "Critique, Critique" is a host's typo rather
  // than an attack, and the list renders as a fixed control where a duplicate would be a
  // visibly broken option. Over-long and over-numerous lists are refused instead, because
  // those cannot be a typo — they do not fit in the control.
  const specialties = normaliseSpecialties(input.aiSpecialties);
  const maxModels = normaliseMaxModels(input.aiMaxModels);

  // ## A panel needs something to be a panel about
  //
  // Checked here rather than left to the schema so the host is told what is missing. Every
  // other room kind stays exactly what it was: `guest` is the default, so a caller that never
  // heard of panel rooms produces the same row it always did.
  const roomKind = input.roomKind === "panel" ? "panel" : "guest";
  if (roomKind === "panel" && specialties.length === 0) {
    throw new RoomError(
      "A panel room needs at least one role for its members to fill",
      400,
      "PANEL_NEEDS_SPECIALTIES",
    );
  }

  if ((await activeRoomCount(user.id)) >= FREE_ROOM_QUOTA) {
    throw new RoomError(
      "You can hold two rooms at a time. Close one to start another.",
      409,
      "ROOM_QUOTA_REACHED",
    );
  }

  const roomId = createRoomId();
  const memberToken = createMemberToken();

  const { error } = await supabase.from("rooms").insert({
    room_id: roomId,
    owner_id: user.id,
    invite_code_hash: await hashSecret(input.inviteCode),
    host_code_hash: await hashSecret(input.hostCode),
    wrap_salt: input.wrapSalt,
    wrapped_room_key: input.wrappedRoomKey,
    settings_ciphertext: null,
    ai_provider: input.aiProvider,
    ai_model: input.aiModel,
    ai_specialties: specialties,
    ai_max_models: maxModels,
    room_kind: roomKind,
    key_mode: input.keyMode,
    key_expires_at: input.keyExpiresAt,
    allow_guest_write: input.allowGuestWrite,
    require_display_name: input.requireDisplayName,
    room_quota: FREE_ROOM_QUOTA,
    ai_audience: "trusted",
    expires_at: expiry.toISOString(),
  });
  if (error) {
    // A duplicate id is a one-in-fifteen-billion collision and anything else is a
    // database fault. Neither is worth passing to a client.
    throw new RoomError("The room could not be created", 503, "ROOM_CREATE_FAILED");
  }

  const { error: memberError } = await supabase.from("room_members").insert({
    room_id: roomId,
    member_token_hash: await hashSecret(memberToken),
    role: "host",
    invited_by: null,
  });
  if (memberError) {
    // Without the host row the room exists with nobody in it. Removing it keeps the
    // quota honest rather than leaving an unreachable room holding a slot.
    await supabase.from("rooms").delete().eq("room_id", roomId);
    throw new RoomError("The room could not be created", 503, "ROOM_CREATE_FAILED");
  }

  // The codes are echoed back because the server only stored their hashes. The host
  // sees them once, here, and there is no endpoint that can produce them again.
  return { roomId, inviteCode: input.inviteCode, hostCode: input.hostCode, memberToken };
}

export interface JoinRoomInput {
  roomId: string;
  inviteCode: string;
}

export interface JoinRoomResult {
  roomId: string;
  memberToken: string;
  role: "guest";
  /** The sealed room key. A guest reads nothing until this is unwrapped locally. */
  wrappedRoomKey: string;
  wrapSalt: string;
  requireDisplayName: boolean;
  allowGuestWrite: boolean;
}

/**
 * Joins a room with an invite code.
 *
 * A wrong code, a room that does not exist, and a room id with the wrong shape all
 * produce the same error. Distinguishing them would let someone enumerate ids and learn
 * which rooms exist, which is exactly what the random alphabet in `access.ts` is
 * supposed to prevent.
 *
 * The comparison is a hash equality check rather than a database lookup on the code,
 * because the plaintext code is never stored.
 */
export async function joinRoom(input: JoinRoomInput): Promise<JoinRoomResult> {
  const { supabase, user } = await requireUser();
  if (!supabase) {
    throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");
  }

  if (!isValidRoomId(input.roomId) || !isValidInviteCode(input.inviteCode)) {
    throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");
  }

  const { data, error } = await supabase
    .from("rooms")
    .select(
      "room_id,invite_code_hash,wrapped_room_key,wrap_salt,closed_at,expires_at,require_display_name,allow_guest_write,room_kind",
    )
    .eq("room_id", input.roomId)
    .maybeSingle();

  if (error || !data) {
    throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");
  }

  if ((await hashSecret(input.inviteCode)) !== data.invite_code_hash) {
    throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");
  }

  const expiry = new Date(data.expires_at);
  if (data.closed_at || Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    // A finished room is not an invalid invite, and saying so is useful: it tells the
    // guest the code was right and the meeting is over.
    throw new RoomError("This room has ended", 410, "ROOM_ENDED");
  }

  // ## A panel seat requires an account
  //
  // This is the whole reason panel rooms are a separate kind rather than a flag. A member who
  // brings a model spends their own key, so the room has to know which account spent it; a
  // `guest` row has no account and therefore could never be held to anything.
  //
  // Checked *after* the invite code, so an anonymous caller holding a bad code learns nothing
  // about whether the room exists or what kind it is. A panel room refuses to be anonymous,
  // and saying so to someone who cannot use the room anyway would only help them enumerate
  // ids.
  if (data.room_kind === "panel" && !user) {
    throw new RoomError("Sign in to join a panel room", 401, "SIGNIN_REQUIRED");
  }

  const memberToken = createMemberToken();
  const { error: memberError } = await supabase.from("room_members").insert({
    room_id: data.room_id,
    member_token_hash: await hashSecret(memberToken),
    role: "guest",
    invited_by: null,
    // Null on a guest room, and that null is the promise section 13 makes: this member left
    // no durable identity behind. Never written for a guest room, under any code path.
    user_id: data.room_kind === "panel" ? user!.id : null,
  });
  if (memberError) {
    throw new RoomError("This room could not be joined", 503, "JOIN_FAILED");
  }

  return {
    roomId: data.room_id,
    memberToken,
    role: "guest",
    wrappedRoomKey: data.wrapped_room_key,
    wrapSalt: data.wrap_salt,
    requireDisplayName: data.require_display_name,
    allowGuestWrite: data.allow_guest_write,
  };
}


// ---------------------------------------------------------------------------
// Panel: a member's own model
// ---------------------------------------------------------------------------

export interface PanelModelRegistration {
  roomId: string;
  memberToken: string;
  /** The provider model id. Validated against the same list the guest room uses. */
  modelId: string;
  modelLabel: string;
  /** Must be one the host offered. Never free text. */
  specialty: string;
}

/**
 * Registers — or replaces — **the caller's own** model for a panel room.
 *
 * The word "own" is the entire design. `panel-rooms-proposal.md` section 5:
 *
 * > No one spends someone else's key. Whoever invokes a model invokes it with their own.
 *
 * So this writes to the row belonging to `memberToken` and to no other. It cannot be given a
 * `user_id` or a token belonging to somebody else, which is the point: there is no argument
 * through which a caller could name whose model this is.
 *
 * ## The cap is the host's, and it is counted here rather than trusted
 *
 * `ai_max_models` was stored on the room row from the start and enforced nowhere, which made
 * it a number the host set believing it bounded something. It bounds the count of rows with a
 * model, counted immediately before the write. The room's own value is read from the database
 * inside this function — never from the request — because a cap the caller can supply is not
 * a cap.
 */
export async function registerPanelModel(
  input: PanelModelRegistration,
): Promise<{ modelId: string; modelLabel: string; specialty: string }> {
  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    throw new RoomError("Sign in required", 401, "SIGNIN_REQUIRED");
  }

  const role = await roleFor(input.roomId, input.memberToken);
  if (!role) throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");

  const { data: room } = await supabase
    .from("rooms")
    .select("room_kind,ai_specialties,ai_max_models,closed_at,expires_at")
    .eq("room_id", input.roomId)
    .maybeSingle();

  // A guest room has exactly one model — the room's own — and a member row naming a different
  // one would mean nothing. Refused rather than ignored so a stale client cannot fill a guest
  // room's roster with models that will never answer anything.
  if (!room || room.room_kind !== "panel") {
    throw new RoomError("This room does not take member models", 400, "NOT_A_PANEL");
  }

  const expiry = new Date(room.expires_at as string);
  if (room.closed_at || Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    throw new RoomError("This room has ended", 410, "ROOM_ENDED");
  }

  // The caller's own row, and only that. Matching on the token hash is what makes this
  // "own": there is no parameter through which another member's row could be named.
  const memberHash = await hashSecret(input.memberToken);
  const { data: member } = await supabase
    .from("room_members")
    .select("user_id,model_id")
    .eq("room_id", input.roomId)
    .eq("member_token_hash", memberHash)
    .maybeSingle();

  if (!member) throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");

  // The seat must belong to the signed-in account, not merely to whoever holds the token. A
  // leaked member token would otherwise be enough to register a model against someone else's
  // account and spend their key.
  if (member.user_id !== user.id) {
    throw new RoomError("This seat is not yours", 403, "NOT_YOUR_SEAT");
  }

  const label = input.modelLabel.trim().slice(0, 60);
  const modelId = input.modelId.trim().slice(0, 200);
  if (!label || !modelId || !isValidModelId(modelId)) {
    throw new RoomError("That model could not be registered", 400, "MODEL_INVALID");
  }

  const offered = Array.isArray(room.ai_specialties)
    ? (room.ai_specialties as unknown[]).map((value) => String(value))
    : [];
  if (!offered.includes(input.specialty)) {
    // The host's list or nothing. A specialty nobody agreed to is the same as none, and a
    // member picking one at random is the noise the host's list exists to prevent.
    throw new RoomError("Pick one of the roles this room offered", 400, "SPECIALTY_INVALID");
  }

  // ## The cap
  //
  // Only counted when this is a *new* seat. Replacing your own model does not take a second
  // slot, and a member who registered and then swapped models would otherwise find the room
  // full of their own doing.
  if (member.model_id === null && room.ai_max_models !== null) {
    const { count } = await supabase
      .from("room_members")
      .select("member_token_hash", { count: "exact", head: true })
      .eq("room_id", input.roomId)
      .not("model_id", "is", null);

    if ((count ?? 0) >= Number(room.ai_max_models)) {
      throw new RoomError(
        "This room has as many models as the host allows",
        409,
        "PANEL_CAP_REACHED",
      );
    }
  }

  const { error } = await supabase
    .from("room_members")
    .update({ model_id: modelId, model_label: label, model_specialty: input.specialty })
    .eq("room_id", input.roomId)
    .eq("member_token_hash", memberHash);
  if (error) {
    throw new RoomError("That model could not be registered", 503, "PANEL_REGISTER_FAILED");
  }

  return { modelId, modelLabel: label, specialty: input.specialty };
}

/**
 * Withdraws the caller's own model.
 *
 * Not a delete of the member row: the seat stays and the person stays, they simply stop
 * bringing a model and can no longer invoke one. That matches section 6.1 of the proposal —
 * a member not bringing a model is not an error, and neither is withdrawing one later.
 */
export async function withdrawPanelModel(input: {
  roomId: string;
  memberToken: string;
}): Promise<void> {
  const { supabase } = await requireUser();
  if (!supabase) throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");

  const role = await roleFor(input.roomId, input.memberToken);
  if (!role) throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");

  const { error } = await supabase
    .from("room_members")
    .update({ model_id: null, model_label: null, model_specialty: null })
    .eq("room_id", input.roomId)
    .eq("member_token_hash", await hashSecret(input.memberToken));
  if (error) {
    throw new RoomError("That model could not be withdrawn", 503, "PANEL_WITHDRAW_FAILED");
  }
}

export interface CreateRoomResult {
  roomId: string;
  /** Sent to guests. Shown once and never stored. */
  inviteCode: string;
  /** Never sent anywhere. Shown once and never stored. */
  hostCode: string;
  memberToken: string;
}

/** Longest and shortest a room may live. */
const MAX_ROOM_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000;
const MIN_ROOM_LIFETIME_MS = 5 * 60 * 1000;

/**
 * How many rooms a host may hold at once.
 *
 * The design settles on two per rolling month. It is a constant here rather than in the
 * UI, so the paid tier becomes a number in one place instead of a code change, and a
 * client cannot talk its way past it.
 */
const FREE_ROOM_QUOTA = 2;

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

/** How many messages one page carries. Bounds both the query and the response. */
const MESSAGE_PAGE = 100;

/** A message as the transcript page needs it. The body is still ciphertext here. */
export interface MessageRow {
  id: string;
  seq: number;
  authorTokenHash: string;
  ciphertext: string;
  contentHash: string;
  kind: "human" | "ai" | "system";
  phase: number | null;
  pinnedAt: string | null;
  /** Which model wrote an `ai` row, and the speciality the host gave it. */
  modelLabel: string | null;
  modelSpecialty: string | null;
  replyToId: string | null;
  threadRootId: string | null;
  createdAt: string;
  /** True when the caller wrote this message. Decided server-side. */
  isMine: boolean;
}

/**
 * Reads the caller's role for a room, using the member token the request carries.
 *
 * The token arrives in the `x-room-member` header rather than in the body so that it
 * cannot end up in a body that gets logged. It is compared against a stored hash, so
 * the comparison reveals nothing beyond membership.
 */
async function roleFor(
  roomId: string,
  memberToken: string,
): Promise<"host" | "trusted" | "guest" | null> {
  const { supabase } = await requireUser();
  if (!supabase) return null;
  const { data } = await supabase
    .from("room_members")
    .select("role")
    .eq("room_id", roomId)
    .eq("member_token_hash", await hashSecret(memberToken))
    .maybeSingle();
  return (data?.role as "host" | "trusted" | "guest" | undefined) ?? null;
}

/**
 * Resolves the caller's role and whether they may spend the host's key on the model.
 *
 * Separate from `roleFor` because the answer is not the same thing. `trusted` and `host`
 * may invoke the model; `guest` may not, however long they have been in the room and
 * however much they have contributed. That is the host's decision and it is the room's
 * `ai_audience` setting, so it is resolved here in one place rather than by each caller
 * remembering which roles are which.
 *
 * A non-member is `null`, and a room that has set `ai_audience` to `all` does *not* make a
 * non-member a member: membership is decided before audience is consulted.
 */
export async function resolveAiAccess(input: {
  roomId: string;
  memberToken: string;
}): Promise<{
  role: "host" | "trusted" | "guest";
  mayInvokeModel: boolean;
  /** The provider and model the host chose when they opened this room. */
  aiProvider: string | null;
  aiModel: string | null;
  /** The roles the host offered. Empty means an ordinary room with no roles at all. */
  aiSpecialties: string[];
  /**
   * The host's ceiling on how many members may bring their own model.
   *
   * Null means the host set no ceiling. Returned here so the layer that registers a model
   * can read the number the host chose rather than trusting a value in the request: a cap
   * that could be overridden by the caller would not be a cap.
   */
  aiMaxModels: number | null;
  /**
   * Which kind of room this is, and — in a panel — the caller's own model.
   *
   * `callerModel` is null for every guest-room caller, and for a panel member who registered
   * no model. That null is load-bearing: the AI route reads it to decide there is nothing to
   * invoke, which is section 5 of the proposal working rather than a gap.
   */
  roomKind: "guest" | "panel";
  callerModel: { modelId: string; modelLabel: string; specialty: string } | null;
  /**
   * Where the host's key lives for this room, and whose key it is.
   *
   * Both are needed by the AI route to decide between Option A and Option B (section 5).
   * The owner id is returned rather than resolved from the caller's token on purpose: the
   * stored key belongs to the room's *host*, not to whoever is currently asking, so a
   * `trusted` member's request opens the host's credential and not one of their own.
   */
  keyMode: "browser" | "server" | null;
  roomOwnerId: string | null;
} | null> {
  const { supabase } = await requireUser();
  if (!supabase) return null;

  const role = await roleFor(input.roomId, input.memberToken);
  if (!role) return null;

  const { data: room } = await supabase
    .from("rooms")
    .select(
      "ai_audience,ai_provider,ai_model,key_mode,owner_id,ai_specialties,ai_max_models,allow_guest_write,closed_at,expires_at,room_kind",
    )
    .eq("room_id", input.roomId)
    .maybeSingle();

  // A finished room answers nothing.
  //
  // `readRoom` and `postMessage` both refuse a closed or expired room, and this used not to.
  // The service role bypasses RLS, so nothing below the application layer would have caught
  // it either. The effect was that closing a room stopped the conversation but not the
  // spending: a `trusted` member could keep invoking the model, drawing on the host's key,
  // for as long as the row survived the sweep. The transcript being gone made it look closed.
  if (room) {
    const expiry = new Date(room.expires_at as string);
    if (room.closed_at || Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      return null;
    }
  }

  const audienceAll = room?.ai_audience === "all";

  // Read-only stops a guest spending, not just a guest typing.
  //
  // The role table in section 4 gives read-only `May invoke: No`, and `postMessage` already
  // refuses a guest's write in the same state. Without this half, a host who set
  // `ai_audience` to `all` and then locked the room got a room nobody could write to where
  // every guest could still spend their key — the one thing the lock was pulled for.
  //
  // The host stays exempt, as they are in `postMessage`: a host who cannot ask their own
  // model has been locked out of their own room, which is not what "read-only" means.
  const readOnly = room?.allow_guest_write === false;

  const roomKind = (room?.room_kind === "panel" ? "panel" : "guest") as "guest" | "panel";

  // The caller's own model, and only in a panel room.
  //
  // Read by the caller's token hash, so this is the model belonging to whoever is asking.
  // There is no parameter that could name another member's model, which is what makes the
  // proposal's rule — "whoever invokes a model invokes it with their own" — a property of
  // the shape rather than a check somebody has to remember to write.
  let callerModel: { modelId: string; modelLabel: string; specialty: string } | null = null;
  if (roomKind === "panel") {
    const { data: ownRow } = await supabase
      .from("room_members")
      .select("model_id,model_label,model_specialty")
      .eq("room_id", input.roomId)
      .eq("member_token_hash", await hashSecret(input.memberToken))
      .maybeSingle();

    // All three or none is the schema's constraint, so a present `model_id` implies the other
    // two. The guards are here so a row that predates the constraint cannot hand the AI route
    // a half-built model to sign a request with.
    if (ownRow?.model_id && ownRow.model_label && ownRow.model_specialty) {
      callerModel = {
        modelId: String(ownRow.model_id),
        modelLabel: String(ownRow.model_label),
        specialty: String(ownRow.model_specialty),
      };
    }
  }

  return {
    role,
    // The design puts the model behind the host's trust by default: a guest who cannot be
    // moderated by the host should not be able to spend the host's money.
    mayInvokeModel: readOnly
      ? role === "host" || role === "trusted"
      : role === "host" || role === "trusted" || audienceAll,
    // Read from the room, never from the request. `rooms.sql` says why: "the server needs
    // them to pick a model without asking the host's device for anything." The host chose
    // these when they opened the room, and no member — including the host — gets to change
    // the model for one question. A caller-supplied model would let any member bill the
    // room for a price the host never agreed to.
    aiProvider: room?.ai_provider ?? null,
    aiModel: room?.ai_model ?? null,
    aiSpecialties: Array.isArray(room?.ai_specialties)
      ? (room?.ai_specialties as unknown[]).map((value) => String(value))
      : [],
    // Null when the room has no ceiling, which the room row distinguishes from zero. A zero
    // would be refused by the column's own check, so the two can never be confused here.
    aiMaxModels:
      room?.ai_max_models === null || room?.ai_max_models === undefined
        ? null
        : Number(room?.ai_max_models),
    roomKind,
    callerModel,
    keyMode: (room?.key_mode as "browser" | "server" | undefined) ?? null,
    roomOwnerId: room?.owner_id ?? null,
  };
}

function toMessageRow(row: Record<string, unknown>): MessageRow {
  return {
    id: String(row.id),
    seq: Number(row.seq),
    authorTokenHash: String(row.author_token_hash),
    ciphertext: String(row.ciphertext),
    contentHash: String(row.content_hash),
    kind: row.kind as MessageRow["kind"],
    phase: row.phase === null ? null : Number(row.phase),
    pinnedAt: row.pinned_at ? String(row.pinned_at) : null,
    modelLabel: row.model_label ? String(row.model_label) : null,
    modelSpecialty: row.model_specialty ? String(row.model_specialty) : null,
    replyToId: row.reply_to_id ? String(row.reply_to_id) : null,
    threadRootId: row.thread_root_id ? String(row.thread_root_id) : null,
    createdAt: String(row.created_at),
    // Overwritten by readMessages, which knows the caller's own hash. A default of
    // false means a row that somehow skipped that comparison is not claimed as the
    // caller's own.
    isMine: false,
  };
}

const MESSAGE_COLUMNS =
  "id,seq,author_token_hash,ciphertext,content_hash,kind,phase,pinned_at,model_label,model_specialty,reply_to_id,thread_root_id,created_at";

export interface ReadMessagesInput {
  roomId: string;
  memberToken: string;
}

/**
 * Reads the transcript, oldest first.
 *
 * The result is ciphertext. The client unwraps the room key and decrypts each message
 * locally, which is why this function asks only "are you a member" and never who you
 * are: it has no ability to read the room either way.
 */
export async function readMessages(
  input: ReadMessagesInput,
): Promise<{
  /** A page, in transcript order. Carries no author hash; see the note in the body. */
  messages: (Omit<MessageRow, "authorTokenHash"> & { isMine: boolean })[];
  role: "host" | "trusted" | "guest";
  allowGuestWrite: boolean;
  /** The channel to subscribe to for a "something changed" signal. Not a credential. */
  feedId: string | null;
  /**
   * The roles the host offered this room's model, and how many models it may run at once.
   *
   * Returned with the transcript rather than through a second request, because a member
   * cannot choose a role without knowing the list, and the list does not change during a
   * room's life.
   */
  aiSpecialties: string[];
  aiMaxModels: number | null;
  /**
   * Which kind of room this is, and — in a panel — the caller's own model.
   *
   * Sent with the transcript because the panel controls cannot be rendered without them, and a
   * second request to learn "am I in a panel, and have I registered a model" would double
   * the reads on the one screen that opens most often. Neither field is a credential:
   * `roomKind` is structural, and `callerModel` is the caller's own registration, which the
   * caller could read from their own database row in any case.
   */
  roomKind: "guest" | "panel";
  callerModel: { modelId: string; modelLabel: string; specialty: string } | null;
}> {
  const { supabase } = await requireUser();
  if (!supabase) throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");

  const role = await roleFor(input.roomId, input.memberToken);
  if (!role) {
    // A non-member gets the same refusal as a bad link, so this endpoint cannot be
    // used to discover which room ids exist.
    throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");
  }

  const { data, error } = await supabase
    .from("room_messages")
    .select(MESSAGE_COLUMNS)
    .eq("room_id", input.roomId)
    // Newest first, so the page returned is the end of the conversation rather than its
    // beginning. A room that has passed a hundred messages used to serve its opening
    // hundred and nothing since, which reads to a late joiner as "nobody has said
    // anything" and to the host as a room that has gone quiet. The rows are reversed
    // below so the client still receives them in transcript order.
    .order("seq", { ascending: false })
    .limit(MESSAGE_PAGE);

  if (error) {
    throw new RoomError("The transcript could not be loaded", 503, "MESSAGES_FAILED");
  }

  // The write flag travels with the transcript so the composer can disable itself
  // without a second request. It is not a secret: a member can already see whether
  // their own post was accepted.
  const { data: room } = await supabase
    .from("rooms")
    .select(
      "allow_guest_write,feed_id,closed_at,expires_at,ai_specialties,ai_max_models,room_kind",
    )
    .eq("room_id", input.roomId)
    .maybeSingle();

  // The service role bypasses row level security, so the policies that would have
  // refused a read of a finished room are not consulted here. Without this check a
  // transcript outlives the room it belongs to until the row is actually swept, which
  // is exactly the window the design says must not exist.
  if (room) {
    const expiry = new Date(room.expires_at);
    if (room.closed_at || Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
      throw new RoomError("This room has ended", 410, "ROOM_ENDED");
    }
  }

  // ## The caller's own panel model
  //
  // Read by the caller's token hash, so it is theirs by construction: there is no parameter
  // here that could name another member's registration. Only fetched in a panel room, because
  // in a guest room the answer is always null and one query per room read is a cost the panel
  // feature should not charge everybody else.
  let ownModel: { modelId: string; modelLabel: string; specialty: string } | null = null;
  if (room?.room_kind === "panel") {
    const { data: ownRow } = await supabase
      .from("room_members")
      .select("model_id,model_label,model_specialty")
      .eq("room_id", input.roomId)
      .eq("member_token_hash", await hashSecret(input.memberToken))
      .maybeSingle();

    // All three or none is the schema's constraint. The guards repeat it here so a row that
    // predates the constraint cannot hand the client a half-built model to render as though
    // it were usable.
    if (ownRow?.model_id && ownRow.model_label && ownRow.model_specialty) {
      ownModel = {
        modelId: String(ownRow.model_id),
        modelLabel: String(ownRow.model_label),
        specialty: String(ownRow.model_specialty),
      };
    }
  }

  // Each message is marked with whether the caller wrote it, decided here rather than
  // in the client.
  //
  // The client *could* work this out by re-deriving a SHA-256 of its own token and
  // comparing, because the service role read `author_token_hash` from the row. That
  // version is fragile: it depends on two implementations of the same digest agreeing,
  // in two runtimes, forever, for a cosmetic difference. Comparing the two hashes the
  // server already holds is one comparison in one place.
  //
  // Returning a boolean rather than the hash is deliberate. `author_token_hash` is
  // already in the row the caller just fetched, so returning it would not widen access,
  // but a client that starts reading that column would then have a hash per author to
  // correlate across rooms. A boolean answers the only question the UI asks.
  const own = await hashSecret(input.memberToken);
  const rows = (data ?? []) as Record<string, unknown>[];

  return {
    messages: rows
      // Read newest-first, hand back oldest-first.
      .reverse()
      .map((row) => {
        const message = toMessageRow(row);
        // The hash is dropped here rather than below, in `toMessageRow`, because the
        // insert path still needs it in the row it returns to the author. Omitting it
        // from the transcript is the point: a client that received one hash per author
        // could correlate who writes in which room forever, and nothing in the UI asks
        // for more than the boolean.
        const { authorTokenHash: _omitted, ...published } = message;
        return { ...published, isMine: row.author_token_hash === own };
      }),
    role,
    allowGuestWrite: room?.allow_guest_write !== false,
    feedId: room?.feed_id ?? null,
    aiSpecialties: Array.isArray(room?.ai_specialties)
      ? (room?.ai_specialties as unknown[]).map((value) => String(value))
      : [],
    aiMaxModels:
      room?.ai_max_models === null || room?.ai_max_models === undefined
        ? null
        : Number(room?.ai_max_models),
    // Which kind of room this is, so the client can show a member their own model controls
    // only where those controls mean something. Anything but the literal "panel" is a guest
    // room, so a room written before this column existed is treated as what it always was.
    roomKind: (room?.room_kind === "panel" ? "panel" : "guest") as "guest" | "panel",
    // The caller's own registration, and their own only. Null in every guest room, and null
    // for a panel member who has not registered — which is a state the panel UI must render
    // as "you have not brought a model" rather than as an error.
    callerModel: ownModel,
  };
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export interface PostMessageInput {
  roomId: string;
  memberToken: string;
  ciphertext: string;
  contentHash: string;
  replyToId?: string | null;
  threadRootId?: string | null;
  kind?: MessageRow["kind"];
  /** Required for `ai` rows, refused for every other kind. See the schema's two checks. */
  modelLabel?: string | null;
  /** The speciality the host defined. Refused when the room's list does not contain it. */
  modelSpecialty?: string | null;
}

/** Bounds a single message. A transcript is unusable if one row is enormous. */
const MAX_CIPHERTEXT = 65_536;

/**
 * Appends one message.
 *
 * The check order is deliberate. Shape first, so a malformed body is rejected before
 * any database work; then membership, so a stranger learns nothing about the room; then
 * the room's own write flag, because read-only is the host's decision and a guest must
 * not be able to talk their way past it.
 */
export async function postMessage(input: PostMessageInput): Promise<MessageRow> {
  const { supabase } = await requireUser();
  if (!supabase) throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");

  if (
    !input.ciphertext ||
    input.ciphertext.length > MAX_CIPHERTEXT ||
    !/^[0-9a-f]{64}$/.test(input.contentHash)
  ) {
    throw new RoomError("That message could not be saved", 400, "MESSAGE_INVALID");
  }

  const role = await roleFor(input.roomId, input.memberToken);
  if (!role) {
    throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");
  }

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .select("allow_guest_write,closed_at,expires_at,feed_id,ai_specialties,ai_model")
    .eq("room_id", input.roomId)
    .maybeSingle();

  if (roomError || !room) {
    throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");
  }

  const expiry = new Date(room.expires_at);
  if (room.closed_at || Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    throw new RoomError("This room has ended", 410, "ROOM_ENDED");
  }

  // Read-only is room-wide, and the host is exempt: the host still needs to be able to
  // lift it from inside the room.
  if (role === "guest" && !room.allow_guest_write) {
    throw new RoomError("This room is read-only", 403, "READ_ONLY");
  }

  // Attribution, and only for `ai` rows.
  //
  // Two rules, and both are load-bearing rather than cosmetic:
  //
  // An `ai` row must name a model. Without it the room has answers of unknown origin, which
  // is the state this whole feature exists to end.
  //
  // A speciality must be one the host actually offered. A model cannot attach a role nobody
  // agreed to, or the role means nothing — and a caller inventing one would make the field
  // free text, which is what the host's list was for.
  const kind = input.kind ?? "human";
  const modelLabel = input.modelLabel?.trim() || null;
  const modelSpecialty = input.modelSpecialty?.trim() || null;

  if (kind === "ai" && !modelLabel) {
    throw new RoomError("That message could not be saved", 400, "MODEL_LABEL_REQUIRED");
  }
  if (kind !== "ai" && modelLabel) {
    // A member must not be able to write a message that renders as the model's opinion.
    // The schema refuses it too; checking here turns a constraint violation into an
    // explanation.
    throw new RoomError("Only a model answer can name a model", 400, "MODEL_LABEL_NOT_ALLOWED");
  }
  if (modelLabel && modelLabel.length > 60) {
    throw new RoomError("That message could not be saved", 400, "MODEL_LABEL_TOO_LONG");
  }

  // Only a role the host actually offered is ever stored.
  //
  // When the room offers roles and this is not one of them, the answer is refused rather than
  // written: the caller is either confused or trying to invent a role, and either way the room
  // must not end up holding a role nobody agreed to.
  //
  // When the room offers no roles at all, the role is dropped instead of refused. Refusing
  // would make the model unusable in every room that predates this feature, and there is
  // nothing to invent a role *against* — the honest outcome is an answer with no role on it.
  const offered = Array.isArray(room.ai_specialties)
    ? (room.ai_specialties as unknown[]).map((value) => String(value))
    : [];
  const acceptedSpecialty =
    modelSpecialty && offered.includes(modelSpecialty) ? modelSpecialty : null;

  if (modelSpecialty && offered.length > 0 && !acceptedSpecialty) {
    throw new RoomError("That role is not one this room offers", 400, "SPECIALTY_UNKNOWN");
  }
  if (modelSpecialty && modelSpecialty.length > 60) {
    throw new RoomError("That message could not be saved", 400, "MODEL_SPECIALTY_TOO_LONG");
  }

  const { data, error } = await supabase
    .from("room_messages")
    .insert({
      room_id: input.roomId,
      author_token_hash: await hashSecret(input.memberToken),
      ciphertext: input.ciphertext,
      ciphertext_bytes: input.ciphertext.length,
      content_hash: input.contentHash,
      kind,
      model_label: kind === "ai" ? modelLabel : null,
      model_specialty: kind === "ai" ? acceptedSpecialty : null,
      reply_to_id: input.replyToId ?? null,
      // A reply with no explicit thread root is its own root, which is what makes a
      // plain reply a one-message thread rather than an orphan.
      thread_root_id: input.threadRootId ?? input.replyToId ?? null,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) throw new RoomError("That message could not be saved", 503, "MESSAGE_FAILED");

  // Not awaited by the caller, but awaited here: the insert has succeeded, and a
  // subscriber that is told within a second beats one that waits out a poll interval.
  await announceRoomChange(room.feed_id);

  return toMessageRow(data as Record<string, unknown>);
}

/**
 * Pins or unpins one message. Host only.
 *
 * Pinning is the one edit anyone can make to an existing row, and the design gives it to the
 * host alone: *"A group converges on a few items; those need to stop scrolling away. Host
 * only."* A member who could pin would be marking the room's agenda, which is the host's
 * call and not a matter of who argued well.
 *
 * The column is `pinned_at` rather than a boolean so that a pinned item shows when it was
 * marked, and so that unpinning and re-pinning are distinguishable. It holds a timestamp or
 * null, never a flag, because a boolean would lose the second fact.
 *
 * Only `pinned_at` is written. The update names that one column and nothing else, so a
 * concurrent client cannot use this path to rewrite a message body. That matters because
 * `seq` is described as final: the ordering the whole room agrees on must not be something a
 * later write can disturb.
 */
export async function setMessagePinned(input: {
  roomId: string;
  memberToken: string;
  messageId: string;
  pinned: boolean;
}): Promise<{ pinnedAt: string | null }> {
  const { supabase } = await requireUser();
  if (!supabase) throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");

  const role = await roleFor(input.roomId, input.memberToken);
  if (!role) {
    throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");
  }

  // Deliberately `host` and not `trusted`. A trusted member may spend the host's key, which
  // is a cost decision the host made about them; it is not a grant of authority over the
  // room itself.
  if (role !== "host") {
    throw new RoomError("Only the host can pin", 403, "NOT_HOST");
  }

  // Scoped to the room as well as the message. Message ids are globally unique, but a query
  // that found a message by id alone would be one refactor away from pinning across rooms,
  // and the room predicate is free to include.
  const { data, error } = await supabase
    .from("room_messages")
    .update({ pinned_at: input.pinned ? new Date().toISOString() : null })
    .eq("room_id", input.roomId)
    .eq("id", input.messageId)
    .select("pinned_at")
    .maybeSingle();

  // A missing row and a failed write are told apart, because "not found" for an id the host
  // just clicked usually means the message is gone rather than that the room is broken.
  if (error) throw new RoomError("That message could not be pinned", 503, "PIN_FAILED");
  if (!data) throw new RoomError("That message is not in this room", 404, "MESSAGE_NOT_FOUND");

  // The transcript is cached on every client, so a pin must reach them the same way a new
  // message does. The signal is content-free and the row is already readable by members, so
  // announcing a change adds nothing to what a member could learn.
  const { data: room } = await supabase
    .from("rooms")
    .select("feed_id")
    .eq("room_id", input.roomId)
    .maybeSingle();
  await announceRoomChange(room?.feed_id);

  return { pinnedAt: data.pinned_at ? String(data.pinned_at) : null };
}

// ---------------------------------------------------------------------------
// Spend: what a room has cost, and who spent it
// ---------------------------------------------------------------------------

/**
 * Records one successful model call.
 *
 * Called after the provider answers, not before, so a failed call costs the host nothing and
 * is not counted as though it had.
 *
 * **This never fails the request.** A member who asked a question and got an answer has been
 * served; refusing to return that answer because the counter could not be written would trade
 * a bookkeeping problem for a real one. The write is awaited only so it usually lands before the
 * next one, and its error is swallowed deliberately — the host's view of spend is a convenience,
 * not a billing ledger, and this file does not claim otherwise.
 */
export async function recordRoomAiUsage(input: {
  roomId: string;
  memberToken: string;
  model: string;
}): Promise<void> {
  try {
    const { supabase } = await requireUser();
    if (!supabase) return;

    await supabase.from("room_ai_usage").insert({
      room_id: input.roomId,
      // The hash, never the token — the same rule as `room_members`.
      author_token_hash: await hashSecret(input.memberToken),
      model: input.model.slice(0, 200),
    });
  } catch {
    // Swallowed on purpose. See the note on the function above: the answer has already been
    // produced, and failing here would withhold it over a bookkeeping row.
  }
}

/**
 * Switches a room between open and read-only. Host only.
 *
 * Read-only is the host's blunt instrument and the one the risk table reaches for: "the host
 * can switch to read-only or remove a member, effective immediately". The schema has always
 * carried the column and `postMessage` has always enforced it, so this closes the gap where a
 * host could set the rule but had no way to pull the switch.
 *
 * The host is exempt, in `postMessage` rather than here. A room the host can read but not
 * write to is a room they cannot close, and that is never what "read-only" is meant to mean.
 */
export async function setRoomReadOnly(input: {
  roomId: string;
  memberToken: string;
  readOnly: boolean;
}): Promise<{ allowGuestWrite: boolean }> {
  const role = await roleFor(input.roomId, input.memberToken);
  if (!role) throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");
  if (role !== "host") throw new RoomError("Only the host can change this", 403, "NOT_HOST");

  const { supabase } = await requireUser();
  if (!supabase) throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");

  const { data, error } = await supabase
    .from("rooms")
    // `allow_guest_write` is the column; `readOnly` is the same fact as a host thinks of it.
    // Naming the second in the API keeps the endpoint reading as the sentence it is.
    .update({ allow_guest_write: !input.readOnly })
    .eq("room_id", input.roomId)
    .select("allow_guest_write")
    .maybeSingle();

  if (error) throw new RoomError("That change could not be saved", 503, "SETTINGS_FAILED");

  return { allowGuestWrite: Boolean(data?.allow_guest_write) };
}

/** One member's spend, as the host sees it. */
export interface RoomSpendRow {
  /** The host's six-character label, matching the members panel and the roster. */
  label: string;
  role: "host" | "trusted" | "guest";
  /** How many calls this member made. Never a cost: the server cannot price a provider call. */
  calls: number;
  lastUsedAt: string | null;
}

export interface RoomSpendSummary {
  /** Total calls across the room, including the host's own. */
  totalCalls: number;
  /** Calls in the last day, so "quiet" and "abandoned" can be told apart. */
  callsLastDay: number;
  /** Per member, busiest first. */
  members: RoomSpendRow[];
  /** Distinct models used, with counts. Empty when nothing has been asked. */
  models: { model: string; calls: number }[];
}

/**
 * Reads a room's spend. Host only.
 *
 * Counts, never money. The server knows how many calls were made and which model answered; it
 * does not know what the host's key costs per token, because that depends on the host's
 * provider contract. Inventing a currency figure here would be a guess dressed as a number,
 * so the host is shown the thing that is actually knowable and told plainly what it is not.
 */
export async function readRoomSpend(input: {
  roomId: string;
  memberToken: string;
}): Promise<RoomSpendSummary | null> {
  const role = await roleFor(input.roomId, input.memberToken);
  // A non-member and a non-host get the same refusal, so this cannot be used to discover
  // which rooms exist or who is in one.
  if (role !== "host") return null;

  const { supabase } = await requireUser();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("room_ai_usage")
    .select("author_token_hash,model,created_at")
    .eq("room_id", input.roomId);

  if (error || !data) {
    return { totalCalls: 0, callsLastDay: 0, members: [], models: [] };
  }

  const rows = data as Record<string, unknown>[];
  const dayAgo = Date.now() - 86_400_000;

  // Grouped in memory rather than with a SQL aggregate. A room's spend is bounded by its own
  // rate limit, so the row count is small, and grouping here keeps the query a single read
  // with no second round trip for the role lookup the host already needs elsewhere.
  const byMember = new Map<string, { calls: number; lastUsedAt: string; model: string }>();
  const byModel = new Map<string, number>();
  let callsLastDay = 0;

  for (const row of rows) {
    const hash = String(row.author_token_hash);
    const createdAt = String(row.created_at);
    const existing = byMember.get(hash);

    if (existing) {
      existing.calls += 1;
      // ISO-8601 sorts as a string, so the later of two timestamps is the greater.
      if (createdAt > existing.lastUsedAt) existing.lastUsedAt = createdAt;
    } else {
      byMember.set(hash, { calls: 1, lastUsedAt: createdAt, model: String(row.model) });
    }

    const model = String(row.model);
    byModel.set(model, (byModel.get(model) ?? 0) + 1);

    const time = new Date(createdAt).getTime();
    if (!Number.isNaN(time) && time >= dayAgo) callsLastDay += 1;
  }

  // The role comes from `room_members` so a spent member is labelled `host` or `trusted` even
  // though the usage row itself carries no role.
  const { data: memberRows } = await supabase
    .from("room_members")
    .select("member_token_hash,role")
    .eq("room_id", input.roomId);

  const roleByHash = new Map<string, string>();
  for (const row of (memberRows ?? []) as Record<string, unknown>[]) {
    roleByHash.set(String(row.member_token_hash), String(row.role));
  }

  const members: RoomSpendRow[] = [...byMember.entries()]
    .map(([hash, value]) => ({
      label: hash.slice(0, 6),
      role: (roleByHash.get(hash) as RoomSpendRow["role"]) ?? "guest",
      calls: value.calls,
      lastUsedAt: value.lastUsedAt,
    }))
    .sort((a, b) => b.calls - a.calls || a.label.localeCompare(b.label));

  return {
    totalCalls: rows.length,
    callsLastDay,
    members,
    models: [...byModel.entries()]
      .map(([model, calls]) => ({ model, calls }))
      .sort((a, b) => b.calls - a.calls || a.model.localeCompare(b.model)),
  };
}

// ---------------------------------------------------------------------------
// Ideas and voting
// ---------------------------------------------------------------------------

/**
 * An idea as the server stores it.
 *
 * `ciphertext` is the sealed body and the server cannot open it — the same property messages
 * have, and for the same reason: an idea is room content. What the server *can* see is the
 * structure around it, which is what makes a board sortable and countable without the server
 * ever learning what was proposed.
 */
export interface IdeaRow {
  id: string;
  ciphertext: string;
  /** True when the caller's own token matches the row's author hash. Never the hash itself. */
  isMine: boolean;
  status: "open" | "accepted" | "dropped";
  /** Set once the host has converted this into a real task on their device. */
  taskId: string | null;
  createdAt: string;
  /** Net score, computed by the server from the votes table. */
  score: number;
  /** How many members voted, which is not the same as the net score. */
  voters: number;
  /** Whether *this* caller has voted, and how. Drives the button's own state. */
  myVote: -1 | 0 | 1;
}

/** How many ideas one member may have open at once. */
const MAX_OPEN_IDEAS_PER_MEMBER = 20;

async function liveRoomRow(roomId: string): Promise<Record<string, unknown> | null> {
  const { supabase } = await requireUser();
  if (!supabase) return null;
  const { data } = await supabase
    .from("rooms")
    .select("closed_at,expires_at")
    .eq("room_id", roomId)
    .maybeSingle();
  if (!data) return null;
  const expiry = new Date(data.expires_at as string);
  if (data.closed_at || Number.isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    return null;
  }
  return data as Record<string, unknown>;
}

/**
 * Reads the room's ideas with their scores.
 *
 * Every member may read every idea, which is the point of a board. The score is computed here
 * rather than in the browser because summing votes is arithmetic on rows the server holds, and
 * a browser that summed them itself would have to be trusted not to.
 */
export async function readIdeas(input: {
  roomId: string;
  memberToken: string;
}): Promise<IdeaRow[]> {
  const role = await roleFor(input.roomId, input.memberToken);
  if (!role) throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");

  const { supabase } = await requireUser();
  if (!supabase) throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");

  const ownHash = await hashSecret(input.memberToken);

  const { data: ideaRows } = await supabase
    .from("room_ideas")
    .select("id,ciphertext,author_token_hash,status,task_id,created_at")
    .eq("room_id", input.roomId)
    .order("created_at", { ascending: false });

  const ideas = (ideaRows ?? []) as Record<string, unknown>[];
  if (ideas.length === 0) return [];

  // Two maps rather than a query per idea. A board with twenty rows would otherwise be forty
  // round trips, and the whole point of the scores is that the client can sort on them.
  const scoreByIdea = new Map<string, { score: number; voters: number }>();
  const mineByIdea = new Map<string, -1 | 1>();

  const { data: voteRows } = await supabase
    .from("room_votes")
    .select("idea_id,voter_token_hash,vote")
    .eq("room_id", input.roomId);

  for (const vote of (voteRows ?? []) as Record<string, unknown>[]) {
    const ideaId = String(vote.idea_id);
    const value = Number(vote.vote) === -1 ? -1 : 1;
    const existing = scoreByIdea.get(ideaId);
    if (existing) {
      existing.score += value;
      existing.voters += 1;
    } else {
      scoreByIdea.set(ideaId, { score: value, voters: 1 });
    }
    if (vote.voter_token_hash === ownHash) mineByIdea.set(ideaId, value);
  }

  return ideas.map((row) => {
    const id = String(row.id);
    const tally = scoreByIdea.get(id);
    return {
      id,
      ciphertext: String(row.ciphertext),
      isMine: row.author_token_hash === ownHash,
      status: row.status as IdeaRow["status"],
      taskId: row.task_id === null || row.task_id === undefined ? null : String(row.task_id),
      createdAt: String(row.created_at),
      score: tally?.score ?? 0,
      voters: tally?.voters ?? 0,
      myVote: mineByIdea.get(id) ?? 0,
    };
  });
}

/**
 * Adds an idea. Any member may, including a guest.
 *
 * A guest proposing an idea is not a guest spending the host's key — no model is involved —
 * so the panel rules do not apply here. What a guest may not do is moderate the board, and
 * that is `setIdeaStatus` and `attachIdeaTask`, both host-only.
 */
export async function createIdea(input: {
  roomId: string;
  memberToken: string;
  ciphertext: string;
}): Promise<{ id: string }> {
  const role = await roleFor(input.roomId, input.memberToken);
  if (!role) throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");

  if (!(await liveRoomRow(input.roomId))) {
    throw new RoomError("This room has ended", 410, "ROOM_ENDED");
  }

  const { supabase } = await requireUser();
  if (!supabase) throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");

  // A bound on how much one member can fill a board. Not on what they may say — on how many
  // rows they may add — because a board a single member can fill is not a board.
  const { count } = await supabase
    .from("room_ideas")
    .select("id", { count: "exact", head: true })
    .eq("room_id", input.roomId)
    .eq("author_token_hash", await hashSecret(input.memberToken));
  if ((count ?? 0) >= MAX_OPEN_IDEAS_PER_MEMBER) {
    throw new RoomError(
      "You have added as many ideas as one member may add",
      409,
      "TOO_MANY_IDEAS",
    );
  }

  const { data, error } = await supabase
    .from("room_ideas")
    .insert({
      room_id: input.roomId,
      ciphertext: input.ciphertext,
      author_token_hash: await hashSecret(input.memberToken),
      status: "open",
    })
    .select("id")
    .maybeSingle();

  if (error || !data) {
    throw new RoomError("That idea could not be added", 503, "IDEA_CREATE_FAILED");
  }
  return { id: String(data.id) };
}

/**
 * Records a vote, or replaces the caller's previous one.
 *
 * One vote per person per idea is a **primary key** on `room_votes`, so it is a database
 * guarantee rather than something this function checks and the UI is trusted to honour. The
 * upsert below is what lets a member change their mind without accumulating votes.
 */
export async function voteOnIdea(input: {
  roomId: string;
  memberToken: string;
  ideaId: string;
  vote: 1 | -1;
}): Promise<void> {
  const role = await roleFor(input.roomId, input.memberToken);
  if (!role) throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");

  const { supabase } = await requireUser();
  if (!supabase) throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");

  const { error } = await supabase.from("room_votes").upsert({
    room_id: input.roomId,
    idea_id: input.ideaId,
    voter_token_hash: await hashSecret(input.memberToken),
    vote: input.vote,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new RoomError("That vote could not be recorded", 503, "VOTE_FAILED");
}

/** Withdraws the caller's vote. The idea is untouched; only the vote goes. */
export async function withdrawVote(input: {
  roomId: string;
  memberToken: string;
  ideaId: string;
}): Promise<void> {
  const role = await roleFor(input.roomId, input.memberToken);
  if (!role) throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");

  const { supabase } = await requireUser();
  if (!supabase) throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");

  const { error } = await supabase
    .from("room_votes")
    .delete()
    .eq("room_id", input.roomId)
    .eq("idea_id", input.ideaId)
    .eq("voter_token_hash", await hashSecret(input.memberToken));
  if (error) throw new RoomError("That vote could not be withdrawn", 503, "VOTE_FAILED");
}

/**
 * Accepts or drops an idea. Host only.
 *
 * Approval is the boundary in section 9: only a host-approved item becomes permanent memory,
 * and everything else expires with the room. So the decision to accept is not a vote — it is
 * the one act that a member of the room cannot perform for themselves.
 */
export async function setIdeaStatus(input: {
  roomId: string;
  memberToken: string;
  ideaId: string;
  status: "open" | "accepted" | "dropped";
}): Promise<void> {
  const role = await roleFor(input.roomId, input.memberToken);
  if (!role) throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");
  if (role !== "host") throw new RoomError("Only the host can do this", 403, "NOT_HOST");

  const { supabase } = await requireUser();
  if (!supabase) throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");

  const { error } = await supabase
    .from("room_ideas")
    .update({ status: input.status })
    .eq("room_id", input.roomId)
    .eq("id", input.ideaId);
  if (error) throw new RoomError("That idea could not be changed", 503, "IDEA_UPDATE_FAILED");
}

/**
 * Records that the host turned this idea into a real task on their device.
 *
 * Only the id is stored. The task itself never leaves the host's browser — the same boundary
 * section 9 draws for an approved decision, where the summary crosses into memory and nothing
 * else does.
 */
export async function attachIdeaTask(input: {
  roomId: string;
  memberToken: string;
  ideaId: string;
  taskId: string;
}): Promise<void> {
  const role = await roleFor(input.roomId, input.memberToken);
  if (!role) throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");
  if (role !== "host") throw new RoomError("Only the host can do this", 403, "NOT_HOST");

  const { supabase } = await requireUser();
  if (!supabase) throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");

  const { error } = await supabase
    .from("room_ideas")
    .update({ task_id: input.taskId.slice(0, 200) })
    .eq("room_id", input.roomId)
    .eq("id", input.ideaId);
  if (error) throw new RoomError("That task could not be linked", 503, "TASK_LINK_FAILED");
}
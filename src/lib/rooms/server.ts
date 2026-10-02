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
  const { supabase } = await requireUser();
  if (!supabase) {
    throw new RoomError("Rooms are not available", 503, "ROOMS_UNAVAILABLE");
  }

  if (!isValidRoomId(input.roomId) || !isValidInviteCode(input.inviteCode)) {
    throw new RoomError("This invite is not valid", 404, "INVITE_INVALID");
  }

  const { data, error } = await supabase
    .from("rooms")
    .select(
      "room_id,invite_code_hash,wrapped_room_key,wrap_salt,closed_at,expires_at,require_display_name,allow_guest_write",
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

  const memberToken = createMemberToken();
  const { error: memberError } = await supabase.from("room_members").insert({
    room_id: data.room_id,
    member_token_hash: await hashSecret(memberToken),
    role: "guest",
    invited_by: null,
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
    .select("ai_audience,ai_provider,ai_model,key_mode,owner_id")
    .eq("room_id", input.roomId)
    .maybeSingle();

  const audienceAll = room?.ai_audience === "all";
  return {
    role,
    // The design puts the model behind the host's trust by default: a guest who cannot be
    // moderated by the host should not be able to spend the host's money.
    mayInvokeModel: role === "host" || role === "trusted" || audienceAll,
    // Read from the room, never from the request. `rooms.sql` says why: "the server needs
    // them to pick a model without asking the host's device for anything." The host chose
    // these when they opened the room, and no member — including the host — gets to change
    // the model for one question. A caller-supplied model would let any member bill the
    // room for a price the host never agreed to.
    aiProvider: room?.ai_provider ?? null,
    aiModel: room?.ai_model ?? null,
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
  "id,seq,author_token_hash,ciphertext,content_hash,kind,phase,pinned_at,reply_to_id,thread_root_id,created_at";

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
    .select("allow_guest_write,feed_id,closed_at,expires_at")
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
    .select("allow_guest_write,closed_at,expires_at,feed_id")
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

  const { data, error } = await supabase
    .from("room_messages")
    .insert({
      room_id: input.roomId,
      author_token_hash: await hashSecret(input.memberToken),
      ciphertext: input.ciphertext,
      ciphertext_bytes: input.ciphertext.length,
      content_hash: input.contentHash,
      kind: input.kind ?? "human",
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

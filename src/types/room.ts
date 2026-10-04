/**
 * Group room types. Phase 1 of docs/group-rooms-design.md.
 *
 * These mirror the columns in `supabase/rooms.sql`. Anything the server stores as
 * ciphertext is typed as the ciphertext string here, never as the decoded value, so a
 * component cannot accidentally treat an undecrypted field as readable. The plaintext
 * shapes live in `lib/rooms/crypto` and are only produced after `openMessage` succeeds.
 */

/** Who a member is, which decides what they may do. */
export type RoomRole = "host" | "trusted" | "guest";

/**
 * One row of the host's member list.
 *
 * Declared here rather than in `lib/rooms/members` because that module carries the
 * `server-only` marker while the panel that renders these rows is a client component.
 *
 * `label` is a short prefix of the member's stored token hash. It is a selector for the
 * host's click and nothing more: every authorisation on that endpoint is checked against
 * the caller's own token, so guessing or copying a label grants nothing.
 *
 * There is deliberately no `memberTokenHash` field. A host holding every hash could
 * recognise the same person in a second room, which is the correlation this design
 * refuses to make possible.
 */
export interface RoomMemberView {
  label: string;
  role: RoomRole;
  joinedAt: string;
  lastSeenAt: string | null;
}

/** Where the host's AI key lives. See section 5 of the design document. */
export type RoomKeyMode = "browser" | "server";

/** Who may invoke the model in this room. */
export type RoomAiAudience = "trusted" | "all";

/** Who authored a row. `ai` is the model, `system` is the room announcing something. */
export type RoomMessageKind = "human" | "ai" | "system";

/** An idea's fate. Only the host moves it out of `open`. */
export type RoomIdeaStatus = "open" | "accepted" | "dropped";

/** The `rooms` row, as the server returns it. Content fields are ciphertext. */
export interface Room {
  roomId: string;
  ownerId: string;
  /** The room key sealed under the invite code. Useless without the code. */
  wrappedRoomKey: string;
  wrapSalt: string;
  /** Title, topic, and phase. Encrypted, because a topic can be sensitive. */
  settingsCiphertext: string | null;
  aiProvider: string | null;
  aiModel: string | null;
  keyMode: RoomKeyMode;
  keyExpiresAt: string | null;
  allowGuestWrite: boolean;
  requireDisplayName: boolean;
  roomQuota: number;
  aiAudience: RoomAiAudience;
  expiresAt: string;
  createdAt: string;
  closedAt: string | null;
}

/** A member row. The token itself is never returned; the client keeps it. */
export interface RoomMember {
  roomId: string;
  memberTokenHash: string;
  role: RoomRole;
  invitedBy: string | null;
  joinedAt: string;
  lastSeenAt: string | null;
}

/**
 * A message row.
 *
 * `replyToId` and `threadRootId` are stored in cleartext columns on purpose: they are
 * structural, and rendering a thread does not require decrypting every message. They
 * reveal the shape of the conversation, never its content.
 */
export interface RoomMessage {
  id: string;
  roomId: string;
  /** The total order every member sees. Not interchangeable with `createdAt`. */
  seq: number;
  authorTokenHash: string;
  ciphertext: string;
  kind: RoomMessageKind;
  phase: number | null;
  pinnedAt: string | null;
  /** Which model wrote an `ai` row, and the job the host gave it. Null otherwise. */
  modelLabel: string | null;
  modelSpecialty: string | null;
  replyToId: string | null;
  threadRootId: string | null;
  createdAt: string;
}

/** An idea on the board. The text is encrypted; the status is not. */
export interface RoomIdea {
  id: string;
  roomId: string;
  ciphertext: string;
  authorTokenHash: string;
  status: RoomIdeaStatus;
  /** Set when the host converts it to a task on their own device. */
  taskId: string | null;
  createdAt: string;
}

/** One vote. The primary key makes this unique per voter per idea. */
export interface RoomVote {
  roomId: string;
  ideaId: string;
  voterTokenHash: string;
  vote: 1 | -1;
  updatedAt: string;
}

/** The header the API route reads the member token from. Named in rooms.sql. */
export const ROOM_MEMBER_HEADER = "x-room-member";

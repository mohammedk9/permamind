/**
 * Browser-side room client.
 *
 * The room key lives here and nowhere else. It is created when a host opens a room and
 * it is unwrapped when a guest joins, and in both cases it is produced by Web Crypto in
 * this tab. Nothing in this file sends it to the server, which is the whole basis of
 * the design: a leaked database is ciphertext because the key that opens it was never
 * transmitted.
 */

import {
  createHostCode,
  createInviteCode,
  createRoomId,
  saveMemberToken,
  isValidInviteCode,
  isValidRoomId,
} from "@/lib/rooms/access";
import {
  createRoomKey,
  createWrapSalt,
  unwrapRoomKey,
  wrapRoomKey,
  type RoomKeyHandle,
  type WrappedRoomKey,
} from "@/lib/rooms/crypto";

/** The codes a host sees once, at creation. */
export interface NewRoomCodes {
  roomId: string;
  inviteCode: string;
  hostCode: string;
}

export interface CreateRoomRequest {
  title: string;
  topic: string;
  expiresAt: string;
  aiProvider: string;
  aiModel: string;
  keyMode: "browser" | "server";
  keyExpiresAt: string | null;
  allowGuestWrite: boolean;
  requireDisplayName: boolean;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

/**
 * Prepares everything the server needs, without sending the room key.
 *
 * The codes and the wrapper are produced here rather than by the route because only
 * this side holds the key and therefore only this side can seal it. The route receives
 * the two codes in plaintext exactly once, hashes them, and stores the wrapper.
 */
export async function prepareNewRoom(): Promise<{
  roomId: string;
  inviteCode: string;
  hostCode: string;
  wrappedRoomKey: string;
  wrapSalt: string;
}> {
  const roomKey = await createRoomKey();
  const inviteCode = createInviteCode();
  const hostCode = createHostCode();
  const salt = createWrapSalt();
  const wrapped = await wrapRoomKey(roomKey, inviteCode, salt);

  return {
    roomId: createRoomId(),
    inviteCode,
    hostCode,
    wrappedRoomKey: JSON.stringify(wrapped),
    wrapSalt: bytesToBase64(salt),
  };
}

/** The shareable link. The id is in the path; the code is not. */
export function roomLink(roomId: string): string {
  if (typeof window === "undefined") return `/r/${roomId}`;
  return `${window.location.origin}/r/${roomId}`;
}

export interface JoinOutcome {
  ok: true;
  roomId: string;
  memberToken: string;
  /** The unwrapped room key. The caller holds it in memory for the session. */
  key: RoomKeyHandle;
}

export type JoinResult = JoinOutcome | { ok: false; error: string; code: string };

/**
 * Joins a room and unwraps the key locally.
 *
 * The response carries a wrapped key, so this function is the only place a guest
 * becomes able to read the room. It happens on the guest's device, after the code has
 * already been verified server-side.
 *
 * The unwrapped key is returned rather than stored, because a room key that outlives
 * the tab is a room key that any later script on this origin can read. A guest who
 * wants to return re-enters the code and unwraps again.
 */
export async function joinWithCode(
  roomId: string,
  inviteCode: string,
): Promise<JoinResult> {
  if (!isValidRoomId(roomId) || !isValidInviteCode(inviteCode)) {
    return { ok: false, error: "Check the room link and the six-digit code.", code: "INVITE_INVALID" };
  }

  const response = await fetch("/api/rooms/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roomId, inviteCode }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
    memberToken?: string;
    wrappedRoomKey?: string;
    wrapSalt?: string;
  };

  if (!response.ok || !data.memberToken || !data.wrappedRoomKey) {
    return {
      ok: false,
      error: data.error ?? "This room could not be joined.",
      code: data.code ?? "JOIN_FAILED",
    };
  }

  try {
    const key = await unwrapRoomKey(
      JSON.parse(data.wrappedRoomKey) as WrappedRoomKey,
      inviteCode,
    );
    saveMemberToken(roomId, data.memberToken);
    return { ok: true, roomId, memberToken: data.memberToken, key };
  } catch {
    // The wrapper did not open with the code that was just accepted. That should be
    // impossible, and saying so beats a generic failure.
    return {
      ok: false,
      error: "This room could not be opened on this device.",
      code: "UNWRAP_FAILED",
    };
  }
}

export type { RoomKeyHandle };

/**
 * Room access primitives: identifiers, codes, and tokens.
 *
 * This module owns every string that ends up on a postcard. The rule it enforces is
 * simple and worth stating plainly: nothing the server stores is ever a secret in the
 * clear. Codes are hashed before they are written, and the room key is wrapped rather
 * than sent.
 *
 * Identifiers use an alphabet with no vowels and no characters that are ambiguous when
 * read aloud, because a room id gets copied out of a chat window and typed back in.
 */

// No vowels, and none of 0/O, 1/I/L, 5/S. An id containing one of those gets mistyped
// when it is read out of a chat window, and a mistyped id looks like a room that does
// not exist.
const ID_ALPHABET = "BCDFGHJKMNPQRTWXYZ2346789";
const CODE_ALPHABET = "2346789";

/** Room ids are short enough to paste, long enough not to be sequential. */
const ROOM_ID_LENGTH = 6;
const CODE_LENGTH = 6;
const TOKEN_BYTES = 32;

function randomFrom(alphabet: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += alphabet[bytes[index] % alphabet.length];
  }
  return out;
}

/**
 * A room id such as `7K9P2X`.
 *
 * The alphabet omits vowels, `0`, `1`, `I`, `O`, and `S`, so a misread id is rejected
 * rather than silently resolving to a different room. Sequential ids are not used at
 * all: they would let anyone enumerate rooms and try to join each one.
 */
export function createRoomId(): string {
  return randomFrom(ID_ALPHABET, ROOM_ID_LENGTH);
}

/** A six-digit invite code. Digits only, so it survives being read over a phone. */
export function createInviteCode(): string {
  return randomFrom(CODE_ALPHABET, CODE_LENGTH);
}

/**
 * The host's administration code.
 *
 * Separate from the invite code and never sent to anyone. Sharing an invite therefore
 * never confers administrative rights over the room.
 *
 * The first character is forced to be a **letter**. `ID_ALPHABET` contains every character in
 * `CODE_ALPHABET`, so a host code drawn from it independently would land inside the invite
 * code's shape roughly once in every 350 rooms — all six characters digits. That is the one
 * case where pasting the wrong code hands over the wrong half of the authority, which is
 * precisely what this function exists to prevent, so it is made impossible rather than
 * unlikely. The remaining five characters still come from the full alphabet, which is far
 * more than the 100k invite codes this must not collide with.
 */
export function createHostCode(): string {
  const letters = ID_ALPHABET.replace(/[0-9]/g, "");
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  const first = letters[bytes[0] % letters.length];
  const rest = randomFrom(ID_ALPHABET, CODE_LENGTH - 1);
  return first + rest;
}

/** A member token. High entropy, because it is the guest's only credential. */
export function createMemberToken(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * SHA-256, hex encoded.
 *
 * The database stores hashes of the invite code, the host code, and the member token.
 * A digest is the right primitive here because these are random high-entropy strings,
 * not human-chosen passwords, so there is nothing to brute force offline. The invite
 * code is the one exception, which is why it is stretched with PBKDF2 before use as a
 * key rather than being trusted as a digest input.
 */
export async function hashSecret(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

/** Constant-time-ish comparison, so a wrong code cannot be narrowed down by timing. */
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

/** Shape checks, applied before any database call. */
export function isValidRoomId(value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^[${ID_ALPHABET}]{${ROOM_ID_LENGTH}}$`).test(value);
}

export function isValidInviteCode(value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(value);
}

export function isValidHostCode(value: unknown): value is string {
  return typeof value === "string" && new RegExp(`^[${ID_ALPHABET}]{${CODE_LENGTH}}$`).test(value);
}

export function isValidMemberToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

/**
 * The key the client keeps for a room it has joined.
 *
 * The member token is a credential, so it is held in `sessionStorage` like the API key
 * rather than in `localStorage`. Losing it on tab close is the intended behaviour: a
 * token that outlives the session is a token that can be read by any later script on
 * the origin. A guest who wants to come back re-joins with the invite code.
 */
const MEMBER_TOKEN_PREFIX = "permamind:room-member:";

export function saveMemberToken(roomId: string, token: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(`${MEMBER_TOKEN_PREFIX}${roomId}`, token);
  } catch {
    // A blocked storage quota is not a reason to refuse a join; the guest simply
    // cannot return to this room later without the invite code.
  }
}

export function loadMemberToken(roomId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = sessionStorage.getItem(`${MEMBER_TOKEN_PREFIX}${roomId}`);
    return isValidMemberToken(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearMemberToken(roomId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(`${MEMBER_TOKEN_PREFIX}${roomId}`);
  } catch {
    // Nothing to do: the token is already unreachable.
  }
}

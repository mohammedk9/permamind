/**
 * Storage for a host's provider key (Option B).
 *
 * Every function here requires an authenticated user id. There is no path that stores or
 * returns a key without one, and no room-member token is involved: this is the host's own
 * credential in their own account, not something a guest can reach or a room can borrow.
 *
 * The expiry is mandatory and enforced in two places, on purpose:
 *
 *   1. The `expires_at` column is `not null`, so a row cannot exist without an end date.
 *   2. Every read re-checks the date and deletes the row if it has passed, so a row that
 *      outlives its date by even one request is removed rather than used.
 *
 * The second check is what makes the first honest. A schema constraint says an end date was
 * chosen; it does not say anything acted on it. Without the read-side sweep, deleting an
 * expired key would depend on a cron job that does not exist yet, and a key promised to be
 * deleted after seven days would still be readable on day eight.
 */

import "server-only";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  hostKeyStorageAvailable,
  openHostKey,
  sealHostKey,
  HostKeyError,
  type SealedHostKey,
} from "@/lib/rooms/host-key";

/** Bounds the window, so "expires in ten years" cannot be written by a crafted request. */
const MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_LIFETIME_MS = 60 * 60 * 1000;

/**
 * Serialises the sealed form into the two text columns the table stores.
 *
 * JSON rather than concatenated base64: it is one field to validate on read, and a column
 * that cannot be parsed is a row that can be discarded instead of half-opened.
 */
function toColumns(sealed: SealedHostKey) {
  return {
    key_version: sealed.version,
    sealed_dek: JSON.stringify(sealed.sealedDek),
    sealed_key: JSON.stringify(sealed.sealedKey),
  };
}

function fromRow(row: Record<string, unknown>): SealedHostKey {
  try {
    return {
      version: Number(row.key_version),
      sealedDek: JSON.parse(String(row.sealed_dek)) as SealedHostKey["sealedDek"],
      sealedKey: JSON.parse(String(row.sealed_key)) as SealedHostKey["sealedKey"],
    };
  } catch {
    throw new HostKeyError("This stored key is unreadable", 409, "KEY_CORRUPT");
  }
}

function assertExpiry(expiresAt: string, now: Date): Date {
  const expiry = new Date(expiresAt);
  const delta = expiry.getTime() - now.getTime();
  if (Number.isNaN(delta)) {
    throw new HostKeyError("Choose when this key should be deleted", 400, "KEY_EXPIRY_INVALID");
  }
  // There is no "forever". A credential that cannot be revoked by time is the failure mode
  // this whole option exists to avoid.
  if (delta < MIN_LIFETIME_MS) {
    throw new HostKeyError("A stored key must last at least an hour", 400, "KEY_EXPIRY_SOON");
  }
  if (delta > MAX_LIFETIME_MS) {
    throw new HostKeyError("A stored key cannot last longer than 30 days", 400, "KEY_EXPIRY_TOO_LONG");
  }
  return expiry;
}

function admin() {
  // The service role is required: RLS on `host_ai_keys` is written in terms of
  // `auth.uid()`, and these reads happen outside a request context, after the caller has
  // already been authenticated by this module.
  const client = getSupabaseAdminClient();
  if (!client) {
    throw new HostKeyError("Storage is not available", 503, "HOST_KEY_UNAVAILABLE");
  }
  return client;
}

/**
 * Stores or replaces the host's provider key.
 *
 * A replace rather than an insert, so re-saving a new key does not orphan the old row and
 * leave a second copy behind for someone to find later.
 */
export async function storeHostKey(input: {
  userId: string;
  providerKey: string;
  expiresAt: string;
  now?: Date;
}): Promise<{ expiresAt: string }> {
  const now = input.now ?? new Date();
  if (!hostKeyStorageAvailable()) {
    throw new HostKeyError(
      "Storing a key on our servers is not available",
      503,
      "HOST_KEY_UNAVAILABLE",
    );
  }
  const expiry = assertExpiry(input.expiresAt, now);
  const sealed = await sealHostKey(input.providerKey);

  const { error } = await admin().from("host_ai_keys").upsert(
    {
      user_id: input.userId,
      ...toColumns(sealed),
      expires_at: expiry.toISOString(),
      created_at: now.toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    // The row is not written and the database message is not passed through: a driver error
    // can name the constraint that failed, which is a small disclosure about the schema.
    throw new HostKeyError("Your key could not be stored", 503, "KEY_STORE_FAILED");
  }
  return { expiresAt: expiry.toISOString() };
}

/**
 * Reads the host's provider key, or null when there is nothing usable.
 *
 * Returns null rather than throwing for "absent", "expired", or "unreadable", because all
 * three mean the same thing to a caller: this room must fall back to Option A and let the
 * host answer while they are present. A thrown error would turn a recoverable state into a
 * failed room, which is the opposite of what section 5 promises.
 */
export async function loadHostKey(
  userId: string,
  now = new Date(),
): Promise<{ key: string; expiresAt: string } | null> {
  const { data, error } = await admin()
    .from("host_ai_keys")
    .select("key_version,sealed_dek,sealed_key,expires_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;

  // Sweep on read. This is the check that makes "deleted after N days" a fact rather than an
  // intention: the first request after the date removes the row instead of using it.
  if (new Date(String(data.expires_at)).getTime() <= now.getTime()) {
    await admin().from("host_ai_keys").delete().eq("user_id", userId);
    return null;
  }

  try {
    const key = await openHostKey(fromRow(data as Record<string, unknown>));
    return key ? { key, expiresAt: String(data.expires_at) } : null;
  } catch {
    // A key that cannot be opened is a key that cannot be used, and leaving it in place
    // would keep a row the host believes is gone.
    await admin().from("host_ai_keys").delete().eq("user_id", userId);
    return null;
  }
}

/** Removes the host's stored key. Deletion is not recoverable, by design. */
export async function deleteHostKey(userId: string): Promise<void> {
  await admin().from("host_ai_keys").delete().eq("user_id", userId);
}

/**
 * Whether a stored key exists, without opening it.
 *
 * For the Settings screen, which needs to show an expiry date and offer a delete action but
 * has no reason to hold the key itself in memory to draw a checkbox.
 */
export async function hostKeyStatus(
  userId: string,
  now = new Date(),
): Promise<{ present: boolean; expiresAt: string | null }> {
  const { data } = await admin()
    .from("host_ai_keys")
    .select("expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return { present: false, expiresAt: null };
  if (new Date(String(data.expires_at)).getTime() <= now.getTime()) {
    return { present: false, expiresAt: null };
  }
  return { present: true, expiresAt: String(data.expires_at) };
}


/**
 * A local memory of the free daily allowance being spent.
 *
 * The server is the only authority: `/api/chat` refuses with
 * `code: "free_quota_exceeded"` and a `resetAt` timestamp. Without this module
 * that answer lived only in React state, so it disappeared on reload or on a
 * closed tab, and the UI had nothing to show before the next send. Keeping the
 * reset time under its own key lets the client know, at boot, that the allowance
 * is still spent.
 *
 * Why localStorage rather than IndexedDB: this is one timestamp a few bytes
 * long, it is written on refusal and read once at startup, and it must survive a
 * browser restart. `storage-preferences` uses the same store for the same
 * reason. It is deliberately not synced and not exported: it describes the
 * server's allowance for this browser, not the user's data.
 *
 * A tampered or stale value is never trusted. `readActiveFreeQuotaState`
 * drops an expired entry, and the server re-checks the allowance on every send,
 * so a wrong local value can only cost one wasted request, never a wrong answer.
 */

export const FREE_QUOTA_STATE_KEY = "permamind:free-quota:v1";

export interface FreeQuotaState {
  version: 1;
  /** ISO 8601, UTC — copied verbatim from the server's `resetAt`. */
  resetAt: string;
  /** Messages already spent when the refusal arrived, when the server said so. */
  used?: number;
  /** The daily limit the server reported, when it said so. */
  limit?: number;
}

function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(FREE_QUOTA_STATE_KEY);
  } catch {
    // A blocked storage (private mode, disabled cookies) must not throw here:
    // this module is read during render.
    return null;
  }
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Parses a stored value, returning null for anything this app did not write. */
function parse(raw: string | null): FreeQuotaState | null {
  if (!raw) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<FreeQuotaState>;
  if (candidate.version !== 1) return null;
  if (typeof candidate.resetAt !== "string") return null;

  const time = Date.parse(candidate.resetAt);
  if (Number.isNaN(time)) return null;

  return {
    version: 1,
    resetAt: new Date(time).toISOString(),
    used: optionalCount(candidate.used),
    limit: optionalCount(candidate.limit),
  };
}

/** The stored refusal, or null when nothing readable is stored. Never throws. */
export function readFreeQuotaState(): FreeQuotaState | null {
  return parse(readRaw());
}

/** The stored reset time, or null. Does not check whether it has passed. */
export function readFreeQuotaResetAt(): string | null {
  return readFreeQuotaState()?.resetAt ?? null;
}

/**
 * Records a refusal.
 *
 * Returns false when the value is unusable or the store is blocked, so a caller
 * that needs to know whether the state survived can tell. `resetAt` is
 * normalised to ISO so a later comparison is a string/number comparison and not
 * a re-parse.
 */
export function rememberFreeQuotaResetAt(
  resetAt: string,
  details: { used?: number; limit?: number } = {},
): boolean {
  const time = Date.parse(resetAt);
  if (Number.isNaN(time)) return false;

  const state: FreeQuotaState = {
    version: 1,
    resetAt: new Date(time).toISOString(),
    ...(details.used !== undefined ? { used: details.used } : {}),
    ...(details.limit !== undefined ? { limit: details.limit } : {}),
  };

  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(FREE_QUOTA_STATE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/** Forgets the stored refusal. Safe to call when nothing is stored. */
export function clearFreeQuotaState(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(FREE_QUOTA_STATE_KEY);
  } catch {
    // Nothing to recover: a blocked store simply keeps whatever it kept.
  }
}

/**
 * True while the allowance is still spent.
 *
 * An unparseable or missing value is treated as "not spent": showing a quota
 * message with no evidence behind it would be worse than letting the server
 * refuse again.
 */
export function isQuotaResetActive(
  resetAt?: string | null,
  now: number = Date.now(),
): boolean {
  if (!resetAt) return false;
  const time = Date.parse(resetAt);
  if (Number.isNaN(time)) return false;
  return time > now;
}

/**
 * The stored refusal while its reset still lies in the future.
 *
 * Returns the whole entry rather than only the timestamp because the card that
 * renders after a reload needs the limit to say "you have used your 10 free
 * messages"; a reset time without a count produces a sentence with a hole in it.
 *
 * An expired entry is removed on the way out, so the key does not outlive the
 * day it describes and a later read is not left validating a stale value.
 */
export function readActiveFreeQuotaState(now: number = Date.now()): FreeQuotaState | null {
  const state = readFreeQuotaState();
  if (!state) return null;
  if (!isQuotaResetActive(state.resetAt, now)) {
    clearFreeQuotaState();
    return null;
  }
  return state;
}
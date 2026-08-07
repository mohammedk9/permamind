const LOCK_PREFIX = "permamind:coordination:";
const DEFAULT_LEASE_MS = 15_000;

type Lease = { owner: string; expiresAt: number };

const ownerId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function read(name: string): Lease | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(`${LOCK_PREFIX}${name}`);
    return value ? (JSON.parse(value) as Lease) : null;
  } catch { return null; }
}

export function acquireLease(name: string, leaseMs = DEFAULT_LEASE_MS): string | null {
  if (typeof window === "undefined") return null;
  const key = `${LOCK_PREFIX}${name}`;
  const current = read(name);
  const now = Date.now();
  if (current && current.owner !== ownerId && current.expiresAt > now) return null;
  const token = ownerId;
  try {
    localStorage.setItem(key, JSON.stringify({ owner: token, expiresAt: now + leaseMs }));
    // A read-back prevents stale tabs from proceeding after a competing write.
    return (read(name)?.owner === token) ? token : null;
  } catch { return null; }
}

export function renewLease(name: string, token: string, leaseMs = DEFAULT_LEASE_MS): boolean {
  if (read(name)?.owner !== token) return false;
  try {
    localStorage.setItem(`${LOCK_PREFIX}${name}`, JSON.stringify({ owner: token, expiresAt: Date.now() + leaseMs }));
    return read(name)?.owner === token;
  } catch { return false; }
}

export function releaseLease(name: string, token: string): void {
  if (typeof window === "undefined" || read(name)?.owner !== token) return;
  try { localStorage.removeItem(`${LOCK_PREFIX}${name}`); } catch { /* unavailable storage */ }
}

export function withLease<T>(name: string, fn: () => T): T | undefined {
  const token = acquireLease(name);
  if (!token) return undefined;
  try { return fn(); } finally { releaseLease(name, token); }
}
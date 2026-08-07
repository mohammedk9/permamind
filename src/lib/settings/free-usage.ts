export const FREE_DAILY_MESSAGE_LIMIT = 10;
const STORAGE_KEY = "permamind:free-usage:v1";

export interface FreeUsage { date: string; count: number }

function today() { return new Date().toISOString().slice(0, 10); }

export function getFreeUsage(now = today()): FreeUsage {
  if (typeof window === "undefined") return { date: now, count: 0 };
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<FreeUsage> | null;
    if (!value || value.date !== now || typeof value.count !== "number") return { date: now, count: 0 };
    return { date: now, count: Math.max(0, Math.floor(value.count)) };
  } catch { return { date: now, count: 0 }; }
}

export function consumeFreeMessage(): FreeUsage {
  const usage = getFreeUsage();
  const next = { ...usage, count: usage.count + 1 };
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* best effort */ }
  return next;
}

export function getRemainingFreeMessages() {
  return Math.max(0, FREE_DAILY_MESSAGE_LIMIT - getFreeUsage().count);
}
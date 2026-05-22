import type { UsageEvent } from "@/types/analytics";

const STORAGE_KEY = "permamind:analytics:v1";
const MAX_EVENTS = 400;

interface StoredAnalytics {
  version: 1;
  events: UsageEvent[];
}

export function loadAnalyticsEvents(): UsageEvent[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as StoredAnalytics;
    if (data.version !== 1 || !Array.isArray(data.events)) return [];
    return data.events;
  } catch {
    return [];
  }
}

export function saveAnalyticsEvents(events: UsageEvent[]): void {
  if (typeof window === "undefined") return;

  const trimmed = events.slice(-MAX_EVENTS);
  const data: StoredAnalytics = { version: 1, events: trimmed };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

export function appendAnalyticsEvent(event: UsageEvent): UsageEvent[] {
  const events = [...loadAnalyticsEvents(), event];
  saveAnalyticsEvents(events);
  return events;
}

export function clearAnalyticsEvents(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

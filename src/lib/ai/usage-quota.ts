import { checkRateLimit } from "@/lib/ai/rate-limit";
import { requireUser } from "@/lib/supabase/server";

export const FREE_DAILY_CHAT_LIMIT = 10;
export const FREE_DAILY_SUMMARY_LIMIT = 10;
const BURST_LIMIT = 5;

export type QuotaKind = "chat" | "summary";

type Reservation =
  | { ok: true }
  | { ok: false; status: number; error: string; retryAfterSeconds?: number };

/**
 * Free mode spends the shared server key, so its daily allowance must survive
 * restarts and multiple server copies. The in-memory limiter is only a burst
 * guard. BYOK spends the caller's own key and keeps the short burst guard.
 */
export async function reserveAiQuota(kind: QuotaKind, freeMode: boolean): Promise<Reservation> {
  const burst = checkRateLimit(`ai:${kind}:burst`, BURST_LIMIT);
  if (!burst.allowed) {
    return { ok: false, status: 429, error: "Too many requests. Please slow down.", retryAfterSeconds: burst.retryAfterSeconds };
  }
  if (!freeMode) return { ok: true };

  const { supabase, user } = await requireUser();
  if (!supabase || !user) {
    return { ok: false, status: 401, error: "Sign in to use the free daily allowance, or add your own API key in Settings." };
  }

  const limit = kind === "chat" ? FREE_DAILY_CHAT_LIMIT : FREE_DAILY_SUMMARY_LIMIT;
  const { data, error } = await supabase.rpc("reserve_ai_request", {
    p_user_id: user.id,
    p_kind: kind,
    p_limit: limit,
  });
  if (error) return { ok: false, status: 503, error: "The daily allowance is temporarily unavailable." };

  const quota = Array.isArray(data) ? data[0] : data;
  if (!quota?.allowed) {
    const noun = kind === "chat" ? "messages" : "summaries";
    return {
      ok: false,
      status: 429,
      error: `You have used your ${limit} free ${noun} for today. Add your own API key in Settings, or come back tomorrow.`,
      retryAfterSeconds: secondsUntilUtcMidnight(),
    };
  }
  return { ok: true };
}

function secondsUntilUtcMidnight(now = Date.now()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - now) / 1000));
}

import { checkRateLimit } from "@/lib/ai/rate-limit";
import { requireUser } from "@/lib/supabase/server";

export const FREE_DAILY_CHAT_LIMIT = 10;
export const FREE_DAILY_SUMMARY_LIMIT = 10;
const BURST_LIMIT = 5;

export type QuotaKind = "chat" | "summary";

type Reservation =
  | { ok: true; reservationId?: string }
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

  let supabase: Awaited<ReturnType<typeof requireUser>>["supabase"];
  let user: Awaited<ReturnType<typeof requireUser>>["user"];
  try {
    ({ supabase, user } = await requireUser());
  } catch (error) {
    console.error("[ai-quota] Could not resolve the authenticated user", error);
    return { ok: false, status: 503, error: "The daily allowance is temporarily unavailable." };
  }
  if (!supabase || !user) {
    return { ok: false, status: 401, error: "Sign in to use the free daily allowance, or add your own API key in Settings." };
  }

  const limit = kind === "chat" ? FREE_DAILY_CHAT_LIMIT : FREE_DAILY_SUMMARY_LIMIT;
  let data: unknown;
  let error: { message?: string } | null;
  try {
    ({ data, error } = await supabase.rpc("reserve_ai_request", {
      p_user_id: user.id,
      p_kind: kind,
      p_limit: limit,
    }));
  } catch (rpcError) {
    console.error("[ai-quota] Reserve RPC failed", rpcError);
    return { ok: false, status: 503, error: "The daily allowance is temporarily unavailable." };
  }
  if (error) {
    console.error("[ai-quota] Reserve RPC returned an error", error.message);
    return { ok: false, status: 503, error: "The daily allowance is temporarily unavailable." };
  }

  const quota = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean; reservation_id?: unknown } | null | undefined;
  if (!quota?.allowed) {
    const noun = kind === "chat" ? "messages" : "summaries";
    return {
      ok: false,
      status: 429,
      error: `You have used your ${limit} free ${noun} for today. Add your own API key in Settings, or come back tomorrow.`,
      retryAfterSeconds: secondsUntilUtcMidnight(),
    };
  }
  if (typeof quota.reservation_id !== "string" || !quota.reservation_id) {
    console.error("[ai-quota] Reserve RPC returned no reservation id");
    return { ok: false, status: 503, error: "The daily allowance is temporarily unavailable." };
  }
  return { ok: true, reservationId: quota.reservation_id };
}

/** Finalize only after the provider response completed successfully. */
export async function finalizeAiQuota(reservationId: string | undefined): Promise<void> {
  if (!reservationId) return;
  try {
    const { supabase, user } = await requireUser();
    if (!supabase || !user) {
      console.error("[ai-quota] Cannot finalize reservation without an authenticated user", reservationId);
      return;
    }
    const { error } = await supabase.rpc("finalize_ai_request", {
      p_reservation_id: reservationId,
    });
    if (error) console.error("[ai-quota] Finalize RPC returned an error", { reservationId, error: error.message });
  } catch (error) {
    console.error("[ai-quota] Finalize RPC failed", { reservationId, error });
  }
}

/** Release a reservation when validation, the provider, or streaming fails. */
export async function releaseAiQuota(reservationId: string | undefined): Promise<void> {
  if (!reservationId) return;
  try {
    const { supabase, user } = await requireUser();
    if (!supabase || !user) {
      console.error("[ai-quota] Cannot release reservation without an authenticated user", reservationId);
      return;
    }
    const { error } = await supabase.rpc("release_ai_request", {
      p_reservation_id: reservationId,
    });
    if (error) console.error("[ai-quota] Release RPC returned an error", { reservationId, error: error.message });
  } catch (error) {
    console.error("[ai-quota] Release RPC failed", { reservationId, error });
  }
}

function secondsUntilUtcMidnight(now = Date.now()): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return Math.max(1, Math.ceil((next.getTime() - now) / 1000));
}

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/ai/rate-limit", () => ({ checkRateLimit: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })) }));

import { checkRateLimit } from "@/lib/ai/rate-limit";
import { requireUser } from "@/lib/supabase/server";
import { finalizeAiQuota, releaseAiQuota, reserveAiQuota } from "./usage-quota";

describe("durable AI quota", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reserves a free request against the signed-in user", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ allowed: true, used_count: 1, reservation_id: "reservation-1" }], error: null });
    vi.mocked(requireUser).mockResolvedValue({ supabase: { rpc }, user: { id: "user-1" } } as never);
    await expect(reserveAiQuota("chat", true)).resolves.toEqual({ ok: true, reservationId: "reservation-1" });
    expect(rpc).toHaveBeenCalledWith("reserve_ai_request", { p_user_id: "user-1", p_kind: "chat", p_limit: 10 });
  });

  it("does not spend the shared key when the durable quota is exhausted", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ allowed: false, used_count: 10 }], error: null });
    vi.mocked(requireUser).mockResolvedValue({ supabase: { rpc }, user: { id: "user-1" } } as never);
    const result = await reserveAiQuota("summary", true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(429);
  });

  it("tags the exhausted allowance with the free-quota code, used count, and UTC reset", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ allowed: false, used_count: 10 }], error: null });
    vi.mocked(requireUser).mockResolvedValue({ supabase: { rpc }, user: { id: "user-1" } } as never);

    const result = await reserveAiQuota("chat", true);

    expect(result).toMatchObject({ ok: false, status: 429, code: "free_quota_exceeded", limit: 10, used: 10 });
    if (result.ok || !result.resetAt) throw new Error("expected a reset time");

    const reset = new Date(result.resetAt);
    expect(Number.isNaN(reset.getTime())).toBe(false);
    expect(result.resetAt).toBe(reset.toISOString());
    // The daily counter is keyed on the UTC date, so the reset is UTC midnight.
    expect(reset.getUTCHours()).toBe(0);
    expect(reset.getUTCMinutes()).toBe(0);
    expect(reset.getUTCSeconds()).toBe(0);
    expect(reset.getUTCMilliseconds()).toBe(0);
    expect(reset.getTime()).toBeGreaterThan(Date.now());
  });

  it("reports the used count the RPC returned rather than assuming the limit", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ allowed: false, used_count: 7 }], error: null });
    vi.mocked(requireUser).mockResolvedValue({ supabase: { rpc }, user: { id: "user-1" } } as never);

    await expect(reserveAiQuota("chat", true)).resolves.toMatchObject({ ok: false, used: 7, limit: 10 });
  });

  it("never emits the legacy QUOTA_EXCEEDED code for a spent allowance", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ allowed: false, used_count: 10 }], error: null });
    vi.mocked(requireUser).mockResolvedValue({ supabase: { rpc }, user: { id: "user-1" } } as never);

    const result = await reserveAiQuota("chat", true);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).not.toBe("QUOTA_EXCEEDED");
  });

  it("tags a missing RPC as an unavailable allowance instead of a spent one", async () => {
    // The production outage: the function did not exist, so every request
    // failed. It must not be reported as "you used your ten for today".
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "function reserve_ai_request does not exist" } });
    vi.mocked(requireUser).mockResolvedValue({ supabase: { rpc }, user: { id: "user-1" } } as never);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await reserveAiQuota("chat", true);
    expect(result).toMatchObject({ ok: false, status: 503, code: "QUOTA_UNAVAILABLE" });
    expect(result.ok === false && result.limit).toBeUndefined();
    consoleError.mockRestore();
  });

  it("tags an unauthenticated free request separately from a spent allowance", async () => {
    vi.mocked(requireUser).mockResolvedValue({ supabase: null, user: null } as never);
    await expect(reserveAiQuota("chat", true)).resolves.toMatchObject({ ok: false, status: 401, code: "SIGNIN_REQUIRED" });
  });

  it("tags the burst limiter as a rate limit rather than a quota problem", async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce({ allowed: false, retryAfterSeconds: 30 } as never);
    await expect(reserveAiQuota("chat", true)).resolves.toMatchObject({ ok: false, status: 429, code: "RATE_LIMITED" });
  });

  it("allows requests one through ten and rejects request eleven", async () => {
    let call = 0;
    const rpc = vi.fn().mockImplementation(async () => {
      call += 1;
      return call <= 10
        ? { data: [{ allowed: true, used_count: call, reservation_id: `reservation-${call}` }], error: null }
        : { data: [{ allowed: false, used_count: 10, reservation_id: null }], error: null };
    });
    vi.mocked(requireUser).mockResolvedValue({ supabase: { rpc }, user: { id: "user-1" } } as never);

    const results = await Promise.all(Array.from({ length: 11 }, () => reserveAiQuota("chat", true)));

    expect(results.slice(0, 10).every((result) => result.ok)).toBe(true);
    expect(results[10]).toMatchObject({ ok: false, status: 429 });
  });

  it("keeps BYOK off the durable shared-key quota", async () => {
    await expect(reserveAiQuota("chat", false)).resolves.toEqual({ ok: true });
    expect(requireUser).not.toHaveBeenCalled();
    expect(checkRateLimit).toHaveBeenCalled();
  });

  it("releases a failed reservation without finalizing it", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    vi.mocked(requireUser).mockResolvedValue({ supabase: { rpc }, user: { id: "user-1" } } as never);

    await releaseAiQuota("reservation-1");

    expect(rpc).toHaveBeenCalledWith("release_ai_request", { p_reservation_id: "reservation-1" });
  });

  it("finalizes only the reservation passed by the completed request", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    vi.mocked(requireUser).mockResolvedValue({ supabase: { rpc }, user: { id: "user-1" } } as never);

    await finalizeAiQuota("reservation-1");

    expect(rpc).toHaveBeenCalledWith("finalize_ai_request", { p_reservation_id: "reservation-1" });
  });
});

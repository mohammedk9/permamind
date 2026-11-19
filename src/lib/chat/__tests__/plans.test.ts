import { describe, expect, it } from "vitest";

import {
  DEFAULT_BYOK_PROVIDER,
  canOfferLocalPlan,
  currentPlan,
  isLocalHost,
  resolvePlan,
  type PlanSettings,
} from "@/lib/chat/plans";

const FREE: PlanSettings = { mode: "free", provider: "openrouter" };
const BYOK: PlanSettings = { mode: "byok", provider: "openai" };
const LOCAL: PlanSettings = { mode: "byok", provider: "ollama" };

describe("resolvePlan", () => {
  it("selects the free allowance without touching a keyed provider", () => {
    expect(resolvePlan("free", BYOK)).toEqual({ mode: "free", provider: "openai" });
  });

  it("leaves the local model when moving to free", () => {
    // The bug this prevents: `getRequestHeaders()` checks the provider before
    // the mode, so `mode: "free"` + `provider: "ollama"` would keep routing to
    // the local model after the user chose the free allowance.
    expect(resolvePlan("free", LOCAL)).toEqual({ mode: "free", provider: DEFAULT_BYOK_PROVIDER });
  });

  it("leaves the local model when moving to a keyed provider", () => {
    expect(resolvePlan("byok", LOCAL)).toEqual({ mode: "byok", provider: DEFAULT_BYOK_PROVIDER });
  });

  it("keeps a keyed provider the user already chose", () => {
    expect(resolvePlan("byok", { mode: "free", provider: "anthropic" })).toEqual({
      mode: "byok",
      provider: "anthropic",
    });
  });

  it("models the local plan as BYOK against Ollama, which needs no key", () => {
    expect(resolvePlan("local", FREE)).toEqual({ mode: "byok", provider: "ollama" });
  });
});

describe("currentPlan", () => {
  it("reads the provider first, because that is what the app actually routes on", () => {
    expect(currentPlan(LOCAL)).toBe("local");
  });

  it("distinguishes the free allowance from a keyed provider", () => {
    expect(currentPlan(FREE)).toBe("free");
    expect(currentPlan(BYOK)).toBe("byok");
  });

  it("round-trips every plan through resolvePlan", () => {
    for (const plan of ["free", "byok", "local"] as const) {
      expect(currentPlan(resolvePlan(plan, FREE))).toBe(plan);
    }
  });
});

describe("isLocalHost", () => {
  it("recognises the names a browser uses for this machine", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("[::1]")).toBe(true);
    expect(isLocalHost("::1")).toBe(true);
    expect(isLocalHost("LOCALHOST")).toBe(true);
  });

  it("rejects every other host, including a private network address", () => {
    // Only the machine itself counts: a NAS or a colleague's laptop is not the
    // * user's device, even though the same port may be open there.
    expect(isLocalHost("example.com")).toBe(false);
    expect(isLocalHost("192.168.1.20")).toBe(false);
    expect(isLocalHost("10.0.0.4")).toBe(false);
    expect(isLocalHost("my-app.vercel.app")).toBe(false);
  });
});

describe("canOfferLocalPlan", () => {
  it("offers the local plan on localhost only", () => {
    expect(canOfferLocalPlan("localhost")).toBe(true);
  });

  it("treats a missing host as not local, so nothing is offered by default", () => {
    // A non-browser context (or a test) must not end up offering a switch that
    // * cannot be verified.
    expect(canOfferLocalPlan(undefined)).toBe(false);
    expect(canOfferLocalPlan(null)).toBe(false);
    expect(canOfferLocalPlan("")).toBe(false);
  });
});

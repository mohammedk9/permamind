import { describe, expect, it } from "vitest";

import {
  canModelAnswer,
  defaultModelSharing,
  MAX_MODEL_CALL_LIMIT,
  sharingAllowed,
  sharingRefusalMessage,
  usageMessage,
  type ModelUsage,
} from "../sharing";

/**
 * A member's model, and the two things they agree to before it answers.
 *
 * The property under test throughout is that **a member's key is never spent past what they
 * agreed to**. Consent and a ceiling are both required, the ceiling is checked before every
 * call rather than after, and the refusal names which limit stopped it so the member knows
 * whether to raise the ceiling or simply wait.
 */

const usage = (overrides: Partial<ModelUsage> = {}): ModelUsage => ({
  totalCalls: 0,
  callsToday: 0,
  exhausted: false,
  ...overrides,
});

describe("silence is the default", () => {
  it("treats a member who changed nothing as silent", () => {
    expect(defaultModelSharing()).toBe("silent");
  });

  it("refuses a silent model even when it has budget left", () => {
    // The budgets of a model nobody shared are the budgets of a model nobody agreed to share.
    const decision = canModelAnswer({
      sharing: "silent",
      callLimit: 100,
      dailyLimit: 100,
      usage: usage(),
    });

    expect(decision).toEqual({ allowed: false, reason: "silent" });
  });
});

describe("a ceiling is a ceiling", () => {
  it("allows a call while under the total limit", () => {
    expect(
      canModelAnswer({ sharing: "on_request", callLimit: 10, dailyLimit: null, usage: usage({ totalCalls: 9 }) }),
    ).toEqual({ allowed: true });
  });

  it("refuses the call that would exceed the total limit", () => {
    // Not after the eleventh, but before the tenth. A ceiling checked after the fact is an
    // invoice, not a budget.
    const decision = canModelAnswer({
      sharing: "on_request",
      callLimit: 10,
      dailyLimit: null,
      usage: usage({ totalCalls: 10 }),
    });

    expect(decision).toEqual({ allowed: false, reason: "budget" });
  });

  it("refuses on the daily limit even when the total has room", () => {
    const decision = canModelAnswer({
      sharing: "always",
      callLimit: 100,
      dailyLimit: 5,
      usage: usage({ totalCalls: 12, callsToday: 5 }),
    });

    // A room that runs for days is exactly what the daily ceiling exists for, and the total
    // being untouched must not let it through.
    expect(decision).toEqual({ allowed: false, reason: "daily" });
  });

  it("refuses even at always when the daily limit is reached", () => {
    const decision = canModelAnswer({
      sharing: "always",
      callLimit: null,
      dailyLimit: 3,
      usage: usage({ callsToday: 3 }),
    });

    expect(decision).toEqual({ allowed: false, reason: "daily" });
  });

  it("allows a model whose owner set no ceiling at all", () => {
    // A real choice, and refusing it would be inventing a limit nobody agreed to.
    expect(
      canModelAnswer({ sharing: "on_request", callLimit: null, dailyLimit: null, usage: usage({ totalCalls: 999 }) }),
    ).toEqual({ allowed: true });
  });
});

describe("the ceiling must be reachable", () => {
  it("bounds a member's largest stated budget", () => {
    // Without a bound on the number itself, a ceiling of 10^15 is a number that happens to be
    // present and a budget that never stops anything.
    expect(MAX_MODEL_CALL_LIMIT).toBeLessThanOrEqual(10_000);
  });
});

describe("sharing is a room idea, not a panel one", () => {
  it("is allowed in a panel room", () => {
    expect(sharingAllowed("panel")).toBe(true);
  });

  it("is allowed in a guest room too", () => {
    // Corrected. This said `false` when written, reasoning that a guest room has one model and
    // therefore nobody to ask. Wrong in a way that mattered: a member who signs in and brings
    // a model has asked for exactly what the host already has there, and the room is no less a
    // conversation for it. Ownership differs, not permission — the host's model costs the host
    // and there is one of it; a member's costs that member. Both set their own budget.
    expect(sharingAllowed("guest")).toBe(true);
  });
});

describe("the refusals say something useful", () => {
  it("names the model's owner in the refusal", () => {
    const english = sharingRefusalMessage("budget", false);
    expect(english).toMatch(/owner/i);
  });

  it("tells a member the daily limit returns tomorrow", () => {
    expect(sharingRefusalMessage("daily", false)).toMatch(/tomorrow/i);
  });

  it("says nothing was shared rather than implying a fault", () => {
    expect(sharingRefusalMessage("silent", false)).toMatch(/has not shared/i);
  });

  it("has an Arabic sentence for every reason", () => {
    for (const reason of ["silent", "budget", "daily"] as const) {
      const arabic = sharingRefusalMessage(reason, true);
      expect(arabic.length).toBeGreaterThan(10);
      expect(arabic).toMatch(/[\u0600-\u06FF]/);
    }
  });

  it("never names the budget as the owner's own error", () => {
    // The refusal is about a limit the member set. It reads as an accusation otherwise.
    expect(sharingRefusalMessage("budget", false)).not.toMatch(/you (failed|forgot|should not)/i);
  });
});

describe("the owner sees their own budget being spent", () => {
  it("reports both the total and today", () => {
    const english = usageMessage({ totalCalls: 12, callsToday: 3, exhausted: false, ar: false });
    expect(english).toMatch(/12/);
    expect(english).toMatch(/today/i);
  });

  it("uses the singular for one call", () => {
    expect(usageMessage({ totalCalls: 1, callsToday: 1, exhausted: false, ar: false })).toBe(
      "Used 1 time · 1 today",
    );
  });

  it("has an Arabic form", () => {
    const arabic = usageMessage({ totalCalls: 2, callsToday: 1, exhausted: false, ar: true });
    expect(arabic).toMatch(/[\u0600-\u06FF]/);
  });
});
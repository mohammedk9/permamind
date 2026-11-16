import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FREE_QUOTA_STATE_KEY,
  clearFreeQuotaState,
  isQuotaResetActive,
  readActiveFreeQuotaState,
  readFreeQuotaResetAt,
  readFreeQuotaState,
  rememberFreeQuotaResetAt,
} from "../quota-state";

const FUTURE = "2026-01-02T00:00:00.000Z";
const PAST = "2026-01-01T00:00:00.000Z";

describe("free quota state", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads nothing when no refusal was ever recorded", () => {
    expect(readFreeQuotaState()).toBeNull();
    expect(readFreeQuotaResetAt()).toBeNull();
    expect(readActiveFreeQuotaState()).toBeNull();
  });

  it("round-trips a refusal through the store", () => {
    expect(rememberFreeQuotaResetAt(FUTURE, { used: 10, limit: 10 })).toBe(true);

    expect(readFreeQuotaState()).toEqual({ version: 1, resetAt: FUTURE, used: 10, limit: 10 });
    expect(readFreeQuotaResetAt()).toBe(FUTURE);
    expect(window.localStorage.getItem(FREE_QUOTA_STATE_KEY)).toContain(FUTURE);
  });

  it("records a refusal even when the server sent no counts", () => {
    expect(rememberFreeQuotaResetAt(FUTURE)).toBe(true);
    expect(readFreeQuotaState()).toEqual({ version: 1, resetAt: FUTURE });
  });

  it("normalises the reset time so a later comparison never re-parses text", () => {
    rememberFreeQuotaResetAt("2026-01-02T00:00:00.000+00:00");
    expect(readFreeQuotaResetAt()).toBe("2026-01-02T00:00:00.000Z");
  });

  it("forgets the refusal on request, and is happy when nothing is stored", () => {
    rememberFreeQuotaResetAt(FUTURE);
    clearFreeQuotaState();
    expect(readFreeQuotaState()).toBeNull();
    expect(() => clearFreeQuotaState()).not.toThrow();
  });

  it("rejects a value this app did not write", () => {
    window.localStorage.setItem(FREE_QUOTA_STATE_KEY, "{ not json");
    expect(readFreeQuotaState()).toBeNull();

    window.localStorage.setItem(FREE_QUOTA_STATE_KEY, JSON.stringify({ version: 2, resetAt: FUTURE }));
    expect(readFreeQuotaState()).toBeNull();

    window.localStorage.setItem(FREE_QUOTA_STATE_KEY, JSON.stringify({ version: 1 }));
    expect(readFreeQuotaState()).toBeNull();

    window.localStorage.setItem(FREE_QUOTA_STATE_KEY, JSON.stringify({ version: 1, resetAt: "tomorrow" }));
    expect(readFreeQuotaState()).toBeNull();
  });

  it("counts the allowance as spent only while the reset lies ahead", () => {
    const now = Date.parse("2026-01-01T12:00:00.000Z");

    expect(isQuotaResetActive(FUTURE, now)).toBe(true);
    expect(isQuotaResetActive(PAST, now)).toBe(false);
    expect(isQuotaResetActive(null, now)).toBe(false);
    expect(isQuotaResetActive(undefined, now)).toBe(false);
    expect(isQuotaResetActive("tomorrow", now)).toBe(false);
  });

  it("treats the exact reset instant as the moment the allowance returns", () => {
    const instant = Date.parse(FUTURE);
    expect(isQuotaResetActive(FUTURE, instant - 1)).toBe(true);
    expect(isQuotaResetActive(FUTURE, instant)).toBe(false);
    expect(isQuotaResetActive(FUTURE, instant + 1)).toBe(false);
  });

  it("returns the stored refusal, with its counts, while it is still ahead", () => {
    rememberFreeQuotaResetAt(FUTURE, { used: 10, limit: 10 });

    const active = readActiveFreeQuotaState(Date.parse(PAST));

    // The limit travels with the reset time: the card has to say "10 messages"
    // after a reload, and it cannot if only the timestamp survived.
    expect(active).toEqual({ version: 1, resetAt: FUTURE, used: 10, limit: 10 });
    // A still-valid entry survives the read.
    expect(readFreeQuotaState()).not.toBeNull();
  });

  it("drops an expired refusal instead of leaving a stale value behind", () => {
    rememberFreeQuotaResetAt(PAST);

    expect(readActiveFreeQuotaState(Date.parse(FUTURE))).toBeNull();
    expect(readFreeQuotaState()).toBeNull();
    expect(window.localStorage.getItem(FREE_QUOTA_STATE_KEY)).toBeNull();
  });

  it("refuses to record an unusable reset time", () => {
    expect(rememberFreeQuotaResetAt("")).toBe(false);
    expect(rememberFreeQuotaResetAt("not a date")).toBe(false);
    expect(window.localStorage.getItem(FREE_QUOTA_STATE_KEY)).toBeNull();
  });

  it("survives a blocked store without throwing at the caller", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    expect(rememberFreeQuotaResetAt(FUTURE)).toBe(false);
    expect(() => clearFreeQuotaState()).not.toThrow();
    expect(readFreeQuotaState()).toBeNull();
  });

  it("does nothing outside a browser", () => {
    vi.stubGlobal("window", undefined);

    expect(readFreeQuotaState()).toBeNull();
    expect(readFreeQuotaResetAt()).toBeNull();
    expect(readActiveFreeQuotaState()).toBeNull();
    expect(rememberFreeQuotaResetAt(FUTURE)).toBe(false);
    expect(() => clearFreeQuotaState()).not.toThrow();
  });
});
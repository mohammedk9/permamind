import { completeFirstRun, hasCompletedFirstRun, resetFirstRun } from "@/lib/settings/first-run";

describe("first-run experience", () => {
  beforeEach(() => localStorage.clear());

  it("shows on first launch and persists completion", () => {
    expect(hasCompletedFirstRun()).toBe(false);
    completeFirstRun();
    expect(hasCompletedFirstRun()).toBe(true);
  });

  it("supports skip and reset", () => {
    completeFirstRun();
    expect(hasCompletedFirstRun()).toBe(true);
    resetFirstRun();
    expect(hasCompletedFirstRun()).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { buildRecoveryBundle, parseRecoveryBundle } from "./recovery-bundle";

describe("recovery bundle", () => {
  it("round-trips the transaction id and passphrase", () => {
    const bundle = buildRecoveryBundle({ txId: "A".repeat(43), snapshotVersion: 3, createdAt: "2026-01-01T00:00:00.000Z", passphrase: "correct horse" });
    const parsed = parseRecoveryBundle(JSON.parse(JSON.stringify(bundle)));
    expect(parsed.txId).toBe(bundle.txId);
    expect(parsed.passphrase).toBe("correct horse");
    expect(parsed.steps.ar.length).toBeGreaterThan(0);
  });

  it("rejects a file from another app", () => {
    expect(() => parseRecoveryBundle({ kind: "other", version: 1 })).toThrow("not a PermaMind recovery file");
  });
});

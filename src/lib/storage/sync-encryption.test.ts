import { describe, expect, it, beforeEach } from "vitest";
import { decryptSyncValue, encryptSyncValue, setSyncPassphrase } from "./sync-encryption";

describe("sync encryption", () => {
  beforeEach(() => setSyncPassphrase(null));

  it("round trips data without storing the passphrase", async () => {
    setSyncPassphrase("correct horse battery staple");
    const encrypted = await encryptSyncValue({ conversations: [{ id: "one", text: "private" }] });
    expect(encrypted).not.toContain("private");
    expect(await decryptSyncValue(encrypted)).toEqual({ conversations: [{ id: "one", text: "private" }] });
  });

  it("rejects decryption with the wrong passphrase", async () => {
    setSyncPassphrase("first passphrase");
    const encrypted = await encryptSyncValue({ value: 1 });
    setSyncPassphrase("wrong passphrase");
    await expect(decryptSyncValue(encrypted)).rejects.toThrow();
  });
});
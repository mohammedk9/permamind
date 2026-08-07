import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLatestFullSnapshot, getSnapshotByVersion, validateSnapshotChain } from "../snapshot-registry";
import { SNAPSHOT_REGISTRY_KEY } from "../constants";

describe("snapshot-registry", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns the latest full snapshot even when a delta is newer", () => {
    localStorage.setItem(SNAPSHOT_REGISTRY_KEY, JSON.stringify({
      version: 1,
      snapshots: [
        { version: 1, type: "full" },
        { version: 2, type: "delta" },
      ],
    }));

    expect(getLatestFullSnapshot()?.version).toBe(1);
  });

  it("returns a matching snapshot by version and null for an unknown version", () => {
    localStorage.setItem(SNAPSHOT_REGISTRY_KEY, JSON.stringify({
      version: 1,
      snapshots: [{ version: 3, type: "full" }],
    }));

    expect(getSnapshotByVersion(3)?.version).toBe(3);
    expect(getSnapshotByVersion(4)).toBeNull();
  });

  const meta = (version: number, parentVersion: number | null, parentTxId: string | null, type: "full" | "delta" = "full") => ({
    version, epoch: type === "full" ? version : 1, type, parentVersion, parentTxId,
    createdAt: new Date().toISOString(), contentHash: `hash-${version}`, conversationIds: [],
    messageCount: 0, compressedSize: 0, encryptedSize: 0, txId: `tx-${version}`,
  });

  it.each([
    ["broken parent", [meta(1, null, null), meta(2, 99, null)]],
    ["missing parent", [meta(1, null, null), meta(3, 2, "tx-2")]],
    ["duplicate version", [meta(1, null, null), meta(1, null, null)]],
  ])("rejects %s chains", (_name, snapshots) => {
    expect(() => validateSnapshotChain(snapshots)).toThrow();
  });
});
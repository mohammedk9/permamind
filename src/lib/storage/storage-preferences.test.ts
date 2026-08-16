import { describe, expect, it } from "vitest";
import { DEFAULT_STORAGE_PREFERENCES, isCloudSyncEnabled } from "./storage-preferences";

describe("storage choices", () => {
  it("defaults to local storage without enabling cloud sync", () => {
    expect(DEFAULT_STORAGE_PREFERENCES.syncMode).toBe("local");
    expect(isCloudSyncEnabled(DEFAULT_STORAGE_PREFERENCES)).toBe(false);
  });

  it("does not enable cloud sync just because the cloud mode is selected", () => {
    expect(isCloudSyncEnabled({ ...DEFAULT_STORAGE_PREFERENCES, syncMode: "supabase" })).toBe(false);
  });

  it("requires an explicit data category choice for cloud sync", () => {
    expect(isCloudSyncEnabled({ ...DEFAULT_STORAGE_PREFERENCES, syncMode: "supabase", syncConversations: true })).toBe(true);
  });
});
import { beforeEach, describe, expect, it } from "vitest";
import {
  checkStorage,
  checkUploadRate,
  recordUpload,
  resetUploadProtection,
} from "../upload-protection";
import { FREE_STORAGE_QUOTA_BYTES, MAX_UPLOAD_SIZE_BYTES } from "../constants";

describe("managed upload protection", () => {
  beforeEach(() => resetUploadProtection());

  it("defines and recognizes uploads larger than 50 MB", () => {
    expect(MAX_UPLOAD_SIZE_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_UPLOAD_SIZE_BYTES + 1 > MAX_UPLOAD_SIZE_BYTES).toBe(true);
  });

  it("rejects a payload that exceeds the user's storage quota", () => {
    recordUpload("user", FREE_STORAGE_QUOTA_BYTES - 10);
    expect(checkStorage("user", 11)).toEqual({ ok: false, remainingMb: 0 });
  });

  it("enforces the free hourly upload limit", () => {
    for (let i = 0; i < 10; i += 1) recordUpload("user", 1, 1_000);
    expect(checkUploadRate("user", false, 1_001)).toEqual({ ok: false, retryAfter: 3600 });
  });

  it("allows a successful upload below both limits", () => {
    expect(checkStorage("user", 1024)).toMatchObject({ ok: true });
    expect(checkUploadRate("user", false)).toEqual({ ok: true });
  });
});
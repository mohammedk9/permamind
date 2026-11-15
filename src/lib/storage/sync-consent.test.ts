import { describe, expect, it, vi } from "vitest";
import { CLOUD_SUMMARY_WARNING_EN, CLOUD_SUMMARY_WARNING_AR, confirmCloudSummaryUpload, getCloudSummaryWarning } from "./sync-consent";

describe("cloud summary consent", () => {
  it("clearly warns that the summary is saved in Supabase", () => {
    expect(CLOUD_SUMMARY_WARNING_EN).toContain("Supabase");
    expect(CLOUD_SUMMARY_WARNING_EN).toContain("encrypted in your browser before upload");
    expect(CLOUD_SUMMARY_WARNING_EN).toContain("full conversation text is not sent");
    expect(CLOUD_SUMMARY_WARNING_AR).toContain("يُشفَّر الملخص في متصفحك قبل الرفع");
    expect(CLOUD_SUMMARY_WARNING_AR).toContain("لن يتم إرسال النص الكامل للمحادثة");
    expect(getCloudSummaryWarning("en")).toBe(CLOUD_SUMMARY_WARNING_EN);
    expect(getCloudSummaryWarning("ar")).toBe(CLOUD_SUMMARY_WARNING_AR);
  });

  it("requires explicit user confirmation", () => {
    expect(confirmCloudSummaryUpload(vi.fn(() => false))).toBe(false);
    expect(confirmCloudSummaryUpload(vi.fn(() => true))).toBe(true);
  });
});
export const CLOUD_SUMMARY_WARNING_EN =
  "This conversation summary will be saved in Supabase.\nThe summary may contain private information.\nOnly the summary and the details you selected will be sent.\nThe full conversation text will not be sent by default.\nDo you want to continue?";

export const CLOUD_SUMMARY_WARNING_AR =
  "سيتم حفظ ملخص هذه المحادثة في Supabase.\nقد يحتوي الملخص على معلومات خاصة.\nسيتم إرسال الملخص والتفاصيل التي اخترتها فقط.\nلن يتم إرسال النص الكامل للمحادثة افتراضيًا.\nهل تريد المتابعة؟";

export const CLOUD_SUMMARY_WARNING = CLOUD_SUMMARY_WARNING_EN;

export function getCloudSummaryWarning(locale: "ar" | "en" = "en"): string {
  return locale === "ar" ? CLOUD_SUMMARY_WARNING_AR : CLOUD_SUMMARY_WARNING_EN;
}

export function confirmCloudSummaryUpload(confirmFn?: (message: string) => boolean): boolean {
  const locale = typeof document !== "undefined" && document.documentElement.lang === "ar" ? "ar" : "en";
  const warning = getCloudSummaryWarning(locale);
  if (confirmFn) return confirmFn(warning);
  if (typeof window === "undefined") return false;
  return window.confirm(warning);
}
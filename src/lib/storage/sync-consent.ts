export const CLOUD_SUMMARY_WARNING_EN =
  "This conversation summary will be saved in Supabase.\nThe summary is encrypted in your browser before upload, so the server stores ciphertext it cannot read.\nThe full conversation text is not sent.\nAn MCP client can only read the summary if you enable that separately.\nDo you want to continue?";

export const CLOUD_SUMMARY_WARNING_AR =
  "سيتم حفظ ملخص هذه المحادثة في Supabase.\nيُشفَّر الملخص في متصفحك قبل الرفع، لذا يخزّن الخادم نصاً مشفراً لا يستطيع قراءته.\nلن يتم إرسال النص الكامل للمحادثة.\nلا يستطيع عميل MCP قراءة الملخص إلا إذا فعّلت ذلك بشكل منفصل.\nهل تريد المتابعة؟";

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
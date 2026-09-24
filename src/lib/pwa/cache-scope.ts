const APP_ROUTES = ["/", "/chat", "/memory", "/settings", "/backup", "/privacy", "/terms", "/auth/sign-in", "/auth/sign-up"];

/** App pages and static assets may be cached. Network APIs never may. */
export function isCacheableRequest(url: URL): boolean {
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return false;
  if (APP_ROUTES.includes(url.pathname)) return true;
  return /\.(?:js|css|png|ico|svg|webp|woff2?|json|txt)$/i.test(url.pathname);
}

export const OFFLINE_MODEL_NOTICE = "النموذج والبحث يحتاجان إلى اتصال بالشبكة.";

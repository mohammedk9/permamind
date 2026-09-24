const CACHE_NAME = "permamind-shell-v1";
const APP_ROUTES = ["/", "/chat", "/memory", "/settings", "/backup", "/privacy", "/terms", "/auth/sign-in", "/auth/sign-up"];

function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return false;
  if (APP_ROUTES.includes(url.pathname)) return true;
  return /\.(?:js|css|png|ico|svg|webp|woff2?|json|txt)$/i.test(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(["/", "/chat", "/manifest.json", "/android-chrome-192x192.png"])));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || !isCacheable(url)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(event.request);
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      if (event.request.mode === "navigate") return (await cache.match("/chat")) ?? (await cache.match("/")) ?? Response.error();
      return Response.error();
    }
  })());
});

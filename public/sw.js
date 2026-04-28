// Minimal service worker — satisfies PWA installability requirement.
// Network-first: all requests pass through to network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  // Skip API routes — streaming responses (e.g. blob proxy) break respondWith
  if (new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(fetch(event.request));
});

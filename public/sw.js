// Minimal service worker — satisfies PWA installability requirement.
// No caching strategy yet; all requests pass through to network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

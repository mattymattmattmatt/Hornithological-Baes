/* Hornithological Baes — app-shell service worker
 * Handles offline support + install. Push notifications are handled
 * separately by firebase-messaging-sw.js (registered from the page).
 *
 * Bump CACHE_VERSION whenever you ship changes so clients refresh.
 */
const CACHE_VERSION = "hb-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./species-au.json",
  "./Logo.png",
  "./favicon.ico",
  "./common.png",
  "./uncommon.png",
  "./rare.png",
  "./super_rare.png",
  "./very_common.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon-180.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Best-effort: don't fail the whole install if one asset 404s.
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Allow the page to trigger an immediate update.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only manage our own origin. Let Firebase / Storage / CDN requests pass through.
  if (url.origin !== self.location.origin) return;

  // HTML navigations: network-first so content updates are seen immediately,
  // falling back to cache when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Static same-origin assets: cache-first, then network (and cache the result).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});

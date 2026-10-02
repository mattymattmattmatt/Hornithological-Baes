/* Hornithological Baes — app-shell service worker
 * Handles offline support + install. Push notifications are handled
 * separately by firebase-messaging-sw.js (registered from the page).
 *
 * Bump CACHE_VERSION whenever you ship changes so clients refresh.
 */
const CACHE_VERSION = "hb-v2";
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
  // falling back to cache when offline. Only cache good responses so a 404 or
  // error page never becomes the offline copy of the app.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put("./index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Species list: network-first too, so checklist edits reach installed apps
  // without needing a CACHE_VERSION bump.
  if (url.pathname.endsWith("/species-au.json")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
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

// Tapping a lite alert that was shown through this registration (used when
// full push isn't available). This worker controls the page, so it can message
// the open window or open a fresh one at the deep link.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || "./";
  const appRoot = new URL("./", self.location.href).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.startsWith(appRoot) && "focus" in client) {
          if (data.photoId) client.postMessage({ type: "hb-open-photo", photoId: data.photoId });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

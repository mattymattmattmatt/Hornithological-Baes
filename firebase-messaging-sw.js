/* Hornithological Baes — Firebase Cloud Messaging service worker.
 * Receives push messages when the app is in the background or fully closed,
 * and renders the "new birb" notification. Registered from index.html at a
 * dedicated narrow scope so it never collides with the app-shell sw.js.
 */
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/9.22.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDkmpTvNw1IOCxS1NFr9_fqkZY73N0f1P8",
  authDomain: "hornithological-baes.firebaseapp.com",
  projectId: "hornithological-baes",
  storageBucket: "hornithological-baes.firebasestorage.app",
  messagingSenderId: "909306883752",
  appId: "1:909306883752:web:daf920bede5aa6fadf1c9d",
  measurementId: "G-T9VSSKQS0Q"
});

const messaging = firebase.messaging();

// The Cloud Function sends DATA-only messages so we fully control display here
// (and can share a per-photo tag with the in-page notifications to de-dupe).
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  const title = d.title || "New birb! 🦜";
  self.registration.showNotification(title, {
    body: d.body || "A new sighting was just added.",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    image: d.image || undefined,
    tag: d.tag || "new-birb",
    renotify: false,
    data: { url: d.url || "./?source=push" }
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate && client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

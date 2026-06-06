/**
 * Hornithological Baes — push notifications.
 *
 * Fires whenever a new document is created in the `birdPhotos` collection and
 * sends a Web Push notification to every device token saved in `fcmTokens`.
 * Dead tokens are pruned automatically.
 *
 * Deploy with:  firebase deploy --only functions
 * (See SETUP-NOTIFICATIONS.md for the full walkthrough.)
 */
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

exports.notifyNewBirb = onDocumentCreated("birdPhotos/{photoId}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const photo = snap.data() || {};
  const photoId = event.params.photoId;

  const db = getFirestore();
  const tokensSnap = await db.collection("fcmTokens").get();
  if (tokensSnap.empty) {
    console.log("No fcmTokens registered yet — nothing to send.");
    return;
  }

  const tokens = [];
  const refByToken = new Map();
  tokensSnap.forEach((d) => {
    const t = d.get("token") || d.id;
    if (t) {
      tokens.push(t);
      refByToken.set(t, d.ref);
    }
  });
  if (!tokens.length) return;

  const who = (photo.uploadedBy || "").toString().trim();
  const what = (photo.birdName || "A new birb").toString().trim();
  const body = who ? `${who} added ${what}.` : `${what} was just added.`;

  // Data-only payload: the service worker (firebase-messaging-sw.js) renders it,
  // so we fully control look + de-dupe tag. `tag` matches the in-app lite alert.
  const baseMessage = {
    data: {
      title: "New birb! 🦜",
      body,
      tag: "birb-" + photoId,
      url: "./?source=push",
      image: (photo.imageUrl || "").toString()
    },
    webpush: {
      headers: { Urgency: "high", TTL: "86400" }
    }
  };

  const BATCH = 500; // FCM multicast limit per call
  const invalidTokens = [];
  let sent = 0;

  for (let i = 0; i < tokens.length; i += BATCH) {
    const batch = tokens.slice(i, i + BATCH);
    const res = await getMessaging().sendEachForMulticast({ ...baseMessage, tokens: batch });
    sent += res.successCount;
    res.responses.forEach((r, idx) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument"
      ) {
        invalidTokens.push(batch[idx]);
      } else {
        console.warn("Send error for a token:", code);
      }
    });
  }

  // Prune dead tokens so the list doesn't grow stale.
  await Promise.all(
    invalidTokens.map((t) => {
      const ref = refByToken.get(t);
      return ref ? ref.delete().catch(() => {}) : Promise.resolve();
    })
  );

  console.log(`Birb ${photoId}: delivered ${sent}/${tokens.length}, pruned ${invalidTokens.length} dead token(s).`);
});

// Notify the uploader when someone gives their photo a new rating.
// Detects a fresh rating (not a re-rate) by checking if ratingCount increased.
exports.notifyRating = onDocumentUpdated("birdPhotos/{photoId}", async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};

  const countBefore = Number(before.ratingCount || 0);
  const countAfter = Number(after.ratingCount || 0);

  // Only fire on new ratings, not re-rates or other field updates (comments etc).
  if (countAfter <= countBefore) return;

  const ownerDeviceId = after.ownerDeviceId;
  if (!ownerDeviceId) return;

  const db = getFirestore();
  const tokensSnap = await db.collection("fcmTokens")
    .where("deviceId", "==", ownerDeviceId)
    .get();
  if (tokensSnap.empty) return; // uploader hasn't opted in to notifications

  const scoreGiven = Number(after.ratingTotal || 0) - Number(before.ratingTotal || 0);
  const newAverage = countAfter > 0 ? (Number(after.ratingTotal || 0) / countAfter) : 0;
  const birdName = (after.birdName || "your birb").toString().trim();
  const parrots = "🦜".repeat(Math.max(1, Math.round(scoreGiven)));
  const body = countAfter === 1
    ? `First rating: ${scoreGiven}/10 ${parrots}`
    : `${scoreGiven}/10 ${parrots} · new average ${newAverage.toFixed(1)}/10`;

  const tokens = [];
  const refByToken = new Map();
  tokensSnap.forEach((d) => {
    const t = d.get("token") || d.id;
    if (t) { tokens.push(t); refByToken.set(t, d.ref); }
  });
  if (!tokens.length) return;

  const message = {
    data: {
      title: `Someone rated ${birdName}!`,
      body,
      tag: "rating-" + event.params.photoId,
      url: "./?source=rating",
      image: (after.imageUrl || "").toString()
    },
    webpush: { headers: { Urgency: "normal", TTL: "43200" } }
  };

  const invalidTokens = [];
  const res = await getMessaging().sendEachForMulticast({ ...message, tokens });
  res.responses.forEach((r, idx) => {
    if (r.success) return;
    const code = r.error && r.error.code;
    if (
      code === "messaging/registration-token-not-registered" ||
      code === "messaging/invalid-registration-token" ||
      code === "messaging/invalid-argument"
    ) {
      invalidTokens.push(tokens[idx]);
    }
  });

  await Promise.all(
    invalidTokens.map((t) => {
      const ref = refByToken.get(t);
      return ref ? ref.delete().catch(() => {}) : Promise.resolve();
    })
  );

  console.log(`Rating on ${event.params.photoId}: notified owner (${ownerDeviceId}), score=${scoreGiven}, avg=${newAverage.toFixed(1)}`);
});

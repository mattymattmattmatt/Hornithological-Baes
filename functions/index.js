/**
 * Hornithological Baes — push notifications.
 *
 *  - notifyNewBirb: when a new document lands in `birdPhotos`, push a "New birb!"
 *    alert to every device token saved in `fcmTokens` (except the uploader's).
 *  - notifyRating: when someone gives a photo a new rating, push the uploader
 *    the score they were given plus the new average.
 *
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

// Only these mean "this token is gone for good". Anything else (e.g. a malformed
// payload → messaging/invalid-argument) would fail for *every* token, so pruning
// on it could wipe the whole list.
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token"
]);

// Mirrors normalizeName() in index.html so the same name typed on different
// devices (or in Safari vs the installed app) still matches.
function nameKey(s) {
  return (s || "").toString().trim().toLowerCase()
    .replace(/[’‘]/g, "'").replace(/[–—]/g, "-").replace(/\s+/g, " ");
}

// Flatten one or more fcmTokens query snapshots into a de-duped token → docRef map.
function collectTokens(snaps, skip = () => false) {
  const refByToken = new Map();
  for (const snap of snaps) {
    snap.forEach((d) => {
      const t = d.get("token") || d.id;
      if (t && !skip(d)) refByToken.set(t, d.ref);
    });
  }
  return refByToken;
}

async function sendToTokens(refByToken, message) {
  const tokens = Array.from(refByToken.keys());
  const BATCH = 500; // FCM multicast limit per call
  const invalidTokens = [];
  let sent = 0;

  for (let i = 0; i < tokens.length; i += BATCH) {
    const batch = tokens.slice(i, i + BATCH);
    const res = await getMessaging().sendEachForMulticast({ ...message, tokens: batch });
    sent += res.successCount;
    res.responses.forEach((r, idx) => {
      if (r.success) return;
      const code = r.error && r.error.code;
      if (DEAD_TOKEN_CODES.has(code)) invalidTokens.push(batch[idx]);
      else console.warn("Send error for a token:", code);
    });
  }

  // Prune dead tokens so the list doesn't grow stale.
  await Promise.all(
    invalidTokens.map((t) => refByToken.get(t).delete().catch(() => {}))
  );

  return { sent, total: tokens.length, pruned: invalidTokens.length };
}

exports.notifyNewBirb = onDocumentCreated("birdPhotos/{photoId}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const photo = snap.data() || {};
  const photoId = event.params.photoId;

  const tokensSnap = await getFirestore().collection("fcmTokens").get();
  if (tokensSnap.empty) {
    console.log("No fcmTokens registered yet — nothing to send.");
    return;
  }

  // Don't ping the uploader about their own birb.
  const ownerDeviceId = photo.ownerDeviceId || "";
  const ownerKey = nameKey(photo.uploadedBy);
  const refByToken = collectTokens([tokensSnap], (d) =>
    (ownerDeviceId && d.get("deviceId") === ownerDeviceId) ||
    (ownerKey && d.get("uploaderKey") === ownerKey)
  );
  if (!refByToken.size) return;

  const who = (photo.uploadedBy || "").toString().trim();
  const what = (photo.birdName || "A new birb").toString().trim();
  const body = who ? `${who} added ${what}.` : `${what} was just added.`;

  // Data-only payload: the service worker (firebase-messaging-sw.js) renders it,
  // so we fully control look + de-dupe tag. `tag` matches the in-app lite alert.
  const { sent, total, pruned } = await sendToTokens(refByToken, {
    data: {
      title: "New birb! 🦜",
      body,
      tag: "birb-" + photoId,
      url: "./?photo=" + encodeURIComponent(photoId),
      photoId,
      image: (photo.imageUrl || "").toString()
    },
    webpush: {
      headers: { Urgency: "high", TTL: "86400" }
    }
  });

  console.log(`Birb ${photoId}: delivered ${sent}/${total}, pruned ${pruned} dead token(s).`);
});

// Notify the uploader when someone gives their photo a new rating.
exports.notifyRating = onDocumentUpdated("birdPhotos/{photoId}", async (event) => {
  if (!event.data) return;
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};
  const photoId = event.params.photoId;

  const countBefore = Number(before.ratingCount) || 0;
  const countAfter = Number(after.ratingCount) || 0;

  // Only fire on brand-new ratings, not re-rates or other field updates (Chirps etc).
  if (countAfter <= countBefore) return;

  // The app writes each rating as its own atomic increment, so the change in
  // ratingTotal is exactly the score this person gave.
  const totalAfter = Number(after.ratingTotal) || 0;
  const delta = totalAfter - (Number(before.ratingTotal) || 0);
  const score = (countAfter - countBefore === 1 && Number.isInteger(delta) && delta >= 1 && delta <= 10)
    ? delta
    : null;

  // Find the uploader's devices: the device they posted from, plus any device
  // where they've set the same name (e.g. phone + laptop, or Safari vs the
  // installed iPhone app, which keep separate storage).
  const db = getFirestore();
  const lookups = [];
  if (after.ownerDeviceId) {
    lookups.push(db.collection("fcmTokens").where("deviceId", "==", after.ownerDeviceId).get());
  }
  const ownerKey = nameKey(after.uploadedBy);
  if (ownerKey) {
    lookups.push(db.collection("fcmTokens").where("uploaderKey", "==", ownerKey).get());
  }
  if (!lookups.length) return;
  const refByToken = collectTokens(await Promise.all(lookups));
  if (!refByToken.size) return; // uploader hasn't turned on alerts

  const birdName = (after.birdName || "birb").toString().trim();
  const average = (totalAfter / countAfter).toFixed(1);
  let body;
  if (score === null) {
    const n = countAfter - countBefore;
    body = `${n} new rating${n === 1 ? "" : "s"} · average now ${average}/10`;
  } else {
    body = `They gave it ${score}/10 ${"🦜".repeat(score)}`;
    body += countAfter === 1 ? " · first rating!" : ` · average now ${average}/10`;
  }

  const { sent, total, pruned } = await sendToTokens(refByToken, {
    data: {
      title: `Someone rated your ${birdName}!`,
      body,
      // One notification per rating; matches the in-app lite alert so they de-dupe.
      tag: `rating-${photoId}-${countAfter}`,
      url: "./?photo=" + encodeURIComponent(photoId),
      photoId,
      image: (after.imageUrl || "").toString()
    },
    webpush: { headers: { Urgency: "high", TTL: "86400" } }
  });

  console.log(`Rating on ${photoId}: score=${score}, avg=${average}, delivered ${sent}/${total}, pruned ${pruned}.`);
});

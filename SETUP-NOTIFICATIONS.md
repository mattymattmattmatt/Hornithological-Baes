# 🦜 Turning Hornithological Baes into a shareable app (with push notifications)

Your site is now a **Progressive Web App (PWA)**. That means friends can
"install" it to their home screen and it opens like a real app — full screen,
its own icon, no browser bars — just by visiting the URL. No App Store needed.

There are **two kinds of alerts**:

- **New birb** — everyone (except the uploader) gets pinged when a sighting is added.
- **Someone rated your birb** — the uploader gets pinged with the score they
  were given, e.g. *"Someone rated your Galah! They gave it 8/10 · average now
  7.5/10"*. Tapping it opens the app straight to that post.

…delivered through **two layers**:

| Layer | Works when… | Setup needed |
|-------|-------------|--------------|
| **1. Lite alerts** | A friend has the app **open or recently backgrounded** | ✅ None — already live |
| **2. Full push** | Even when the app is **fully closed** | A few console steps below |

**Layer 1 already works right now.** Layer 2 is optional but recommended for
real "ping my phone" reliability. Here's how to finish it.

---

## Part A — Share the app with friends (works today, no setup)

1. Deploy the site as usual (it's on GitHub Pages).
2. Send friends the URL.
3. On their phone:
   - **Android (Chrome):** tap the **⋮** menu → **Add to Home screen** / **Install app**.
   - **iPhone (Safari):** tap the **Share** button → **Add to Home Screen**.
     > ⚠️ On iPhone, notifications **only work after** they add it to the Home
     > Screen and open it from that icon (Apple's rule). Just bookmarking the
     > page is not enough.
4. They open the app and tap **🔔 Get birb alerts** in the header to allow notifications.
   If the app doesn't know their name yet, it asks for the name they post
   under. That's how rating alerts find them, even on a different device from
   the one they uploaded with. (If they skipped it, the button says
   **"Alerts on · add your name for rating alerts"**. Tap it to set the name.)
   > 💡 The name must match the "Uploaded by" name on their posts (case doesn't matter).

That's it for sharing. The rest of this doc enables notifications when the
app is **completely closed**.

---

## Part B — Enable full push notifications (app-closed)

You'll do this **once**. It needs three things: a key, a billing plan, and one
deploy command.

### Step 1 — Generate your Web Push key (VAPID key)

1. Go to the [Firebase console](https://console.firebase.google.com/) → your
   **hornithological-baes** project.
2. Click the ⚙️ gear → **Project settings** → **Cloud Messaging** tab.
3. Scroll to **Web configuration → Web Push certificates**.
4. Click **Generate key pair**.
5. Copy the **key** it shows (a long string starting with `B…`).

Now paste it into **`index.html`**. Find this line near the bottom:

```js
const VAPID_KEY = "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE";
```

Replace the placeholder with your key:

```js
const VAPID_KEY = "BxxxxxxYOUR_ACTUAL_KEYxxxxxx";
```

Commit + push so GitHub Pages serves the update.

### Step 2 — Upgrade to the Blaze plan (free for your usage)

Cloud Functions require Firebase's **Blaze (pay-as-you-go)** plan. It needs a
card on file, but for a handful of friends you'll stay inside the **free
monthly allowance** — realistically **$0/month**.

1. Firebase console → **⚙️ → Usage and billing → Details & settings**, or just
   the **Upgrade** button at the bottom-left of the console.
2. Choose **Blaze** and follow the prompts.
3. (Optional but smart) Set a **budget alert** at e.g. $1 so you're emailed if
   anything ever changes.

### Step 3 — Deploy the notification function

You need the **Firebase CLI** on your computer (one-time install).

```bash
# Install the CLI (only once, ever)
npm install -g firebase-tools

# Log in to your Google/Firebase account
firebase login

# From the project folder (the one with firebase.json):
cd path/to/Hornithological-Baes
firebase deploy --only functions
```

When it finishes you'll see **`notifyNewBirb`** and **`notifyRating`** listed
as deployed. `notifyNewBirb` watches for new birbs and pushes to everyone who
opted in; `notifyRating` pings the uploader whenever someone gives their birb a
new rating.

> 🔁 **Re-run `firebase deploy --only functions` whenever `functions/index.js`
> changes.** Pushing to GitHub only updates the website; it doesn't update the
> functions running in Firebase.

### Step 4 — Allow friends' devices to register (Firestore rule)

The app saves each friend's notification token to a new `fcmTokens` collection.
Add a rule so the browser is allowed to write there.

Firebase console → **Firestore Database → Rules**. Inside your existing
`match /databases/{database}/documents { … }` block, add:

```
match /fcmTokens/{token} {
  // Devices can register/update their own push token, but nobody can read the
  // list back (it holds names + device ids). The Cloud Functions read and
  // clean it up with admin rights regardless.
  allow create, update: if true;
  allow read, delete: if false;
}
```

> If you already have `allow read, write: if true;` here, it still works, but
> the version above stops anyone from downloading everyone's names and device
> ids. Click **Publish**.

---

## Part C — Test it

1. On your phone, open the installed app and tap **🔔 Get birb alerts** → Allow.
   You should immediately get a "Birb alerts are on! 🦜" confirmation.
2. **Fully close** the app (swipe it away).
3. On another device (or ask a friend), upload a new birb.
4. Your phone should buzz with **"New birb! 🦜"** within a few seconds.

**Rating alerts:** with the app closed on your phone, have someone else rate
one of *your* birbs. You should get **"Someone rated your …!"** with their
score. If the app is open, you'll see a toast at the bottom of the screen
instead. Tap it to jump to the post.

If foreground/open-app alerts work but closed-app ones don't, re-check Steps
1–3 (usually the VAPID key wasn't pushed, or the functions didn't deploy).
If new-birb alerts work but rating alerts don't, make sure `notifyRating` is
deployed and that your name in the app matches the name on your posts.

---

## How it all fits together

- **`manifest.webmanifest`** — makes the app installable (icon, name, colors).
- **`sw.js`** — the app-shell service worker: offline support + faster loads.
- **`firebase-messaging-sw.js`** — receives push messages when the app is
  closed and shows the notification.
- **`functions/index.js`** — two Cloud Functions:
  - `notifyNewBirb`: on every new birb, sends a push to all saved tokens
    except the uploader's (and prunes dead ones).
  - `notifyRating`: when a birb's rating count goes up, finds the uploader's
    devices (by the device they posted from, or by their name) and pushes the
    score they were given plus the new average. Changing an existing rating
    doesn't send an alert.
- **`index.html`** — registers the service workers, shows the **🔔** button,
  saves each device's token (plus your name) to `fcmTokens`, and fires the
  instant *lite* alerts and the in-app rating toast.

## Costs, in plain terms

- PWA install + lite alerts: **free, forever**.
- Full push (FCM): **free** — Firebase Cloud Messaging has no usage charge.
- Cloud Functions: needs Blaze, but a few friends' worth of birbs is **well
  within the free tier** (~$0). Set a budget alert and forget about it.

## Note on the "want a real App Store app?" question

This PWA covers your goal (home-screen app + push). If you ever want a true
App Store / Play Store listing, the same site can be wrapped with **Capacitor**
or **PWABuilder** with no rewrite — but that adds an Apple Developer account
($99/yr) and store review. Not needed for sharing with friends.

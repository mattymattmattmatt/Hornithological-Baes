# 🦜 Turning Hornithological Baes into a shareable app (with push notifications)

Your site is now a **Progressive Web App (PWA)**. That means friends can
"install" it to their home screen and it opens like a real app — full screen,
its own icon, no browser bars — just by visiting the URL. No App Store needed.

There are **two layers of notifications**:

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

When it finishes you'll see `notifyNewBirb` listed as deployed. That function
watches for new birbs and pushes to everyone who opted in.

### Step 4 — Allow friends' devices to register (Firestore rule)

The app saves each friend's notification token to a new `fcmTokens` collection.
Add a rule so the browser is allowed to write there.

Firebase console → **Firestore Database → Rules**. Inside your existing
`match /databases/{database}/documents { … }` block, add:

```
match /fcmTokens/{token} {
  // Anyone can register/update their own push token.
  allow read, write: if true;
  // The Cloud Function reads/cleans these up with admin rights regardless.
}
```

> This mirrors how your `birdPhotos` collection is already open. If you later
> lock things down with auth, tighten this too. Click **Publish**.

---

## Part C — Test it

1. On your phone, open the installed app and tap **🔔 Get birb alerts** → Allow.
   You should immediately get a "Birb alerts are on! 🦜" confirmation.
2. **Fully close** the app (swipe it away).
3. On another device (or ask a friend), upload a new birb.
4. Your phone should buzz with **"New birb! 🦜"** within a few seconds.

If foreground/open-app alerts work but closed-app ones don't, re-check Steps
1–3 (usually the VAPID key wasn't pushed, or the function didn't deploy).

---

## How it all fits together

- **`manifest.webmanifest`** — makes the app installable (icon, name, colors).
- **`sw.js`** — the app-shell service worker: offline support + faster loads.
- **`firebase-messaging-sw.js`** — receives push messages when the app is
  closed and shows the notification.
- **`functions/index.js`** — the `notifyNewBirb` Cloud Function: on every new
  birb, sends a push to all saved tokens (and prunes dead ones).
- **`index.html`** — registers the service workers, shows the **🔔** button,
  saves each device's token to `fcmTokens`, and fires the instant *lite* alerts.

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

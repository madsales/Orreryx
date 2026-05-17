# OrreryX Mobile App — Design Spec

**Date:** 2026-05-17  
**Status:** Approved  
**Platform:** Android first → iOS later  
**Tech:** Capacitor 6 wrapping the existing OrreryX web app  

---

## Goal

Publish OrreryX on Google Play Store (Android first, iOS later) as a freemium native-feeling app. The existing web app (`public/app.html` and all supporting pages) runs unchanged inside a Capacitor WebView. A thin native layer adds four mobile-specific capabilities: push notifications, home screen widget, biometric login, and offline mode. Subscriptions are sold via Google Play Billing (Analyst $14.99/mo, Command $34.99/mo) with a generous free tier to maximise downloads.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Android APK / AAB                  │
│  ┌───────────────────────────────────────────────┐  │
│  │            Capacitor Shell (Java/Kotlin)       │  │
│  │  ┌─────────────────────────────────────────┐  │  │
│  │  │         WebView (Chromium)               │  │  │
│  │  │   Existing app.html + all OrreryX pages  │  │  │
│  │  │   Same HTML / JS / CSS — zero rewrite    │  │  │
│  │  └──────────────┬──────────────────────────┘  │  │
│  │                 │ Capacitor Bridge              │  │
│  │  ┌──────────────▼──────────────────────────┐  │  │
│  │  │  Native Plugins                          │  │  │
│  │  │  • @capacitor/push-notifications (FCM)   │  │  │
│  │  │  • @capacitor/biometrics               │  │  │
│  │  │  • @capacitor/filesystem (offline cache) │  │  │
│  │  │  • Android Widget (WorkManager)          │  │  │
│  │  │  • Google Play Billing (in-app subs)     │  │  │
│  │  └─────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
         Vercel API (https://www.orreryx.io/api/*)
         Same endpoints — no backend changes needed
```

---

## Navigation

The desktop sidebar (`--sb: 224px`) is hidden on mobile via a CSS media query. A **bottom tab bar** is injected by the Capacitor shell into the WebView via a JavaScript bridge call on app load.

**5 tabs:**

| Tab | Icon | Route | Tier |
|-----|------|-------|------|
| Feed | 🌍 | `/app` (default) | Free |
| Map | 🗺️ | `/map` | Free (view) / Analyst (filters) |
| Markets | 📈 | `/market-impact` | Analyst |
| Watchlist | ⭐ | `/watchlist` | Analyst |
| Profile | 👤 | `/app#profile` | Free |

On free tier, tapping a locked tab shows the upgrade bottom sheet instead of navigating.

---

## Free vs Paid Feature Split

### ✅ Free — always available
- Live conflict feed (last 24 hours only)
- Global risk score (0–100) + top 5 country risk scores
- Gold, Oil, BTC live prices
- Risk map (view only — no country filters, no drill-down)
- Breaking news push notifications (up to 3/day)
- Basic profile (login, push notification preferences)

### 🔑 Starter — $0.99/mo (Google Play Billing)
- Everything in Free
- Full conflict feed (72h history)
- Top 10 country risk scores
- Up to 10 push notifications/day
- 1 custom watchlist country

### 🔒 Analyst — $14.99/mo (Google Play Billing)
- Full conflict feed (all history, all 35+ countries)
- All country risk scores + drill-down detail pages
- Market impact analysis per conflict
- Watchlist + custom country/conflict alerts
- Unlimited push notifications (per-country, per-conflict subscriptions)
- Biometric login (fingerprint / face unlock)
- Offline mode (last known data cached)
- Map country filters + risk heatmap

### 👑 Command — $34.99/mo (Google Play Billing)
- Everything in Analyst
- AI daily briefing (`/app` intelligence tab)
- Risk timeline (`/risk-timeline`)
- Compare tool (`/compare`)
- Portfolio market impact (`/market-impact` full)
- Home screen widget (2×2 Android widget)
- Public API access

---

## Native Feature Specs

### 1. Push Notifications (Firebase FCM)

**Plugin:** `@capacitor/push-notifications`  
**Backend:** Existing `api/push.js` — add FCM server-side send alongside existing web push  

**Notification types:**
- 🔴 `breaking` — score ≥ 9 events, delivered immediately, high priority channel
- ⚠️ `important` — score 6–8 events, normal priority channel
- 📊 `risk_change` — country risk score moves ±10 points

**User control (Profile tab):**
- Master toggle (all notifications on/off)
- Per-type toggles (breaking / important / risk changes)
- Per-country subscriptions (Analyst tier): user picks countries to follow

**Free tier limit:** 3 push notifications per day (enforced server-side via Redis counter `push:count:{userId}:{date}`)

**Implementation:**
- On first app launch → request notification permission
- Register FCM token → `POST /api/push` with `{ token, platform: 'android' }`
- Store token in Upstash Redis: `push:fcm:{userId}` with 90-day TTL
- `api/breaking-news.js` already fires — extend it to also call FCM send API for registered tokens

---

### 2. Home Screen Widget (Android)

**Implementation:** Android AppWidget + WorkManager (no Capacitor plugin — pure native Kotlin)  
**Size:** 2×2 cells (minimum), expandable to 4×2  
**Refresh:** WorkManager periodic task every 30 minutes, calls `GET /api/admin?action=agent-status` for risk data  

**Widget UI:**
```
┌─────────────────────────┐
│ OrreryX          ● LIVE │
│                         │
│  74 /100                │
│  ⚠️ ELEVATED RISK       │
│                         │
│  Au $3,412  Oil $84     │
│  BTC $97K               │
└─────────────────────────┘
```

**Data source:** `GET https://www.orreryx.io/api/gnews?type=risk` — reads from existing Redis cache, no extra load  
**Tier gate:** Widget configuration only available to Command subscribers. Non-subscribers see a "Upgrade to Command" prompt when they try to add the widget.

---

### 3. Biometric Login

**Plugin:** `@capacitor-community/biometric-auth`  
**Storage:** Android Keystore via `@capacitor/preferences` (encrypted)  

**Flow:**
1. User logs in via magic link (existing flow)
2. After successful login: prompt "Enable fingerprint login?"
3. If yes: store session token encrypted in Android Keystore
4. On next app open: show biometric prompt → on success → restore session token → auto-login
5. If biometric fails 3× → fall back to magic link

**Session token:** The existing magic-link session cookie value is stored as the Keystore secret. The `api/magic.js` session check endpoint validates it.  
**Tier:** Analyst and above only. Free users see the prompt but get a "Upgrade to Analyst to enable biometric login" sheet.

---

### 4. Offline Mode

**App shell cache:** Service Worker (`/sw.js`) — already registered in `app.html`. Extend cache list to include all static assets, fonts, and icon files.

**Data cache:** On every successful API response, Capacitor Filesystem writes a JSON snapshot:
- `cache/risk-feed.json` — last conflict feed response
- `cache/risk-scores.json` — last country risk scores
- `cache/prices.json` — last Gold/Oil/BTC prices

**Offline detection:** `window.addEventListener('offline', ...)` → inject a banner at top of WebView:
```
📶 Offline — showing data from [timestamp]
```

**Cache TTL:** Data shown as stale after 2 hours. After 24 hours offline, show "Data may be outdated — connect to refresh."

**Scope:** Last 24h of feed items, global risk score, top 10 country scores, last known prices.

---

### 5. Google Play Billing

**Library:** Google Play Billing Library 6.x (Kotlin, in the Capacitor Android project)  
**Products:** Three recurring subscriptions defined in Play Console:
- `orreryx_starter_monthly` — $0.99/month, 3-day free trial
- `orreryx_analyst_monthly` — $14.99/month, 3-day free trial
- `orreryx_command_monthly` — $34.99/month, 3-day free trial

**Purchase flow:**
1. User taps locked feature → bottom sheet appears with tier comparison
2. User selects plan → `BillingClient.launchBillingFlow()` 
3. On purchase success → `POST /api/paypal?action=mobile-grant` with `{ purchaseToken, productId, userId }`
4. Backend verifies token with Google Play Developer API → grants tier in Upstash Redis: `user:tier:{userId}`
5. WebView JS bridge notified → UI unlocks immediately

**Receipt validation:** Server-side only via `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{pkg}/purchases/subscriptions/{productId}/tokens/{token}`  
**Subscription status sync:** On every app open → re-verify active subscription via Play API → update Redis tier. Handles cancellations and renewals automatically.

---

## Project Structure

```
orreryx-mobile/              ← new Capacitor project (separate repo)
├── capacitor.config.ts      ← points WebView to https://www.orreryx.io/app
├── android/
│   ├── app/src/main/
│   │   ├── java/io/orreryx/app/
│   │   │   ├── MainActivity.kt
│   │   │   ├── OrreryWidget.kt       ← home screen widget
│   │   │   ├── WidgetUpdateWorker.kt ← WorkManager 30min refresh
│   │   │   └── BillingManager.kt     ← Play Billing integration
│   │   └── res/
│   │       ├── layout/widget_orreryx.xml
│   │       └── xml/orreryx_widget_info.xml
├── src/
│   ├── capacitor-init.ts    ← registers plugins, bridge to WebView
│   ├── push.ts              ← FCM token registration + notification handling
│   ├── biometric.ts         ← biometric auth flow
│   ├── offline.ts           ← offline detection + Filesystem cache
│   └── billing.ts           ← Play Billing JS bridge
└── package.json
```

**Existing OrreryX web repo changes needed (minimal):**
- `public/app.html` — add `capacitor-init.ts` script injection detection + bottom tab bar CSS for mobile
- `api/push.js` — extend to support FCM token registration and FCM send
- `api/paypal.js` — add `mobile-grant` action for Play Billing receipt validation
- `public/manifest.json` — already exists, update with correct icons for app store

---

## App Store Listing

**App name:** OrreryX — Geopolitical Intelligence  
**Category:** News / Finance  
**Short description:** Live conflict tracker, risk scores, market impact. Know what's moving the world.  
**Package ID:** `io.orreryx.app`  
**Min Android version:** Android 8.0 (API 26) — covers 97%+ of active devices  
**Permissions requested:** Internet, POST_NOTIFICATIONS, USE_BIOMETRIC, USE_FINGERPRINT, RECEIVE_BOOT_COMPLETED (widget), VIBRATE

---

## Build & Release Pipeline

1. **Dev:** `npx cap run android` — runs on emulator / USB device  
2. **Build:** `npx cap build android` → Android Studio → Generate signed AAB  
3. **Release:** Upload AAB to Google Play Console → Internal testing → Production  
4. **CI (future):** GitHub Actions with Gradle build + Play Store upload via Fastlane  

**iOS (later):** Same Capacitor project, `npx cap add ios` → Xcode build → App Store Connect. Replace Google Play Billing with StoreKit 2. FCM works on iOS too.

---

## Timeline Estimate

| Week | Work |
|------|------|
| 1 | Capacitor project setup, WebView loads orreryx.io, bottom tab bar, FCM push |
| 2 | Biometric login, offline mode, Play Billing integration |
| 3 | Android widget, app store assets (icon, screenshots, listing copy) |
| 4 | Internal testing, bug fixes, Google Play submission |

**Total: ~4 weeks to Google Play listing**

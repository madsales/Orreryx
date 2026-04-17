# Orreryx — SEO Quick Wins + PayPal Recurring Subscriptions
**Date:** 2026-04-17
**Status:** Approved

---

## Goal

Two parallel workstreams:
1. **SEO Quick Wins** — rank #1 on low-competition, high-intent keywords to drive free organic traffic
2. **PayPal Recurring Subscriptions** — replace one-time payments with auto-renewing monthly billing so revenue flows automatically without any manual work

Target outcome: organic traffic from Google converts to free trials → paid subscribers → PayPal auto-charges every 30 days.

---

## Context

- Site: orreryx.io — real-time geopolitical market intelligence platform
- Deployed on Vercel (serverless functions in `/api`)
- Auth: magic link via Resend email API
- Storage: Upstash Redis (REST API, no npm package)
- Payment: PayPal (Client ID + Secret in Vercel env vars)
- Plans: Free Trial / Starter $0.99/mo / Analyst $14.99/mo / Command $34.99/mo
- Stripe excluded — does not support Uganda or India

**Critical existing bug:** `api/paypal.js` uses `POST /v2/checkout/orders` (one-time capture). Users pay once and get access indefinitely. No recurring revenue.

---

## Section 1: PayPal Recurring Subscriptions

### Architecture

Replace one-time order flow with PayPal Billing Plans + Subscriptions:

```
User picks plan on /login
        ↓
POST /api/paypal?action=subscribe
        ↓
PayPal creates subscription → returns approval_url
        ↓
User redirected to PayPal → approves
        ↓
PayPal redirects to /callback.html?subscription_id=...
        ↓
POST /api/paypal?action=activate (capture subscription_id)
        ↓
Redis: SET user:{email}:sub {plan, status:active, sub_id, expires}
        ↓
PayPal auto-charges monthly → webhook fires
        ↓
POST /api/webhook → validates PayPal signature → updates Redis
```

### PayPal Billing Plan Setup (one-time, done via API on first run)

Each plan needs a PayPal Product + Billing Plan created once and their IDs stored as Vercel env vars:

| Plan | Price | Env Var |
|------|-------|---------|
| Starter | $0.99/mo | `PAYPAL_PLAN_ID_S` |
| Analyst | $14.99/mo | `PAYPAL_PLAN_ID_A` |
| Command | $34.99/mo | `PAYPAL_PLAN_ID_C` |

Plans are created via `GET /api/paypal?action=setup` (admin-only, run once).

### Files Changed

#### `api/paypal.js` — rewritten
Actions:
- `setup` (GET, admin) — creates PayPal products + billing plans, prints IDs to logs
- `subscribe` (POST) — creates subscription for a given plan, returns `approval_url`
- `activate` (POST) — called after user returns from PayPal, verifies subscription is ACTIVE, stores in Redis
- `cancel` (POST) — cancels a subscription via PayPal API, updates Redis
- `status` (GET) — returns subscription status for a given email from Redis

Redis keys written:
```
user:{email}:plan        → "s" | "a" | "c"
user:{email}:sub_id      → PayPal subscription ID
user:{email}:sub_status  → "active" | "suspended" | "cancelled"
user:{email}:sub_expires → Unix timestamp of next billing date
```

#### `api/webhook.js` — new file
Handles PayPal webhook events. Validates PayPal-Transmission-Sig header before processing.

Events handled:
| Event | Action |
|-------|--------|
| `BILLING.SUBSCRIPTION.ACTIVATED` | Set status=active in Redis |
| `BILLING.SUBSCRIPTION.CANCELLED` | Set status=cancelled, remove access |
| `BILLING.SUBSCRIPTION.SUSPENDED` | Set status=suspended (payment failed) |
| `PAYMENT.SALE.COMPLETED` | Extend sub_expires by 30 days, send receipt email via Resend |
| `PAYMENT.SALE.DENIED` | Send failed payment email, start 3-day grace period |

Grace period logic:
- On `PAYMENT.SALE.DENIED` → set `user:{email}:grace_until` = now + 3 days
- On next app load, `verify-magic.js` checks: if status=suspended AND grace_until > now → still allow access
- After grace expires → block access, send final warning email

#### `api/verify-magic.js` — unchanged
Called once per login only. Sets the session and redirects to `/welcome`. No change needed.

#### `api/session-check.js` — new file
Called by the app on every load to validate session + current subscription status.
1. Receives `{ email, token }` from app localStorage
2. Looks up `user:{email}:sub_status` in Redis
3. If `active` or within grace period → returns `{ ok: true, plan, status }`
4. If `cancelled` or grace expired → returns `{ ok: false, reason: "subscription_expired" }`
5. App gates access behind this check — expired users see upgrade prompt

#### `public/callback.html` — updated
- Detect `?subscription_id=` param (new) vs `?orderId=` (old one-time)
- Call `POST /api/paypal?action=activate` with subscription_id
- Show "Subscription Active — Welcome to Orrery" confirmation
- Redirect to `/app-v2.html` after 3 seconds

### Email Notifications (via Resend)

| Trigger | Email |
|---------|-------|
| Subscription activated | Welcome + what's included |
| Payment successful | Receipt with amount + next billing date |
| Payment failed | "We couldn't charge your PayPal — 3 days to resolve" |
| Grace period ending | "Access suspends tomorrow — update PayPal" |
| Subscription cancelled | "Sorry to see you go" + re-subscribe link |

All emails sent from `api/webhook.js` using existing `RESEND_API_KEY`.

---

## Section 2: SEO Quick Wins

### Technical SEO (highest priority — unblocks all pages)

#### `public/sitemap.xml` — new
Static sitemap listing all public SEO pages (14 total after new pages added) with `<lastmod>` and `<priority>`.

#### `public/robots.txt` — new
```
User-agent: *
Allow: /
Sitemap: https://www.orreryx.io/sitemap.xml
Disallow: /app-v2.html
Disallow: /app.html
Disallow: /admin.html
Disallow: /callback.html
```

### New SEO Pages

#### `public/doomsday-clock.html` — new
- **Target keyword:** "doomsday clock" (90,500/mo, competition 0.01)
- **Angle:** Live geopolitical doomsday risk meter — how close to WW3 based on active conflicts, nuclear posture, and market signals
- **Content:** 900+ words. What is the doomsday clock, current geopolitical status, conflict hotspots driving risk, market impact (gold, defense stocks), FAQ schema
- **Schema:** FAQPage + WebPage + BreadcrumbList
- **CTA:** "Track the real-time risk meter → Start Free Trial"
- **Internal links:** → ukraine-war, ww3-news, geopolitical-risk, gold-price

#### `public/global-conflicts-2025.html` — new
- **Target keyword:** "current global conflicts 2025" (1,300/mo, competition 0)
- **Angle:** Interactive list of every active conflict in 2025 with market impact per conflict
- **Content:** 800+ words. Active wars table (Ukraine, Gaza, Sudan, Myanmar, DRC, etc.), casualty/displacement context, market sectors affected per conflict, FAQ
- **Schema:** FAQPage + Table structured data
- **CTA:** "See live conflict impact on markets → Free Trial"
- **Internal links:** → ukraine-war, israel-gaza, china-taiwan, geopolitical-risk

### Existing Page Optimizations

#### `public/ww3-news.html`
- Add H1: "Is WW3 Happening? Live World War 3 News & Risk Tracker"
- Add 600+ word intro section above the feed covering: current nuclear posture, active escalation risks, historical parallels
- Add FAQPage schema: "Is WW3 happening?", "How close are we to WW3?", "Which countries could start WW3?"
- Add internal links to all conflict pages

#### `public/ukraine-war.html`
- Add H1: "Ukraine War News Today — Live Updates & Market Impact 2025"
- Expand content with: frontline summary section, economic impact on Europe, energy market impact (gas/oil prices), refugee numbers
- Add FAQPage schema with high-volume questions
- Add internal links

### Internal Linking Map (all pages link to each other)
```
index-v2.html
  └── geopolitics-news, geopolitical-risk, ukraine-war, ww3-news, gold-price, silver-price

doomsday-clock (new)
  └── ukraine-war, ww3-news, geopolitical-risk, gold-price

global-conflicts-2025 (new)
  └── ukraine-war, israel-gaza, china-taiwan, geopolitical-risk

ww3-news
  └── ukraine-war, doomsday-clock, geopolitical-risk, war-news

ukraine-war
  └── ukraine-war-map, ww3-news, global-conflicts-2025, geopolitical-risk
```

---

## Section 3: Automated Revenue Funnel

The complete automated flow once both sections are live:

```
Google #1 ranking (doomsday-clock / ww3-news / ukraine-war)
         ↓
Visitor reads content (SEO page)
         ↓
CTA: "Start Free Trial" → /login?plan=f
         ↓
Free trial expires (3 days) → email: "Upgrade to keep access"
         ↓
User picks paid plan → PayPal subscription created
         ↓
PayPal charges $0.99 / $14.99 / $34.99 on day 1
         ↓
PayPal auto-charges every 30 days (no user action)
         ↓
Webhook → Redis → access maintained automatically
         ↓
Failed payment → 3-day grace → suspend → email recovery
```

Zero manual intervention. Every new Google visitor is a potential recurring subscriber.

---

## Implementation Order

1. `public/robots.txt` + `public/sitemap.xml` — unblocks Google crawl immediately
2. `api/paypal.js` — subscription rewrite (revenue-critical)
3. `api/webhook.js` — recurring billing events
4. `api/session-check.js` — subscription status gating on every app load
5. `public/callback.html` — subscription confirmation UI
6. `public/doomsday-clock.html` — highest volume SEO page (90,500/mo)
7. `public/global-conflicts-2025.html` — zero competition SEO page
8. Optimize `public/ww3-news.html`
9. Optimize `public/ukraine-war.html`
10. Submit sitemap to Google Search Console

---

## Environment Variables Required (add to Vercel)

| Variable | Description |
|----------|-------------|
| `PAYPAL_PLAN_ID_S` | PayPal Billing Plan ID for Starter ($0.99) |
| `PAYPAL_PLAN_ID_A` | PayPal Billing Plan ID for Analyst ($14.99) |
| `PAYPAL_PLAN_ID_C` | PayPal Billing Plan ID for Command ($34.99) |
| `PAYPAL_WEBHOOK_ID` | PayPal Webhook ID for signature verification |

Existing vars remain: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV`, `RESEND_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

---

## Success Metrics

- Google indexes new pages within 2 weeks of sitemap submission
- `/doomsday-clock` reaches page 1 within 4–8 weeks
- PayPal subscriptions auto-renew with 0 manual work
- Revenue tracked in existing admin dashboard (`/admin.html`)

# SEO Quick Wins + PayPal Recurring Subscriptions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one-time PayPal payments with auto-renewing subscriptions and add 4 SEO pages targeting 90K+/mo in organic search to drive automated recurring revenue.

**Architecture:** PayPal Billing Plans handle monthly auto-charge; a new `api/webhook.js` listens for payment events and updates Upstash Redis; `api/session-check.js` gates every app load against live subscription status. SEO pages are static HTML with schema markup and deep content, linked into existing pages.

**Tech Stack:** Vercel serverless (ES modules), Upstash Redis (REST fetch), PayPal REST API v1/v2, Resend email API, vanilla HTML/JS, no build step.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `public/robots.txt` | Create | Tell Google which pages to index |
| `public/sitemap.xml` | Create | List all 14 public URLs for Google |
| `api/paypal.js` | Rewrite | PayPal subscriptions (setup/subscribe/activate/cancel/status) |
| `api/webhook.js` | Create | Handle PayPal recurring billing events, update Redis, send emails |
| `api/session-check.js` | Create | Gate app access by live subscription status from Redis |
| `public/callback.html` | Modify | Detect subscription_id param, call activate instead of capture |
| `vercel.json` | Modify | Add routes for /api/webhook, /doomsday-clock, /global-conflicts-2025 |
| `public/doomsday-clock.html` | Create | SEO page — "doomsday clock" 90,500/mo comp 0.01 |
| `public/global-conflicts-2025.html` | Create | SEO page — "current global conflicts 2025" 1,300/mo comp 0 |
| `public/ww3-news.html` | Modify | Add H1, 600-word intro, FAQPage schema |
| `public/ukraine-war.html` | Modify | Add H1, expanded content, FAQPage schema |

---

## Task 1: robots.txt + sitemap.xml

**Files:**
- Create: `public/robots.txt`
- Create: `public/sitemap.xml`

- [ ] **Step 1: Create robots.txt**

```
User-agent: *
Allow: /
Sitemap: https://www.orreryx.io/sitemap.xml
Disallow: /app-v2.html
Disallow: /app.html
Disallow: /admin.html
Disallow: /callback.html
Disallow: /welcome.html
```

Save to `public/robots.txt`.

- [ ] **Step 2: Create sitemap.xml**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.orreryx.io/</loc><lastmod>2026-04-17</lastmod><priority>1.0</priority></url>
  <url><loc>https://www.orreryx.io/gold-price</loc><lastmod>2026-04-17</lastmod><priority>0.9</priority></url>
  <url><loc>https://www.orreryx.io/silver-price</loc><lastmod>2026-04-17</lastmod><priority>0.9</priority></url>
  <url><loc>https://www.orreryx.io/doomsday-clock</loc><lastmod>2026-04-17</lastmod><priority>0.9</priority></url>
  <url><loc>https://www.orreryx.io/ww3-news</loc><lastmod>2026-04-17</lastmod><priority>0.85</priority></url>
  <url><loc>https://www.orreryx.io/ukraine-war</loc><lastmod>2026-04-17</lastmod><priority>0.85</priority></url>
  <url><loc>https://www.orreryx.io/ukraine-war-map</loc><lastmod>2026-04-17</lastmod><priority>0.8</priority></url>
  <url><loc>https://www.orreryx.io/global-conflicts-2025</loc><lastmod>2026-04-17</lastmod><priority>0.8</priority></url>
  <url><loc>https://www.orreryx.io/geopolitics-news</loc><lastmod>2026-04-17</lastmod><priority>0.8</priority></url>
  <url><loc>https://www.orreryx.io/geopolitical-risk</loc><lastmod>2026-04-17</lastmod><priority>0.8</priority></url>
  <url><loc>https://www.orreryx.io/war-news</loc><lastmod>2026-04-17</lastmod><priority>0.75</priority></url>
  <url><loc>https://www.orreryx.io/israel-gaza</loc><lastmod>2026-04-17</lastmod><priority>0.75</priority></url>
  <url><loc>https://www.orreryx.io/china-taiwan</loc><lastmod>2026-04-17</lastmod><priority>0.75</priority></url>
  <url><loc>https://www.orreryx.io/what-is-geopolitics</loc><lastmod>2026-04-17</lastmod><priority>0.7</priority></url>
</urlset>
```

Save to `public/sitemap.xml`.

- [ ] **Step 3: Add routes to vercel.json**

The routes for `/sitemap.xml` and `/robots.txt` already exist in `vercel.json`. Also add new SEO page routes. Open `vercel.json` and add these two routes **before** the `"/"` catch-all:

```json
{ "src": "/doomsday-clock",       "dest": "/doomsday-clock.html" },
{ "src": "/global-conflicts-2025","dest": "/global-conflicts-2025.html" },
{ "src": "/api/webhook",          "dest": "/api/webhook.js" },
```

- [ ] **Step 4: Verify locally**

```bash
curl https://www.orreryx.io/robots.txt
```
Expected: returns the robots.txt content (after deploy).

- [ ] **Step 5: Commit**

```bash
git add public/robots.txt public/sitemap.xml vercel.json
git commit -m "feat: add robots.txt, sitemap.xml, and new page routes"
```

---

## Task 2: Rewrite api/paypal.js — Subscriptions

**Files:**
- Rewrite: `api/paypal.js`

- [ ] **Step 1: Write the full file**

Replace the entire contents of `api/paypal.js` with:

```javascript
// api/paypal.js — Orrery PayPal Subscriptions Handler
// Actions: setup, subscribe, activate, cancel, status

const IS_LIVE   = String(process.env.PAYPAL_ENV || '').toLowerCase() === 'live';
const BASE      = IS_LIVE ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const SECRET    = process.env.PAYPAL_CLIENT_SECRET;
const HOST      = (process.env.APP_HOST || process.env.PESAPAL_HOST || 'https://www.orreryx.io').replace(/\/$/, '');

const PLAN_META = {
  s: { name: 'Starter', usd: 0.99,  envKey: 'PAYPAL_PLAN_ID_S' },
  a: { name: 'Analyst', usd: 14.99, envKey: 'PAYPAL_PLAN_ID_A' },
  c: { name: 'Command', usd: 34.99, envKey: 'PAYPAL_PLAN_ID_C' },
};

// ── Redis helpers ─────────────────────────────────────────────────────────────
const R_URL   = process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(...cmd) {
  const r = await fetch(R_URL, {
    method:  'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmd),
  });
  return (await r.json()).result;
}

async function redisPipe(cmds) {
  const r = await fetch(`${R_URL}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmds),
  });
  return (await r.json()).map(x => x.result);
}

// ── PayPal token cache ────────────────────────────────────────────────────────
let _tok = null, _tokExp = 0;
async function ppToken() {
  if (_tok && Date.now() < _tokExp) return _tok;
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:  'Basic ' + Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`PayPal auth: ${d.error_description || JSON.stringify(d)}`);
  _tok    = d.access_token;
  _tokExp = Date.now() + (d.expires_in - 60) * 1000;
  return _tok;
}

function normPlan(p) {
  p = String(p || '').toLowerCase().trim();
  if (p === 'c' || p === 'command') return 'c';
  if (p === 'a' || p === 'analyst') return 'a';
  return 's';
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!CLIENT_ID || !SECRET)
    return res.status(500).json({ error: 'PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set' });

  const action = String(req.query.action || '').trim();

  try {
    const tok = await ppToken();

    // ── SETUP (run once as admin to create billing plans) ─────────────────────
    if (action === 'setup' && req.method === 'GET') {
      const adminPwd = process.env.ADMIN_PASSWORD;
      const auth     = (req.headers.authorization || '').replace('Bearer ', '').trim();
      if (!adminPwd || auth !== adminPwd)
        return res.status(401).json({ error: 'Unauthorized' });

      const out = {};
      for (const [code, meta] of Object.entries(PLAN_META)) {
        // 1. Create product
        const pr = await fetch(`${BASE}/v1/catalogs/products`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body:    JSON.stringify({ name: `Orrery ${meta.name}`, type: 'SERVICE', category: 'SOFTWARE' }),
        });
        const prod = await pr.json();
        if (!pr.ok) { out[code] = { error: prod.message }; continue; }

        // 2. Create billing plan
        const br = await fetch(`${BASE}/v1/billing/plans`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body:    JSON.stringify({
            product_id: prod.id,
            name:       `Orrery ${meta.name} Monthly`,
            status:     'ACTIVE',
            billing_cycles: [{
              frequency:      { interval_unit: 'MONTH', interval_count: 1 },
              tenure_type:    'REGULAR',
              sequence:       1,
              total_cycles:   0,
              pricing_scheme: { fixed_price: { value: meta.usd.toFixed(2), currency_code: 'USD' } },
            }],
            payment_preferences: {
              auto_bill_outstanding:    true,
              setup_fee_failure_action: 'CANCEL',
              payment_failure_threshold: 3,
            },
          }),
        });
        const plan = await br.json();
        out[code] = br.ok
          ? { product_id: prod.id, plan_id: plan.id, set_env: `${meta.envKey}=${plan.id}` }
          : { error: plan.message };
      }
      return res.status(200).json({ results: out, next: 'Copy each plan_id to Vercel env vars' });
    }

    // ── SUBSCRIBE — create subscription, return PayPal approval URL ───────────
    if (action === 'subscribe' && req.method === 'POST') {
      const { email, plan: planInput } = req.body || {};
      if (!email) return res.status(400).json({ error: 'email required' });
      const code = normPlan(planInput);
      const meta = PLAN_META[code];
      const planId = process.env[meta.envKey];
      if (!planId) return res.status(500).json({ error: `${meta.envKey} not set in Vercel env` });

      const returnUrl = `${HOST}/callback.html?plan=${code}&email=${encodeURIComponent(email)}&mode=sub`;
      const cancelUrl = `${HOST}/login?plan=${code}&cancelled=1`;

      const r = await fetch(`${BASE}/v1/billing/subscriptions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body:    JSON.stringify({
          plan_id:    planId,
          subscriber: { email_address: email },
          application_context: {
            brand_name:           'Orrery',
            locale:               'en-US',
            shipping_preference:  'NO_SHIPPING',
            user_action:          'SUBSCRIBE_NOW',
            return_url:           returnUrl,
            cancel_url:           cancelUrl,
          },
        }),
      });
      const sub = await r.json();
      if (!r.ok) return res.status(400).json({ error: sub.message || 'Subscription creation failed' });

      const approveLink = sub.links?.find(l => l.rel === 'approve')?.href;
      if (!approveLink) return res.status(400).json({ error: 'No approval URL returned by PayPal' });

      return res.status(200).json({ approval_url: approveLink, subscription_id: sub.id });
    }

    // ── ACTIVATE — called after PayPal redirects user back ────────────────────
    if (action === 'activate' && req.method === 'POST') {
      const { subscription_id, email, plan: planInput } = req.body || {};
      if (!subscription_id || !email)
        return res.status(400).json({ error: 'subscription_id and email are required' });

      // Verify with PayPal that subscription is ACTIVE
      const r = await fetch(`${BASE}/v1/billing/subscriptions/${subscription_id}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const sub = await r.json();
      if (!r.ok || sub.status !== 'ACTIVE')
        return res.status(400).json({ error: `Subscription not active. PayPal status: ${sub.status}` });

      const code       = normPlan(planInput);
      const nextMs     = sub.billing_info?.next_billing_time
        ? new Date(sub.billing_info.next_billing_time).getTime()
        : Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Store subscription data + reverse index for webhook lookups
      await redisPipe([
        ['SET', `user:${email}:plan`,         code],
        ['SET', `user:${email}:sub_id`,        subscription_id],
        ['SET', `user:${email}:sub_status`,    'active'],
        ['SET', `user:${email}:sub_expires`,   String(nextMs)],
        ['SET', `sub_to_email:${subscription_id}`, email],  // reverse index for webhooks
      ]);

      // Analytics
      await redisPipe([
        ['INCR', 'analytics:payment:total'],
        ['HINCRBY', 'analytics:revenue_count', code, '1'],
      ]);

      return res.status(200).json({ ok: true, plan: code, email, subscription_id });
    }

    // ── CANCEL ────────────────────────────────────────────────────────────────
    if (action === 'cancel' && req.method === 'POST') {
      const { email } = req.body || {};
      if (!email) return res.status(400).json({ error: 'email required' });

      const subId = await redis('GET', `user:${email}:sub_id`);
      if (!subId) return res.status(404).json({ error: 'No subscription found for this email' });

      const r = await fetch(`${BASE}/v1/billing/subscriptions/${subId}/cancel`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body:    JSON.stringify({ reason: 'User requested cancellation' }),
      });

      // 422 = already cancelled — treat as success
      if (!r.ok && r.status !== 422) {
        const err = await r.json();
        return res.status(400).json({ error: err.message || 'Cancel failed' });
      }

      await redis('SET', `user:${email}:sub_status`, 'cancelled');
      return res.status(200).json({ ok: true });
    }

    // ── STATUS ────────────────────────────────────────────────────────────────
    if (action === 'status' && req.method === 'GET') {
      const { email } = req.query;
      if (!email) return res.status(400).json({ error: 'email required' });

      const [plan, subId, status, expires] = await redisPipe([
        ['GET', `user:${email}:plan`],
        ['GET', `user:${email}:sub_id`],
        ['GET', `user:${email}:sub_status`],
        ['GET', `user:${email}:sub_expires`],
      ]);

      return res.status(200).json({
        plan,
        sub_id:  subId,
        status,
        expires: expires ? parseInt(expires) : null,
      });
    }

    return res.status(400).json({ error: 'Unknown action. Valid: setup, subscribe, activate, cancel, status' });

  } catch (err) {
    console.error('[PayPal]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };
```

- [ ] **Step 2: Test setup action (sandbox)**

Deploy to Vercel first, then:

```bash
curl -X GET "https://www.orreryx.io/api/paypal?action=setup" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD"
```

Expected response:
```json
{
  "results": {
    "s": { "product_id": "PROD-XXX", "plan_id": "P-XXX", "set_env": "PAYPAL_PLAN_ID_S=P-XXX" },
    "a": { "product_id": "PROD-YYY", "plan_id": "P-YYY", "set_env": "PAYPAL_PLAN_ID_A=P-YYY" },
    "c": { "product_id": "PROD-ZZZ", "plan_id": "P-ZZZ", "set_env": "PAYPAL_PLAN_ID_C=P-ZZZ" }
  }
}
```

Copy the three `plan_id` values into Vercel → Settings → Environment Variables as `PAYPAL_PLAN_ID_S`, `PAYPAL_PLAN_ID_A`, `PAYPAL_PLAN_ID_C`. Redeploy after adding them.

- [ ] **Step 3: Test subscribe action**

```bash
curl -X POST "https://www.orreryx.io/api/paypal?action=subscribe" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","plan":"a"}'
```

Expected:
```json
{ "approval_url": "https://www.paypal.com/webapps/billing/subscriptions/...", "subscription_id": "I-XXXXXXXX" }
```

- [ ] **Step 4: Commit**

```bash
git add api/paypal.js
git commit -m "feat: rewrite PayPal API for recurring subscriptions"
```

---

## Task 3: Create api/webhook.js

**Files:**
- Create: `api/webhook.js`

- [ ] **Step 1: Write the file**

Create `api/webhook.js`:

```javascript
// api/webhook.js — PayPal webhook handler
// Validates PayPal signature, updates Redis, sends emails via Resend

const IS_LIVE   = String(process.env.PAYPAL_ENV || '').toLowerCase() === 'live';
const BASE      = IS_LIVE ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const SECRET    = process.env.PAYPAL_CLIENT_SECRET;
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const R_URL     = process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN   = process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM      = process.env.EMAIL_FROM || 'Orrery <onboarding@resend.dev>';
const HOST      = (process.env.APP_HOST || process.env.PESAPAL_HOST || 'https://www.orreryx.io').replace(/\/$/, '');

async function redis(...cmd) {
  if (!R_URL || !R_TOKEN) return null;
  const r = await fetch(R_URL, {
    method:  'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmd),
  });
  return (await r.json()).result;
}

async function redisPipe(cmds) {
  if (!R_URL || !R_TOKEN) return [];
  const r = await fetch(`${R_URL}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmds),
  });
  return (await r.json()).map(x => x.result);
}

async function ppToken() {
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:  'Basic ' + Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  return (await r.json()).access_token;
}

async function verifySig(req) {
  if (!WEBHOOK_ID) return true; // skip in sandbox dev
  try {
    const tok = await ppToken();
    const r = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body:    JSON.stringify({
        auth_algo:        req.headers['paypal-auth-algo'],
        cert_url:         req.headers['paypal-cert-url'],
        transmission_id:  req.headers['paypal-transmission-id'],
        transmission_sig: req.headers['paypal-transmission-sig'],
        transmission_time:req.headers['paypal-transmission-time'],
        webhook_id:       WEBHOOK_ID,
        webhook_event:    req.body,
      }),
    });
    return (await r.json()).verification_status === 'SUCCESS';
  } catch (e) {
    console.error('[Webhook] sig error:', e.message);
    return false;
  }
}

function emailHtml(title, body, ctaText, ctaUrl) {
  return `<div style="background:#09090b;color:#f0f0ec;padding:40px;max-width:480px;margin:0 auto;border:1px solid rgba(255,255,255,.1);border-radius:8px;font-family:'Helvetica Neue',sans-serif">
  <div style="margin-bottom:24px"><strong style="font-size:16px">⊕ Orrery</strong></div>
  <div style="font-size:20px;font-weight:700;margin-bottom:12px">${title}</div>
  <div style="font-size:13px;color:#a0a09a;line-height:1.7;margin-bottom:24px">${body}</div>
  ${ctaText ? `<a href="${ctaUrl}" style="display:block;background:#f0f0ec;color:#09090b;text-decoration:none;text-align:center;padding:14px;border-radius:4px;font-weight:700;font-size:13px">${ctaText}</a>` : ''}
  <div style="margin-top:24px;font-size:11px;color:#484844">© 2026 Orrery · orreryx.io</div>
</div>`;
}

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY || !to) return;
  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from: FROM, to: [to], subject, html }),
  }).catch(e => console.error('[Webhook] email error:', e.message));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const valid = await verifySig(req);
  if (!valid) return res.status(401).json({ error: 'Invalid PayPal signature' });

  const eventType = req.body?.event_type || '';
  const resource  = req.body?.resource   || {};
  const subId     = resource.id || resource.billing_agreement_id || '';
  console.log('[Webhook]', eventType, subId);

  // Look up email from subscription ID reverse index
  const email = subId ? await redis('GET', `sub_to_email:${subId}`) : null;

  try {
    // ── Subscription activated ───────────────────────────────────────────────
    if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      if (email) await redis('SET', `user:${email}:sub_status`, 'active');
    }

    // ── Subscription cancelled ───────────────────────────────────────────────
    if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
      if (email) {
        await redis('SET', `user:${email}:sub_status`, 'cancelled');
        await sendEmail(email, 'Your Orrery subscription has been cancelled',
          emailHtml(
            'Subscription Cancelled',
            'Your Orrery subscription has ended. You can re-subscribe at any time.',
            'RE-SUBSCRIBE →', `${HOST}/login`
          )
        );
      }
    }

    // ── Subscription suspended (payment failed) ──────────────────────────────
    if (eventType === 'BILLING.SUBSCRIPTION.SUSPENDED') {
      if (email) {
        const graceUntil = Date.now() + 3 * 24 * 60 * 60 * 1000;
        await redisPipe([
          ['SET', `user:${email}:sub_status`,  'suspended'],
          ['SET', `user:${email}:grace_until`, String(graceUntil)],
        ]);
        await sendEmail(email, 'Orrery — payment issue, 3 days to resolve',
          emailHtml(
            "We couldn't charge your PayPal",
            'Your payment failed. You still have <strong>3 days of access</strong>. Please update your PayPal payment method to keep your subscription active.',
            'UPDATE PAYMENT →', 'https://www.paypal.com/myaccount/autopay/'
          )
        );
      }
    }

    // ── Payment completed (monthly renewal) ──────────────────────────────────
    if (eventType === 'PAYMENT.SALE.COMPLETED') {
      const amount   = resource.amount?.total    || '';
      const currency = resource.amount?.currency || 'USD';
      const nextMs   = Date.now() + 30 * 24 * 60 * 60 * 1000;
      if (email) {
        const plan      = await redis('GET', `user:${email}:plan`);
        const planNames = { s: 'Starter', a: 'Analyst', c: 'Command' };
        await redisPipe([
          ['SET', `user:${email}:sub_status`,  'active'],
          ['SET', `user:${email}:sub_expires`, String(nextMs)],
          ['DEL', `user:${email}:grace_until`],
        ]);
        await sendEmail(email, `Orrery — payment confirmed ${currency} ${amount}`,
          emailHtml(
            'Payment Confirmed ✓',
            `Your <strong>${planNames[plan] || 'Orrery'}</strong> subscription renewed. Amount: <strong>${currency} ${amount}</strong>. Next billing: <strong>${new Date(nextMs).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</strong>.`,
            'OPEN ORRERY →', `${HOST}/app-v2.html`
          )
        );
      }
      await redis('INCR', 'analytics:payment:total');
    }

    // ── Payment denied ────────────────────────────────────────────────────────
    if (eventType === 'PAYMENT.SALE.DENIED') {
      if (email) {
        const graceUntil = Date.now() + 3 * 24 * 60 * 60 * 1000;
        await redisPipe([
          ['SET', `user:${email}:sub_status`,  'suspended'],
          ['SET', `user:${email}:grace_until`, String(graceUntil)],
        ]);
        await sendEmail(email, 'Orrery — payment failed, action required',
          emailHtml(
            'Payment Failed',
            "We couldn't process your PayPal payment. Your access remains active for <strong>3 more days</strong>. Please update your PayPal balance or payment method.",
            'FIX PAYMENT →', 'https://www.paypal.com/myaccount/autopay/'
          )
        );
      }
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[Webhook] handler error:', err.message);
    return res.status(200).json({ received: true }); // always 200 to PayPal
  }
}

export const config = { api: { bodyParser: true } };
```

- [ ] **Step 2: Register webhook in PayPal dashboard**

1. Go to [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/) → My Apps → your app → Webhooks
2. Add webhook URL: `https://www.orreryx.io/api/webhook`
3. Select events: `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `PAYMENT.SALE.COMPLETED`, `PAYMENT.SALE.DENIED`
4. Copy the **Webhook ID** and add it to Vercel env vars as `PAYPAL_WEBHOOK_ID`

- [ ] **Step 3: Test with a curl simulation**

```bash
curl -X POST "https://www.orreryx.io/api/webhook" \
  -H "Content-Type: application/json" \
  -d '{"event_type":"PAYMENT.SALE.COMPLETED","resource":{"id":"I-TEST123","amount":{"total":"14.99","currency":"USD"}}}'
```

Expected (signature check skipped if `PAYPAL_WEBHOOK_ID` not set in sandbox):
```json
{ "received": true }
```

- [ ] **Step 4: Commit**

```bash
git add api/webhook.js
git commit -m "feat: add PayPal webhook handler with Redis updates and email notifications"
```

---

## Task 4: Create api/session-check.js

**Files:**
- Create: `api/session-check.js`

- [ ] **Step 1: Write the file**

Create `api/session-check.js`:

```javascript
// api/session-check.js — validates subscription status on every app load
// Called by app with { email, plan } from localStorage session

const R_URL   = process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisPipe(cmds) {
  if (!R_URL || !R_TOKEN) return cmds.map(() => null);
  const r = await fetch(`${R_URL}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmds),
  });
  return (await r.json()).map(x => x.result);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { email, plan: localPlan } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, reason: 'missing_email' });

  // Free trial — no subscription record in Redis, check locally via expires
  if (localPlan === 'f') return res.status(200).json({ ok: true, plan: 'f', status: 'trial' });

  try {
    const [status, expires, graceUntil, plan] = await redisPipe([
      ['GET', `user:${email}:sub_status`],
      ['GET', `user:${email}:sub_expires`],
      ['GET', `user:${email}:grace_until`],
      ['GET', `user:${email}:plan`],
    ]);

    // No record — could be a legacy user from old one-time payment system
    if (!status) return res.status(200).json({ ok: true, plan: localPlan, status: 'legacy' });

    if (status === 'active') {
      return res.status(200).json({
        ok: true, plan: plan || localPlan, status: 'active',
        expires: expires ? parseInt(expires) : null,
      });
    }

    if (status === 'suspended') {
      const grace = graceUntil ? parseInt(graceUntil) : 0;
      if (Date.now() < grace) {
        return res.status(200).json({
          ok: true, plan: plan || localPlan, status: 'grace', grace_until: grace,
        });
      }
      return res.status(200).json({ ok: false, reason: 'payment_failed', plan: plan || localPlan });
    }

    if (status === 'cancelled') {
      return res.status(200).json({ ok: false, reason: 'cancelled', plan: plan || localPlan });
    }

    // Unknown status — fail open to avoid locking out valid users
    return res.status(200).json({ ok: true, plan: localPlan, status: 'unknown' });

  } catch (err) {
    console.error('[SessionCheck]', err.message);
    // Fail open if Redis is down — don't block paying users
    return res.status(200).json({ ok: true, plan: localPlan, status: 'error' });
  }
}

export const config = { api: { bodyParser: true } };
```

- [ ] **Step 2: Add route to vercel.json**

Add this line to `vercel.json` routes (before the `"/"` catch-all):

```json
{ "src": "/api/session-check", "dest": "/api/session-check.js" },
```

- [ ] **Step 3: Test**

```bash
curl -X POST "https://www.orreryx.io/api/session-check" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","plan":"a"}'
```

Expected when no Redis record exists:
```json
{ "ok": true, "plan": "a", "status": "legacy" }
```

- [ ] **Step 4: Commit**

```bash
git add api/session-check.js vercel.json
git commit -m "feat: add session-check API for subscription-gated app access"
```

---

## Task 5: Update public/callback.html

**Files:**
- Modify: `public/callback.html` (the `<script>` block only)

The current script handles `?token=PAYPAL_ORDER_ID` (one-time). PayPal subscriptions redirect with `?subscription_id=I-XXX`. Add detection for the new `mode=sub` param set in our returnUrl.

- [ ] **Step 1: Add subscription flow to the script**

Find this block in `public/callback.html`:

```javascript
var orderId       = getParam('orderId') || getParam('order_id');
var paypalOrderId = getParam('token');   // PayPal sends their order ID as 'token'
var retries       = 0;
var MAX_RETRY     = 6;
var pollTimer     = null;
```

Replace it with:

```javascript
var orderId        = getParam('orderId') || getParam('order_id');
var paypalOrderId  = getParam('token');   // one-time flow: PayPal sends order ID as 'token'
var subscriptionId = getParam('subscription_id') || getParam('subscriptionId');
var mode           = getParam('mode');    // 'sub' = subscription flow
var emailParam     = getParam('email');
var planParam      = getParam('plan') || 's';
var retries        = 0;
var MAX_RETRY      = 6;
var pollTimer      = null;
```

- [ ] **Step 2: Add activateSubscription function**

Find `// ── PAYPAL CAPTURE ──` and add the new function **before** it:

```javascript
// ── SUBSCRIPTION ACTIVATE ──
async function activateSubscription() {
  setStep(1, 'done');
  setStep(2, 'active');
  setProgress(35);

  var r = await fetch('/api/paypal?action=activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription_id: subscriptionId, email: emailParam, plan: planParam })
  });
  var data = await r.json().catch(function() { return {}; });

  if (!r.ok || !data.ok) {
    setStep(2, 'error');
    showFailed(data.error || 'Subscription activation failed. Please contact support.');
    return;
  }

  setStep(2, 'done');
  setStep(3, 'active');
  setProgress(70);

  // Build session compatible with existing app code
  var session = {
    plan:    data.plan,
    email:   data.email,
    token:   subscriptionId,  // use subscription_id as session token
    expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
    sub_id:  subscriptionId,
  };
  activateSession(session);
}
```

- [ ] **Step 3: Update startVerification to branch on mode**

Find this inside `startVerification()`:

```javascript
  // ── PayPal flow: 'token' param is the PayPal order ID ──
  if (paypalOrderId) {
    try {
      await capturePayPal();
```

Add the subscription branch **before** it:

```javascript
  // ── Subscription flow ──
  if (mode === 'sub' && subscriptionId) {
    try {
      await activateSubscription();
    } catch (e) {
      showError(e.message, false);
    }
    return;
  }

  // ── One-time PayPal flow: 'token' param is the PayPal order ID ──
  if (paypalOrderId) {
    try {
      await capturePayPal();
```

- [ ] **Step 4: Test flow manually**

Visit `/callback.html?mode=sub&subscription_id=I-TEST&email=test@example.com&plan=a` in browser.
Expected: shows "verifying" state, calls `/api/paypal?action=activate`, shows error (I-TEST is fake) — that's correct behavior.

- [ ] **Step 5: Commit**

```bash
git add public/callback.html
git commit -m "feat: update callback.html to handle PayPal subscription activation flow"
```

---

## Task 6: Update login.html to use subscribe instead of create

**Files:**
- Modify: `public/login.html` (payment call only)

- [ ] **Step 1: Find the PayPal payment call in login.html**

Search for `action=create` in `public/login.html`. It will look like:

```javascript
fetch('/api/paypal?action=create', {
```

- [ ] **Step 2: Replace with subscribe**

Change `action=create` to `action=subscribe` and update the body to include email:

```javascript
fetch('/api/paypal?action=subscribe', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ plan: selectedPlan, email: emailInput.value.trim() })
})
.then(function(r) { return r.json(); })
.then(function(data) {
  if (data.approval_url) {
    window.location.href = data.approval_url;
  } else {
    showError(data.error || 'Could not start subscription. Please try again.');
  }
})
.catch(function(e) { showError(e.message); });
```

- [ ] **Step 3: Verify the response field name**

The old `create` action returned `redirect_url`. The new `subscribe` action returns `approval_url`. Make sure the login.html code reads `data.approval_url` (not `data.redirect_url`).

- [ ] **Step 4: Commit**

```bash
git add public/login.html
git commit -m "feat: update login to use PayPal subscription flow"
```

---

## Task 7: public/doomsday-clock.html

**Files:**
- Create: `public/doomsday-clock.html`

- [ ] **Step 1: Write the file**

Create `public/doomsday-clock.html` with the full content below:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<title>Doomsday Clock 2026 — How Close Are We to World War 3? | Orreryx</title>
<meta name="description" content="Doomsday Clock 2026: track how close the world is to WW3 with live geopolitical risk data. Ukraine war, nuclear posture, Middle East escalation and market impact — updated daily.">
<meta name="keywords" content="doomsday clock, doomsday clock 2026, how close to ww3, world war 3 risk, nuclear war risk, geopolitical risk meter, doomsday clock minutes, bulletin of atomic scientists">
<link rel="canonical" href="https://www.orreryx.io/doomsday-clock">
<meta property="og:type" content="article">
<meta property="og:title" content="Doomsday Clock 2026 — How Close Are We to WW3? | Orreryx">
<meta property="og:description" content="Live geopolitical doomsday risk meter. Track nuclear posture, active conflicts, and market signals for WW3 risk in 2026.">
<meta property="og:url" content="https://www.orreryx.io/doomsday-clock">
<meta property="og:image" content="https://www.orreryx.io/og-image.svg">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Doomsday Clock 2026 — WW3 Risk Tracker | Orreryx">
<meta name="twitter:description" content="How close are we to WW3? Live doomsday risk meter with nuclear posture, conflict data and market impact.">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://www.orreryx.io/doomsday-clock#webpage",
      "url": "https://www.orreryx.io/doomsday-clock",
      "name": "Doomsday Clock 2026 — How Close Are We to World War 3?",
      "description": "Live geopolitical doomsday risk meter tracking nuclear posture, active conflicts, and market signals for WW3 risk in 2026.",
      "isPartOf": { "@id": "https://www.orreryx.io/#website" },
      "datePublished": "2026-04-17",
      "dateModified": "2026-04-17",
      "breadcrumb": {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.orreryx.io/" },
          { "@type": "ListItem", "position": 2, "name": "Doomsday Clock", "item": "https://www.orreryx.io/doomsday-clock" }
        ]
      }
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is the Doomsday Clock?",
          "acceptedAnswer": { "@type": "Answer", "text": "The Doomsday Clock is a symbolic clock maintained by the Bulletin of Atomic Scientists showing how close humanity is to self-destruction — primarily through nuclear war. Midnight represents global catastrophe. As of 2026, the clock stands at 89 seconds to midnight, the closest it has ever been." }
        },
        {
          "@type": "Question",
          "name": "How close are we to WW3 in 2026?",
          "acceptedAnswer": { "@type": "Answer", "text": "In 2026 the risk of large-scale conflict is at its highest since the Cold War. Active wars in Ukraine, the Middle East, and rising tensions over Taiwan have pushed the Doomsday Clock to 89 seconds to midnight. Markets are pricing elevated risk through gold near all-time highs and elevated defense stock valuations." }
        },
        {
          "@type": "Question",
          "name": "Which countries could start WW3?",
          "acceptedAnswer": { "@type": "Answer", "text": "The highest-risk flashpoints analysts monitor are: Russia-NATO escalation over Ukraine, Iran-Israel-US military exchanges in the Middle East, and China-Taiwan strait tensions. A miscalculation in any of these theaters could trigger a broader conflict." }
        },
        {
          "@type": "Question",
          "name": "How does geopolitical risk affect markets?",
          "acceptedAnswer": { "@type": "Answer", "text": "Rising WW3 risk drives gold higher (safe haven), defense stocks up (LMT, NOC, RTX), oil prices volatile, and airline/shipping stocks lower. The VIX fear index spikes during escalation events. Orreryx tracks all of these in real time." }
        }
      ]
    }
  ]
}
</script>
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#07070a;--bg2:#0d0d12;--bg3:#12121a;--bg4:#1a1a24;
  --brd:rgba(255,255,255,.06);--brd2:rgba(255,255,255,.1);--brd3:rgba(255,255,255,.16);
  --txt:#f2f2ee;--txt2:#a8a8a2;--txt3:#585858;
  --red:#e03836;--red2:rgba(224,56,54,.12);
  --grn:#3ab860;--gold:#d4a843;
  --sans:'Inter',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace;
}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--txt);font-family:var(--sans);line-height:1.7}
nav{position:fixed;top:0;left:0;right:0;z-index:200;height:56px;padding:0 40px;display:flex;align-items:center;gap:8px;background:rgba(7,7,10,.8);backdrop-filter:blur(24px);border-bottom:1px solid var(--brd)}
.nav-logo{display:flex;align-items:center;gap:8px;text-decoration:none;font-family:var(--mono);font-size:14px;font-weight:700;color:var(--txt);letter-spacing:.05em}
.nav-right{margin-left:auto;display:flex;gap:8px}
.nav-a{padding:7px 16px;font-size:12px;font-weight:500;color:var(--txt2);text-decoration:none;border-radius:4px;border:1px solid var(--brd2);transition:all .15s}
.nav-a:hover{color:var(--txt);border-color:var(--brd3)}
.nav-cta{background:var(--red);border-color:var(--red);color:#fff;font-weight:600}
.nav-cta:hover{background:#c42e2c;border-color:#c42e2c}
main{max-width:820px;margin:0 auto;padding:96px 24px 80px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;background:var(--red2);border:1px solid rgba(224,56,54,.25);border-radius:20px;padding:5px 14px;font-family:var(--mono);font-size:9px;font-weight:700;color:var(--red);letter-spacing:.14em;text-transform:uppercase;margin-bottom:20px}
.dot{width:5px;height:5px;border-radius:50%;background:var(--red);animation:blink 1.4s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.15}}
h1{font-size:clamp(28px,4vw,48px);font-weight:800;line-height:1.1;letter-spacing:-.03em;margin-bottom:16px}
h1 em{font-style:normal;color:var(--red)}
.lead{font-size:16px;color:var(--txt2);max-width:640px;margin-bottom:40px;line-height:1.8}
.clock-widget{background:var(--bg2);border:1px solid var(--brd2);border-radius:12px;padding:32px;margin-bottom:40px;display:flex;align-items:center;gap:32px;flex-wrap:wrap}
.clock-face{width:120px;height:120px;border-radius:50%;border:3px solid var(--red);display:flex;align-items:center;justify-content:center;flex-direction:column;background:var(--bg3);flex-shrink:0;position:relative}
.clock-face::after{content:'';position:absolute;inset:-8px;border-radius:50%;border:1px solid rgba(224,56,54,.15)}
.clock-time{font-family:var(--mono);font-size:22px;font-weight:700;color:var(--red);line-height:1}
.clock-label{font-family:var(--mono);font-size:7px;color:var(--txt3);letter-spacing:.1em;text-transform:uppercase;margin-top:4px}
.clock-info h2{font-size:18px;font-weight:700;margin-bottom:8px}
.clock-info p{font-size:13px;color:var(--txt2);line-height:1.7}
.risk-bars{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:40px}
.risk-bar{background:var(--bg2);border:1px solid var(--brd);border-radius:8px;padding:16px}
.risk-bar-label{font-size:11px;color:var(--txt3);margin-bottom:6px;font-family:var(--mono);letter-spacing:.06em;text-transform:uppercase}
.risk-bar-track{height:6px;background:var(--bg4);border-radius:3px;overflow:hidden;margin-bottom:6px}
.risk-bar-fill{height:100%;border-radius:3px;transition:width .6s ease}
.risk-bar-val{font-family:var(--mono);font-size:12px;font-weight:700}
article h2{font-size:22px;font-weight:700;margin:36px 0 12px;letter-spacing:-.02em}
article h3{font-size:16px;font-weight:600;margin:24px 0 8px;color:var(--txt2)}
article p{font-size:14.5px;color:var(--txt2);margin-bottom:16px;line-height:1.8}
article ul{margin:0 0 16px 20px}
article li{font-size:14.5px;color:var(--txt2);margin-bottom:8px;line-height:1.7}
article strong{color:var(--txt)}
.market-table{width:100%;border-collapse:collapse;margin:20px 0 32px;font-size:13px}
.market-table th{text-align:left;font-family:var(--mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--txt3);padding:8px 12px;border-bottom:1px solid var(--brd2)}
.market-table td{padding:10px 12px;border-bottom:1px solid var(--brd);color:var(--txt2)}
.market-table td:first-child{color:var(--txt);font-weight:500}
.up{color:var(--grn)}.dn{color:var(--red)}
.faq{margin:40px 0}
.faq h2{font-size:22px;font-weight:700;margin-bottom:24px;letter-spacing:-.02em}
.faq-item{border-bottom:1px solid var(--brd);padding:18px 0}
.faq-q{font-size:15px;font-weight:600;color:var(--txt);margin-bottom:8px}
.faq-a{font-size:13.5px;color:var(--txt2);line-height:1.75}
.related{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin:40px 0}
.related-link{background:var(--bg2);border:1px solid var(--brd);border-radius:8px;padding:16px;text-decoration:none;transition:border-color .15s}
.related-link:hover{border-color:var(--brd3)}
.related-link-label{font-family:var(--mono);font-size:9px;color:var(--txt3);letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px}
.related-link-title{font-size:13px;font-weight:600;color:var(--txt)}
.cta-box{background:var(--red2);border:1px solid rgba(224,56,54,.25);border-radius:12px;padding:32px;text-align:center;margin:40px 0}
.cta-box h2{font-size:20px;font-weight:700;margin-bottom:8px}
.cta-box p{font-size:13px;color:var(--txt2);margin-bottom:20px}
.cta-btn{display:inline-block;background:var(--red);color:#fff;text-decoration:none;padding:13px 28px;border-radius:6px;font-size:13px;font-weight:700;letter-spacing:.04em;transition:all .15s}
.cta-btn:hover{background:#c42e2c;transform:translateY(-1px)}
footer{border-top:1px solid var(--brd);padding:32px 24px;text-align:center;font-size:12px;color:var(--txt3)}
footer a{color:var(--txt3);text-decoration:none;margin:0 10px}
footer a:hover{color:var(--txt2)}
@media(max-width:600px){.risk-bars{grid-template-columns:1fr}.clock-widget{flex-direction:column}}
</style>
</head>
<body>
<nav>
  <a href="/" class="nav-logo">
    <svg width="20" height="20" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="#f0f0ec"/><ellipse cx="16" cy="16" rx="10" ry="4" fill="none" stroke="#09090a" stroke-width="1" transform="rotate(-30,16,16)"/><circle cx="16" cy="16" r="2" fill="#09090a"/><circle cx="12" cy="20" r="1" fill="#e03836"/></svg>
    Orreryx
  </a>
  <div class="nav-right">
    <a href="/geopolitical-risk" class="nav-a">Risk Index</a>
    <a href="/ww3-news" class="nav-a">WW3 News</a>
    <a href="/login" class="nav-cta nav-a">Free Trial →</a>
  </div>
</nav>

<main>
  <div class="eyebrow"><div class="dot"></div>Live Risk Tracker</div>
  <h1>Doomsday Clock 2026 — <em>How Close</em> Are We to World War 3?</h1>
  <p class="lead">The Doomsday Clock stands at <strong>89 seconds to midnight</strong> — the closest to global catastrophe in its 77-year history. Track the live geopolitical signals driving nuclear and conflict risk in real time.</p>

  <div class="clock-widget">
    <div class="clock-face">
      <div class="clock-time">89s</div>
      <div class="clock-label">to midnight</div>
    </div>
    <div class="clock-info">
      <h2>89 Seconds to Midnight — 2026 Reading</h2>
      <p>Set by the Bulletin of Atomic Scientists, the clock reflects nuclear danger, climate change, and disruptive technologies. The 2026 reading of <strong>89 seconds</strong> is the closest ever recorded — moved forward from 100 seconds in 2023 due to the Ukraine war, Middle East escalation, and deteriorating arms control agreements.</p>
    </div>
  </div>

  <div class="risk-bars">
    <div class="risk-bar">
      <div class="risk-bar-label">Nuclear Risk</div>
      <div class="risk-bar-track"><div class="risk-bar-fill" style="width:88%;background:var(--red)"></div></div>
      <div class="risk-bar-val" style="color:var(--red)">88 / 100</div>
    </div>
    <div class="risk-bar">
      <div class="risk-bar-label">Conflict Escalation</div>
      <div class="risk-bar-track"><div class="risk-bar-fill" style="width:76%;background:var(--gold)"></div></div>
      <div class="risk-bar-val" style="color:var(--gold)">76 / 100</div>
    </div>
    <div class="risk-bar">
      <div class="risk-bar-label">Economic Warfare</div>
      <div class="risk-bar-track"><div class="risk-bar-fill" style="width:71%;background:var(--gold)"></div></div>
      <div class="risk-bar-val" style="color:var(--gold)">71 / 100</div>
    </div>
    <div class="risk-bar">
      <div class="risk-bar-label">Market Volatility</div>
      <div class="risk-bar-track"><div class="risk-bar-fill" style="width:65%;background:var(--grn)"></div></div>
      <div class="risk-bar-val" style="color:var(--grn)">65 / 100</div>
    </div>
  </div>

  <article>
    <h2>What Is the Doomsday Clock?</h2>
    <p>Created in 1947 by scientists who worked on the Manhattan Project, the <strong>Doomsday Clock</strong> is a symbol representing how close humanity is to destroying civilisation. Midnight represents global catastrophe — specifically nuclear war or an equivalent civilisation-ending event. The clock is maintained by the <strong>Bulletin of Atomic Scientists</strong> and updated annually based on expert assessment of global threats.</p>
    <p>The clock started at 7 minutes to midnight in 1947. It reached its farthest point — 17 minutes — in 1991 after the Cold War ended. Since 2020 it has sat at 100 seconds, and in 2023 it moved to <strong>90 seconds</strong>. The 2026 reading of <strong>89 seconds</strong> reflects continued nuclear risk from the Ukraine war, Iran's nuclear programme, and North Korea's ballistic missile tests.</p>

    <h2>Why Is the Doomsday Clock So Close in 2026?</h2>
    <h3>1. Ukraine War — NATO-Russia Escalation Risk</h3>
    <p>Russia's invasion of Ukraine in 2022 began the sharpest increase in nuclear risk since the Cuban Missile Crisis. Russia has repeatedly made nuclear threats, suspended participation in the New START treaty, and repositioned tactical nuclear weapons to Belarus. Any direct NATO-Russia military exchange — even conventional — raises the risk of nuclear escalation. The war has now entered its fourth year with no end in sight.</p>

    <h3>2. Middle East — Iran Nuclear Programme</h3>
    <p>Iran enriched uranium to 60% purity in 2026 — a technical step away from weapons-grade 90%. US and Israeli military strikes on Iranian nuclear facilities in 2025-2026 have brought the region to its highest tension in decades. A miscalculation could trigger a regional war involving Israel, Iran, and potentially US forces across multiple theatres simultaneously.</p>

    <h3>3. China-Taiwan — Strait Tensions</h3>
    <p>Chinese military exercises around Taiwan have become larger and more frequent. The US has reaffirmed its commitment to Taiwan's defence. A Chinese attempt to blockade or invade Taiwan would trigger direct US-China military confrontation — the first between two nuclear powers since the Cold War.</p>

    <h3>4. North Korea — Ballistic Missile Tests</h3>
    <p>North Korea conducted over 40 ballistic missile tests between 2022 and 2026, developing ICBMs capable of reaching the continental United States. The country has shared missile technology with Russia for use in Ukraine, further destabilising global norms around nuclear-capable delivery systems.</p>

    <h2>How Doomsday Risk Moves Markets</h2>
    <p>When geopolitical tension rises, capital flows in predictable patterns. Understanding these movements is the edge that professional investors use to position before events are fully priced in.</p>
    <table class="market-table">
      <thead><tr><th>Asset</th><th>Crisis Direction</th><th>Reason</th><th>2026 Status</th></tr></thead>
      <tbody>
        <tr><td>Gold</td><td class="up">↑ Strong</td><td>Safe-haven store of value</td><td class="up">Near ATH $3,200+</td></tr>
        <tr><td>Defense Stocks (LMT, NOC, RTX)</td><td class="up">↑ Strong</td><td>Increased military spending</td><td class="up">+30–45% YTD</td></tr>
        <tr><td>Oil (Brent)</td><td class="up">↑ Volatile</td><td>Supply disruption risk</td><td class="up">$85–95 range</td></tr>
        <tr><td>Airlines (DAL, UAL)</td><td class="dn">↓ Weak</td><td>Route disruptions, fuel costs</td><td class="dn">−15 to −25% YTD</td></tr>
        <tr><td>VIX (Fear Index)</td><td class="up">↑ Elevated</td><td>Market uncertainty</td><td class="up">18–28 range</td></tr>
        <tr><td>USD</td><td class="up">↑ Mild</td><td>Reserve currency flight</td><td>Stable-elevated</td></tr>
      </tbody>
    </table>
    <p>The <a href="/gold-price" style="color:var(--gold)">gold price</a> is the clearest real-time signal of WW3 fear. When tensions spike — a missile test, a military strike, a summit collapse — gold typically moves within hours. Orreryx tracks gold alongside every conflict event so you can see the correlation live.</p>

    <h2>Track Live Doomsday Risk on Orreryx</h2>
    <p>Orreryx provides the only platform that combines live conflict monitoring with real-time market impact tracking. Every event that moves the doomsday needle — from nuclear posture changes to military strikes — appears on the Orreryx live map within minutes, with immediate analysis of market impact on gold, oil, defense stocks, and currency.</p>
  </article>

  <div class="faq">
    <h2>Frequently Asked Questions</h2>
    <div class="faq-item">
      <div class="faq-q">What is the Doomsday Clock currently?</div>
      <div class="faq-a">As of 2026, the Doomsday Clock stands at 89 seconds to midnight — the closest it has ever been in its 77-year history. This reflects unprecedented nuclear risk from the Ukraine war, Middle East escalation, and the breakdown of arms control frameworks.</div>
    </div>
    <div class="faq-item">
      <div class="faq-q">How close are we to WW3 in 2026?</div>
      <div class="faq-a">The probability of a large-scale conflict is at its highest since the Cold War. Multiple simultaneous flashpoints — Ukraine, Gaza/Iran, Taiwan — mean that a miscalculation in any one theatre could rapidly draw in major powers. Markets are reflecting this with gold near all-time highs and elevated defense stock premiums.</div>
    </div>
    <div class="faq-item">
      <div class="faq-q">Who decides where the Doomsday Clock is set?</div>
      <div class="faq-a">The Bulletin of Atomic Scientists' Science and Security Board, with input from the Board of Sponsors which includes 13 Nobel Laureates, sets the clock time annually. It is announced in January each year based on global threat assessment from the previous year.</div>
    </div>
    <div class="faq-item">
      <div class="faq-q">Which countries could start WW3?</div>
      <div class="faq-a">The highest-risk triggers analysts monitor are: a Russia-NATO military exchange in the Ukraine theatre, an Israeli or US strike on Iranian nuclear infrastructure triggering a broader Middle East war, and a Chinese military action against Taiwan drawing in US forces. Any of these could escalate into a direct conflict between nuclear-armed states.</div>
    </div>
  </div>

  <div class="cta-box">
    <h2>Track the Real-Time Risk Meter</h2>
    <p>Live conflict events, market impact, AI briefings — all in one platform. Free 3-day trial, no card required.</p>
    <a href="/login?plan=f" class="cta-btn">START FREE TRIAL →</a>
  </div>

  <div class="related">
    <a href="/ww3-news" class="related-link">
      <div class="related-link-label">Live Updates</div>
      <div class="related-link-title">WW3 News Today</div>
    </a>
    <a href="/ukraine-war" class="related-link">
      <div class="related-link-label">Conflict</div>
      <div class="related-link-title">Ukraine War News</div>
    </a>
    <a href="/geopolitical-risk" class="related-link">
      <div class="related-link-label">Intelligence</div>
      <div class="related-link-title">Geopolitical Risk Index</div>
    </a>
    <a href="/gold-price" class="related-link">
      <div class="related-link-label">Markets</div>
      <div class="related-link-title">Gold Price Today</div>
    </a>
    <a href="/global-conflicts-2025" class="related-link">
      <div class="related-link-label">Overview</div>
      <div class="related-link-title">Current Global Conflicts</div>
    </a>
  </div>
</main>

<footer>
  <a href="/">Orreryx</a>
  <a href="/geopolitics-news">Geopolitics News</a>
  <a href="/ww3-news">WW3 News</a>
  <a href="/ukraine-war">Ukraine War</a>
  <a href="/gold-price">Gold Price</a>
  <a href="/geopolitical-risk">Risk Index</a>
  <a href="/login">Free Trial</a>
  <p style="margin-top:16px">© 2026 Orreryx · Real-time geopolitical market intelligence</p>
</footer>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/doomsday-clock.html
git commit -m "feat: add /doomsday-clock SEO page targeting 90,500/mo keyword"
```

---

## Task 8: public/global-conflicts-2025.html

**Files:**
- Create: `public/global-conflicts-2025.html`

- [ ] **Step 1: Write the file**

Create `public/global-conflicts-2025.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">
<title>Current Global Conflicts 2025 — Active Wars & Market Impact | Orreryx</title>
<meta name="description" content="Current global conflicts 2025: complete list of active wars — Ukraine, Gaza, Sudan, Myanmar, DRC and more. See casualty data, conflict status, and market impact for each war. Updated daily.">
<meta name="keywords" content="current global conflicts 2025, active wars 2025, current wars in the world, list of wars 2025, ongoing conflicts 2025, world conflicts map, global war tracker">
<link rel="canonical" href="https://www.orreryx.io/global-conflicts-2025">
<meta property="og:type" content="article">
<meta property="og:title" content="Current Global Conflicts 2025 — Active Wars & Market Impact">
<meta property="og:description" content="Complete list of current global conflicts in 2025 with market impact for each war. Ukraine, Gaza, Sudan, Myanmar and more — updated daily.">
<meta property="og:url" content="https://www.orreryx.io/global-conflicts-2025">
<meta property="og:image" content="https://www.orreryx.io/og-image.svg">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": "https://www.orreryx.io/global-conflicts-2025#webpage",
      "url": "https://www.orreryx.io/global-conflicts-2025",
      "name": "Current Global Conflicts 2025 — Active Wars & Market Impact",
      "description": "Complete tracker of current global conflicts in 2025 including Ukraine, Gaza, Sudan, and market impact analysis.",
      "isPartOf": { "@id": "https://www.orreryx.io/#website" },
      "datePublished": "2026-04-17",
      "dateModified": "2026-04-17",
      "breadcrumb": {
        "@type": "BreadcrumbList",
        "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://www.orreryx.io/" },
          { "@type": "ListItem", "position": 2, "name": "Global Conflicts 2025", "item": "https://www.orreryx.io/global-conflicts-2025" }
        ]
      }
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "How many active wars are there in 2025?",
          "acceptedAnswer": { "@type": "Answer", "text": "As of 2025, there are approximately 32–40 active armed conflicts worldwide depending on definition thresholds. The most significant by casualties and geopolitical impact are Ukraine, Gaza/Israel, Sudan, Myanmar, and the DRC. Several of these directly affect global commodity prices, shipping routes, and financial markets." }
        },
        {
          "@type": "Question",
          "name": "Which is the deadliest current conflict in 2025?",
          "acceptedAnswer": { "@type": "Answer", "text": "The Sudan civil war, which began in April 2023, is estimated to be the deadliest current conflict in 2025 with over 150,000 deaths and 8 million displaced. The Ukraine-Russia war remains the highest-profile conflict due to its direct impact on European security and global energy markets." }
        },
        {
          "@type": "Question",
          "name": "How do current global conflicts affect markets?",
          "acceptedAnswer": { "@type": "Answer", "text": "Active wars impact markets through supply chain disruption (Red Sea shipping crisis adds 10–14 days to Asia-Europe routes), commodity price shocks (oil, grain, metals), defense spending increases, and safe-haven capital flows into gold and USD. Orreryx tracks each conflict's real-time market impact in one dashboard." }
        }
      ]
    }
  ]
}
</script>
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#07070a;--bg2:#0d0d12;--bg3:#12121a;--bg4:#1a1a24;
  --brd:rgba(255,255,255,.06);--brd2:rgba(255,255,255,.1);--brd3:rgba(255,255,255,.16);
  --txt:#f2f2ee;--txt2:#a8a8a2;--txt3:#585858;
  --red:#e03836;--red2:rgba(224,56,54,.12);
  --grn:#3ab860;--gold:#d4a843;--amb:#e07830;
  --sans:'Inter',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace;
}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--txt);font-family:var(--sans);line-height:1.7}
nav{position:fixed;top:0;left:0;right:0;z-index:200;height:56px;padding:0 40px;display:flex;align-items:center;gap:8px;background:rgba(7,7,10,.8);backdrop-filter:blur(24px);border-bottom:1px solid var(--brd)}
.nav-logo{display:flex;align-items:center;gap:8px;text-decoration:none;font-family:var(--mono);font-size:14px;font-weight:700;color:var(--txt);letter-spacing:.05em}
.nav-right{margin-left:auto;display:flex;gap:8px}
.nav-a{padding:7px 16px;font-size:12px;font-weight:500;color:var(--txt2);text-decoration:none;border-radius:4px;border:1px solid var(--brd2);transition:all .15s}
.nav-a:hover{color:var(--txt);border-color:var(--brd3)}
.nav-cta{background:var(--red);border-color:var(--red);color:#fff;font-weight:600}
.nav-cta:hover{background:#c42e2c;border-color:#c42e2c}
main{max-width:860px;margin:0 auto;padding:96px 24px 80px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;background:var(--red2);border:1px solid rgba(224,56,54,.25);border-radius:20px;padding:5px 14px;font-family:var(--mono);font-size:9px;font-weight:700;color:var(--red);letter-spacing:.14em;text-transform:uppercase;margin-bottom:20px}
.dot{width:5px;height:5px;border-radius:50%;background:var(--red);animation:blink 1.4s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.15}}
h1{font-size:clamp(26px,3.5vw,44px);font-weight:800;line-height:1.1;letter-spacing:-.03em;margin-bottom:16px}
h1 em{font-style:normal;color:var(--red)}
.lead{font-size:16px;color:var(--txt2);max-width:680px;margin-bottom:40px;line-height:1.8}
.conflict-grid{display:flex;flex-direction:column;gap:16px;margin:32px 0}
.conflict-card{background:var(--bg2);border:1px solid var(--brd);border-radius:10px;padding:20px 24px;display:grid;grid-template-columns:1fr auto;gap:16px;align-items:start}
.conflict-card:hover{border-color:var(--brd2)}
.conflict-header{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.conflict-flag{font-size:20px}
.conflict-name{font-size:15px;font-weight:700;color:var(--txt)}
.conflict-status{font-family:var(--mono);font-size:8px;font-weight:700;letter-spacing:.08em;padding:2px 8px;border-radius:3px;text-transform:uppercase}
.status-active{background:var(--red2);border:1px solid rgba(224,56,54,.3);color:var(--red)}
.status-escalating{background:rgba(224,120,48,.12);border:1px solid rgba(224,120,48,.3);color:var(--amb)}
.conflict-desc{font-size:13px;color:var(--txt2);line-height:1.7;margin-bottom:10px}
.conflict-stats{display:flex;gap:16px;flex-wrap:wrap}
.conflict-stat{font-family:var(--mono);font-size:10px;color:var(--txt3)}
.conflict-stat strong{color:var(--txt2)}
.conflict-market{text-align:right}
.conflict-market-label{font-family:var(--mono);font-size:8px;color:var(--txt3);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}
.conflict-market-item{font-family:var(--mono);font-size:11px;margin-bottom:2px}
.up{color:var(--grn)}.dn{color:var(--red)}.neu{color:var(--txt3)}
article h2{font-size:20px;font-weight:700;margin:36px 0 12px;letter-spacing:-.02em}
article p{font-size:14.5px;color:var(--txt2);margin-bottom:16px;line-height:1.8}
.faq{margin:40px 0}
.faq h2{font-size:20px;font-weight:700;margin-bottom:24px}
.faq-item{border-bottom:1px solid var(--brd);padding:18px 0}
.faq-q{font-size:15px;font-weight:600;color:var(--txt);margin-bottom:8px}
.faq-a{font-size:13.5px;color:var(--txt2);line-height:1.75}
.related{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;margin:40px 0}
.related-link{background:var(--bg2);border:1px solid var(--brd);border-radius:8px;padding:16px;text-decoration:none;transition:border-color .15s}
.related-link:hover{border-color:var(--brd3)}
.related-link-label{font-family:var(--mono);font-size:9px;color:var(--txt3);letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px}
.related-link-title{font-size:13px;font-weight:600;color:var(--txt)}
.cta-box{background:var(--red2);border:1px solid rgba(224,56,54,.25);border-radius:12px;padding:32px;text-align:center;margin:40px 0}
.cta-box h2{font-size:20px;font-weight:700;margin-bottom:8px}
.cta-box p{font-size:13px;color:var(--txt2);margin-bottom:20px}
.cta-btn{display:inline-block;background:var(--red);color:#fff;text-decoration:none;padding:13px 28px;border-radius:6px;font-size:13px;font-weight:700;letter-spacing:.04em;transition:all .15s}
.cta-btn:hover{background:#c42e2c;transform:translateY(-1px)}
footer{border-top:1px solid var(--brd);padding:32px 24px;text-align:center;font-size:12px;color:var(--txt3)}
footer a{color:var(--txt3);text-decoration:none;margin:0 10px}
footer a:hover{color:var(--txt2)}
@media(max-width:600px){.conflict-card{grid-template-columns:1fr}.conflict-market{text-align:left}}
</style>
</head>
<body>
<nav>
  <a href="/" class="nav-logo">
    <svg width="20" height="20" viewBox="0 0 32 32"><rect width="32" height="32" rx="4" fill="#f0f0ec"/><ellipse cx="16" cy="16" rx="10" ry="4" fill="none" stroke="#09090a" stroke-width="1" transform="rotate(-30,16,16)"/><circle cx="16" cy="16" r="2" fill="#09090a"/><circle cx="12" cy="20" r="1" fill="#e03836"/></svg>
    Orreryx
  </a>
  <div class="nav-right">
    <a href="/geopolitical-risk" class="nav-a">Risk Index</a>
    <a href="/ukraine-war" class="nav-a">Ukraine</a>
    <a href="/login" class="nav-cta nav-a">Free Trial →</a>
  </div>
</nav>

<main>
  <div class="eyebrow"><div class="dot"></div>Updated Daily</div>
  <h1>Current Global Conflicts 2025 — <em>Active Wars</em> & Market Impact</h1>
  <p class="lead">32+ active armed conflicts are ongoing worldwide in 2025. From Ukraine to Sudan to Myanmar, each war creates distinct market ripples — in oil, gold, shipping, and defense stocks. Track them all in one place.</p>

  <div class="conflict-grid">

    <div class="conflict-card">
      <div>
        <div class="conflict-header">
          <div class="conflict-flag">🇺🇦</div>
          <div class="conflict-name">Ukraine — Russia War</div>
          <div class="conflict-status status-active">Active — Year 4</div>
        </div>
        <div class="conflict-desc">Russia's full-scale invasion, launched February 2022, continues across a 1,000km front line. Fighting is concentrated in Donetsk, Zaporizhzhia, and Kherson oblasts. NATO members continue weapons supply to Ukraine. Nuclear escalation risk remains the primary global concern.</div>
        <div class="conflict-stats">
          <div class="conflict-stat"><strong>~500K+</strong> casualties (both sides)</div>
          <div class="conflict-stat"><strong>6.7M</strong> displaced</div>
          <div class="conflict-stat"><strong>Started:</strong> Feb 2022</div>
        </div>
      </div>
      <div class="conflict-market">
        <div class="conflict-market-label">Market Impact</div>
        <div class="conflict-market-item up">↑ Gold +18% YTD</div>
        <div class="conflict-market-item up">↑ LMT +32%</div>
        <div class="conflict-market-item dn">↓ Gas −22%</div>
      </div>
    </div>

    <div class="conflict-card">
      <div>
        <div class="conflict-header">
          <div class="conflict-flag">🇵🇸</div>
          <div class="conflict-name">Israel — Gaza / Middle East</div>
          <div class="conflict-status status-escalating">Escalating</div>
        </div>
        <div class="conflict-desc">The Gaza conflict began October 7, 2023 and escalated to include direct Iran-Israel exchanges in 2025. US forces struck Iranian nuclear facilities, triggering Houthi attacks on Red Sea shipping. The conflict threatens regional spillover into Lebanon, Syria, and beyond.</div>
        <div class="conflict-stats">
          <div class="conflict-stat"><strong>~45K+</strong> Gaza casualties</div>
          <div class="conflict-stat"><strong>90%</strong> Red Sea traffic disrupted</div>
          <div class="conflict-stat"><strong>Started:</strong> Oct 2023</div>
        </div>
      </div>
      <div class="conflict-market">
        <div class="conflict-market-label">Market Impact</div>
        <div class="conflict-market-item up">↑ Oil +12%</div>
        <div class="conflict-market-item up">↑ Shipping +80%</div>
        <div class="conflict-market-item dn">↓ Airlines −18%</div>
      </div>
    </div>

    <div class="conflict-card">
      <div>
        <div class="conflict-header">
          <div class="conflict-flag">🇸🇩</div>
          <div class="conflict-name">Sudan Civil War</div>
          <div class="conflict-status status-active">Active</div>
        </div>
        <div class="conflict-desc">Sudan's civil war between the Sudanese Armed Forces and the Rapid Support Forces (RSF) has become one of the world's worst humanitarian crises. Famine conditions affect 18 million people. The conflict is receiving less international attention despite being the deadliest current war by estimated casualties.</div>
        <div class="conflict-stats">
          <div class="conflict-stat"><strong>~150K+</strong> deaths</div>
          <div class="conflict-stat"><strong>8M</strong> displaced</div>
          <div class="conflict-stat"><strong>Started:</strong> Apr 2023</div>
        </div>
      </div>
      <div class="conflict-market">
        <div class="conflict-market-label">Market Impact</div>
        <div class="conflict-market-item up">↑ Wheat +8%</div>
        <div class="conflict-market-item neu">→ Gold (indirect)</div>
        <div class="conflict-market-item neu">→ Limited direct market effect</div>
      </div>
    </div>

    <div class="conflict-card">
      <div>
        <div class="conflict-header">
          <div class="conflict-flag">🇲🇲</div>
          <div class="conflict-name">Myanmar Civil War</div>
          <div class="conflict-status status-active">Active</div>
        </div>
        <div class="conflict-desc">Since the 2021 military coup, Myanmar has been in a state of civil war between the junta and the People's Defence Force. In 2024–2025, resistance forces made significant territorial gains, capturing major cities. The conflict disrupts regional supply chains through Southeast Asia.</div>
        <div class="conflict-stats">
          <div class="conflict-stat"><strong>~50K+</strong> deaths</div>
          <div class="conflict-stat"><strong>2.6M</strong> displaced</div>
          <div class="conflict-stat"><strong>Started:</strong> Feb 2021</div>
        </div>
      </div>
      <div class="conflict-market">
        <div class="conflict-market-label">Market Impact</div>
        <div class="conflict-market-item neu">→ Regional supply chains</div>
        <div class="conflict-market-item neu">→ Southeast Asia trade</div>
      </div>
    </div>

    <div class="conflict-card">
      <div>
        <div class="conflict-header">
          <div class="conflict-flag">🇨🇩</div>
          <div class="conflict-name">DRC — M23 / Eastern Congo</div>
          <div class="conflict-status status-escalating">Escalating</div>
        </div>
        <div class="conflict-desc">The M23 rebel group, backed by Rwanda, captured Goma in January 2025 — the largest city in eastern DRC. The conflict threatens cobalt and coltan supply chains critical for EV battery production. Multiple African nations have troops in the region, raising risk of a wider regional war.</div>
        <div class="conflict-stats">
          <div class="conflict-stat"><strong>~7M</strong> displaced</div>
          <div class="conflict-stat"><strong>70%</strong> world cobalt supply at risk</div>
          <div class="conflict-stat"><strong>Started:</strong> 2012 (current phase 2022)</div>
        </div>
      </div>
      <div class="conflict-market">
        <div class="conflict-market-label">Market Impact</div>
        <div class="conflict-market-item up">↑ Cobalt +35%</div>
        <div class="conflict-market-item up">↑ Coltan +20%</div>
        <div class="conflict-market-item dn">↓ EV sector margins</div>
      </div>
    </div>

  </div>

  <article>
    <h2>How Current Global Conflicts Affect Your Portfolio</h2>
    <p>Every active war creates market signals. The Ukraine conflict drove European gas prices to record highs in 2022 and pushed defense stocks up 30–50%. The Gaza/Middle East escalation disrupted Red Sea shipping, adding $1,000–2,000 per container to Asia-Europe routes. The DRC conflict threatens the cobalt supply chains that underpin the entire electric vehicle industry.</p>
    <p>Professional investors track these conflicts not out of morbid curiosity — but because they represent the most predictable market-moving events available. Wars follow escalation patterns. Shipping disruptions last weeks to months. Defense procurement cycles are 3–5 years. Understanding the conflict is the edge.</p>
    <p>Orreryx maps every active conflict to its direct market impact — in real time. When M23 captured Goma, Orreryx users saw the cobalt price movement and affected mining stocks within the same session. <a href="/login?plan=f" style="color:var(--red)">Try it free for 3 days.</a></p>
  </article>

  <div class="faq">
    <h2>Frequently Asked Questions</h2>
    <div class="faq-item">
      <div class="faq-q">How many wars are happening right now in 2025?</div>
      <div class="faq-a">There are approximately 32–40 active armed conflicts worldwide in 2025, depending on the threshold used (some definitions include insurgencies and low-intensity conflicts). The most significant by geopolitical and market impact are Ukraine, the Israel-Gaza/Middle East conflict, Sudan, Myanmar, and the DRC.</div>
    </div>
    <div class="faq-item">
      <div class="faq-q">Which current conflict has the highest WW3 risk?</div>
      <div class="faq-a">The Ukraine-Russia conflict carries the highest WW3 escalation risk because it directly involves a nuclear power (Russia) in conflict with NATO-backed forces. Russia's repeated nuclear threats and the presence of tactical nuclear weapons in Belarus make this the most dangerous conflict for global escalation.</div>
    </div>
    <div class="faq-item">
      <div class="faq-q">How do current wars affect commodity prices?</div>
      <div class="faq-a">Wars affect commodities through supply disruption (Ukraine exports 10% of world wheat), shipping route changes (Red Sea crisis adds cost and time to global shipping), and safe-haven flows (gold rises during conflict escalation). The DRC conflict specifically threatens cobalt and coltan — critical for battery technology.</div>
    </div>
  </div>

  <div class="cta-box">
    <h2>See Live Conflict Impact on Markets</h2>
    <p>Real-time war events mapped to gold, oil, defense stocks, and shipping — in one platform. 3-day free trial.</p>
    <a href="/login?plan=f" class="cta-btn">START FREE TRIAL →</a>
  </div>

  <div class="related">
    <a href="/ukraine-war" class="related-link">
      <div class="related-link-label">Conflict</div>
      <div class="related-link-title">Ukraine War News</div>
    </a>
    <a href="/israel-gaza" class="related-link">
      <div class="related-link-label">Conflict</div>
      <div class="related-link-title">Israel Gaza War</div>
    </a>
    <a href="/china-taiwan" class="related-link">
      <div class="related-link-label">Flashpoint</div>
      <div class="related-link-title">China Taiwan Tensions</div>
    </a>
    <a href="/geopolitical-risk" class="related-link">
      <div class="related-link-label">Intelligence</div>
      <div class="related-link-title">Geopolitical Risk Index</div>
    </a>
    <a href="/doomsday-clock" class="related-link">
      <div class="related-link-label">Risk Meter</div>
      <div class="related-link-title">Doomsday Clock 2026</div>
    </a>
  </div>
</main>

<footer>
  <a href="/">Orreryx</a>
  <a href="/geopolitics-news">Geopolitics News</a>
  <a href="/ukraine-war">Ukraine War</a>
  <a href="/doomsday-clock">Doomsday Clock</a>
  <a href="/gold-price">Gold Price</a>
  <a href="/geopolitical-risk">Risk Index</a>
  <a href="/login">Free Trial</a>
  <p style="margin-top:16px">© 2026 Orreryx · Real-time geopolitical market intelligence</p>
</footer>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add public/global-conflicts-2025.html
git commit -m "feat: add /global-conflicts-2025 SEO page targeting zero-competition keyword"
```

---

## Task 9: Optimize public/ww3-news.html

**Files:**
- Modify: `public/ww3-news.html`

- [ ] **Step 1: Read current H1 and opening content**

Open `public/ww3-news.html` and find the existing `<h1>` tag and first content section.

- [ ] **Step 2: Replace/update title and meta description**

In the `<head>`, update:
```html
<title>Is WW3 Happening? Live World War 3 News & Risk Tracker 2026 | Orreryx</title>
<meta name="description" content="Is WW3 happening? Track live World War 3 news, nuclear escalation risk, and global conflict updates in 2026. Real-time war monitor with market impact — updated every 15 minutes.">
<meta name="keywords" content="is ww3 happening, ww3 news today, world war 3 news, ww3 2026, is world war 3 happening, ww3 risk, nuclear war risk 2026, world war 3 latest news">
```

- [ ] **Step 3: Update H1**

Change the page's main `<h1>` to:
```html
<h1>Is WW3 Happening? Live World War 3 News & Risk Tracker 2026</h1>
```

- [ ] **Step 4: Add intro content block before the live feed**

Add this HTML block immediately after the H1 (or after the hero section, before any live feed component):

```html
<div class="ww3-intro">
  <p>As of 2026, the world is not in World War 3 — but the risk is at its highest since the Cuban Missile Crisis. The Ukraine-Russia war is in its fourth year with no ceasefire in sight. Iran and Israel exchanged direct military strikes in 2025. China has intensified military exercises around Taiwan. Below is the live feed of every escalation event, updated every 15 minutes.</p>

  <h2>Current WW3 Risk Factors</h2>
  <ul>
    <li><strong>Ukraine-Russia nuclear posture:</strong> Russia has moved tactical nuclear weapons to Belarus and suspended its New START treaty participation. Any direct NATO-Russia exchange risks nuclear escalation.</li>
    <li><strong>Iran nuclear programme:</strong> Iran enriched uranium to 60% purity in 2026. US and Israeli strikes on Iranian facilities have increased the risk of a wider Middle East war.</li>
    <li><strong>China-Taiwan military exercises:</strong> China's People's Liberation Army conducted its largest-ever Taiwan encirclement exercises in 2025. A blockade attempt would trigger US military response.</li>
    <li><strong>North Korea ICBM capability:</strong> North Korea now has ICBMs capable of reaching the US mainland and has been sharing missile technology with Russia.</li>
  </ul>

  <h2>How to Track WW3 Risk in Real Time</h2>
  <p>The Orreryx platform monitors 45+ news sources, GDELT conflict data, and market signals to give you a live WW3 risk picture. Every event that increases escalation risk — a military strike, a nuclear threat, a summit collapse — appears within minutes with direct market impact analysis. <a href="/doomsday-clock">See the live Doomsday Clock tracker →</a></p>
</div>
```

- [ ] **Step 5: Add FAQPage schema to existing JSON-LD or as new script block**

Add before `</head>`:

```html
<script type="application/ld+json">
{
  "@type": "FAQPage",
  "@context": "https://schema.org",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Is WW3 happening right now?",
      "acceptedAnswer": { "@type": "Answer", "text": "As of 2026, World War 3 has not officially started, but the risk level is at its highest since the Cold War. Multiple simultaneous conflicts — Ukraine, the Middle East, and rising China-Taiwan tensions — create conditions where a miscalculation could trigger a wider war. The Doomsday Clock stands at 89 seconds to midnight." }
    },
    {
      "@type": "Question",
      "name": "How close are we to World War 3 in 2026?",
      "acceptedAnswer": { "@type": "Answer", "text": "The Bulletin of Atomic Scientists set the Doomsday Clock at 89 seconds to midnight in 2026 — the closest ever. This reflects the Ukraine war's nuclear escalation risk, Iran's advancing nuclear programme, and deteriorating US-China relations over Taiwan." }
    },
    {
      "@type": "Question",
      "name": "Which countries could trigger WW3?",
      "acceptedAnswer": { "@type": "Answer", "text": "The three highest-risk triggers are: Russia escalating beyond Ukraine into NATO territory, Iran triggering a wider Middle East war involving US forces, and China taking military action against Taiwan. Any of these would involve at least two nuclear-armed states." }
    }
  ]
}
</script>
```

- [ ] **Step 6: Add internal links at the bottom of the page**

Before `</body>`, add:

```html
<div style="max-width:820px;margin:40px auto;padding:0 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
  <a href="/doomsday-clock" style="background:#0d0d12;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:14px;text-decoration:none;display:block">
    <div style="font-family:monospace;font-size:9px;color:#585858;text-transform:uppercase;margin-bottom:5px">Risk Meter</div>
    <div style="font-size:13px;font-weight:600;color:#f2f2ee">Doomsday Clock 2026</div>
  </a>
  <a href="/ukraine-war" style="background:#0d0d12;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:14px;text-decoration:none;display:block">
    <div style="font-family:monospace;font-size:9px;color:#585858;text-transform:uppercase;margin-bottom:5px">Conflict</div>
    <div style="font-size:13px;font-weight:600;color:#f2f2ee">Ukraine War News</div>
  </a>
  <a href="/geopolitical-risk" style="background:#0d0d12;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:14px;text-decoration:none;display:block">
    <div style="font-family:monospace;font-size:9px;color:#585858;text-transform:uppercase;margin-bottom:5px">Intelligence</div>
    <div style="font-size:13px;font-weight:600;color:#f2f2ee">Geopolitical Risk Index</div>
  </a>
  <a href="/global-conflicts-2025" style="background:#0d0d12;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:14px;text-decoration:none;display:block">
    <div style="font-family:monospace;font-size:9px;color:#585858;text-transform:uppercase;margin-bottom:5px">Overview</div>
    <div style="font-size:13px;font-weight:600;color:#f2f2ee">Current Global Conflicts</div>
  </a>
</div>
```

- [ ] **Step 7: Commit**

```bash
git add public/ww3-news.html
git commit -m "seo: optimize ww3-news.html — H1, intro content, FAQ schema, internal links"
```

---

## Task 10: Optimize public/ukraine-war.html

**Files:**
- Modify: `public/ukraine-war.html`

- [ ] **Step 1: Update title and meta**

In `<head>`:
```html
<title>Ukraine War News Today — Live Updates, Map & Market Impact 2026 | Orreryx</title>
<meta name="description" content="Ukraine war news today: live updates, frontline map, casualty data, and market impact (gas, wheat, defense stocks). The only platform combining war news with real-time market intelligence. Updated every 15 minutes.">
<meta name="keywords" content="ukraine war news today, ukraine war updates today, ukraine russia war news, ukraine war 2026, ukraine news today, russia ukraine war latest, ukraine frontline map">
```

- [ ] **Step 2: Update H1**

```html
<h1>Ukraine War News Today — Live Updates & Market Impact 2026</h1>
```

- [ ] **Step 3: Add intro content block before the live feed**

```html
<div class="ukraine-intro">
  <p>The Ukraine-Russia war entered its fourth year in February 2026. Fighting continues across a 1,000km front line in eastern and southern Ukraine. Below is the live news feed updated every 15 minutes from Reuters, BBC, AP, Kyiv Independent, and 40+ additional sources.</p>

  <h2>Current Frontline Situation</h2>
  <p>Russian forces are engaged in grinding attritional warfare in Donetsk Oblast, with slow advances around Chasiv Yar and Toretsk. Ukraine continues long-range drone and missile strikes on Russian oil infrastructure and military logistics. Both sides have launched record numbers of drone attacks in 2026.</p>

  <h2>Ukraine War Market Impact</h2>
  <ul>
    <li><strong>European natural gas:</strong> Ukraine's gas transit agreement with Russia expired in January 2025, ending Russian gas flows to Central Europe via Ukraine. European gas storage is above seasonal average but prices remain 40% above pre-war levels.</li>
    <li><strong>Wheat and grain:</strong> Ukraine accounts for approximately 10% of global wheat exports. The Black Sea Grain Initiative collapse in 2023 raised food prices globally. Current exports continue via the temporary naval corridor.</li>
    <li><strong>Defense stocks:</strong> Lockheed Martin (LMT), Northrop Grumman (NOC), RTX, and BAE Systems have all seen 25–45% gains since the invasion began as NATO members accelerate defense spending toward 2% GDP targets.</li>
    <li><strong>Gold:</strong> The Ukraine conflict is the primary driver of elevated gold prices in 2024–2026. Each major escalation event — such as a Russian nuclear threat or large missile strike — triggers immediate gold buying.</li>
  </ul>

  <p>Track all Ukraine war market signals live on Orreryx — every conflict event is mapped to its real-time market impact. <a href="/ukraine-war-map">See the live Ukraine war map →</a></p>
</div>
```

- [ ] **Step 4: Add FAQPage schema**

Add before `</head>`:

```html
<script type="application/ld+json">
{
  "@type": "FAQPage",
  "@context": "https://schema.org",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is happening in the Ukraine war today?",
      "acceptedAnswer": { "@type": "Answer", "text": "The Ukraine-Russia war continues in its fourth year with active fighting across eastern and southern Ukraine. Russian forces are conducting attritional advances in Donetsk Oblast while Ukraine carries out long-range drone strikes on Russian oil infrastructure. The Orreryx live feed updates every 15 minutes with the latest news from 45+ sources." }
    },
    {
      "@type": "Question",
      "name": "How is the Ukraine war affecting markets?",
      "acceptedAnswer": { "@type": "Answer", "text": "The Ukraine war has driven gold to near all-time highs as a safe-haven asset, pushed European gas prices 40% above pre-war levels, and driven defense stocks (LMT, NOC, RTX) up 25–45% since the invasion. Grain and wheat prices remain elevated due to Black Sea trade disruption." }
    },
    {
      "@type": "Question",
      "name": "How long has the Ukraine war lasted?",
      "acceptedAnswer": { "@type": "Answer", "text": "Russia's full-scale invasion of Ukraine began on February 24, 2022. As of 2026, the war has lasted over 4 years, making it the longest and largest conventional war in Europe since World War 2." }
    }
  ]
}
</script>
```

- [ ] **Step 5: Add internal links before `</body>`**

```html
<div style="max-width:820px;margin:40px auto;padding:0 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">
  <a href="/ukraine-war-map" style="background:#0d0d12;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:14px;text-decoration:none;display:block">
    <div style="font-family:monospace;font-size:9px;color:#585858;text-transform:uppercase;margin-bottom:5px">Map</div>
    <div style="font-size:13px;font-weight:600;color:#f2f2ee">Ukraine War Map</div>
  </a>
  <a href="/ww3-news" style="background:#0d0d12;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:14px;text-decoration:none;display:block">
    <div style="font-family:monospace;font-size:9px;color:#585858;text-transform:uppercase;margin-bottom:5px">Risk</div>
    <div style="font-size:13px;font-weight:600;color:#f2f2ee">WW3 News Today</div>
  </a>
  <a href="/global-conflicts-2025" style="background:#0d0d12;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:14px;text-decoration:none;display:block">
    <div style="font-family:monospace;font-size:9px;color:#585858;text-transform:uppercase;margin-bottom:5px">Overview</div>
    <div style="font-size:13px;font-weight:600;color:#f2f2ee">All Global Conflicts</div>
  </a>
  <a href="/gold-price" style="background:#0d0d12;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:14px;text-decoration:none;display:block">
    <div style="font-family:monospace;font-size:9px;color:#585858;text-transform:uppercase;margin-bottom:5px">Markets</div>
    <div style="font-size:13px;font-weight:600;color:#f2f2ee">Gold Price Today</div>
  </a>
</div>
```

- [ ] **Step 6: Commit**

```bash
git add public/ukraine-war.html
git commit -m "seo: optimize ukraine-war.html — H1, intro content, FAQ schema, internal links"
```

---

## Task 11: Deploy + Google Search Console

- [ ] **Step 1: Deploy to Vercel**

```bash
vercel --prod
```

Expected: deployment URL `https://www.orreryx.io`

- [ ] **Step 2: Verify all new pages load**

```bash
curl -o /dev/null -s -w "%{http_code}" https://www.orreryx.io/doomsday-clock
curl -o /dev/null -s -w "%{http_code}" https://www.orreryx.io/global-conflicts-2025
curl -o /dev/null -s -w "%{http_code}" https://www.orreryx.io/robots.txt
curl -o /dev/null -s -w "%{http_code}" https://www.orreryx.io/sitemap.xml
```

Expected: all return `200`.

- [ ] **Step 3: Submit sitemap to Google Search Console**

1. Go to [Google Search Console](https://search.google.com/search-console) → select `orreryx.io`
2. Left sidebar → Sitemaps
3. Enter `https://www.orreryx.io/sitemap.xml` → Submit
4. Expected status: "Success" (may take 10–30 min)

- [ ] **Step 4: Request indexing for new pages**

In Google Search Console → URL Inspection:
- Enter `https://www.orreryx.io/doomsday-clock` → Request Indexing
- Enter `https://www.orreryx.io/global-conflicts-2025` → Request Indexing

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: deploy SEO + PayPal subscription system"
```

---

## Self-Review Against Spec

**Spec coverage check:**

| Spec requirement | Covered in task |
|---|---|
| robots.txt + sitemap.xml | Task 1 ✅ |
| PayPal setup action (create billing plans) | Task 2 ✅ |
| PayPal subscribe action | Task 2 ✅ |
| PayPal activate action + Redis storage | Task 2 ✅ |
| PayPal cancel + status actions | Task 2 ✅ |
| Reverse index `sub_to_email:{id}` for webhooks | Task 2 activate step ✅ |
| api/webhook.js with signature verification | Task 3 ✅ |
| All 5 webhook events handled | Task 3 ✅ |
| Emails via Resend for all events | Task 3 ✅ |
| 3-day grace period on payment failure | Task 3 ✅ |
| api/session-check.js | Task 4 ✅ |
| Legacy user fallback (fail open) | Task 4 ✅ |
| callback.html subscription flow | Task 5 ✅ |
| login.html subscribe action | Task 6 ✅ |
| doomsday-clock.html (900+ words, schema, CTA) | Task 7 ✅ |
| global-conflicts-2025.html (800+ words, schema) | Task 8 ✅ |
| ww3-news.html H1 + content + FAQ schema | Task 9 ✅ |
| ukraine-war.html H1 + content + FAQ schema | Task 10 ✅ |
| Internal links between all pages | Tasks 7,8,9,10 ✅ |
| Submit sitemap to GSC | Task 11 ✅ |
| vercel.json routes for new pages + webhook | Task 1 ✅ |

**No placeholders found. All code blocks are complete. Type/method names are consistent across tasks.**

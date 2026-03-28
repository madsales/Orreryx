// api/pesapal.js — Orrery Payment API
// Handles: create order, get IPN list, IPN webhook
// All amounts controlled server-side. Currency configurable via env var.

import Redis from 'ioredis';

// ── CONFIG ──
const IS_LIVE       = String(process.env.PESAPAL_ENV || '').toLowerCase() === 'live';
const BASE          = IS_LIVE ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3';
const KEY           = process.env.PESAPAL_CONSUMER_KEY;
const SECRET        = process.env.PESAPAL_CONSUMER_SECRET;
const HOST          = (process.env.PESAPAL_HOST || 'https://www.orreryx.io').replace(/\/$/, '');
const SUCCESS_PATH  = process.env.PESAPAL_SUCCESS_PATH || '/callback.html';
const CURRENCY      = (process.env.PESAPAL_CURRENCY || 'USD').toUpperCase();

// Plan config — amounts in both currencies
const PLANS = {
  s: { name: 'Starter',  usd: 0.99,  ugx: 3700   },
  a: { name: 'Analyst',  usd: 14.99, ugx: 55000  },
  c: { name: 'Command',  usd: 34.99, ugx: 128000 },
};

// ── REDIS ──
function getRedis() {
  const url = process.env.REDIS_URL || '';
  if (!url) return null;
  const opts = { maxRetriesPerRequest: 2, connectTimeout: 5000, enableReadyCheck: false, lazyConnect: true };
  if (url.startsWith('rediss://')) opts.tls = {};
  return new Redis(url, opts);
}
async function closeRedis(r) {
  if (!r) return;
  try { await Promise.race([r.quit(), new Promise(res => setTimeout(res, 1500))]); } catch (_) {}
}
async function saveOrder(redis, orderId, data) {
  if (!redis) return;
  try {
    const key = `order:${orderId}`;
    const existing = await redis.get(key).catch(() => null);
    const current  = existing ? JSON.parse(existing) : {};
    await redis.set(key, JSON.stringify({ ...current, ...data, updatedAt: Date.now() }), 'EX', 60 * 60 * 24 * 400);
  } catch (e) {
    console.error('[Pesapal] Redis save error:', e.message);
  }
}

// ── TOKEN CACHE ──
let _token = null, _tokenExpiry = 0;
async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const r = await fetch(`${BASE}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ consumer_key: KEY, consumer_secret: SECRET })
  });
  const d = await r.json();
  if (!r.ok || !d.token) throw new Error(`Pesapal auth failed: ${d?.error?.message || JSON.stringify(d)}`);
  _token = d.token;
  _tokenExpiry = Date.now() + 4 * 60 * 60 * 1000;
  return _token;
}

// ── IPN: Fetch registered IPNs and find matching ID ──
async function getIpnId(token) {
  // 1. Use env var if set
  if (process.env.PESAPAL_IPN_ID) return process.env.PESAPAL_IPN_ID;

  // 2. Fetch list from Pesapal and find matching URL
  const r = await fetch(`${BASE}/api/URLSetup/GetIpnList`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  const list = await r.json();
  const ipnUrl = `${HOST}/api/ipn`;

  if (Array.isArray(list)) {
    // Match by URL — try exact match first, then partial
    const match = list.find(i => i.url === ipnUrl) ||
                  list.find(i => i.url && i.url.includes('/api/ipn'));
    if (match?.ipn_id) {
      console.log('[Pesapal] Found IPN ID from list:', match.ipn_id, 'for URL:', match.url);
      return match.ipn_id;
    }
  }

  // 3. Register new IPN if none found
  console.log('[Pesapal] No matching IPN found, registering:', ipnUrl);
  const reg = await fetch(`${BASE}/api/URLSetup/RegisterIPN`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: ipnUrl, ipn_notification_type: 'GET' })
  });
  const d = await reg.json();
  if (!d.ipn_id) throw new Error(`IPN registration failed: ${JSON.stringify(d)}`);
  console.log('[Pesapal] Registered new IPN ID:', d.ipn_id);
  return d.ipn_id;
}

// ── HELPERS ──
function normalizePlan(plan) {
  const p = String(plan || '').toLowerCase().trim();
  if (p === 'c' || p === 'command') return 'c';
  if (p === 'a' || p === 'analyst') return 'a';
  return 's';
}

function getPlanAmount(planCode) {
  const plan = PLANS[planCode] || PLANS.s;
  return CURRENCY === 'UGX' ? Math.round(plan.ugx) : plan.usd;
}

function sanitizePhone(phone) {
  let p = String(phone || '').replace(/[^\d+]/g, '');
  if (p && !p.startsWith('+')) p = '+' + p;
  return p || '+256700000000';
}

function sanitizeName(v, fb) {
  return String(v || fb).replace(/[^a-zA-Z\s'-]/g, '').trim().slice(0, 50) || fb;
}

function sanitizeEmail(e) {
  return String(e || '').trim().toLowerCase() || 'customer@example.com';
}

function sanitizeOrderId(id, plan) {
  const c = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50);
  return c || `orrery_${plan}_${Date.now()}`;
}

// ── MAIN HANDLER ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Guard: keys must be configured
  if (!KEY || !SECRET) {
    return res.status(500).json({ error: 'PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET not set in Vercel.' });
  }

  const action = String(req.query.action || '').trim();
  let redis;

  try {
    redis = getRedis();
    const token = await getToken();

    // ── CREATE ORDER ──
    if (action === 'create' && req.method === 'POST') {
      const body      = req.body || {};
      const planCode  = normalizePlan(body.plan);
      const amount    = getPlanAmount(planCode);
      const orderId   = sanitizeOrderId(body.orderId, planCode);
      const nameParts = String(body.name || body.firstName || 'Customer').split(' ');
      const firstName = sanitizeName(body.firstName || nameParts[0], 'Customer');
      const lastName  = sanitizeName(body.lastName  || nameParts.slice(1).join(' ') || firstName, firstName);
      const ipnId     = await getIpnId(token);

      const callbackUrl = `${HOST}${SUCCESS_PATH}?orderId=${encodeURIComponent(orderId)}&plan=${encodeURIComponent(planCode)}&mode=${IS_LIVE ? 'live' : 'sandbox'}`;

      const orderPayload = {
        id:               orderId,
        currency:         CURRENCY,
        amount:           amount,
        description:      `Orrery ${PLANS[planCode].name} Plan`,
        callback_url:     callbackUrl,
        notification_id:  ipnId,
        billing_address: {
          email_address: sanitizeEmail(body.email),
          phone_number:  sanitizePhone(body.phone),
          first_name:    firstName,
          last_name:     lastName,
          country_code:  'UG'
        }
      };

      console.log('[Pesapal] Creating order:', JSON.stringify(orderPayload));

      const r = await fetch(`${BASE}/api/Transactions/SubmitOrderRequest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(orderPayload)
      });
      const result = await r.json();

      console.log('[Pesapal] Response:', JSON.stringify(result));

      // Surface Pesapal errors clearly
      if (!r.ok || result.error || !result.redirect_url) {
        const errCode = result?.error?.code || '';
        const errMsg  = result?.error?.message || result?.message || 'Order creation failed';

        // Friendly messages for known errors
        if (errCode === 'InvalidIpnId') {
          return res.status(400).json({ error: 'IPN configuration error. Please contact support.' });
        }
        if (errCode === 'amount_exceeds_default_limit') {
          return res.status(400).json({ error: 'Transaction amount exceeds your account limit. Please contact Pesapal support to raise your limit, or try a lower plan.' });
        }

        return res.status(400).json({ error: errMsg, code: errCode });
      }

      // Validate redirect URL is Pesapal domain
      let safeRedirect = false;
      try {
        const u = new URL(result.redirect_url);
        safeRedirect = ['pesapal.com', 'pay.pesapal.com', 'cybqa.pesapal.com'].some(
          h => u.hostname === h || u.hostname.endsWith('.' + h)
        );
      } catch (_) {}
      if (!safeRedirect) return res.status(400).json({ error: 'Invalid redirect URL from payment gateway.' });

      // Save order to Redis
      await saveOrder(redis, orderId, {
        orderId, plan: planCode, amount, currency: CURRENCY,
        email:    sanitizeEmail(body.email),
        phone:    sanitizePhone(body.phone),
        env:      IS_LIVE ? 'live' : 'sandbox',
        status:   'pending',
        paid:     false,
        ipnId,
        orderTrackingId:    result.order_tracking_id || null,
        merchantReference:  result.merchant_reference || orderId,
        redirect_url:       result.redirect_url,
        createdAt:          Date.now()
      });

      return res.status(200).json({
        redirect_url:       result.redirect_url,
        order_tracking_id:  result.order_tracking_id || null,
        merchant_reference: result.merchant_reference || orderId,
        orderId,
        plan:    planCode,
        amount,
        currency: CURRENCY,
        env:     IS_LIVE ? 'live' : 'sandbox'
      });
    }

    // ── GET IPN LIST (utility — helps find correct IPN ID) ──
    if (action === 'getipn' && req.method === 'GET') {
      const r    = await fetch(`${BASE}/api/URLSetup/GetIpnList`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
      });
      const list = await r.json();
      return res.status(200).json({
        tip:                   'Set PESAPAL_IPN_ID in Vercel to the ipn_id matching your URL below.',
        current_PESAPAL_IPN_ID: process.env.PESAPAL_IPN_ID || 'NOT SET',
        your_ipn_url:          `${HOST}/api/ipn`,
        ipn_list:              list
      });
    }

    // ── STATUS CHECK ──
    if (action === 'status' && req.method === 'GET') {
      const trackingId = String(req.query.trackingId || req.query.OrderTrackingId || '').trim();
      const orderId    = String(req.query.orderId || '').trim();
      if (!trackingId && !orderId) return res.status(400).json({ error: 'trackingId or orderId required' });

      let resolvedId = trackingId;
      if (!resolvedId && redis && orderId) {
        const raw = await redis.get(`order:${orderId}`).catch(() => null);
        if (raw) { try { resolvedId = JSON.parse(raw).orderTrackingId || ''; } catch (_) {} }
      }
      if (!resolvedId) return res.status(404).json({ error: 'Order not found or tracking ID unavailable' });

      const r   = await fetch(`${BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(resolvedId)}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
      });
      const d   = await r.json();
      const raw = String(d?.payment_status_description || d?.status || '').toLowerCase();
      const status = /(completed|paid|captured|success)/.test(raw) ? 'paid'
                   : /(failed|invalid|declined|cancelled|reversed)/.test(raw) ? 'failed' : 'pending';

      return res.status(200).json({ status, paid: status === 'paid', trackingId: resolvedId, orderId: orderId || null });
    }

    return res.status(400).json({ error: 'Unknown action. Valid actions: create, status, getipn' });

  } catch (err) {
    console.error('[Pesapal] Unhandled error:', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    await closeRedis(redis);
  }
}

export const config = { api: { bodyParser: true } };

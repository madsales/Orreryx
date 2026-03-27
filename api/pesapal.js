import Redis from 'ioredis';

const IS_LIVE = String(process.env.PESAPAL_ENV || '').toLowerCase() === 'live';
const BASE = IS_LIVE
  ? 'https://pay.pesapal.com/v3'
  : 'https://cybqa.pesapal.com/pesapalv3';
const KEY = process.env.PESAPAL_CONSUMER_KEY;
const SECRET = process.env.PESAPAL_CONSUMER_SECRET;

// CRITICAL: Always use the canonical production domain.
// Never fall back to VERCEL_URL (preview deployments) — sessions written
// to a vercel.app subdomain are invisible to orreryx.io (different origin).
const HOST = (process.env.PESAPAL_HOST || 'https://www.orreryx.io').replace(/\/$/, '');

// Point to callback.html — the page that reads the tracking ID and activates the session.
const SUCCESS_PATH = process.env.PESAPAL_SUCCESS_PATH || '/callback.html';

const PLAN_NAMES = { s: 'Starter', a: 'Analyst', c: 'Command' };
const PLAN_PRICES = { s: 0.99, a: 14.99, c: 34.99 };

let cachedToken = null;
let tokenExpiry = 0;

function getRedis() {
  const url = process.env.REDIS_URL || '';
  if (!url) return null;
  const opts = {
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    enableReadyCheck: false,
    lazyConnect: true
  };
  if (url.startsWith('rediss://')) opts.tls = {};
  return new Redis(url, opts);
}

async function closeRedis(redis) {
  if (!redis) return;
  try {
    await Promise.race([
      redis.quit(),
      new Promise(resolve => setTimeout(resolve, 1000))
    ]);
  } catch (_) {}
}

function normalizePlan(plan) {
  const p = String(plan || '').toLowerCase().trim();
  if (p === 's' || p === 'starter') return 's';
  if (p === 'a' || p === 'analyst') return 'a';
  if (p === 'c' || p === 'command') return 'c';
  return 's';
}

function sanitizeOrderId(orderId, planCode) {
  const cleaned = String(orderId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 50);

  if (cleaned) return cleaned;
  return `orrery_${planCode}_${Date.now()}`;
}

function sanitizePhone(phone) {
  let safePhone = String(phone || '').replace(/[^\d+]/g, '');
  if (safePhone && !safePhone.startsWith('+')) safePhone = '+' + safePhone;
  return safePhone || '+256700000000';
}

function sanitizeName(value, fallback) {
  return String(value || fallback)
    .replace(/[^a-zA-Z\s'-]/g, '')
    .trim() || fallback;
}

function sanitizeEmail(email) {
  const v = String(email || '').trim().toLowerCase();
  return v || 'customer@example.com';
}

function buildSuccessUrl(orderId, planCode) {
  const mode = IS_LIVE ? 'live' : 'sandbox';
  return `${HOST}${SUCCESS_PATH}?orderId=${encodeURIComponent(orderId)}&plan=${encodeURIComponent(planCode)}&mode=${mode}`;
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const r = await fetch(`${BASE}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ consumer_key: KEY, consumer_secret: SECRET })
  });

  const d = await r.json();
  if (!r.ok || !d.token) {
    throw new Error('Pesapal auth failed: ' + JSON.stringify(d));
  }

  cachedToken = d.token;
  tokenExpiry = Date.now() + 4 * 60 * 60 * 1000;
  return cachedToken;
}

async function getOrRegisterIPN(token) {
  if (process.env.PESAPAL_IPN_ID) return process.env.PESAPAL_IPN_ID;

  const r = await fetch(`${BASE}/api/URLSetup/RegisterIPN`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      url: `${HOST}/api/ipn`,
      ipn_notification_type: 'GET'
    })
  });

  const d = await r.json();
  if (!r.ok || !d.ipn_id) {
    throw new Error('IPN registration failed: ' + JSON.stringify(d));
  }

  console.log('[Pesapal] IPN registered:', d.ipn_id);
  return d.ipn_id;
}

async function createOrder(token, ipnId, payload) {
  const planCode = normalizePlan(payload.plan);
  const amount = Number.isFinite(Number(payload.amount))
    ? Number(payload.amount)
    : PLAN_PRICES[planCode];
  const orderId = sanitizeOrderId(payload.orderId, planCode);

  const body = {
    id: orderId,
    currency: 'USD',
    amount: Number(amount.toFixed(2)),
    description: `Orrery ${PLAN_NAMES[planCode]} Plan — Monthly`,
    callback_url: buildSuccessUrl(orderId, planCode),
    notification_id: ipnId,
    billing_address: {
      email_address: sanitizeEmail(payload.email),
      phone_number: sanitizePhone(payload.phone),
      first_name: sanitizeName(payload.firstName, 'User'),
      last_name: sanitizeName(payload.lastName, 'NA'),
      country_code: 'UG'
    }
  };

  console.log('[Pesapal] Order request:', JSON.stringify(body));

  const r = await fetch(`${BASE}/api/Transactions/SubmitOrderRequest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  const result = await r.json();
  console.log('[Pesapal] Order response:', JSON.stringify(result));

  if (!r.ok) {
    throw new Error(result.error?.message || result.message || 'Pesapal order creation failed');
  }

  return { result, orderId, planCode, amount: Number(amount.toFixed(2)) };
}

async function getStatus(token, trackingId) {
  const r = await fetch(
    `${BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(trackingId)}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      }
    }
  );

  const d = await r.json();
  if (!r.ok) {
    throw new Error(d.error?.message || d.message || 'Status lookup failed');
  }
  return d;
}

function mapPesapalStatus(statusPayload) {
  const raw = String(
    statusPayload?.payment_status_description ||
    statusPayload?.status ||
    statusPayload?.payment_status ||
    ''
  ).toLowerCase();

  if (/(completed|paid|captured|success)/.test(raw)) return 'paid';
  if (/(failed|invalid|declined|cancelled|canceled|reversed)/.test(raw)) return 'failed';
  return 'pending';
}

async function saveOrder(redis, orderId, patch) {
  if (!redis) return;

  const key = `order:${orderId}`;
  let current = {};
  const existing = await redis.get(key);
  if (existing) {
    try { current = JSON.parse(existing); } catch (_) {}
  }

  const merged = {
    ...current,
    ...patch,
    updatedAt: Date.now()
  };

  await redis.set(key, JSON.stringify(merged), 'EX', 60 * 60 * 24 * 30);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!KEY || !SECRET) {
    return res.status(500).json({
      error: 'Pesapal keys not configured. Set PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET in Vercel.'
    });
  }

  let redis;
  try {
    redis = getRedis();
    const token = await getToken();
    const { action } = req.query;

    if (req.method === 'POST' && action === 'create') {
      const ipnId = await getOrRegisterIPN(token);
      const { result, orderId, planCode, amount } = await createOrder(token, ipnId, req.body || {});

      if (!result.redirect_url) {
        return res.status(400).json({
          error: result.error?.message || result.message || 'Order creation failed',
          detail: result
        });
      }

      await saveOrder(redis, orderId, {
        orderId,
        plan: planCode,
        amount,
        email: sanitizeEmail(req.body?.email),
        phone: sanitizePhone(req.body?.phone),
        env: IS_LIVE ? 'live' : 'sandbox',
        status: 'pending',
        paid: false,
        merchantReference: result.merchant_reference || orderId,
        orderTrackingId: result.order_tracking_id || null,
        redirect_url: result.redirect_url,
        createdAt: Date.now()
      });

      return res.status(200).json({
        redirect_url: result.redirect_url,
        order_tracking_id: result.order_tracking_id || null,
        merchant_reference: result.merchant_reference || orderId,
        orderId,
        plan: planCode,
        env: IS_LIVE ? 'live' : 'sandbox'
      });
    }

    if (req.method === 'GET' && action === 'status') {
      const trackingId = String(req.query.trackingId || '').trim();
      const orderId = String(req.query.orderId || '').trim();

      if (!trackingId && !orderId) {
        return res.status(400).json({ error: 'trackingId or orderId required' });
      }

      let resolvedTrackingId = trackingId;
      if (!resolvedTrackingId && redis && orderId) {
        const raw = await redis.get(`order:${orderId}`);
        if (raw) {
          try {
            const stored = JSON.parse(raw);
            resolvedTrackingId = stored.orderTrackingId || '';
          } catch (_) {}
        }
      }

      if (!resolvedTrackingId) {
        return res.status(404).json({ error: 'Tracking ID not found for this order' });
      }

      const statusPayload = await getStatus(token, resolvedTrackingId);
      const mappedStatus = mapPesapalStatus(statusPayload);

      if (redis && orderId) {
        await saveOrder(redis, orderId, {
          status: mappedStatus,
          paid: mappedStatus === 'paid',
          pesapalStatus: statusPayload
        });
      }

      return res.status(200).json({
        orderId: orderId || null,
        trackingId: resolvedTrackingId,
        status: mappedStatus,
        paid: mappedStatus === 'paid',
        env: IS_LIVE ? 'live' : 'sandbox',
        pesapal: statusPayload
      });
    }

    return res.status(400).json({ error: 'Unknown action. Use ?action=create or ?action=status' });
  } catch (err) {
    console.error('[Pesapal] Error:', err.message);
    return res.status(500).json({ error: err.message });
  } finally {
    await closeRedis(redis);
  }
}

export const config = { api: { bodyParser: true } };
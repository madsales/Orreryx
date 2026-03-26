// api/order-status.js
// Called by the success/callback page after Pesapal redirects back.
// CRITICAL FIX: don't rely on Redis alone (IPN fires async, often after user lands).
// Instead: check Redis first, then fall back to calling Pesapal directly.

import Redis from 'ioredis';

const IS_LIVE = String(process.env.PESAPAL_ENV || '').toLowerCase() === 'live';
const BASE = IS_LIVE
  ? 'https://pay.pesapal.com/v3'
  : 'https://cybqa.pesapal.com/pesapalv3';

const SESSION_SECRET = process.env.SESSION_SECRET || 'orrery-change-me';

function getRedis() {
  const url = process.env.REDIS_URL || '';
  if (!url) return null;
  const opts = { maxRetriesPerRequest: 2, connectTimeout: 5000, enableReadyCheck: false, lazyConnect: true };
  if (url.startsWith('rediss://')) opts.tls = {};
  return new Redis(url, opts);
}

async function closeRedis(r) {
  if (!r) return;
  try { await Promise.race([r.quit(), new Promise(res => setTimeout(res, 1000))]); } catch (_) {}
}

function normalizePlan(plan, orderId) {
  const p = String(plan || '').toLowerCase().trim();
  if (p === 'command' || p === 'c') return 'c';
  if (p === 'analyst'  || p === 'a') return 'a';
  if (p === 'starter'  || p === 's') return 's';
  const parts = String(orderId || '').split('_');
  if (parts.length >= 2 && ['s','a','c'].includes(parts[1])) return parts[1];
  return 's';
}

function generateSessionToken(orderId, plan, email) {
  const payload = [orderId, plan, email || '', SESSION_SECRET].join(':');
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
    h >>>= 0;
  }
  return h.toString(36) + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

let _cachedToken = null;
let _tokenExpiry = 0;
async function getPesapalToken() {
  if (_cachedToken && Date.now() < _tokenExpiry) return _cachedToken;
  const r = await fetch(`${BASE}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      consumer_key:    process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    })
  });
  const d = await r.json();
  if (!r.ok || !d.token) throw new Error('Pesapal auth failed: ' + JSON.stringify(d));
  _cachedToken = d.token;
  _tokenExpiry = Date.now() + 4 * 60 * 60 * 1000;
  return _cachedToken;
}

async function verifyWithPesapal(trackingId) {
  const token = await getPesapalToken();
  const r = await fetch(
    `${BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(trackingId)}`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } }
  );
  const d = await r.json();
  if (!r.ok) throw new Error('GetTransactionStatus failed: ' + JSON.stringify(d));
  return d;
}

function isPaid(d) {
  const raw = String(d?.payment_status_description || d?.status || '').toLowerCase();
  return /(completed|paid|captured|success)/.test(raw) || d?.status_code === 1;
}

function isFailed(d) {
  const raw = String(d?.payment_status_description || d?.status || '').toLowerCase();
  return /(failed|invalid|declined|cancelled|canceled|reversed)/.test(raw);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const orderId    = String(req.query.orderId || '').trim();
  const trackingId = String(
    req.query.OrderTrackingId ||
    req.query.orderTrackingId ||
    req.query.trackingId      || ''
  ).trim();

  if (!orderId && !trackingId) {
    return res.status(400).json({ paid: false, status: 'error', error: 'orderId or trackingId required' });
  }

  let redis;
  try {
    redis = getRedis();

    // ── STEP 1: Check Redis first (fast path — works if IPN already fired) ──
    let stored = null;
    if (redis && orderId) {
      const raw = await redis.get(`order:${orderId}`);
      if (raw) {
        try { stored = JSON.parse(raw); } catch (_) {}
      }
    }

    const plan  = normalizePlan(stored?.plan, orderId);
    const email = stored?.email || '';

    if (stored?.paid === true) {
      const token   = generateSessionToken(orderId, plan, email);
      const expires = Date.now() + 365 * 24 * 60 * 60 * 1000;
      return res.status(200).json({ paid: true, status: 'paid', plan, email, token, expires, source: 'redis', orderId });
    }

    // ── STEP 2: Resolve trackingId ──
    // Pesapal appends OrderTrackingId to the callback URL — use it directly.
    const resolvedTrackingId = trackingId || stored?.orderTrackingId || stored?.trackingId || '';

    if (!resolvedTrackingId) {
      return res.status(200).json({ paid: false, status: 'pending', error: 'Awaiting payment confirmation', orderId, plan });
    }

    // ── STEP 3: Call Pesapal GetTransactionStatus directly ──
    let pesapalData;
    try {
      pesapalData = await verifyWithPesapal(resolvedTrackingId);
    } catch (e) {
      console.error('[order-status] Pesapal verification error:', e.message);
      return res.status(200).json({ paid: false, status: stored?.status || 'pending', error: 'Verification temporarily unavailable', orderId, plan });
    }

    const paid   = isPaid(pesapalData);
    const failed = isFailed(pesapalData);
    const status = paid ? 'paid' : failed ? 'failed' : 'pending';

    // ── STEP 4: Write confirmed status back to Redis ──
    if (redis && orderId) {
      const merged = {
        ...(stored || {}),
        orderId, plan, paid, status,
        orderTrackingId: resolvedTrackingId,
        pesapalStatus: pesapalData,
        updatedAt: Date.now(),
        ...(paid   ? { paidAt:   new Date().toISOString() } : {}),
        ...(failed ? { failedAt: new Date().toISOString() } : {})
      };
      await redis.set(`order:${orderId}`, JSON.stringify(merged), 'EX', 60 * 60 * 24 * 400);
    }

    if (!paid) {
      return res.status(200).json({ paid: false, status, orderId, plan });
    }

    // ── STEP 5: Payment confirmed — return session token ──
    const sessionToken = generateSessionToken(orderId, plan, email);
    const expires      = Date.now() + 365 * 24 * 60 * 60 * 1000;

    return res.status(200).json({ paid: true, status: 'paid', plan, email, token: sessionToken, expires, source: 'pesapal', orderId });

  } catch (e) {
    console.error('[order-status] Error:', e.message);
    return res.status(500).json({ paid: false, status: 'error', error: e.message });
  } finally {
    await closeRedis(redis);
  }
}

// api/order-status.js — Orrery Payment Verification
// Called by callback.html after Pesapal redirects the user back.
// Strategy: check Redis first (fast), then call Pesapal directly (reliable).
// Never relies on IPN firing first — IPN is async and often delayed.

import Redis from 'ioredis';

const IS_LIVE = String(process.env.PESAPAL_ENV || '').toLowerCase() === 'live';
const BASE    = IS_LIVE ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3';
const SECRET  = process.env.SESSION_SECRET || 'orrery-secret-change-me';

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

// ── PLAN — always extract from orderId format orrery_{plan}_{ts} ──
function normalizePlan(plan, orderId) {
  const p = String(plan || '').toLowerCase().trim();
  if (p === 'c' || p === 'command') return 'c';
  if (p === 'a' || p === 'analyst') return 'a';
  if (p === 's' || p === 'starter') return 's';
  // Extract from orderId: orrery_c_1234567890 → 'c'
  const parts = String(orderId || '').split('_');
  if (parts.length >= 2 && ['s', 'a', 'c'].includes(parts[1])) return parts[1];
  console.warn('[order-status] Cannot determine plan from:', { plan, orderId });
  return 's';
}

// ── SESSION TOKEN ──
function generateToken(orderId, plan, email) {
  const seed = [orderId, plan, email || '', SECRET].join(':');
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 0x01000193); h >>>= 0; }
  return h.toString(36) + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// ── PESAPAL TOKEN ──
let _token = null, _tokenExpiry = 0;
async function getPesapalToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const r = await fetch(`${BASE}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ consumer_key: process.env.PESAPAL_CONSUMER_KEY, consumer_secret: process.env.PESAPAL_CONSUMER_SECRET })
  });
  const d = await r.json();
  if (!r.ok || !d.token) throw new Error('Pesapal auth failed: ' + JSON.stringify(d));
  _token = d.token;
  _tokenExpiry = Date.now() + 4 * 60 * 60 * 1000;
  return _token;
}

// ── VERIFY WITH PESAPAL DIRECTLY ──
async function verifyWithPesapal(trackingId) {
  const token = await getPesapalToken();
  const r = await fetch(`${BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(trackingId)}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  const d = await r.json();
  if (!r.ok) throw new Error('GetTransactionStatus failed: ' + JSON.stringify(d));
  return d;
}

function isPaid(d)   { return /(completed|paid|captured|success)/.test(String(d?.payment_status_description || d?.status || '').toLowerCase()) || d?.status_code === 1; }
function isFailed(d) { return /(failed|invalid|declined|cancelled|canceled|reversed)/.test(String(d?.payment_status_description || d?.status || '').toLowerCase()); }

// ── HANDLER ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Read params — Pesapal appends OrderTrackingId and OrderMerchantReference to callback URL
  const orderId    = String(req.query.orderId    || '').trim();
  const trackingId = String(req.query.OrderTrackingId || req.query.orderTrackingId || req.query.trackingId || '').trim();

  if (!orderId && !trackingId) {
    return res.status(400).json({ paid: false, status: 'error', error: 'orderId or trackingId required' });
  }

  let redis;
  try {
    redis = getRedis();

    // ── STEP 1: Check Redis (fast path if IPN already fired) ──
    let stored = null;
    if (redis && orderId) {
      const raw = await redis.get(`order:${orderId}`).catch(() => null);
      if (raw) { try { stored = JSON.parse(raw); } catch (_) {} }
    }

    const plan  = normalizePlan(stored?.plan, orderId);
    const email = stored?.email || '';

    console.log(`[order-status] orderId=${orderId} plan=${plan} stored.paid=${stored?.paid}`);

    // Redis already confirmed paid — return session immediately
    if (stored?.paid === true) {
      const token   = generateToken(orderId, plan, email);
      const expires = Date.now() + 365 * 24 * 60 * 60 * 1000;
      return res.status(200).json({ paid: true, status: 'paid', plan, email, token, expires, source: 'redis', orderId });
    }

    // ── STEP 2: Resolve tracking ID ──
    const resolvedId = trackingId || stored?.orderTrackingId || stored?.trackingId || '';

    if (!resolvedId) {
      // No tracking ID yet — payment may still be in flight
      return res.status(200).json({ paid: false, status: 'pending', error: 'Payment confirmation pending', orderId, plan });
    }

    // ── STEP 3: Call Pesapal GetTransactionStatus directly ──
    let pesapalData;
    try {
      pesapalData = await verifyWithPesapal(resolvedId);
    } catch (e) {
      console.error('[order-status] Pesapal verify error:', e.message);
      // Fall back to Redis status — do not crash
      return res.status(200).json({ paid: false, status: stored?.status || 'pending', error: 'Verification temporarily unavailable', orderId, plan });
    }

    const paid   = isPaid(pesapalData);
    const failed = isFailed(pesapalData);
    const status = paid ? 'paid' : failed ? 'failed' : 'pending';

    console.log(`[order-status] Pesapal says: ${pesapalData?.payment_status_description} → ${status} (plan=${plan})`);

    // ── STEP 4: Update Redis with live status ──
    if (redis && orderId) {
      const merged = {
        ...(stored || {}), orderId, plan, paid, status,
        orderTrackingId: resolvedId,
        pesapalStatus:   pesapalData,
        updatedAt:       Date.now(),
        ...(paid   ? { paidAt:   new Date().toISOString() } : {}),
        ...(failed ? { failedAt: new Date().toISOString() } : {})
      };
      await redis.set(`order:${orderId}`, JSON.stringify(merged), 'EX', 60 * 60 * 24 * 400).catch(e => console.error('Redis write error:', e.message));
    }

    if (!paid) {
      return res.status(200).json({ paid: false, status, orderId, plan });
    }

    // ── STEP 5: Payment confirmed — generate session ──
    const token   = generateToken(orderId, plan, email);
    const expires = Date.now() + 365 * 24 * 60 * 60 * 1000;

    console.log(`[order-status] Payment confirmed! orderId=${orderId} plan=${plan} → session generated`);

    return res.status(200).json({ paid: true, status: 'paid', plan, email, token, expires, source: 'pesapal', orderId });

  } catch (e) {
    console.error('[order-status] Error:', e.message);
    return res.status(500).json({ paid: false, status: 'error', error: e.message });
  } finally {
    await closeRedis(redis);
  }
}

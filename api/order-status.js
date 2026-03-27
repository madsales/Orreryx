// api/order-status.js
// Called by callback.html after Pesapal redirects back.
// Checks Redis first, then calls Pesapal GetTransactionStatus directly.
// Returns { paid, plan, token, expires } so callback.html can write the session.

import Redis from 'ioredis';

const IS_LIVE = String(process.env.PESAPAL_ENV || '').toLowerCase() === 'live';
const BASE = IS_LIVE
  ? 'https://pay.pesapal.com/v3'
  : 'https://cybqa.pesapal.com/pesapalv3';

const SESSION_SECRET = process.env.SESSION_SECRET || 'orrery-change-me';

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

async function closeRedis(r) {
  if (!r) return;
  try {
    await Promise.race([r.quit(), new Promise(res => setTimeout(res, 1000))]);
  } catch (_) {}
}

// ── CRITICAL: Extract plan from orderId FIRST, then Redis, then default ──
// orderId format is always: orrery_{plan}_{timestamp}
// e.g. orrery_c_1774611276824 → plan = 'c'
function normalizePlan(plan, orderId) {
  // 1. Try the plan value from Redis directly
  const p = String(plan || '').toLowerCase().trim();
  if (p === 'command' || p === 'c') return 'c';
  if (p === 'analyst'  || p === 'a') return 'a';
  if (p === 'starter'  || p === 's') return 's';

  // 2. Extract from orderId format: orrery_a_1234567890
  const parts = String(orderId || '').split('_');
  if (parts.length >= 2 && ['s', 'a', 'c'].includes(parts[1])) {
    return parts[1];
  }

  // 3. Try the plan URL param embedded in orderId differently
  // Some older orders: orrery_analyst_timestamp or orrery_command_timestamp
  if (parts.length >= 2) {
    const word = parts[1].toLowerCase();
    if (word === 'command') return 'c';
    if (word === 'analyst')  return 'a';
    if (word === 'starter')  return 's';
  }

  // 4. Never default to 's' without checking — log and use 's' as last resort
  console.warn('[order-status] Could not determine plan from:', { plan, orderId });
  return 's';
}

// Generate a session token tied to orderId + plan + secret
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

// ── PESAPAL TOKEN ──
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

// ── CALL PESAPAL GetTransactionStatus DIRECTLY ──
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

  // orderId always in URL — Pesapal also appends OrderTrackingId
  const orderId    = String(req.query.orderId    || '').trim();
  const trackingId = String(
    req.query.OrderTrackingId ||
    req.query.orderTrackingId ||
    req.query.trackingId      || ''
  ).trim();

  if (!orderId && !trackingId) {
    return res.status(400).json({
      paid: false, status: 'error', error: 'orderId or trackingId required'
    });
  }

  let redis;
  try {
    redis = getRedis();

    // ── STEP 1: Check Redis ──
    let stored = null;
    if (redis && orderId) {
      const raw = await redis.get(`order:${orderId}`);
      if (raw) {
        try { stored = JSON.parse(raw); } catch (_) {}
      }
    }

    // Extract plan — ALWAYS try orderId extraction, not just Redis
    // This is the critical fix: orderId contains the plan the user selected
    const plan  = normalizePlan(stored?.plan, orderId);
    const email = stored?.email || '';

    console.log('[order-status] orderId:', orderId, '→ plan:', plan, '(stored.plan:', stored?.plan, ')');

    // Fast path: Redis already confirmed paid
    if (stored?.paid === true) {
      const token   = generateSessionToken(orderId, plan, email);
      const expires = Date.now() + 365 * 24 * 60 * 60 * 1000;
      return res.status(200).json({
        paid: true, status: 'paid', plan, email, token, expires,
        source: 'redis', orderId
      });
    }

    // ── STEP 2: Resolve trackingId ──
    const resolvedTrackingId = trackingId ||
                               stored?.orderTrackingId ||
                               stored?.trackingId || '';

    if (!resolvedTrackingId) {
      return res.status(200).json({
        paid: false, status: 'pending',
        error: 'Awaiting payment confirmation — no tracking ID yet',
        orderId, plan
      });
    }

    // ── STEP 3: Call Pesapal GetTransactionStatus directly ──
    let pesapalData;
    try {
      pesapalData = await verifyWithPesapal(resolvedTrackingId);
    } catch (e) {
      console.error('[order-status] Pesapal verify error:', e.message);
      return res.status(200).json({
        paid: false, status: stored?.status || 'pending',
        error: 'Verification temporarily unavailable — try again shortly',
        orderId, plan
      });
    }

    const paid   = isPaid(pesapalData);
    const failed = isFailed(pesapalData);
    const status = paid ? 'paid' : failed ? 'failed' : 'pending';

    // ── STEP 4: Write confirmed status back to Redis ──
    if (redis && orderId) {
      const merged = {
        ...(stored || {}),
        orderId,
        plan,        // always write the correct plan
        paid,
        status,
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

    // ── STEP 5: Payment confirmed — return session token with CORRECT plan ──
    const sessionToken = generateSessionToken(orderId, plan, email);
    const expires      = Date.now() + 365 * 24 * 60 * 60 * 1000;

    console.log('[order-status] Payment confirmed. orderId:', orderId, 'plan:', plan);

    return res.status(200).json({
      paid: true, status: 'paid',
      plan,   // ← this is what gets written to localStorage
      email,
      token: sessionToken,
      expires,
      source: 'pesapal',
      orderId
    });

  } catch (e) {
    console.error('[order-status] Error:', e.message);
    return res.status(500).json({ paid: false, status: 'error', error: e.message });
  } finally {
    await closeRedis(redis);
  }
}

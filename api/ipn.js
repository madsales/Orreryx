import Redis from 'ioredis';

const IS_LIVE = String(process.env.PESAPAL_ENV || '').toLowerCase() === 'live';
const BASE = IS_LIVE
  ? 'https://pay.pesapal.com/v3'
  : 'https://cybqa.pesapal.com/pesapalv3';

function getRedis() {
  const url = process.env.REDIS_URL || '';
  if (!url) throw new Error('REDIS_URL is not configured');

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

async function getPesapalToken() {
  const r = await fetch(`${BASE}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    })
  });

  const d = await r.json();
  if (!r.ok || !d.token) throw new Error('Auth failed: ' + JSON.stringify(d));
  return d.token;
}

function normalizePlan(plan, orderId = '') {
  const p = String(plan || '').toLowerCase().trim();
  if (p === 'command' || p === 'c') return 'c';
  if (p === 'analyst' || p === 'a') return 'a';
  if (p === 'starter' || p === 's') return 's';

  const parts = String(orderId).split('_');
  if (parts.length >= 2 && ['s', 'a', 'c'].includes(parts[1].toLowerCase())) {
    return parts[1].toLowerCase();
  }

  const byPosition = String(orderId).charAt(6).toLowerCase();
  if (['s', 'a', 'c'].includes(byPosition)) return byPosition;

  return 's';
}

function mapPesapalStatus(statusPayload) {
  const raw = String(
    statusPayload?.payment_status_description ||
    statusPayload?.payment_status_code ||
    statusPayload?.payment_status ||
    statusPayload?.status ||
    statusPayload?.status_code ||
    ''
  ).toLowerCase();

  if (/(completed|paid|captured|success)/.test(raw) || statusPayload?.status_code === 1) return 'paid';
  if (/(failed|invalid|declined|cancelled|canceled|reversed)/.test(raw)) return 'failed';
  return 'pending';
}

async function getStatus(token, orderTrackingId) {
  const r = await fetch(
    `${BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(orderTrackingId)}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      }
    }
  );

  const d = await r.json();
  if (!r.ok) throw new Error('Status lookup failed: ' + JSON.stringify(d));
  return d;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const orderTrackingId = String(req.query.orderTrackingId || req.query.OrderTrackingId || '').trim();
  const orderMerchantReference = String(req.query.orderMerchantReference || req.query.OrderMerchantReference || '').trim();

  if (!orderTrackingId) {
    return res.status(400).send('Missing orderTrackingId');
  }

  let redis;
  try {
    redis = getRedis();
    const token = await getPesapalToken();
    const pesapalStatus = await getStatus(token, orderTrackingId);
    const mappedStatus = mapPesapalStatus(pesapalStatus);

    const ref = orderMerchantReference || pesapalStatus?.merchant_reference || '';
    if (ref) {
      const key = `order:${ref}`;
      let existing = {};
      const raw = await redis.get(key);
      if (raw) {
        try { existing = JSON.parse(raw); } catch (_) {}
      }

      const plan = normalizePlan(existing.plan, ref);
      const merged = {
        ...existing,
        orderId: existing.orderId || ref,
        plan,
        env: existing.env || (IS_LIVE ? 'live' : 'sandbox'),
        orderTrackingId,
        trackingId: orderTrackingId,
        merchantReference: ref,
        paid: mappedStatus === 'paid',
        status: mappedStatus,
        pesapalStatus,
        amount: pesapalStatus?.amount ?? existing.amount ?? null,
        currency: pesapalStatus?.currency ?? existing.currency ?? 'USD',
        updatedAt: Date.now(),
        ...(mappedStatus === 'paid'
          ? { paidAt: existing.paidAt || new Date().toISOString() }
          : {}),
        ...(mappedStatus === 'failed'
          ? { failedAt: new Date().toISOString() }
          : {})
      };

      await redis.set(key, JSON.stringify(merged), 'EX', 60 * 60 * 24 * 400);
      console.log('[IPN] Payment status recorded:', ref, mappedStatus);
    } else {
      console.warn('[IPN] Missing merchant reference for tracking ID:', orderTrackingId);
    }

    return res.status(200).json({
      orderNotificationType: 'IPNCHANGE',
      orderTrackingId,
      orderMerchantReference,
      status: 200
    });
  } catch (e) {
    console.error('[IPN] Error:', e.message);
    return res.status(500).json({ error: e.message });
  } finally {
    await closeRedis(redis);
  }
}
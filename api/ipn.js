// api/ipn.js — Pesapal Instant Payment Notification Handler
// Pesapal calls this URL when payment status changes.
// Updates Redis with payment status so order-status.js can confirm quickly.

import Redis from 'ioredis';

const IS_LIVE = String(process.env.PESAPAL_ENV || '').toLowerCase() === 'live';
const BASE    = IS_LIVE ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3';

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

function normalizePlan(plan, orderId) {
  const p = String(plan || '').toLowerCase().trim();
  if (p === 'c' || p === 'command') return 'c';
  if (p === 'a' || p === 'analyst') return 'a';
  if (p === 's' || p === 'starter') return 's';
  const parts = String(orderId || '').split('_');
  if (parts.length >= 2 && ['s', 'a', 'c'].includes(parts[1])) return parts[1];
  return 's';
}

function mapStatus(d) {
  const raw = String(d?.payment_status_description || d?.payment_status || d?.status || '').toLowerCase();
  if (/(completed|paid|captured|success)/.test(raw) || d?.status_code === 1) return 'paid';
  if (/(failed|invalid|declined|cancelled|canceled|reversed)/.test(raw)) return 'failed';
  return 'pending';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // Pesapal sends GET with these params
  const trackingId = String(req.query.OrderTrackingId || req.query.orderTrackingId || '').trim();
  const merchantRef = String(req.query.OrderMerchantReference || req.query.orderMerchantReference || '').trim();

  if (!trackingId) {
    console.warn('[IPN] Missing orderTrackingId');
    return res.status(400).send('Missing orderTrackingId');
  }

  let redis;
  try {
    redis = getRedis();

    // Get Pesapal token
    const authR = await fetch(`${BASE}/api/Auth/RequestToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ consumer_key: process.env.PESAPAL_CONSUMER_KEY, consumer_secret: process.env.PESAPAL_CONSUMER_SECRET })
    });
    const authD = await authR.json();
    if (!authD.token) throw new Error('IPN auth failed: ' + JSON.stringify(authD));

    // Get transaction status from Pesapal
    const statusR = await fetch(`${BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(trackingId)}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${authD.token}` }
    });
    const statusD = await statusR.json();
    const status  = mapStatus(statusD);
    const ref     = merchantRef || statusD?.merchant_reference || '';

    console.log(`[IPN] trackingId=${trackingId} ref=${ref} status=${status}`);

    // Update Redis
    if (redis && ref) {
      const key = `order:${ref}`;
      const raw = await redis.get(key).catch(() => null);
      let existing = {};
      if (raw) { try { existing = JSON.parse(raw); } catch (_) {} }

      const plan = normalizePlan(existing.plan, ref);
      await redis.set(key, JSON.stringify({
        ...existing,
        orderId:          existing.orderId || ref,
        plan,
        paid:             status === 'paid',
        status,
        orderTrackingId:  trackingId,
        merchantReference: ref,
        pesapalStatus:    statusD,
        env:              IS_LIVE ? 'live' : 'sandbox',
        updatedAt:        Date.now(),
        ...(status === 'paid'   ? { paidAt:   new Date().toISOString() } : {}),
        ...(status === 'failed' ? { failedAt: new Date().toISOString() } : {})
      }), 'EX', 60 * 60 * 24 * 400);

      console.log(`[IPN] Redis updated: ref=${ref} plan=${plan} status=${status}`);
    }

    // Pesapal expects 200 — must respond quickly
    return res.status(200).json({ orderNotificationType: 'IPNCHANGE', orderTrackingId: trackingId, orderMerchantReference: merchantRef, status: 200 });

  } catch (e) {
    console.error('[IPN] Error:', e.message);
    // Still return 200 to Pesapal — otherwise it will retry indefinitely
    return res.status(200).json({ status: 200, error: e.message });
  } finally {
    await closeRedis(redis);
  }
}

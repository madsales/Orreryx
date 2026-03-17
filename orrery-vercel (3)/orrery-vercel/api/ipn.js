import Redis from 'ioredis';

const IS_LIVE = process.env.PESAPAL_ENV === 'live';
const BASE    = IS_LIVE ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3';

function getRedis() {
  const url = process.env.REDIS_URL || '';
  const opts = {
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    enableReadyCheck: false,
    lazyConnect: true,
  };
  // Only enable TLS if URL uses rediss://
  if (url.startsWith('rediss://')) opts.tls = {};
  return new Redis(url, opts);
}

async function closeRedis(redis) {
  try { await Promise.race([redis.quit(), new Promise(r => setTimeout(r, 1000))]); } catch(_) {}
}

async function getPesapalToken() {
  const r = await fetch(`${BASE}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ consumer_key: process.env.PESAPAL_CONSUMER_KEY, consumer_secret: process.env.PESAPAL_CONSUMER_SECRET }),
  });
  const d = await r.json();
  return d.token;
}

export default async function handler(req, res) {
  const { orderTrackingId, orderMerchantReference } = req.query;
  if (!orderTrackingId) return res.status(400).send('Missing orderTrackingId');

  const redis = getRedis();
  try {
    const token = await getPesapalToken();
    const statusRes = await fetch(
      `${BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
      { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } }
    );
    const status = await statusRes.json();

    if (status.payment_status_code === 1 || status.status_code === 1) {
      const parts = (orderMerchantReference || '').split('_');
      const plan  = parts[1] || 'starter';
      await redis.set(
        `order:${orderMerchantReference}`,
        JSON.stringify({ plan, trackingId: orderTrackingId, paidAt: new Date().toISOString(), status: 'PAID' }),
        'EX', 60 * 60 * 24 * 365
      );
    }

    return res.status(200).json({ orderNotificationType: 'IPNCHANGE', orderTrackingId, orderMerchantReference, status: 200 });
  } catch(e) {
    console.error('IPN error:', e.message);
    return res.status(500).json({ error: e.message });
  } finally {
    await closeRedis(redis);
  }
}

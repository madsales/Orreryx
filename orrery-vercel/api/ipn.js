import { createClient } from 'redis';

const IS_LIVE = process.env.PESAPAL_ENV === 'live';
const BASE = IS_LIVE ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3';
const KEY    = process.env.PESAPAL_CONSUMER_KEY;
const SECRET = process.env.PESAPAL_CONSUMER_SECRET;

async function getRedis() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  return client;
}

async function getToken() {
  const r = await fetch(`${BASE}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ consumer_key: KEY, consumer_secret: SECRET })
  });
  const d = await r.json();
  return d.token;
}

export default async function handler(req, res) {
  const { orderTrackingId, orderMerchantReference } = req.query;
  if (!orderTrackingId) return res.status(400).send('Missing orderTrackingId');

  let redis;
  try {
    const token = await getToken();

    const statusRes = await fetch(
      `${BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
      { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } }
    );
    const status = await statusRes.json();
    console.log('IPN received:', { orderTrackingId, orderMerchantReference, status });

    if (status.payment_status_code === 1 || status.status_code === 1) {
      const parts = (orderMerchantReference || '').split('_');
      const plan = parts[1] || 'starter';

      redis = await getRedis();
      await redis.set(
        `order:${orderMerchantReference}`,
        JSON.stringify({ plan, trackingId: orderTrackingId, paidAt: new Date().toISOString(), status: 'PAID' }),
        { EX: 60 * 60 * 24 * 365 } // 1 year
      );
      console.log(`Order ${orderMerchantReference} marked as PAID — plan: ${plan}`);
    }

    return res.status(200).json({
      orderNotificationType: 'IPNCHANGE',
      orderTrackingId,
      orderMerchantReference,
      status: 200
    });
  } catch (err) {
    console.error('IPN error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (redis) await redis.quit();
  }
}

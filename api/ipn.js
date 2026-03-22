import Redis from 'ioredis';

const IS_LIVE = process.env.PESAPAL_ENV === 'live';
const BASE    = IS_LIVE ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3';

function getRedis() {
  const url = process.env.REDIS_URL || '';
  if (!url) throw new Error('REDIS_URL not configured');
  const opts = { maxRetriesPerRequest: 2, connectTimeout: 5000, enableReadyCheck: false, lazyConnect: true };
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
    body: JSON.stringify({ 
      consumer_key: process.env.PESAPAL_CONSUMER_KEY, 
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET 
    }),
  });
  const d = await r.json();
  if (!d.token) throw new Error('Auth failed: ' + JSON.stringify(d));
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
    console.log('[IPN] Status for', orderTrackingId, ':', JSON.stringify(status));

    // Pesapal payment_status_code can be string "COMPLETED" or numeric codes
    const isPaid = 
      status.payment_status_code === 'COMPLETED' ||
      status.payment_status_code === 1 ||
      status.status_code === 1;

    if (isPaid) {
      const ref = orderMerchantReference || '';
      // orderId format: orrery_s_timestamp or orrerys1234 (sanitized)
      // Extract plan from position 6 (after 'orrery') or split on '_'
      const byUnderscore = ref.split('_')[1];
      const byPosition   = ref.charAt(6);
      const planChar = (['s','a','c'].includes(byUnderscore) ? byUnderscore : null)
                    || (['s','a','c'].includes(byPosition)   ? byPosition   : 's');

      const planNames = { s: 'Starter', a: 'Analyst', c: 'Command' };
      await redis.set(
        `order:${ref}`,
        JSON.stringify({ 
          plan: planChar,
          planName: planNames[planChar] || 'Starter',
          trackingId: orderTrackingId, 
          paidAt: new Date().toISOString(), 
          status: 'PAID',
          amount: status.amount,
          currency: status.currency
        }),
        'EX', 60 * 60 * 24 * 400  // 400 days
      );
      console.log('[IPN] Payment recorded:', ref, 'plan:', planChar);
    }

    // Pesapal requires this exact response format
    return res.status(200).json({ 
      orderNotificationType: 'IPNCHANGE', 
      orderTrackingId, 
      orderMerchantReference, 
      status: 200 
    });

  } catch(e) {
    console.error('[IPN] Error:', e.message);
    return res.status(500).json({ error: e.message });
  } finally {
    await closeRedis(redis);
  }
}

const IS_LIVE = process.env.PESAPAL_ENV === 'live';
const BASE = IS_LIVE
  ? 'https://pay.pesapal.com/v3'
  : 'https://cybqa.pesapal.com/pesapalv3';

const KEY    = process.env.PESAPAL_CONSUMER_KEY;
const SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function getToken() {
  const r = await fetch(`${BASE}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ consumer_key: KEY, consumer_secret: SECRET })
  });
  const d = await r.json();
  return d.token;
}

async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) return;
  await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(value)
  });
}

export default async function handler(req, res) {
  // Pesapal sends GET with orderTrackingId and orderMerchantReference
  const { orderTrackingId, orderMerchantReference } = req.query;

  if (!orderTrackingId) {
    return res.status(400).send('Missing orderTrackingId');
  }

  try {
    const token = await getToken();

    // Verify the payment status with Pesapal
    const statusRes = await fetch(
      `${BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`
        }
      }
    );
    const status = await statusRes.json();

    console.log('IPN received:', { orderTrackingId, orderMerchantReference, status });

    // payment_status_code 1 = COMPLETED
    if (status.payment_status_code === 1 || status.status_code === 1) {
      // orderMerchantReference format: "orrery_{plan}_{orderId}"
      const parts = (orderMerchantReference || '').split('_');
      const plan = parts[1] || 'starter';

      // Store in Vercel KV: key = orderId, value = { plan, trackingId, paidAt }
      await kvSet(`order:${orderMerchantReference}`, {
        plan,
        trackingId: orderTrackingId,
        paidAt: new Date().toISOString(),
        status: 'PAID'
      });

      console.log(`Order ${orderMerchantReference} marked as PAID — plan: ${plan}`);
    }

    // Pesapal requires a 200 response with specific body
    return res.status(200).json({
      orderNotificationType: 'IPNCHANGE',
      orderTrackingId,
      orderMerchantReference,
      status: 200
    });
  } catch (err) {
    console.error('IPN error:', err);
    return res.status(500).json({ error: err.message });
  }
}

const IS_LIVE = process.env.PESAPAL_ENV === 'live';
const BASE = IS_LIVE
  ? 'https://pay.pesapal.com/v3'
  : 'https://cybqa.pesapal.com/pesapalv3';

const KEY    = process.env.PESAPAL_CONSUMER_KEY;
const SECRET = process.env.PESAPAL_CONSUMER_SECRET;
const HOST   = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3000';

// Cache token in memory for its lifetime
let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const r = await fetch(`${BASE}/api/Auth/RequestToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ consumer_key: KEY, consumer_secret: SECRET })
  });
  const d = await r.json();
  if (!d.token) throw new Error('Pesapal auth failed: ' + JSON.stringify(d));
  cachedToken = d.token;
  tokenExpiry = Date.now() + (d.expiryDate ? new Date(d.expiryDate) - Date.now() : 4 * 60 * 60 * 1000);
  return cachedToken;
}

async function registerIPN(token) {
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
  return d.ipn_id;
}

async function submitOrder(token, ipnId, { plan, amount, email, phone, firstName, lastName, orderId }) {
  const r = await fetch(`${BASE}/api/Transactions/SubmitOrderRequest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      id: orderId,
      currency: 'UGX',
      amount: amount,
      description: `Orrery ${plan} Plan`,
      callback_url: `${HOST}/success.html?order=${orderId}`,
      notification_id: ipnId,
      billing_address: {
        email_address: email,
        phone_number: phone,
        first_name: firstName,
        last_name: lastName
      }
    })
  });
  return await r.json();
}

async function getStatus(token, orderTrackingId) {
  const r = await fetch(
    `${BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${orderTrackingId}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      }
    }
  );
  return await r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!KEY || !SECRET) {
    return res.status(500).json({ error: 'Pesapal keys not configured in Vercel env vars' });
  }

  try {
    const token = await getToken();
    const { action } = req.query;

    // POST /api/pesapal?action=create — create a new order
    if (req.method === 'POST' && action === 'create') {
      const ipnId = await registerIPN(token);
      const result = await submitOrder(token, ipnId, req.body);
      return res.status(200).json(result);
    }

    // GET /api/pesapal?action=status&trackingId=xxx — check payment status
    if (req.method === 'GET' && action === 'status') {
      const { trackingId } = req.query;
      if (!trackingId) return res.status(400).json({ error: 'trackingId required' });
      const status = await getStatus(token, trackingId);
      return res.status(200).json(status);
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Pesapal error:', err);
    return res.status(500).json({ error: err.message });
  }
}

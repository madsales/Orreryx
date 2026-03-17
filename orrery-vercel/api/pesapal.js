const IS_LIVE = process.env.PESAPAL_ENV === 'live';
const BASE    = IS_LIVE ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3';
const KEY     = process.env.PESAPAL_CONSUMER_KEY;
const SECRET  = process.env.PESAPAL_CONSUMER_SECRET;
const IPN_ID  = process.env.PESAPAL_IPN_ID; // set this after registering IPN in Pesapal dashboard

// Use your actual domain
const HOST = process.env.PESAPAL_HOST || 'https://orreryx.io';

// Cache auth token in memory
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
  tokenExpiry = Date.now() + 4 * 60 * 60 * 1000; // 4 hours
  return cachedToken;
}

async function getOrRegisterIPN(token) {
  // Use stored IPN ID if available
  if (IPN_ID) return IPN_ID;
  // Otherwise auto-register
  const r = await fetch(`${BASE}/api/URLSetup/RegisterIPN`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: `${HOST}/api/ipn`, ipn_notification_type: 'GET' })
  });
  const d = await r.json();
  return d.ipn_id;
}

async function createOrder(token, ipnId, { plan, amount, email, phone, firstName, lastName, orderId }) {
  const planNames = { a: 'Analyst', c: 'Command', s: 'Starter' };
  const r = await fetch(`${BASE}/api/Transactions/SubmitOrderRequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      id: orderId,
      currency: 'USD',
      amount: parseFloat(amount),
      description: `Orrery ${planNames[plan] || plan} Plan — Monthly`,
      callback_url: `${HOST}/success?order=${orderId}&plan=${plan}`,
      notification_id: ipnId,
      billing_address: {
        email_address: email,
        phone_number: phone,
        first_name: firstName || 'User',
        last_name: lastName || '',
        country_code: 'UG'
      }
    })
  });
  return await r.json();
}

async function getStatus(token, trackingId) {
  const r = await fetch(
    `${BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${trackingId}`,
    { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } }
  );
  return await r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!KEY || !SECRET) {
    return res.status(500).json({ error: 'Pesapal keys not set. Add PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET to Vercel env vars.' });
  }

  try {
    const token = await getToken();
    const { action } = req.query;

    // Create payment order
    if (req.method === 'POST' && action === 'create') {
      const ipnId = await getOrRegisterIPN(token);
      const result = await createOrder(token, ipnId, req.body);
      if (!result.redirect_url) {
        console.error('Pesapal order failed:', result);
        return res.status(400).json({ error: result.error?.message || 'Order creation failed', detail: result });
      }
      return res.status(200).json(result);
    }

    // Check payment status
    if (req.method === 'GET' && action === 'status') {
      const { trackingId } = req.query;
      if (!trackingId) return res.status(400).json({ error: 'trackingId required' });
      const status = await getStatus(token, trackingId);
      return res.status(200).json(status);
    }

    return res.status(400).json({ error: 'Unknown action. Use ?action=create or ?action=status' });

  } catch (err) {
    console.error('Pesapal handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };

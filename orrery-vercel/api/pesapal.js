const IS_LIVE = process.env.PESAPAL_ENV === 'live';
const BASE    = IS_LIVE ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3';
const KEY     = process.env.PESAPAL_CONSUMER_KEY;
const SECRET  = process.env.PESAPAL_CONSUMER_SECRET;
const HOST    = process.env.PESAPAL_HOST || 'https://orreryx.io';

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
  tokenExpiry = Date.now() + 4 * 60 * 60 * 1000;
  return cachedToken;
}

async function getOrRegisterIPN(token) {
  const stored = process.env.PESAPAL_IPN_ID;
  if (stored) return stored;
  const r = await fetch(`${BASE}/api/URLSetup/RegisterIPN`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: `${HOST}/api/ipn`, ipn_notification_type: 'GET' })
  });
  const d = await r.json();
  if (!d.ipn_id) throw new Error('IPN registration failed: ' + JSON.stringify(d));
  return d.ipn_id;
}

async function createOrder(token, ipnId, { plan, amount, email, phone, firstName, lastName, orderId }) {
  const planNames = { a: 'Analyst', c: 'Command', s: 'Starter' };

  // Sanitise orderId — alphanumeric only, max 50 chars
  const safeOrderId = orderId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 50);

  // Sanitise phone — ensure it has country code, strip non-digits except leading +
  let safePhone = (phone || '').replace(/[^\d+]/g, '');
  if (safePhone && !safePhone.startsWith('+')) safePhone = '+' + safePhone;
  if (!safePhone) safePhone = '+256700000000'; // fallback

  // Sanitise names — no special chars, must not be empty
  const safeFirst = (firstName || 'User').replace(/[^a-zA-Z\s]/g, '').trim() || 'User';
  const safeLast  = (lastName  || 'N/A').replace(/[^a-zA-Z\s]/g, '').trim()  || 'NA';

  const body = {
    id: safeOrderId,
    currency: 'USD',
    amount: parseFloat(parseFloat(amount).toFixed(2)),
    description: `Orrery ${planNames[plan] || plan} Plan Monthly`,
    callback_url: `${HOST}/success?order=${safeOrderId}&plan=${plan}`,
    notification_id: ipnId,
    billing_address: {
      email_address: email,
      phone_number: safePhone,
      first_name: safeFirst,
      last_name: safeLast,
      country_code: 'UG'
    }
  };

  console.log('Pesapal order request:', JSON.stringify(body));

  const r = await fetch(`${BASE}/api/Transactions/SubmitOrderRequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  const result = await r.json();
  console.log('Pesapal order response:', JSON.stringify(result));
  return result;
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
    return res.status(500).json({ error: 'Pesapal keys not configured in Vercel environment variables.' });
  }

  try {
    const token = await getToken();
    const { action } = req.query;

    if (req.method === 'POST' && action === 'create') {
      const ipnId = await getOrRegisterIPN(token);
      const result = await createOrder(token, ipnId, req.body);
      if (!result.redirect_url) {
        return res.status(400).json({
          error: result.error?.message || result.message || 'Order creation failed',
          detail: result
        });
      }
      return res.status(200).json(result);
    }

    if (req.method === 'GET' && action === 'status') {
      const { trackingId } = req.query;
      if (!trackingId) return res.status(400).json({ error: 'trackingId required' });
      const status = await getStatus(token, trackingId);
      return res.status(200).json(status);
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Pesapal error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };

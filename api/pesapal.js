const IS_LIVE = process.env.PESAPAL_ENV === 'live';
const BASE    = IS_LIVE ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3';
const KEY     = process.env.PESAPAL_CONSUMER_KEY;
const SECRET  = process.env.PESAPAL_CONSUMER_SECRET;
const HOST    = process.env.PESAPAL_HOST || 'https://orreryx.vercel.app';

const PLAN_NAMES  = { s: 'Starter', a: 'Analyst', c: 'Command' };
const PLAN_PRICES = { s: 0.99, a: 14.99, c: 34.99 };

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
  if (process.env.PESAPAL_IPN_ID) return process.env.PESAPAL_IPN_ID;
  const r = await fetch(`${BASE}/api/URLSetup/RegisterIPN`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: `${HOST}/api/ipn`, ipn_notification_type: 'GET' })
  });
  const d = await r.json();
  if (!d.ipn_id) throw new Error('IPN registration failed: ' + JSON.stringify(d));
  console.log('IPN registered:', d.ipn_id, '— set PESAPAL_IPN_ID env var to cache this');
  return d.ipn_id;
}

async function createOrder(token, ipnId, { plan, amount, email, phone, firstName, lastName, orderId }) {
  // Sanitise — allow letters, digits, underscore, hyphen
  const safeOrderId = orderId.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 50);

  // Sanitise phone
  let safePhone = (phone || '').replace(/[^\d+]/g, '');
  if (safePhone && !safePhone.startsWith('+')) safePhone = '+' + safePhone;
  if (!safePhone) safePhone = '+256700000000';

  const safeFirst = (firstName || 'User').replace(/[^a-zA-Z\s]/g, '').trim() || 'User';
  const safeLast  = (lastName  || 'NA').replace(/[^a-zA-Z\s]/g, '').trim()  || 'NA';

  // Resolve plan and amount
  const planCode   = ['s','a','c'].includes(plan) ? plan : 's';
  const planAmount = amount || PLAN_PRICES[planCode] || 0.99;

  const body = {
    id: safeOrderId,
    currency: 'USD',
    amount: parseFloat(parseFloat(planAmount).toFixed(2)),
    description: `Orrery ${PLAN_NAMES[planCode] || 'Starter'} Plan — Monthly`,
    callback_url: `${HOST}/success?order=${safeOrderId}&plan=${planCode}`,
    notification_id: ipnId,
    billing_address: {
      email_address: email,
      phone_number: safePhone,
      first_name: safeFirst,
      last_name: safeLast,
      country_code: 'UG'
    }
  };

  console.log('[Pesapal] Order request:', JSON.stringify(body));
  const r = await fetch(`${BASE}/api/Transactions/SubmitOrderRequest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  const result = await r.json();
  console.log('[Pesapal] Order response:', JSON.stringify(result));
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
    return res.status(500).json({ 
      error: 'Pesapal keys not configured. Set PESAPAL_CONSUMER_KEY and PESAPAL_CONSUMER_SECRET in Vercel.' 
    });
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

    return res.status(400).json({ error: 'Unknown action. Use ?action=create or ?action=status' });

  } catch (err) {
    console.error('[Pesapal] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };

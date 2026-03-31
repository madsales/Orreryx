// api/paypal.js — Orrery PayPal Payment Handler
// Handles: create order (redirects to PayPal), capture after user approves

import crypto from 'crypto';

const IS_LIVE    = String(process.env.PAYPAL_ENV || '').toLowerCase() === 'live';
const BASE       = IS_LIVE ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const CLIENT_ID  = process.env.PAYPAL_CLIENT_ID;
const SECRET     = process.env.PAYPAL_CLIENT_SECRET;
const HOST       = (process.env.APP_HOST || process.env.PESAPAL_HOST || 'https://www.orreryx.io').replace(/\/$/, '');

const PLANS = {
  s: { name: 'Starter',  usd: 0.99  },
  a: { name: 'Analyst',  usd: 14.99 },
  c: { name: 'Command',  usd: 34.99 },
};

// ── ACCESS TOKEN CACHE ──
let _token = null, _tokenExpiry = 0;
async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const d = await r.json();
  if (!r.ok || !d.access_token) throw new Error(`PayPal auth failed: ${d?.error_description || JSON.stringify(d)}`);
  _token = d.access_token;
  _tokenExpiry = Date.now() + (d.expires_in - 60) * 1000;
  return _token;
}

function normalizePlan(plan) {
  const p = String(plan || '').toLowerCase().trim();
  if (p === 'c' || p === 'command') return 'c';
  if (p === 'a' || p === 'analyst') return 'a';
  return 's';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!CLIENT_ID || !SECRET) {
    return res.status(500).json({ error: 'PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are not set in Vercel environment variables.' });
  }

  const action = String(req.query.action || '').trim();

  try {
    const accessToken = await getAccessToken();

    // ── CREATE ORDER — returns PayPal approval URL ──
    if (action === 'create' && req.method === 'POST') {
      const body     = req.body || {};
      const planCode = normalizePlan(body.plan);
      const plan     = PLANS[planCode];
      const orderId  = String(body.orderId || `orrery_${planCode}_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 50);

      const returnUrl = `${HOST}/callback.html?orderId=${encodeURIComponent(orderId)}&plan=${encodeURIComponent(planCode)}`;
      const cancelUrl = `${HOST}/login?plan=${encodeURIComponent(planCode)}&cancelled=1`;

      const r = await fetch(`${BASE}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'PayPal-Request-Id': orderId,
        },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{
            reference_id: orderId,
            description: `Orrery ${plan.name} Plan`,
            amount: { currency_code: 'USD', value: plan.usd.toFixed(2) },
          }],
          application_context: {
            brand_name: 'Orrery',
            landing_page: 'BILLING',
            user_action: 'PAY_NOW',
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        }),
      });

      const result = await r.json();
      console.log('[PayPal] Create order:', result.id, result.status);

      if (!r.ok || result.status !== 'CREATED') {
        const msg = result?.details?.[0]?.description || result?.message || 'Order creation failed';
        return res.status(400).json({ error: msg });
      }

      const approveLink = result.links?.find(l => l.rel === 'approve')?.href;
      if (!approveLink) return res.status(400).json({ error: 'PayPal did not return an approval URL.' });

      return res.status(200).json({
        redirect_url: approveLink,
        paypal_order_id: result.id,
        orderId,
        plan: planCode,
        amount: plan.usd,
        currency: 'USD',
        env: IS_LIVE ? 'live' : 'sandbox',
      });
    }

    // ── CAPTURE PAYMENT — called after user approves on PayPal ──
    if (action === 'capture' && req.method === 'POST') {
      const paypalOrderId = String(req.body?.paypalOrderId || '').trim();
      if (!paypalOrderId) return res.status(400).json({ error: 'paypalOrderId is required' });

      const r = await fetch(`${BASE}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const result = await r.json();
      console.log('[PayPal] Capture:', result.id, result.status);

      if (!r.ok) {
        const msg = result?.details?.[0]?.description || result?.message || `Capture failed (${r.status})`;
        return res.status(r.status).json({ error: msg });
      }

      if (result.status !== 'COMPLETED') {
        return res.status(400).json({ error: `Payment not completed. Status: ${result.status}` });
      }

      // Extract our orderId from the purchase unit reference_id
      const refId    = result.purchase_units?.[0]?.reference_id || '';
      const match    = refId.match(/^orrery_([sac])_/);
      const planCode = match ? match[1] : normalizePlan(req.body?.plan);
      const email    = result.payer?.email_address || '';
      const token    = crypto.randomBytes(32).toString('hex');
      const expires  = Date.now() + 365 * 24 * 60 * 60 * 1000;

      console.log(`[PayPal] Payment confirmed — orderId=${refId} plan=${planCode} email=${email}`);

      return res.status(200).json({
        paid:          true,
        status:        'paid',
        plan:          planCode,
        email,
        token,
        expires,
        orderId:       refId,
        paypalOrderId: result.id,
      });
    }

    return res.status(400).json({ error: 'Unknown action. Valid actions: create, capture' });

  } catch (err) {
    console.error('[PayPal] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };

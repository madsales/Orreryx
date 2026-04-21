// api/paypal.js — Orrery PayPal Subscriptions Handler
// Actions: setup, subscribe, activate, cancel, status

const IS_LIVE   = String(process.env.PAYPAL_ENV || '').toLowerCase() === 'live';
const BASE      = IS_LIVE ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const SECRET    = process.env.PAYPAL_CLIENT_SECRET;
const HOST      = (process.env.APP_HOST || process.env.PESAPAL_HOST || 'https://www.orreryx.io').replace(/\/$/, '');

const PLAN_META = {
  s: { name: 'Starter', usd: 0.99,  envKey: 'PAYPAL_PLAN_ID_S' },
  a: { name: 'Analyst', usd: 14.99, envKey: 'PAYPAL_PLAN_ID_A' },
  c: { name: 'Command', usd: 34.99, envKey: 'PAYPAL_PLAN_ID_C' },
};

// ── Redis helpers ─────────────────────────────────────────────────────────────
const R_URL   = process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(...cmd) {
  const r = await fetch(R_URL, {
    method:  'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmd),
  });
  return (await r.json()).result;
}

async function redisPipe(cmds) {
  const r = await fetch(`${R_URL}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmds),
  });
  return (await r.json()).map(x => x.result);
}

// ── PayPal token cache ────────────────────────────────────────────────────────
let _tok = null, _tokExp = 0;
async function ppToken() {
  if (_tok && Date.now() < _tokExp) return _tok;
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:  'Basic ' + Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`PayPal auth: ${d.error_description || JSON.stringify(d)}`);
  _tok    = d.access_token;
  _tokExp = Date.now() + (d.expires_in - 60) * 1000;
  return _tok;
}

function normPlan(p) {
  p = String(p || '').toLowerCase().trim();
  if (p === 'c' || p === 'command') return 'c';
  if (p === 'a' || p === 'analyst') return 'a';
  return 's';
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!CLIENT_ID || !SECRET)
    return res.status(500).json({ error: 'PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET not set' });

  const action = String(req.query.action || '').trim();

  try {
    const tok = await ppToken();

    // ── SETUP (run once as admin to create billing plans) ─────────────────────
    if (action === 'setup' && req.method === 'GET') {
      const adminPwd = process.env.ADMIN_PASSWORD;
      const auth     = (req.headers.authorization || '').replace('Bearer ', '').trim();
      if (!adminPwd || auth !== adminPwd)
        return res.status(401).json({ error: 'Unauthorized' });

      const out = {};
      for (const [code, meta] of Object.entries(PLAN_META)) {
        // 1. Create product
        const pr = await fetch(`${BASE}/v1/catalogs/products`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body:    JSON.stringify({ name: `Orrery ${meta.name}`, type: 'SERVICE', category: 'SOFTWARE' }),
        });
        const prod = await pr.json();
        if (!pr.ok) { out[code] = { error: prod.message }; continue; }

        // 2. Create billing plan
        const br = await fetch(`${BASE}/v1/billing/plans`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body:    JSON.stringify({
            product_id: prod.id,
            name:       `Orrery ${meta.name} Monthly`,
            status:     'ACTIVE',
            billing_cycles: [{
              frequency:      { interval_unit: 'MONTH', interval_count: 1 },
              tenure_type:    'REGULAR',
              sequence:       1,
              total_cycles:   0,
              pricing_scheme: { fixed_price: { value: meta.usd.toFixed(2), currency_code: 'USD' } },
            }],
            payment_preferences: {
              auto_bill_outstanding:     true,
              setup_fee_failure_action:  'CANCEL',
              payment_failure_threshold: 3,
            },
          }),
        });
        const plan = await br.json();
        out[code] = br.ok
          ? { product_id: prod.id, plan_id: plan.id, set_env: `${meta.envKey}=${plan.id}` }
          : { error: plan.message };
      }
      return res.status(200).json({ results: out, next: 'Copy each plan_id to Vercel env vars then redeploy' });
    }

    // ── SUBSCRIBE — create subscription, return PayPal approval URL ───────────
    if (action === 'subscribe' && req.method === 'POST') {
      const { email, plan: planInput } = req.body || {};
      if (!email) return res.status(400).json({ error: 'email required' });
      const code   = normPlan(planInput);
      const meta   = PLAN_META[code];
      const planId = process.env[meta.envKey];
      if (!planId) return res.status(500).json({ error: `${meta.envKey} not set in Vercel env vars` });

      const returnUrl = `${HOST}/callback.html?plan=${code}&email=${encodeURIComponent(email)}&mode=sub`;
      const cancelUrl = `${HOST}/login?plan=${code}&cancelled=1`;

      const r = await fetch(`${BASE}/v1/billing/subscriptions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body:    JSON.stringify({
          plan_id:    planId,
          subscriber: { email_address: email },
          application_context: {
            brand_name:          'Orrery',
            locale:              'en-US',
            shipping_preference: 'NO_SHIPPING',
            user_action:         'SUBSCRIBE_NOW',
            return_url:          returnUrl,
            cancel_url:          cancelUrl,
          },
        }),
      });
      const sub = await r.json();
      if (!r.ok) return res.status(400).json({ error: sub.message || 'Subscription creation failed' });

      const approveLink = sub.links?.find(l => l.rel === 'approve')?.href;
      if (!approveLink) return res.status(400).json({ error: 'No approval URL returned by PayPal' });

      return res.status(200).json({ approval_url: approveLink, subscription_id: sub.id });
    }

    // ── ACTIVATE — called after PayPal redirects user back ────────────────────
    if (action === 'activate' && req.method === 'POST') {
      const { subscription_id, email, plan: planInput } = req.body || {};
      if (!subscription_id || !email)
        return res.status(400).json({ error: 'subscription_id and email are required' });

      // Verify with PayPal that subscription is ACTIVE
      const r = await fetch(`${BASE}/v1/billing/subscriptions/${subscription_id}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const sub = await r.json();
      if (!r.ok || sub.status !== 'ACTIVE')
        return res.status(400).json({ error: `Subscription not active. PayPal status: ${sub.status}` });

      const code   = normPlan(planInput);
      const nextMs = sub.billing_info?.next_billing_time
        ? new Date(sub.billing_info.next_billing_time).getTime()
        : Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Store subscription data + reverse index for webhook lookups
      await redisPipe([
        ['SET', `user:${email}:plan`,                    code],
        ['SET', `user:${email}:sub_id`,                  subscription_id],
        ['SET', `user:${email}:sub_status`,              'active'],
        ['SET', `user:${email}:sub_expires`,             String(nextMs)],
        ['SET', `sub_to_email:${subscription_id}`,       email],
      ]);

      // Analytics
      await redisPipe([
        ['INCR', 'analytics:payment:total'],
        ['HINCRBY', 'analytics:revenue_count', code, '1'],
      ]);

      return res.status(200).json({ ok: true, plan: code, email, subscription_id });
    }

    // ── CANCEL ────────────────────────────────────────────────────────────────
    if (action === 'cancel' && req.method === 'POST') {
      const { email } = req.body || {};
      if (!email) return res.status(400).json({ error: 'email required' });

      const subId = await redis('GET', `user:${email}:sub_id`);
      if (!subId) return res.status(404).json({ error: 'No subscription found for this email' });

      const r = await fetch(`${BASE}/v1/billing/subscriptions/${subId}/cancel`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body:    JSON.stringify({ reason: 'User requested cancellation' }),
      });

      // 422 = already cancelled — treat as success
      if (!r.ok && r.status !== 422) {
        const err = await r.json();
        return res.status(400).json({ error: err.message || 'Cancel failed' });
      }

      await redis('SET', `user:${email}:sub_status`, 'cancelled');
      return res.status(200).json({ ok: true });
    }

    // ── STATUS ────────────────────────────────────────────────────────────────
    if (action === 'status' && req.method === 'GET') {
      const { email } = req.query;
      if (!email) return res.status(400).json({ error: 'email required' });

      const [plan, subId, status, expires] = await redisPipe([
        ['GET', `user:${email}:plan`],
        ['GET', `user:${email}:sub_id`],
        ['GET', `user:${email}:sub_status`],
        ['GET', `user:${email}:sub_expires`],
      ]);

      return res.status(200).json({
        plan,
        sub_id:  subId,
        status,
        expires: expires ? parseInt(expires) : null,
      });
    }

    return res.status(400).json({ error: 'Unknown action. Valid: setup, subscribe, activate, cancel, status' });

  } catch (err) {
    console.error('[PayPal]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export const config = { api: { bodyParser: true } };

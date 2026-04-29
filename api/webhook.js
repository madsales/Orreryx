// api/webhook.js — PayPal + Meta webhook handler
// Validates PayPal signature, updates Redis, sends emails via Resend
// Also handles Meta (Facebook/Instagram) webhook verification & events

// ── META WEBHOOK HANDLER ─────────────────────────────────────────────────────
async function handleMetaWebhook(req, res) {
  if (req.method === 'GET') {
    const mode      = req.query['hub.mode'];
    const challenge = req.query['hub.challenge'];
    const token     = req.query['hub.verify_token'];
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (!verifyToken) return res.status(500).send('META_WEBHOOK_VERIFY_TOKEN not set');
    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[MetaWebhook] Verification successful');
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(challenge);
    }
    console.error('[MetaWebhook] Verification failed', { mode, token });
    return res.status(403).send('Verification failed');
  }
  if (req.method === 'POST') {
    const body = req.body;
    console.log('[MetaWebhook] Event:', JSON.stringify(body)?.substring(0, 200));
    if (body?.object === 'instagram') {
      for (const entry of (body.entry || [])) {
        for (const change of (entry.changes || [])) {
          if (change.field === 'mentions') console.log('[MetaWebhook] Mention:', JSON.stringify(change.value));
          if (change.field === 'comments') console.log('[MetaWebhook] Comment:', JSON.stringify(change.value));
        }
      }
    }
    return res.status(200).json({ received: true });
  }
  return res.status(405).end();
}

const IS_LIVE    = String(process.env.PAYPAL_ENV || '').toLowerCase() === 'live';
const BASE       = IS_LIVE ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const CLIENT_ID  = process.env.PAYPAL_CLIENT_ID;
const SECRET     = process.env.PAYPAL_CLIENT_SECRET;
const WEBHOOK_ID = process.env.PAYPAL_WEBHOOK_ID;
const R_URL      = process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN    = process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM       = process.env.EMAIL_FROM || 'Orrery <onboarding@resend.dev>';
const HOST       = (process.env.APP_HOST || process.env.PESAPAL_HOST || 'https://www.orreryx.io').replace(/\/$/, '');

async function redis(...cmd) {
  if (!R_URL || !R_TOKEN) return null;
  const r = await fetch(R_URL, {
    method:  'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmd),
  });
  return (await r.json()).result;
}

async function redisPipe(cmds) {
  if (!R_URL || !R_TOKEN) return [];
  const r = await fetch(`${R_URL}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmds),
  });
  return (await r.json()).map(x => x.result);
}

async function ppToken() {
  const r = await fetch(`${BASE}/v1/oauth2/token`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization:  'Basic ' + Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  return (await r.json()).access_token;
}

async function verifySig(req) {
  if (!WEBHOOK_ID) return true; // skip verification in sandbox/dev
  try {
    const tok = await ppToken();
    const r = await fetch(`${BASE}/v1/notifications/verify-webhook-signature`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      body:    JSON.stringify({
        auth_algo:         req.headers['paypal-auth-algo'],
        cert_url:          req.headers['paypal-cert-url'],
        transmission_id:   req.headers['paypal-transmission-id'],
        transmission_sig:  req.headers['paypal-transmission-sig'],
        transmission_time: req.headers['paypal-transmission-time'],
        webhook_id:        WEBHOOK_ID,
        webhook_event:     req.body,
      }),
    });
    return (await r.json()).verification_status === 'SUCCESS';
  } catch (e) {
    console.error('[Webhook] sig verify error:', e.message);
    return false;
  }
}

function emailHtml(title, body, ctaText, ctaUrl) {
  return `<div style="background:#09090b;color:#f0f0ec;padding:40px;max-width:480px;margin:0 auto;border:1px solid rgba(255,255,255,.1);border-radius:8px;font-family:'Helvetica Neue',sans-serif">
  <div style="margin-bottom:24px"><strong style="font-size:16px">⊕ Orrery</strong></div>
  <div style="font-size:20px;font-weight:700;margin-bottom:12px">${title}</div>
  <div style="font-size:13px;color:#a0a09a;line-height:1.7;margin-bottom:24px">${body}</div>
  ${ctaText ? `<a href="${ctaUrl}" style="display:block;background:#f0f0ec;color:#09090b;text-decoration:none;text-align:center;padding:14px;border-radius:4px;font-weight:700;font-size:13px">${ctaText}</a>` : ''}
  <div style="margin-top:24px;font-size:11px;color:#484844">© 2026 Orrery · orreryx.io</div>
</div>`;
}

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY || !to) return;
  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from: FROM, to: [to], subject, html }),
  }).catch(e => console.error('[Webhook] email error:', e.message));
}

export default async function handler(req, res) {
  // Route Meta webhook requests
  if ((req.url || '').includes('/meta-webhook')) return handleMetaWebhook(req, res);

  if (req.method !== 'POST') return res.status(405).end();

  const valid = await verifySig(req);
  if (!valid) {
    console.error('[Webhook] Invalid PayPal signature — rejected');
    return res.status(401).json({ error: 'Invalid PayPal signature' });
  }

  const eventType = req.body?.event_type || '';
  const resource  = req.body?.resource   || {};
  const subId     = resource.id || resource.billing_agreement_id || '';
  console.log('[Webhook]', eventType, subId);

  // Look up email via reverse index stored on activate
  const email = subId ? await redis('GET', `sub_to_email:${subId}`) : null;

  try {
    // ── Subscription activated ───────────────────────────────────────────────
    if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      if (email) await redis('SET', `user:${email}:sub_status`, 'active');
    }

    // ── Subscription cancelled ───────────────────────────────────────────────
    if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
      if (email) {
        await redis('SET', `user:${email}:sub_status`, 'cancelled');
        await sendEmail(
          email,
          'Your Orrery subscription has been cancelled',
          emailHtml(
            'Subscription Cancelled',
            'Your Orrery subscription has ended. You can re-subscribe at any time to regain full access.',
            'RE-SUBSCRIBE →', `${HOST}/login`
          )
        );
      }
    }

    // ── Subscription suspended (payment failed after retries) ────────────────
    if (eventType === 'BILLING.SUBSCRIPTION.SUSPENDED') {
      if (email) {
        const graceUntil = Date.now() + 3 * 24 * 60 * 60 * 1000;
        await redisPipe([
          ['SET', `user:${email}:sub_status`,  'suspended'],
          ['SET', `user:${email}:grace_until`, String(graceUntil)],
        ]);
        await sendEmail(
          email,
          'Orrery — payment issue, 3 days to resolve',
          emailHtml(
            "We couldn't charge your PayPal",
            'Your payment failed after 3 attempts. You still have <strong>3 days of access</strong>. Please update your PayPal payment method to keep your subscription active.',
            'UPDATE PAYMENT →', 'https://www.paypal.com/myaccount/autopay/'
          )
        );
      }
    }

    // ── Payment completed (monthly renewal success) ───────────────────────────
    if (eventType === 'PAYMENT.SALE.COMPLETED') {
      const amount   = resource.amount?.total    || '';
      const currency = resource.amount?.currency || 'USD';
      const nextMs   = Date.now() + 30 * 24 * 60 * 60 * 1000;

      if (email) {
        const plan      = await redis('GET', `user:${email}:plan`);
        const planNames = { s: 'Starter', a: 'Analyst', c: 'Command' };
        await redisPipe([
          ['SET', `user:${email}:sub_status`,  'active'],
          ['SET', `user:${email}:sub_expires`, String(nextMs)],
          ['DEL', `user:${email}:grace_until`],
        ]);
        await sendEmail(
          email,
          `Orrery — payment confirmed ${currency} ${amount}`,
          emailHtml(
            'Payment Confirmed ✓',
            `Your <strong>${planNames[plan] || 'Orrery'}</strong> subscription has been renewed.<br><br>Amount: <strong>${currency} ${amount}</strong><br>Next billing: <strong>${new Date(nextMs).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>`,
            'OPEN ORRERY →', `${HOST}/app-v2.html`
          )
        );
      }
      await redis('INCR', 'analytics:payment:total');
    }

    // ── Payment denied ────────────────────────────────────────────────────────
    if (eventType === 'PAYMENT.SALE.DENIED') {
      if (email) {
        const graceUntil = Date.now() + 3 * 24 * 60 * 60 * 1000;
        await redisPipe([
          ['SET', `user:${email}:sub_status`,  'suspended'],
          ['SET', `user:${email}:grace_until`, String(graceUntil)],
        ]);
        await sendEmail(
          email,
          'Orrery — payment failed, action required',
          emailHtml(
            'Payment Failed',
            "We couldn't process your PayPal payment. Your access remains active for <strong>3 more days</strong>. Please update your PayPal balance or payment method to avoid losing access.",
            'FIX PAYMENT →', 'https://www.paypal.com/myaccount/autopay/'
          )
        );
      }
    }

    // Always return 200 to PayPal — any non-200 causes PayPal to retry
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('[Webhook] handler error:', err.message);
    return res.status(200).json({ received: true });
  }
}

export const config = { api: { bodyParser: true } };

// api/newsletter.js — Email capture & newsletter signup
// Stores emails in Upstash Redis, sends welcome email via Resend

const R_URL   = process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM    = process.env.EMAIL_FROM || 'Orrery Intel <onboarding@resend.dev>';
const HOST    = (process.env.APP_HOST || process.env.PESAPAL_HOST || 'https://www.orreryx.io').replace(/\/$/, '');

async function redis(...cmd) {
  if (!R_URL || !R_TOKEN) return null;
  const r = await fetch(R_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  return (await r.json()).result;
}

async function sendWelcomeEmail(email) {
  if (!RESEND_KEY) return;
  const html = `
<div style="background:#09090b;color:#f0f0ec;padding:40px;max-width:520px;margin:0 auto;border:1px solid rgba(255,255,255,.1);border-radius:8px;font-family:'Helvetica Neue',sans-serif">
  <div style="margin-bottom:24px;font-size:18px;font-weight:800">⊕ Orrery</div>
  <div style="font-size:22px;font-weight:800;margin-bottom:12px">Your weekly geopolitical briefing starts now.</div>
  <div style="font-size:14px;color:#a0a09a;line-height:1.8;margin-bottom:28px">
    Every week you'll get:<br><br>
    🔴 <strong style="color:#f0f0ec">The 3 conflicts moving markets</strong> — what they mean for gold, oil, and equities<br>
    📊 <strong style="color:#f0f0ec">Risk score changes</strong> — which flashpoints escalated or de-escalated<br>
    💡 <strong style="color:#f0f0ec">One trade idea</strong> — the asset most mispriced relative to current geopolitical risk<br><br>
    No noise. No politics. Just intelligence you can act on.
  </div>
  <a href="${HOST}/login?plan=f" style="display:block;background:#e03836;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:4px;font-weight:700;font-size:14px;margin-bottom:24px">
    START FREE TRIAL — TRACK RISK LIVE →
  </a>
  <div style="font-size:12px;color:#484844">
    © 2026 Orrery · orreryx.io<br>
    <a href="${HOST}/unsubscribe?email=${encodeURIComponent(email)}" style="color:#484844">Unsubscribe</a>
  </div>
</div>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [email],
      subject: 'Welcome to Orrery Intel — Your first briefing is coming',
      html,
    }),
  }).catch(e => console.error('[Newsletter] email error:', e.message));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { email, source } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'Valid email required' });
  }

  const key = `newsletter:${email.toLowerCase().trim()}`;

  try {
    // Check if already subscribed
    const existing = await redis('GET', key);
    if (existing) {
      return res.status(200).json({ ok: true, status: 'already_subscribed' });
    }

    // Store subscriber
    await redis('SET', key, JSON.stringify({
      email,
      source: source || 'website',
      subscribed_at: Date.now(),
    }));

    // Add to subscriber count
    await redis('INCR', 'newsletter:count');

    // Send welcome email
    await sendWelcomeEmail(email);

    console.log(`[Newsletter] New subscriber: ${email} from ${source}`);
    return res.status(200).json({ ok: true, status: 'subscribed' });

  } catch (err) {
    console.error('[Newsletter] error:', err.message);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

export const config = { api: { bodyParser: true } };

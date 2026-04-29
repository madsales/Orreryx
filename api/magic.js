// api/magic.js — unified magic link handler
// POST /api/magic       → send magic link
// GET  /api/magic?token → verify token and redirect

import crypto from 'crypto';

const REDIS_URL   = process.env.UPSTASH_REDIS_REST_URL   || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

async function redisCmd(...args) {
  const r = await fetch(REDIS_URL, {
    method:  'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(args),
  });
  const d = await r.json();
  return d.result;
}

function normPlan(p) {
  if (p === 'command' || p === 'c') return 'c';
  if (p === 'analyst'  || p === 'a') return 'a';
  if (p === 'free'     || p === 'f') return 'f';
  return 's';
}

// ── SEND (POST) ──────────────────────────────────────────────────────────────
async function handleSend(req, res) {
  const { email, plan } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Valid email required' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY)
    return res.status(500).json({ error: 'Email service not configured. Add RESEND_API_KEY to Vercel environment variables.' });
  if (!REDIS_URL || !REDIS_TOKEN)
    return res.status(500).json({ error: 'Session storage not configured. Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.' });

  const magicToken = crypto.randomBytes(32).toString('hex');
  const expires    = Date.now() + 15 * 60 * 1000; // 15 minutes

  try {
    await redisCmd('SET', `magic:${magicToken}`, JSON.stringify({ email, plan: plan || 's', expires }), 'EX', 900);
  } catch (e) {
    console.error('[Magic] Redis write error:', e.message);
    return res.status(500).json({ error: 'Storage error. Please try again.' });
  }

  const baseUrl   = process.env.PESAPAL_HOST || `https://${process.env.VERCEL_URL}`;
  const magicLink = `${baseUrl}/api/magic?token=${magicToken}`;
  const FROM_ADDRESS = process.env.EMAIL_FROM || 'Orrery <onboarding@resend.dev>';
  const planLabel  = plan === 'f' ? 'Free Trial' : plan === 'a' ? 'Analyst' : plan === 'c' ? 'Command' : 'Starter';
  const subject    = plan === 'f' ? 'Your Orrery free trial access link' : 'Your Orrery access link';

  const emailRes = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    FROM_ADDRESS,
      to:      [email],
      subject,
      html: `<div style="background:#09090b;color:#f0f0ec;padding:40px;max-width:480px;margin:0 auto;border:1px solid rgba(255,255,255,.1);border-radius:8px;font-family:'Helvetica Neue',sans-serif">
        <div style="margin-bottom:32px">
          <strong style="font-size:16px;letter-spacing:.04em">⊕ Orrery</strong>
          ${plan === 'f' ? '<span style="margin-left:10px;background:rgba(56,188,120,.15);border:1px solid rgba(56,188,120,.3);border-radius:3px;padding:2px 8px;font-size:10px;color:#38bc78;font-weight:700">FREE TRIAL</span>' : ''}
        </div>
        <div style="font-size:22px;font-weight:700;margin-bottom:10px;letter-spacing:-.01em">${plan === 'f' ? 'Start your free 3-day trial' : 'Access your platform'}</div>
        <div style="font-size:13px;color:#a0a09a;margin-bottom:28px;line-height:1.6">${plan === 'f' ? 'Your free trial starts the moment you click the link below. No credit card required.' : 'Your sign-in link expires in'} <strong style="color:#f0f0ec">${plan === 'f' ? '' : '15 minutes'}</strong>${plan === 'f' ? '' : ' and can only be used once.'}</div>
        <a href="${magicLink}" style="display:block;background:${plan === 'f' ? '#38bc78' : '#f0f0ec'};color:${plan === 'f' ? '#000' : '#09090b'};text-decoration:none;text-align:center;padding:14px;border-radius:4px;font-weight:700;letter-spacing:.04em;font-size:13px">${plan === 'f' ? 'ACTIVATE FREE TRIAL →' : 'OPEN ORRERY →'}</a>
        ${plan === 'f' ? '<div style="margin-top:16px;font-size:12px;color:#a0a09a;text-align:center">3 days free · No card required · Upgrade anytime</div>' : ''}
        <div style="margin-top:24px;font-size:11px;color:#484844;line-height:1.6">If you didn\'t request this, you can safely ignore this email.</div>
      </div>`,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.json().catch(() => ({}));
    console.error('[Magic] Resend error:', JSON.stringify(err));
    return res.status(500).json({ error: `Email delivery failed: ${err?.message || 'Unknown error'}` });
  }

  return res.status(200).json({ success: true });
}

// ── VERIFY (GET) ──────────────────────────────────────────────────────────────
async function handleVerify(req, res) {
  const { token } = req.query;
  if (!token) return res.redirect('/login?error=missing_token');
  if (!REDIS_URL || !REDIS_TOKEN) return res.redirect('/login?error=server_error');

  try {
    const raw = await redisCmd('GET', `magic:${token}`);
    if (!raw) return res.redirect('/login?error=invalid_token');

    let data;
    try { data = JSON.parse(raw); } catch(e) { return res.redirect('/login?error=server_error'); }

    if (Date.now() > data.expires) {
      await redisCmd('DEL', `magic:${token}`);
      return res.redirect('/login?error=expired');
    }

    await redisCmd('DEL', `magic:${token}`); // single-use

    const planCode  = normPlan(data.plan);
    const isFree    = planCode === 'f';
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const SESSION_TTL  = isFree ? 3 * 24 * 60 * 60 * 1000 : 365 * 24 * 60 * 60 * 1000;

    const session = {
      email:     data.email,
      plan:      planCode,
      token:     sessionToken,
      expires:   Date.now() + SESSION_TTL,
      createdAt: Date.now(),
      verified:  true,
      ...(isFree && { freeTrialExpires: Date.now() + SESSION_TTL }),
    };

    const sessionStr = encodeURIComponent(JSON.stringify(session));
    return res.redirect(`/welcome?session=${sessionStr}&plan=${planCode}`);

  } catch(e) {
    console.error('[VerifyMagic] Error:', e.message);
    return res.redirect('/login?error=server_error');
  }
}

// ── SESSION CHECK (merged from session-check.js) ──────────────────────────────
async function handleSessionCheck(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { email, plan: localPlan } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, reason: 'missing_email' });
  if (localPlan === 'f') return res.status(200).json({ ok: true, plan: 'f', status: 'trial' });

  try {
    const R = REDIS_URL, T = REDIS_TOKEN;
    if (!R || !T) return res.status(200).json({ ok: true, plan: localPlan, status: 'no_redis' });
    const r = await fetch(`${R}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${T}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['GET', `user:${email}:sub_status`],
        ['GET', `user:${email}:sub_expires`],
        ['GET', `user:${email}:grace_until`],
        ['GET', `user:${email}:plan`],
      ]),
    });
    const [s0, s1, s2, s3] = (await r.json()).map(x => x.result);
    const [status, expires, graceUntil, plan] = [s0, s1, s2, s3];
    if (!status) return res.status(200).json({ ok: true, plan: localPlan, status: 'legacy' });
    if (status === 'active') return res.status(200).json({ ok: true, plan: plan || localPlan, status: 'active', expires: expires ? parseInt(expires) : null });
    if (status === 'suspended') {
      const grace = graceUntil ? parseInt(graceUntil) : 0;
      if (Date.now() < grace) return res.status(200).json({ ok: true, plan: plan || localPlan, status: 'grace', grace_until: grace });
      return res.status(200).json({ ok: false, reason: 'payment_failed', plan: plan || localPlan });
    }
    if (status === 'cancelled') return res.status(200).json({ ok: false, reason: 'cancelled', plan: plan || localPlan });
    return res.status(200).json({ ok: true, plan: localPlan, status: 'unknown' });
  } catch (err) {
    console.error('[SessionCheck]', err.message);
    return res.status(200).json({ ok: true, plan: localPlan, status: 'error' });
  }
}

// ── ROUTER ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Route session-check requests
  if ((req.url || '').includes('/session-check')) return handleSessionCheck(req, res);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET with token = verify
  if (req.method === 'GET' && req.query.token) return handleVerify(req, res);
  // POST = send
  if (req.method === 'POST') return handleSend(req, res);

  return res.status(405).json({ error: 'Method not allowed' });
}

export const config = { api: { bodyParser: true } };

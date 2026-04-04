// api/send-magic.js — sends magic link email via Resend
// Uses Upstash REST API directly (no ioredis / npm packages needed)

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, plan } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Valid email required' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) return res.status(500).json({ error: 'Email service not configured.' });
  if (!REDIS_URL || !REDIS_TOKEN) return res.status(500).json({ error: 'Redis not configured.' });

  const magicToken = crypto.randomBytes(32).toString('hex');
  const expires    = Date.now() + 15 * 60 * 1000; // 15 minutes

  try {
    await redisCmd('SET', `magic:${magicToken}`, JSON.stringify({ email, plan: plan || 's', expires }), 'EX', 900);
  } catch (e) {
    console.error('[Magic] Redis write error:', e.message);
    return res.status(500).json({ error: 'Storage error. Please try again.' });
  }

  const baseUrl   = process.env.PESAPAL_HOST || `https://${process.env.VERCEL_URL}`;
  const magicLink = `${baseUrl}/api/verify-magic?token=${magicToken}`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    process.env.EMAIL_FROM || 'Orrery <noreply@orreryx.io>',
      to:      [email],
      subject: 'Your Orrery access link',
      html: `<div style="background:#09090b;color:#f0f0ec;padding:40px;max-width:480px;margin:0 auto;border:1px solid rgba(255,255,255,.1);border-radius:8px;font-family:'Helvetica Neue',sans-serif">
        <div style="margin-bottom:32px">
          <strong style="font-size:16px;letter-spacing:.04em">⊕ Orrery</strong>
        </div>
        <div style="font-size:22px;font-weight:700;margin-bottom:10px;letter-spacing:-.01em">Access your platform</div>
        <div style="font-size:13px;color:#a0a09a;margin-bottom:28px;line-height:1.6">Your sign-in link expires in <strong style="color:#f0f0ec">15 minutes</strong> and can only be used once.</div>
        <a href="${magicLink}" style="display:block;background:#f0f0ec;color:#09090b;text-decoration:none;text-align:center;padding:14px;border-radius:4px;font-weight:700;letter-spacing:.04em;font-size:13px">OPEN ORRERY →</a>
        <div style="margin-top:24px;font-size:11px;color:#484844;line-height:1.6">If you didn't request this, you can safely ignore this email. This link expires automatically.</div>
      </div>`,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.json().catch(() => ({}));
    console.error('[Magic] Resend error:', JSON.stringify(err));
    return res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }

  return res.status(200).json({ success: true });
}

export const config = { api: { bodyParser: true } };

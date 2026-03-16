import crypto from 'crypto';
import Redis from 'ioredis';

function getRedis() {
  const url = process.env.REDIS_URL || '';
  const opts = {
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    enableReadyCheck: false,
    lazyConnect: true,
  };
  // Only enable TLS if URL uses rediss://
  if (url.startsWith('rediss://')) opts.tls = {};
  return new Redis(url, opts);
}

async function closeRedis(redis) {
  try { await Promise.race([redis.quit(), new Promise(r => setTimeout(r, 1000))]); } catch(_) {}
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
  if (!RESEND_KEY)
    return res.status(500).json({ error: 'RESEND_API_KEY not set.' });

  const token   = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 15 * 60 * 1000;

  const redis = getRedis();
  try {
    await redis.set(`magic:${token}`, JSON.stringify({ email, plan, expires }), 'EX', 900);
  } catch (e) {
    console.error('Redis error:', e.message);
    return res.status(500).json({ error: 'Storage error. Please try again.' });
  } finally {
    await closeRedis(redis);
  }

  const baseUrl   = process.env.PESAPAL_HOST || `https://${process.env.VERCEL_URL}`;
  const magicLink = `${baseUrl}/api/verify-magic?token=${token}`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Orrery <onboarding@resend.dev>',
      to: [email],
      subject: 'Your Orrery sign-in link',
      html: `<div style="background:#09090b;color:#f0f0ec;padding:40px;max-width:480px;margin:0 auto;border:1px solid rgba(255,255,255,.1);border-radius:8px"><div style="margin-bottom:32px"><strong style="font-size:16px">Orrery</strong></div><div style="font-size:20px;font-weight:700;margin-bottom:12px">Click to access Orrery</div><div style="font-size:13px;color:#b0b0aa;margin-bottom:28px">Expires in <strong style="color:#f0f0ec">15 minutes</strong> — one-time use only.</div><a href="${magicLink}" style="display:block;background:#f0f0ec;color:#09090b;text-decoration:none;text-align:center;padding:14px;border-radius:4px;font-weight:700">OPEN ORRERY</a><div style="margin-top:20px;font-size:10px;color:#666670">If you did not request this, ignore this email.</div></div>`,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.json().catch(() => ({}));
    console.error('Resend error:', err);
    return res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }

  return res.status(200).json({ success: true });
}

export const config = { api: { bodyParser: true } };

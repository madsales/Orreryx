// api/verify-magic.js — validates a magic link token and redirects into the app
// Uses Upstash REST API directly (no ioredis / npm packages needed)

import crypto from 'crypto';

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

async function redisCmd(...args) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });

  const d = await r.json();
  return d.result;
}

function normPlan(p) {
  if (p === 'command' || p === 'c') return 'c';
  if (p === 'analyst' || p === 'a') return 'a';
  if (p === 'free' || p === 'f') return 'f';
  return 's';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const { token } = req.query;
  if (!token) return res.redirect('/login?error=missing_token');
  if (!REDIS_URL || !REDIS_TOKEN) return res.redirect('/login?error=server_error');

  try {
    const raw = await redisCmd('GET', `magic:${token}`);
    if (!raw) return res.redirect('/login?error=invalid_token');

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.redirect('/login?error=server_error');
    }

    if (Date.now() > data.expires) {
      await redisCmd('DEL', `magic:${token}`);
      return res.redirect('/login?error=expired');
    }

    // Consume token immediately so the link is single-use.
    await redisCmd('DEL', `magic:${token}`);

    const planCode = normPlan(data.plan);
    const isFree = planCode === 'f';
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const SESSION_TTL = isFree
      ? 3 * 24 * 60 * 60 * 1000
      : 365 * 24 * 60 * 60 * 1000;

    const session = {
      email: data.email,
      plan: planCode,
      token: sessionToken,
      expires: Date.now() + SESSION_TTL,
      createdAt: Date.now(),
      verified: true,
      ...(isFree && { freeTrialExpires: Date.now() + SESSION_TTL }),
    };

    const sessionStr = encodeURIComponent(JSON.stringify(session));
    return res.redirect(`/app?session=${sessionStr}&plan=${planCode}`);
  } catch (e) {
    console.error('[VerifyMagic] Error:', e?.message || e);
    return res.redirect('/login?error=server_error');
  }
}

export const config = { api: { bodyParser: false } };

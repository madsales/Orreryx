// api/session-check.js — validates subscription status on every app load
// Called by app with { email, plan } from localStorage session

const R_URL   = process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redisPipe(cmds) {
  if (!R_URL || !R_TOKEN) return cmds.map(() => null);
  const r = await fetch(`${R_URL}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmds),
  });
  return (await r.json()).map(x => x.result);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { email, plan: localPlan } = req.body || {};
  if (!email) return res.status(400).json({ ok: false, reason: 'missing_email' });

  // Free trial — no subscription record in Redis, validity checked client-side via expires
  if (localPlan === 'f') return res.status(200).json({ ok: true, plan: 'f', status: 'trial' });

  try {
    const [status, expires, graceUntil, plan] = await redisPipe([
      ['GET', `user:${email}:sub_status`],
      ['GET', `user:${email}:sub_expires`],
      ['GET', `user:${email}:grace_until`],
      ['GET', `user:${email}:plan`],
    ]);

    // No Redis record — legacy user from old one-time payment system, allow access
    if (!status) return res.status(200).json({ ok: true, plan: localPlan, status: 'legacy' });

    if (status === 'active') {
      return res.status(200).json({
        ok:      true,
        plan:    plan || localPlan,
        status:  'active',
        expires: expires ? parseInt(expires) : null,
      });
    }

    if (status === 'suspended') {
      const grace = graceUntil ? parseInt(graceUntil) : 0;
      if (Date.now() < grace) {
        return res.status(200).json({
          ok:          true,
          plan:        plan || localPlan,
          status:      'grace',
          grace_until: grace,
        });
      }
      return res.status(200).json({ ok: false, reason: 'payment_failed', plan: plan || localPlan });
    }

    if (status === 'cancelled') {
      return res.status(200).json({ ok: false, reason: 'cancelled', plan: plan || localPlan });
    }

    // Unknown status — fail open to avoid locking out valid users
    return res.status(200).json({ ok: true, plan: localPlan, status: 'unknown' });

  } catch (err) {
    console.error('[SessionCheck]', err.message);
    // Fail open if Redis is down — don't block paying users
    return res.status(200).json({ ok: true, plan: localPlan, status: 'error' });
  }
}

export const config = { api: { bodyParser: true } };

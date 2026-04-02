// api/track.js — Orrery Analytics Tracker
// Uses Upstash REST API directly via fetch — NO npm package required.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Always return 200 — tracking must never break the user experience
  try {
    const url   = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return res.status(200).json({ ok: false, reason: 'no_redis' });

    const body   = req.body || {};
    const event  = body.event  || 'pv';
    const page   = body.page   || '/';
    const ref    = body.ref    || '';
    const plan   = body.plan   || '';
    const device = body.device || 'desktop';
    const date   = new Date().toISOString().split('T')[0];

    const cmds = [];

    if (event === 'pv') {
      cmds.push(['INCR', `analytics:pv:${date}`]);
      cmds.push(['INCR', 'analytics:pv:total']);
      cmds.push(['INCR', `analytics:page:${page}:${date}`]);
      cmds.push(['INCR', `analytics:device:${device}`]);
      cmds.push(['EXPIRE', `analytics:pv:${date}`, 3024000]);
    }

    if (ref) {
      try {
        const domain = new URL(ref).hostname.replace('www.', '');
        cmds.push(['ZINCRBY', 'analytics:refs', '1', domain]);
      } catch (_) {}
    }

    if (event === 'signup') {
      cmds.push(['INCR', `analytics:signup:${date}`]);
      cmds.push(['INCR', 'analytics:signup:total']);
      if (plan) cmds.push(['HINCRBY', 'analytics:plans', plan, '1']);
      cmds.push(['EXPIRE', `analytics:signup:${date}`, 3024000]);
    }

    if (event === 'payment') {
      cmds.push(['INCR', `analytics:payment:${date}`]);
      cmds.push(['INCR', 'analytics:payment:total']);
      if (plan) cmds.push(['HINCRBY', 'analytics:revenue_count', plan, '1']);
    }

    if (event === 'click') {
      const target = body.target || 'unknown';
      cmds.push(['ZINCRBY', 'analytics:clicks', '1', target]);
    }

    if (cmds.length === 0) return res.status(200).json({ ok: true });

    await fetch(`${url}/pipeline`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(cmds),
    });

    return res.status(200).json({ ok: true });
  } catch (_) {
    return res.status(200).json({ ok: false });
  }
}

export const config = { api: { bodyParser: true } };

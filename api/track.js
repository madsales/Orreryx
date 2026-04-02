// api/track.js — Orrery Analytics Tracker
// Receives page views, signups, payments, clicks → stores in Upstash Redis
// Called silently from index.html and app.html — never blocks user experience

import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const redis = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    const body   = req.body || {};
    const event  = body.event  || 'pv';
    const page   = body.page   || '/';
    const ref    = body.ref    || '';
    const plan   = body.plan   || '';
    const device = body.device || 'desktop';

    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const p    = redis.pipeline();

    // ── Page views ──
    if (event === 'pv') {
      p.incr(`analytics:pv:${date}`);
      p.incr(`analytics:pv:total`);
      p.incr(`analytics:page:${page}:${date}`);
      p.incr(`analytics:device:${device}`);
      p.expire(`analytics:pv:${date}`, 35 * 24 * 3600);
      p.expire(`analytics:page:${page}:${date}`, 35 * 24 * 3600);
    }

    // ── Referrer ──
    if (ref) {
      try {
        const domain = new URL(ref).hostname.replace('www.', '');
        p.zincrby('analytics:refs', 1, domain);
      } catch (_) {}
    }

    // ── Signup / Payment ──
    if (event === 'signup') {
      p.incr(`analytics:signup:${date}`);
      p.incr('analytics:signup:total');
      if (plan) p.hincrby('analytics:plans', plan, 1);
      p.expire(`analytics:signup:${date}`, 35 * 24 * 3600);
    }

    if (event === 'payment') {
      p.incr(`analytics:payment:${date}`);
      p.incr('analytics:payment:total');
      if (plan) {
        p.hincrby('analytics:revenue_count', plan, 1);
      }
      p.expire(`analytics:payment:${date}`, 35 * 24 * 3600);
    }

    // ── Clicks ──
    if (event === 'click') {
      const target = body.target || 'unknown';
      p.incr(`analytics:click:${target}:${date}`);
      p.zincrby('analytics:clicks', 1, target);
      p.expire(`analytics:click:${target}:${date}`, 35 * 24 * 3600);
    }

    await p.exec();
    return res.status(200).json({ ok: true });
  } catch (_) {
    // Silently succeed — tracking must never break the user experience
    return res.status(200).json({ ok: false });
  }
}

export const config = { api: { bodyParser: true } };

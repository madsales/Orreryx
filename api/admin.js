// api/admin.js — Orrery Admin API
// Auth uses HMAC self-verifying tokens — no Redis required to log in.
// Stats/content/health use Redis when available; degrade gracefully without it.

import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { Redis } from '@upstash/redis';

// ── HMAC token helpers (Redis-free auth) ─────────────────────────────────────
function makeToken(password) {
  const payload = `${Date.now()}.${randomBytes(8).toString('hex')}`;
  const sig = createHmac('sha256', password).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function checkToken(token, password) {
  if (!token || !password) return false;
  try {
    const dot1 = token.indexOf('.');
    const dot2 = token.indexOf('.', dot1 + 1);
    if (dot1 < 0 || dot2 < 0) return false;
    const payload = token.slice(0, dot2);
    const sig     = token.slice(dot2 + 1);
    const ts      = parseInt(token.slice(0, dot1));
    if (isNaN(ts) || Date.now() - ts > 86_400_000) return false; // 24h expiry
    const expected = createHmac('sha256', password).update(payload).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(sig.padEnd(expected.length, '0').slice(0, expected.length), 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch { return false; }
}

// ── Redis (optional) ─────────────────────────────────────────────────────────
function getRedis() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function dateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action   = req.query.action || 'stats';
  const adminPwd = process.env.ADMIN_PASSWORD;

  // ── AUTH (no Redis required) ─────────────────────────────────────────────
  if (action === 'auth') {
    if (req.method !== 'POST') return res.status(405).end();
    if (!adminPwd)
      return res.status(503).json({ error: 'Admin not configured. Set ADMIN_PASSWORD in Vercel env vars.' });
    const { password } = req.body || {};
    if (!password || password !== adminPwd)
      return res.status(401).json({ error: 'Invalid password' });
    return res.status(200).json({ token: makeToken(adminPwd) });
  }

  // ── Verify token on all other endpoints ──────────────────────────────────
  const rawToken = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!adminPwd || !checkToken(rawToken, adminPwd))
    return res.status(401).json({ error: 'Unauthorized' });

  // ── LOGOUT (token is client-side; just confirm) ──────────────────────────
  if (action === 'logout') {
    return res.status(200).json({ ok: true });
  }

  const r = getRedis();

  // ── STATS ────────────────────────────────────────────────────────────────
  if (action === 'stats') {
    if (!r) {
      // No Redis — return zeroed stats so the dashboard still loads
      const days = Array.from({ length: 30 }, (_, i) => dateStr(29 - i));
      return res.status(200).json({
        pvPerDay:      days.map(d => ({ date: d, views: 0 })),
        signPerDay:    days.map(d => ({ date: d, signups: 0 })),
        totalPV: 0, totalSignups: 0, totalPayments: 0,
        todayPV: 0, todaySignups: 0,
        plans: { s: 0, a: 0, c: 0 },
        revenue: 0, topRefs: [], topClicks: [],
        devices: { mobile: 0, desktop: 0, tablet: 0 },
        _notice: 'Redis not configured — analytics unavailable',
      });
    }

    try {
      const days = Array.from({ length: 30 }, (_, i) => dateStr(29 - i));
      const p    = r.pipeline();
      days.forEach(d => p.get(`analytics:pv:${d}`));
      days.forEach(d => p.get(`analytics:signup:${d}`));
      p.get('analytics:pv:total');
      p.get('analytics:signup:total');
      p.get('analytics:payment:total');
      p.hgetall('analytics:plans');
      p.hgetall('analytics:revenue_count');
      p.zrange('analytics:refs',   0, 9, { rev: true, withScores: true });
      p.zrange('analytics:clicks', 0, 7, { rev: true, withScores: true });
      p.get('analytics:device:mobile');
      p.get('analytics:device:desktop');
      p.get('analytics:device:tablet');

      const res2 = await p.exec();

      const pvPerDay      = days.map((d, i) => ({ date: d, views:   parseInt(res2[i])      || 0 }));
      const signPerDay    = days.map((d, i) => ({ date: d, signups: parseInt(res2[30 + i]) || 0 }));
      const totalPV       = parseInt(res2[60]) || 0;
      const totalSignups  = parseInt(res2[61]) || 0;
      const totalPayments = parseInt(res2[62]) || 0;
      const plans         = res2[63] || {};
      const revCount      = res2[64] || {};
      const refs          = res2[65] || [];
      const clicks        = res2[66] || [];

      const PRICES = { s: 0.99, a: 14.99, c: 34.99 };
      let revenue  = 0;
      Object.entries(revCount).forEach(([plan, cnt]) => { revenue += (PRICES[plan] || 0) * (parseInt(cnt) || 0); });

      const topRefs   = [];
      for (let i = 0; i < refs.length;   i += 2) topRefs.push({   domain: refs[i],   count: parseInt(refs[i+1])   || 0 });
      const topClicks = [];
      for (let i = 0; i < clicks.length; i += 2) topClicks.push({ target: clicks[i], count: parseInt(clicks[i+1]) || 0 });

      return res.status(200).json({
        pvPerDay, signPerDay,
        totalPV, totalSignups, totalPayments,
        todayPV:      pvPerDay[29]?.views    || 0,
        todaySignups: signPerDay[29]?.signups || 0,
        plans: { s: parseInt(plans.s)||0, a: parseInt(plans.a)||0, c: parseInt(plans.c)||0 },
        revenue: Math.round(revenue * 100) / 100,
        topRefs, topClicks,
        devices: { mobile: parseInt(res2[67])||0, desktop: parseInt(res2[68])||0, tablet: parseInt(res2[69])||0 },
      });
    } catch (e) {
      return res.status(200).json({ error: 'Redis error: ' + e.message, pvPerDay: [], signPerDay: [] });
    }
  }

  // ── CONTENT GET/SET ──────────────────────────────────────────────────────
  if (action === 'content') {
    if (!r) return res.status(503).json({ error: 'Redis not configured' });
    try {
      if (req.method === 'GET') {
        const [crisis, announcement, notice, maintenanceRaw] = await Promise.all([
          r.get('admin:content:crisis_text'),
          r.get('admin:content:announcement'),
          r.get('admin:content:notice'),
          r.get('admin:content:maintenance'),
        ]);
        return res.status(200).json({
          crisis:       crisis       || '',
          announcement: announcement || '',
          notice:       notice       || '',
          maintenance:  !!maintenanceRaw,
        });
      }
      if (req.method === 'POST') {
        const body = req.body || {};
        const p2   = r.pipeline();
        if (body.crisis       !== undefined) p2.set('admin:content:crisis_text',  body.crisis);
        if (body.announcement !== undefined) p2.set('admin:content:announcement', body.announcement || '');
        if (body.notice       !== undefined) p2.set('admin:content:notice',       body.notice || '');
        if (body.maintenance  !== undefined) {
          if (body.maintenance) p2.set('admin:content:maintenance', '1');
          else                  p2.del('admin:content:maintenance');
        }
        await p2.exec();
        return res.status(200).json({ ok: true });
      }
    } catch (e) {
      return res.status(500).json({ error: 'Redis error: ' + e.message });
    }
  }

  // ── HEALTH ───────────────────────────────────────────────────────────────
  if (action === 'health') {
    const checks = {
      anthropic: process.env.ANTHROPIC_API_KEY      ? '✅ configured' : '❌ missing',
      paypal:    process.env.PAYPAL_CLIENT_ID        ? '✅ configured' : '❌ missing',
      resend:    process.env.RESEND_API_KEY          ? '✅ configured' : '❌ missing',
      upstash:   process.env.UPSTASH_REDIS_REST_URL  ? '✅ configured' : '❌ missing',
      adminPwd:  adminPwd                            ? '✅ set'        : '❌ not set',
      redis:     'not checked',
    };
    if (r) {
      try { await r.ping(); checks.redis = '✅ connected'; }
      catch (e) { checks.redis = '❌ error: ' + e.message; }
    } else {
      checks.redis = '❌ not configured';
    }
    return res.status(200).json({ checks, ts: new Date().toISOString() });
  }

  return res.status(400).json({ error: 'Unknown action' });
}

export const config = { api: { bodyParser: true } };

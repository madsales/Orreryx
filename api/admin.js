// api/admin.js — Orrery Admin API
// Endpoints: auth, stats, content (GET/POST), health, logout
// Protected by ADMIN_PASSWORD env var + Redis session tokens

import { Redis } from '@upstash/redis';
import { randomBytes } from 'crypto';

function redis() {
  return new Redis({
    url:   process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

async function verifyToken(req, r) {
  const auth  = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!auth) return false;
  const valid = await r.get(`admin:session:${auth}`);
  return !!valid;
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

  const action = req.query.action || 'stats';
  const r      = redis();

  // ── AUTH ────────────────────────────────────────────────────────────────────
  if (action === 'auth') {
    if (req.method !== 'POST') return res.status(405).end();
    const { password } = req.body || {};
    const adminPwd = process.env.ADMIN_PASSWORD;
    if (!adminPwd) return res.status(503).json({ error: 'Admin not configured. Set ADMIN_PASSWORD in Vercel env.' });
    if (!password || password !== adminPwd)
      return res.status(401).json({ error: 'Invalid password' });

    const token = randomBytes(40).toString('hex');
    await r.set(`admin:session:${token}`, '1', { ex: 86400 }); // 24h session
    return res.status(200).json({ token });
  }

  // ── All other endpoints require valid session ────────────────────────────────
  const authed = await verifyToken(req, r);
  if (!authed) return res.status(401).json({ error: 'Unauthorized' });

  // ── LOGOUT ──────────────────────────────────────────────────────────────────
  if (action === 'logout') {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (token) await r.del(`admin:session:${token}`);
    return res.status(200).json({ ok: true });
  }

  // ── STATS ───────────────────────────────────────────────────────────────────
  if (action === 'stats') {
    const days  = Array.from({ length: 30 }, (_, i) => dateStr(29 - i));
    const p     = r.pipeline();

    // Daily page views + signups for last 30 days
    days.forEach(d => p.get(`analytics:pv:${d}`));
    days.forEach(d => p.get(`analytics:signup:${d}`));

    // Totals
    p.get('analytics:pv:total');
    p.get('analytics:signup:total');
    p.get('analytics:payment:total');

    // Plan distribution
    p.hgetall('analytics:plans');

    // Revenue counts per plan
    p.hgetall('analytics:revenue_count');

    // Top referrers
    p.zrange('analytics:refs', 0, 9, { rev: true, withScores: true });

    // Top clicked elements
    p.zrange('analytics:clicks', 0, 7, { rev: true, withScores: true });

    // Device split
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
    const mobiles       = parseInt(res2[67]) || 0;
    const desktops      = parseInt(res2[68]) || 0;
    const tablets       = parseInt(res2[69]) || 0;

    // Revenue estimate
    const PRICES  = { s: 0.99, a: 14.99, c: 34.99 };
    let revenue   = 0;
    Object.entries(revCount).forEach(([plan, cnt]) => {
      revenue += (PRICES[plan] || 0) * (parseInt(cnt) || 0);
    });

    // Today's stats
    const todayPV      = pvPerDay[29]?.views   || 0;
    const todaySignups = signPerDay[29]?.signups || 0;

    // Format refs list
    const topRefs = [];
    for (let i = 0; i < refs.length; i += 2) {
      topRefs.push({ domain: refs[i], count: parseInt(refs[i + 1]) || 0 });
    }

    // Format clicks list
    const topClicks = [];
    for (let i = 0; i < clicks.length; i += 2) {
      topClicks.push({ target: clicks[i], count: parseInt(clicks[i + 1]) || 0 });
    }

    return res.status(200).json({
      pvPerDay, signPerDay,
      totalPV, totalSignups, totalPayments,
      todayPV, todaySignups,
      plans: {
        s: parseInt(plans.s) || 0,
        a: parseInt(plans.a) || 0,
        c: parseInt(plans.c) || 0,
      },
      revenue: Math.round(revenue * 100) / 100,
      topRefs, topClicks,
      devices: { mobile: mobiles, desktop: desktops, tablet: tablets },
    });
  }

  // ── CONTENT GET/SET ─────────────────────────────────────────────────────────
  if (action === 'content') {
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
      if (body.crisis       !== undefined) p2.set('admin:content:crisis_text',    body.crisis);
      if (body.announcement !== undefined) p2.set('admin:content:announcement',   body.announcement || '');
      if (body.notice       !== undefined) p2.set('admin:content:notice',         body.notice || '');
      if (body.maintenance  !== undefined) {
        if (body.maintenance) p2.set('admin:content:maintenance', '1');
        else                  p2.del('admin:content:maintenance');
      }
      await p2.exec();
      return res.status(200).json({ ok: true });
    }
  }

  // ── HEALTH ──────────────────────────────────────────────────────────────────
  if (action === 'health') {
    const checks = {
      redis:     'checking',
      anthropic: process.env.ANTHROPIC_API_KEY  ? '✅ configured' : '❌ missing',
      paypal:    process.env.PAYPAL_CLIENT_ID    ? '✅ configured' : '❌ missing',
      resend:    process.env.RESEND_API_KEY      ? '✅ configured' : '❌ missing',
      upstash:   process.env.UPSTASH_REDIS_REST_URL ? '✅ configured' : '❌ missing',
      adminPwd:  process.env.ADMIN_PASSWORD      ? '✅ set' : '❌ not set',
    };
    try {
      await r.ping();
      checks.redis = '✅ connected';
    } catch (e) {
      checks.redis = '❌ error: ' + e.message;
    }
    return res.status(200).json({ checks, ts: new Date().toISOString() });
  }

  return res.status(400).json({ error: 'Unknown action' });
}

export const config = { api: { bodyParser: true } };

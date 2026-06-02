// api/admin.js — OrreryX Admin API
// Uses Upstash REST API directly via fetch — NO npm package required.
// Auth uses HMAC self-verifying tokens — no Redis needed to log in.

import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

// ── In-memory rate limiter (per Lambda instance) — brute-force protection ──────
const _rl = new Map(); // ip → { count, resetAt }
function rateLimitHit(ip, maxPerMin = 10) {
  const now = Date.now();
  const key  = ip || 'unknown';
  const rec  = _rl.get(key) || { count: 0, resetAt: now + 60_000 };
  if (now > rec.resetAt) { rec.count = 0; rec.resetAt = now + 60_000; }
  rec.count++;
  _rl.set(key, rec);
  return rec.count > maxPerMin;
}

// ── Upstash REST helpers (no npm package) ────────────────────────────────────
function upstash(cmd) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return Promise.resolve(null);
  return fetch(`${url}`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmd),
  }).then(r => r.json()).then(d => d.result).catch(() => null);
}

function upstashPipeline(cmds) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return Promise.resolve(null);
  return fetch(`${url}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmds),
  }).then(r => r.json()).then(rows => rows.map(r => r.result)).catch(() => null);
}

function hasRedis() {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

// ── HMAC token helpers (Redis-free auth) ─────────────────────────────────────
function makeToken(password) {
  const payload = `${Date.now()}.${randomBytes(8).toString('hex')}`;
  const sig     = createHmac('sha256', password).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function checkToken(token, password) {
  if (!token || !password) return false;
  try {
    const dot2   = token.lastIndexOf('.');
    if (dot2 < 0) return false;
    const payload  = token.slice(0, dot2);
    const sig      = token.slice(dot2 + 1);
    const ts       = parseInt(payload.split('.')[0]);
    if (isNaN(ts) || Date.now() - ts > 86_400_000) return false;
    const expected = createHmac('sha256', password).update(payload).digest('hex');
    if (expected.length !== sig.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch { return false; }
}

function dateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

// ── TRACK HANDLER (merged from track.js) ─────────────────────────────────────
async function handleTrack(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const url   = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return res.status(200).json({ ok: false, reason: 'no_redis' });
    const body = req.body || {};
    if (body.action === 'push_subscribe' && body.subscription?.endpoint) {
      const ep   = body.subscription.endpoint;
      const hash = ep.split('/').pop().slice(-28).replace(/[^a-zA-Z0-9]/g, '') || Math.random().toString(36).slice(2);
      await fetch(`${url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify([['SET', `push:${hash}`, JSON.stringify(body.subscription)]]) });
      return res.status(200).json({ ok: true });
    }
    const event  = body.event  || 'pv';
    const page   = body.page   || '/';
    const ref    = body.ref    || '';
    const plan   = body.plan   || '';
    const device = body.device || 'desktop';
    const date   = new Date().toISOString().split('T')[0];
    const cmds = [];
    if (event === 'pv') {
      cmds.push(['INCR', `analytics:pv:${date}`], ['INCR', 'analytics:pv:total'], ['INCR', `analytics:page:${page}:${date}`], ['INCR', `analytics:device:${device}`], ['EXPIRE', `analytics:pv:${date}`, 3024000]);
    }
    if (ref) { try { const domain = new URL(ref).hostname.replace('www.', ''); cmds.push(['ZINCRBY', 'analytics:refs', '1', domain]); } catch (_) {} }
    if (event === 'signup') { cmds.push(['INCR', `analytics:signup:${date}`], ['INCR', 'analytics:signup:total']); if (plan) cmds.push(['HINCRBY', 'analytics:plans', plan, '1']); cmds.push(['EXPIRE', `analytics:signup:${date}`, 3024000]); }
    if (event === 'payment') { cmds.push(['INCR', `analytics:payment:${date}`], ['INCR', 'analytics:payment:total']); if (plan) cmds.push(['HINCRBY', 'analytics:revenue_count', plan, '1']); }
    if (event === 'click') { const target = body.target || 'unknown'; cmds.push(['ZINCRBY', 'analytics:clicks', '1', target]); }
    if (cmds.length === 0) return res.status(200).json({ ok: true });
    await fetch(`${url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
    return res.status(200).json({ ok: true });
  } catch (_) { return res.status(200).json({ ok: false }); }
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Route analytics tracking requests
  if ((req.url || '').includes('/track')) return handleTrack(req, res);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const action   = req.query.action || 'stats';
  const adminPwd = process.env.ADMIN_PASSWORD;

  // ── AUTH ─────────────────────────────────────────────────────────────────
  if (action === 'auth') {
    if (req.method !== 'POST') return res.status(405).end();
    // Rate-limit auth attempts: 10 per minute per IP
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '';
    if (rateLimitHit(ip, 10))
      return res.status(429).json({ error: 'Too many login attempts. Try again in a minute.' });
    if (!adminPwd)
      return res.status(503).json({ error: 'ADMIN_PASSWORD not set in Vercel environment variables.' });
    const { password } = req.body || {};
    if (!password || password !== adminPwd)
      return res.status(401).json({ error: 'Invalid password.' });
    // Set cookie server-side — survives JS issues, domain=.orreryx.io covers all subdomains
    res.setHeader('Set-Cookie', 'orrery_adm=1; Path=/; Max-Age=7776000; SameSite=Lax; Domain=.orreryx.io');
    return res.status(200).json({ token: makeToken(adminPwd) });
  }

  // ── Token check on all other actions ─────────────────────────────────────
  // Accept either a signed Bearer token (from login) OR raw password via ?secret= / Authorization header
  const rawToken   = (req.headers.authorization || '').replace('Bearer ', '').trim();
  const secretParam = req.query.secret || '';
  const authed = adminPwd && (checkToken(rawToken, adminPwd) || secretParam === adminPwd);
  if (!authed)
    return res.status(401).json({ error: 'Unauthorized' });

  // ── LOGOUT ────────────────────────────────────────────────────────────────
  if (action === 'logout') {
    return res.status(200).json({ ok: true });
  }

  // ── SET ACCESS COOKIE (called after login to ensure cookie is set server-side) ──
  if (action === 'set-access-cookie') {
    res.setHeader('Set-Cookie', 'orrery_adm=1; Path=/; Max-Age=7776000; SameSite=Lax; Domain=.orreryx.io');
    return res.status(200).json({ ok: true });
  }

  // ── STATS ─────────────────────────────────────────────────────────────────
  if (action === 'stats') {
    const days = Array.from({ length: 30 }, (_, i) => dateStr(29 - i));

    if (!hasRedis()) {
      return res.status(200).json({
        pvPerDay:   days.map(d => ({ date: d, views: 0 })),
        signPerDay: days.map(d => ({ date: d, signups: 0 })),
        totalPV: 0, totalSignups: 0, totalPayments: 0,
        todayPV: 0, todaySignups: 0,
        plans: { s: 0, a: 0, c: 0 }, revenue: 0,
        topRefs: [], topClicks: [],
        devices: { mobile: 0, desktop: 0, tablet: 0 },
        _notice: 'Redis not configured',
      });
    }

    try {
      const cmds = [
        ...days.map(d => ['GET', `analytics:pv:${d}`]),
        ...days.map(d => ['GET', `analytics:signup:${d}`]),
        ['GET', 'analytics:pv:total'],
        ['GET', 'analytics:signup:total'],
        ['GET', 'analytics:payment:total'],
        ['HGETALL', 'analytics:plans'],
        ['HGETALL', 'analytics:revenue_count'],
        ['ZRANGE', 'analytics:refs',   '0', '9', 'REV', 'WITHSCORES'],
        ['ZRANGE', 'analytics:clicks', '0', '7', 'REV', 'WITHSCORES'],
        ['GET', 'analytics:device:mobile'],
        ['GET', 'analytics:device:desktop'],
        ['GET', 'analytics:device:tablet'],
      ];
      const r2 = await upstashPipeline(cmds);
      if (!r2) throw new Error('Pipeline failed');

      const pvPerDay   = days.map((d, i) => ({ date: d, views:   parseInt(r2[i])      || 0 }));
      const signPerDay = days.map((d, i) => ({ date: d, signups: parseInt(r2[30 + i]) || 0 }));
      const plans      = r2[63] || {};
      const revCount   = r2[64] || {};
      const refs       = r2[65] || [];
      const clicks     = r2[66] || [];

      const PRICES = { s: 0.99, a: 14.99, c: 34.99 };
      let revenue  = 0;
      if (typeof revCount === 'object' && revCount) {
        Object.entries(revCount).forEach(([p, c]) => { revenue += (PRICES[p] || 0) * (parseInt(c) || 0); });
      }

      const topRefs   = Array.isArray(refs)   ? refs.reduce((a, v, i) => { if (i % 2 === 0) a.push({ domain: v, count: parseInt(refs[i+1])   || 0 }); return a; }, []) : [];
      const topClicks = Array.isArray(clicks) ? clicks.reduce((a, v, i) => { if (i % 2 === 0) a.push({ target: v, count: parseInt(clicks[i+1]) || 0 }); return a; }, []) : [];

      return res.status(200).json({
        pvPerDay, signPerDay,
        totalPV:       parseInt(r2[60]) || 0,
        totalSignups:  parseInt(r2[61]) || 0,
        totalPayments: parseInt(r2[62]) || 0,
        todayPV:      pvPerDay[29]?.views    || 0,
        todaySignups: signPerDay[29]?.signups || 0,
        plans: {
          s: parseInt(typeof plans === 'object' ? plans?.s : 0) || 0,
          a: parseInt(typeof plans === 'object' ? plans?.a : 0) || 0,
          c: parseInt(typeof plans === 'object' ? plans?.c : 0) || 0,
        },
        revenue:    Math.round(revenue * 100) / 100,
        topRefs, topClicks,
        devices: {
          mobile:  parseInt(r2[67]) || 0,
          desktop: parseInt(r2[68]) || 0,
          tablet:  parseInt(r2[69]) || 0,
        },
      });
    } catch (e) {
      return res.status(200).json({
        error: 'Redis error: ' + e.message,
        pvPerDay: days.map(d => ({ date: d, views: 0 })),
        signPerDay: days.map(d => ({ date: d, signups: 0 })),
        totalPV: 0, totalSignups: 0, totalPayments: 0,
        todayPV: 0, todaySignups: 0,
        plans: { s: 0, a: 0, c: 0 }, revenue: 0,
        topRefs: [], topClicks: [],
        devices: { mobile: 0, desktop: 0, tablet: 0 },
      });
    }
  }

  // ── CONTENT ───────────────────────────────────────────────────────────────
  if (action === 'content') {
    if (!hasRedis()) return res.status(503).json({ error: 'Redis not configured' });

    if (req.method === 'GET') {
      try {
        const results = await upstashPipeline([
          ['GET', 'admin:content:crisis_text'],
          ['GET', 'admin:content:announcement'],
          ['GET', 'admin:content:notice'],
          ['GET', 'admin:content:maintenance'],
        ]);
        return res.status(200).json({
          crisis:       results?.[0] || '',
          announcement: results?.[1] || '',
          notice:       results?.[2] || '',
          maintenance:  !!results?.[3],
        });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    if (req.method === 'POST') {
      try {
        const body = req.body || {};
        const cmds = [];
        if (body.crisis       !== undefined) cmds.push(['SET', 'admin:content:crisis_text',  body.crisis]);
        if (body.announcement !== undefined) cmds.push(['SET', 'admin:content:announcement', body.announcement || '']);
        if (body.notice       !== undefined) cmds.push(['SET', 'admin:content:notice',       body.notice || '']);
        if (body.maintenance  !== undefined) {
          if (body.maintenance) cmds.push(['SET', 'admin:content:maintenance', '1']);
          else                  cmds.push(['DEL', 'admin:content:maintenance']);
        }
        if (cmds.length) await upstashPipeline(cmds);
        return res.status(200).json({ ok: true });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }
  }

  // ── HEALTH ────────────────────────────────────────────────────────────────
  if (action === 'health') {
    const checks = {
      anthropic: process.env.ANTHROPIC_API_KEY     ? '✅ configured' : '❌ missing',
      paypal:    process.env.PAYPAL_CLIENT_ID       ? '✅ configured' : '❌ missing',
      resend:    process.env.RESEND_API_KEY         ? '✅ configured' : '❌ missing',
      upstash:   process.env.UPSTASH_REDIS_REST_URL ? '✅ configured' : '❌ missing',
      adminPwd:  adminPwd                           ? '✅ set'        : '❌ not set',
      redis:     'not checked',
    };
    if (hasRedis()) {
      const pong = await upstash(['PING']).catch(() => null);
      checks.redis = pong === 'PONG' ? '✅ connected' : '❌ error';
    } else {
      checks.redis = '❌ not configured';
    }
    return res.status(200).json({ checks, ts: new Date().toISOString() });
  }

  // ── APPROVE TODAY (admin panel button) ───────────────────────────────────────
  if (action === 'approve-today') {
    if (!hasRedis()) return res.status(503).json({ error: 'Redis not configured' });
    const today = new Date().toISOString().split('T')[0];
    await upstash(['SET', `ceo:approved:${today}`, JSON.stringify({ approvedAt: Date.now(), date: today, source: 'admin-panel' }), 'EX', 172800]);
    return res.status(200).json({ ok: true, date: today, message: 'Team approved for ' + today });
  }

  // ── TRIGGER DAILY BRIEF (admin panel button) ──────────────────────────────────
  if (action === 'daily-brief') {
    const host  = req.headers.host || 'www.orreryx.io';
    const proto = host.includes('localhost') ? 'http' : 'https';
    try {
      const r = await fetch(`${proto}://${host}/api/ceo-agent?action=daily-brief`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET || ''}` },
        signal: AbortSignal.timeout(55000),
      });
      const d = await r.json().catch(() => ({ raw: 'non-json response' }));
      return res.status(200).json({ ok: r.ok, result: d });
    } catch(e) {
      return res.status(200).json({ ok: false, error: e.message });
    }
  }

  // ── AGENT STATUS ─────────────────────────────────────────────────────────────
  if (action === 'agent-status') {
    if (!hasRedis()) return res.status(503).json({ error: 'Redis not configured' });
    try {
      const today = new Date().toISOString().split('T')[0];
      const results = await upstashPipeline([
        ['GET', 'coo:last_check'],           // 0
        ['GET', 'cfo:last_week'],            // 1
        ['GET', 'sales:last_scan'],          // 2
        ['GET', 'ceo:last_report'],          // 3
        ['GET', 'breaking:last_post_time'],  // 4
        ['GET', `ceo:approved:${today}`],    // 5
        ['GET', 'ideas:latest'],             // 6
        ['GET', 'seo:orchestrator:latest'],  // 7
        ['GET', 'seo:gsc:latest'],           // 8
        ['GET', 'seo:keywords:latest'],      // 9
        ['GET', 'seo:technical:latest'],     // 10
        ['GET', 'seo:content:latest'],       // 11
        ['GET', 'seo:auditor:latest'],       // 12
        ['GET', 'ops:last_run'],             // 13
        ['GET', 'churn:last_run'],           // 14
        ['GET', 'ads:last_run'],             // 15
        ['GET', 'ab:last_run'],              // 16
        ['GET', 'referral:last_run'],        // 17
        ['GET', 'cro:last_report'],          // 18
        ['GET', 'lm:last_run'],              // 19
        ['GET', 'community:last_run'],       // 20
        ['GET', 'directory:last_run'],       // 21
      ]);
      const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return v ? { ts: v } : null; } };
      return res.status(200).json({
        coo:             parse(results?.[0]),
        cfo:             parse(results?.[1]),
        sales:           parse(results?.[2]),
        ceo:             parse(results?.[3]),
        breaking:        results?.[4] ? { last_post_time: parseInt(results[4]) || results[4], ts: parseInt(results[4]) || null } : null,
        approved:        parse(results?.[5]),
        ideas:           parse(results?.[6]),
        seo_orchestrator: parse(results?.[7]),
        seo_gsc:         parse(results?.[8]),
        seo_keyword:     parse(results?.[9]),
        seo_technical:   parse(results?.[10]),
        seo_content:     parse(results?.[11]),
        seo_auditor:     parse(results?.[12]),
        ops:             parse(results?.[13]),
        churn:           parse(results?.[14]),
        ads:             parse(results?.[15]),
        ab:              parse(results?.[16]),
        referral:        parse(results?.[17]),
        cro:             parse(results?.[18]),
        lead_magnet:     parse(results?.[19]),
        community:       parse(results?.[20]),
        directory:       parse(results?.[21]),
        today,
      });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── SEO DASHBOARD ─────────────────────────────────────────────────────────────
  if (action === 'seo-dashboard') {
    if (!hasRedis()) return res.status(503).json({ error: 'Redis not configured' });
    try {
      const results = await upstashPipeline([
        ['GET', 'seo:gsc:latest'],
        ['GET', 'seo:keywords:latest'],
        ['GET', 'seo:technical:latest'],
        ['GET', 'seo:content:latest'],
        ['GET', 'seo:auditor:latest'],
        ['GET', 'seo:analytics:latest'],
        ['GET', 'seo:competitive:latest'],
        ['GET', 'seo:links:latest'],
        ['GET', 'seo:aeo:latest'],
        ['GET', 'seo:orchestrator:latest'],
        ['GET', 'seo:chief:latest'],
        ['GET', 'seo:geo:latest'],
      ]);
      const parse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
      return res.status(200).json({
        gsc:         parse(results?.[0]),
        keywords:    parse(results?.[1]),
        technical:   parse(results?.[2]),
        content:     parse(results?.[3]),
        auditor:     parse(results?.[4]),
        analytics:   parse(results?.[5]),
        competitive: parse(results?.[6]),
        links:       parse(results?.[7]),
        aeo:         parse(results?.[8]),
        orchestrator: parse(results?.[9]),
        chief:       parse(results?.[10]),
        geo:         parse(results?.[11]),
      });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── RUN AGENT ─────────────────────────────────────────────────────────────────
  if (action === 'run-agent') {
    const VALID_AGENTS = ['health-agent', 'finance-agent', 'sales-agent', 'ceo-agent', 'breaking-news', 'social-post', 'ideas-agent', 'legal-agent', 'seo-orchestrator', 'seo-keyword', 'seo-content', 'seo-technical', 'seo-aeo', 'seo-links', 'seo-analytics', 'seo-competitive', 'seo-auditor', 'seo-gsc', 'seo-chief', 'seo-geo', 'report-agent', 'ai-council'];
    // Accept short names (e.g. 'health') or full names (e.g. 'health-agent')
    const rawAgent = (req.query.agent || '').trim();
    const agentMap = {
      health: 'health-agent', finance: 'finance-agent', sales: 'sales-agent', ceo: 'ceo-agent',
      'breaking-news': 'breaking-news', 'social-post': 'social-post', ideas: 'ideas-agent', legal: 'legal-agent',
      'seo-orchestrator': 'seo-orchestrator', 'seo-keyword': 'seo-keyword',
      'seo-content': 'seo-content', 'seo-technical': 'seo-technical',
      'seo-aeo': 'seo-aeo', 'seo-links': 'seo-links', 'seo-analytics': 'seo-analytics',
      'seo-competitive': 'seo-competitive', 'seo-auditor': 'seo-auditor', 'seo-gsc': 'seo-gsc', 'seo-chief': 'seo-chief', 'seo-geo': 'seo-geo',
      'report-agent': 'report-agent', 'ai-council': 'ai-council',
    };
    const agentPath = agentMap[rawAgent] || (VALID_AGENTS.includes(rawAgent) ? rawAgent : null);
    if (!agentPath) return res.status(400).json({ error: 'Unknown agent: ' + rawAgent });

    const force    = req.query.force    === '1';
    const diagnose = req.query.diagnose === '1';
    const host  = req.headers.host || 'www.orreryx.io';
    const proto = host.includes('localhost') ? 'http' : 'https';
    // admin=1 bypasses CEO approval check — admin panel runs are always allowed
    const params = new URLSearchParams({ admin: '1' });
    if (force)    params.set('force', '1');
    if (diagnose) params.set('diagnose', '1');
    const url = `${proto}://${host}/api/${agentPath}?${params.toString()}`;

    try {
      const controller = new AbortController();
      const timeoutMs = agentPath === 'seo-orchestrator' ? 290000 : 50000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const cronSecret = process.env.CRON_SECRET || '';
      const r = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${cronSecret}`,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      const text = await r.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 800) }; }
      return res.status(200).json({ ok: r.ok, status: r.status, agent: agentPath, result: json });
    } catch(e) {
      return res.status(200).json({ ok: false, agent: agentPath, error: e.message });
    }
  }

  // ── TEST EMAIL ────────────────────────────────────────────────────────────────
  if (action === 'test-email') {
    const to = process.env.ADMIN_EMAIL;
    const gmailUser = process.env.GMAIL_USER;
    const gmailPass = process.env.GMAIL_APP_PASSWORD;
    const missing = [];
    if (!to)        missing.push('ADMIN_EMAIL');
    if (!gmailUser) missing.push('GMAIL_USER');
    if (!gmailPass) missing.push('GMAIL_APP_PASSWORD');
    if (missing.length) {
      return res.status(200).json({ ok: false, error: 'Missing env vars: ' + missing.join(', ') });
    }
    try {
      const { default: nodemailer } = await import('nodemailer');
      const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser, pass: gmailPass } });
      await transporter.sendMail({
        from: `OrreryX Test <${gmailUser}>`,
        to,
        subject: '✅ OrreryX email test — ' + new Date().toISOString(),
        html: '<p>Email delivery is working correctly from OrreryX agents.</p>'
      });
      return res.status(200).json({ ok: true, message: 'Test email sent to ' + to });
    } catch (err) {
      return res.status(200).json({ ok: false, error: err?.message || String(err) });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}

export const config = { api: { bodyParser: true } };

// api/lead-magnet-agent.js — Lead Magnet Agent
// Actions:
//   POST ?action=subscribe  { email, magnet }  — subscribe to lead magnet + send magnet email
//   GET  ?action=list                           — list all lead magnets + signup counts
//   GET  ?action=stats                          — signup stats across all magnets
//   Default cron (weekly Monday)               — generate fresh content ideas, email admin
// Required env vars: ANTHROPIC_API_KEY, RESEND_API_KEY, UPSTASH_REDIS_REST_URL,
//                    UPSTASH_REDIS_REST_TOKEN, ADMIN_EMAIL, CRON_SECRET

// ── Lead magnet catalog ───────────────────────────────────────────────────────

const MAGNETS = {
  'conflict-market-cheatsheet': {
    name:    'The Conflict-to-Market Cheat Sheet',
    subject: 'your conflict-market cheat sheet',
    slug:    'conflict-market-cheatsheet',
    url:     'https://orreryx.io/free/conflict-market-cheatsheet',
  },
  'weekly-briefing': {
    name:    'Weekly Geopolitical Risk Briefing',
    subject: 'welcome to the weekly briefing',
    slug:    'weekly-briefing',
    url:     'https://orreryx.io/free/weekly-briefing',
  },
  'war-stocks-watchlist': {
    name:    'War Stocks Watchlist',
    subject: 'your war stocks watchlist',
    slug:    'war-stocks-watchlist',
    url:     'https://orreryx.io/free/war-stocks-watchlist',
  },
  'hedge-fund-guide': {
    name:    'How to Read Geopolitical Risk Like a Hedge Fund Analyst',
    subject: 'your free hedge fund guide',
    slug:    'hedge-fund-guide',
    url:     'https://orreryx.io/free/hedge-fund-guide',
  },
  'iran-oil-report': {
    name:    'Iran Oil Risk Report',
    subject: 'your iran oil risk report',
    slug:    'iran-oil-report',
    url:     'https://orreryx.io/free/iran-oil-report',
  },
};

// ── Redis helpers ─────────────────────────────────────────────────────────────

async function upstashRaw(command) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(command),
    signal:  AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.result ?? null;
}

async function upstashGet(key) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal:  AbortSignal.timeout(6000),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.result ?? null;
}

async function upstashSet(key, value, exSeconds = null) {
  const cmd = exSeconds
    ? ['SET', key, typeof value === 'string' ? value : JSON.stringify(value), 'EX', exSeconds]
    : ['SET', key, typeof value === 'string' ? value : JSON.stringify(value)];
  return upstashRaw(cmd);
}

async function upstashIncr(key) {
  return upstashRaw(['INCR', key]);
}

// ── Email helper ──────────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  if (!to) return false;
  const resendKey = process.env.RESEND_API_KEY;
  const from      = process.env.EMAIL_FROM || 'OrreryX <noreply@orreryx.io>';
  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ from, to: to.trim(), subject, html }),
      });
      if (r.ok) return true;
    } catch (_) {}
  }
  try {
    const { default: nodemailer } = await import('nodemailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({ from: `OrreryX <${user}>`, to: to.trim(), subject, html });
    return true;
  } catch (err) { console.error('[LeadMagnet sendEmail]', err?.message || err); return false; }
}

// ── Lead magnet delivery emails ────────────────────────────────────────────────

function buildMagnetEmail(email, magnet) {
  const encodedEmail = encodeURIComponent(email);
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:580px;margin:0 auto;color:#111;background:#fff">
      <div style="padding:32px 32px 0">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;color:#9ca3af;text-transform:uppercase">OrreryX</p>
      </div>
      <div style="padding:24px 32px 32px">
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Hey,</p>

        <p style="margin:0 0 20px;font-size:15px;line-height:1.6">
          Here's your <strong>${magnet.name}</strong> — click below to access it.
        </p>

        <p style="margin:0 0 32px">
          <a href="${magnet.url}" style="display:inline-block;background:#0f172a;color:white;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:.01em">
            Open ${magnet.name} →
          </a>
        </p>

        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151">
          While you're here — OrreryX tracks 13 live conflict zones and shows which assets move as a result. Same intelligence hedge funds pay thousands for. Free trial at orreryx.io/app — takes 60 seconds.
        </p>

        <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6">
          — The OrreryX Team
        </p>
      </div>
      <div style="border-top:1px solid #f3f4f6;padding:16px 32px;text-align:center">
        <p style="margin:0;font-size:11px;color:#d1d5db">
          You requested this at orreryx.io ·
          <a href="https://orreryx.io/unsubscribe?email=${encodedEmail}" style="color:#d1d5db">Unsubscribe</a>
        </p>
      </div>
    </div>
  `;
}

// ── Claude: weekly lead magnet content ideas ───────────────────────────────────

async function generateMagnetIdeas() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are a content strategist for OrreryX, a real-time geopolitical risk platform for retail investors.

OrreryX tracks: Ukraine-Russia, Iran, Taiwan Strait, India-Pakistan, Gaza, North Korea, Sudan, South China Sea
Assets covered: Oil, Gold, Silver, Uranium, Copper, Wheat, Crypto, Defense stocks, Emerging markets
Audience: Retail investors (25–45), independent traders, financial analysts
Pricing: Starter $0.99, Analyst $14.99, Command $34.99/month

Generate 3 new lead magnet content ideas that would attract high-intent investors to OrreryX RIGHT NOW (based on what's happening globally in May 2026).

For each idea, provide:
- Title (compelling, specific)
- Format (PDF, email series, calculator, etc.)
- 3-bullet outline of key content
- Recommended landing page URL slug
- One subject line for the delivery email (2–4 words, lowercase)
- Why it will convert (tie to a current geopolitical situation)

Keep it specific and actionable. These need to be actually buildable.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5',
        max_tokens: 1000,
        messages:   [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.content?.[0]?.text || null;
  } catch (err) {
    console.error('[LeadMagnet Claude]', err?.message || err);
    return null;
  }
}

// ── Subscribe action ───────────────────────────────────────────────────────────

async function handleSubscribe(req, res) {
  let body = {};
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {}

  const email  = (body.email || '').trim().toLowerCase();
  const slug   = (body.magnet || '').trim();
  const magnet = MAGNETS[slug];

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  if (!magnet) {
    return res.status(400).json({ error: 'Unknown lead magnet', available: Object.keys(MAGNETS) });
  }

  // Store subscriber
  const subKey = `sub:${email}`;
  const existing = await upstashGet(subKey);
  let sub = {};
  try { sub = JSON.parse(existing || '{}'); } catch {}

  if (!sub.email) {
    sub.email      = email;
    sub.signedUpAt = new Date().toISOString();
  }
  sub[`lm_${slug}`] = new Date().toISOString();
  sub.source = sub.source || `lead-magnet:${slug}`;
  await upstashSet(subKey, sub);

  // Increment counters
  await upstashIncr(`lm:signups:${slug}`);
  await upstashIncr(`lm:signups:total`);

  // Send delivery email
  const html = buildMagnetEmail(email, magnet);
  const sent = await sendEmail(email, magnet.subject, html);

  return res.status(200).json({ ok: true, sent, magnet: magnet.name });
}

// ── List action ────────────────────────────────────────────────────────────────

async function handleList(res) {
  const counts = await Promise.all(
    Object.keys(MAGNETS).map(async slug => {
      const count = await upstashGet(`lm:signups:${slug}`);
      return { slug, name: MAGNETS[slug].name, signups: parseInt(count) || 0 };
    })
  );
  const total = await upstashGet('lm:signups:total');
  return res.status(200).json({ ok: true, magnets: counts, totalSignups: parseInt(total) || 0 });
}

// ── Stats action ───────────────────────────────────────────────────────────────

async function handleStats(res) {
  const total = await upstashGet('lm:signups:total');
  const topSlug = Object.keys(MAGNETS).reduce(async (accP, slug) => {
    const acc = await accP;
    const count = parseInt(await upstashGet(`lm:signups:${slug}`)) || 0;
    return count > acc.count ? { slug, count } : acc;
  }, Promise.resolve({ slug: null, count: 0 }));

  return res.status(200).json({
    ok:          true,
    totalSignups: parseInt(total) || 0,
    magnets:     Object.keys(MAGNETS).length,
    catalog:     Object.keys(MAGNETS),
  });
}

// ── Cron: weekly ideas + admin email ──────────────────────────────────────────

async function handleCron(res) {
  const adminEmail = process.env.ADMIN_EMAIL;

  // Collect signup stats
  const signupCounts = await Promise.all(
    Object.keys(MAGNETS).map(async slug => {
      const count = await upstashGet(`lm:signups:${slug}`);
      return { slug, name: MAGNETS[slug].name, signups: parseInt(count) || 0 };
    })
  );
  const totalSignups = await upstashGet('lm:signups:total');

  // Generate new ideas
  const ideas = await generateMagnetIdeas();

  if (adminEmail) {
    const ideasHtml = ideas
      ? ideas.replace(/\n/g, '<br>').replace(/IDEA \d+:/g, s => `<strong style="color:#0f172a">${s}</strong>`)
      : '<p style="color:#6b7280">Claude unavailable — check ANTHROPIC_API_KEY.</p>';

    const statsRows = signupCounts.map(m =>
      `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:8px 0;font-size:13px;color:#374151">${m.name}</td>
        <td style="padding:8px 0;font-size:13px;font-weight:600;text-align:right">${m.signups}</td>
      </tr>`
    ).join('');

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;color:#111;background:#fff">
        <div style="background:#0f172a;color:white;padding:24px 32px">
          <p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;color:#94a3b8;text-transform:uppercase">OrreryX Lead Magnet Agent</p>
          <h1 style="margin:0;font-size:18px;font-weight:700">Weekly Lead Magnet Report</h1>
          <p style="margin:4px 0 0;font-size:13px;color:#94a3b8">${new Date().toISOString().slice(0, 10)}</p>
        </div>
        <div style="padding:24px 32px">
          <h2 style="margin:0 0 12px;font-size:14px;font-weight:600;color:#374151">Signup Stats (All-Time)</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:28px">
            ${statsRows}
            <tr>
              <td style="padding:10px 0;font-size:14px;font-weight:700;color:#0f172a">Total</td>
              <td style="padding:10px 0;font-size:14px;font-weight:700;text-align:right;color:#0f172a">${parseInt(totalSignups) || 0}</td>
            </tr>
          </table>
          <h2 style="margin:0 0 16px;font-size:14px;font-weight:600;color:#374151">New Content Ideas This Week</h2>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;font-size:14px;line-height:1.7;color:#374151">
            ${ideasHtml}
          </div>
        </div>
        <div style="border-top:1px solid #f3f4f6;padding:16px 32px;text-align:center">
          <p style="margin:0;font-size:11px;color:#d1d5db">OrreryX Lead Magnet Agent · auto-generated weekly</p>
        </div>
      </div>
    `;
    await sendEmail(adminEmail, 'lead magnet report', html);
  }

  // Store last run
  await upstashSet('lm:last_run', { ts: Date.now(), totalSignups: parseInt(totalSignups) || 0 });

  return res.status(200).json({
    ok:          true,
    totalSignups: parseInt(totalSignups) || 0,
    ideasLength:  ideas?.length || 0,
    magnets:     signupCounts,
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const cronSecret  = process.env.CRON_SECRET;
  const querySecret = req.query.secret;
  const authHeader  = req.headers['authorization'];
  if (cronSecret && querySecret !== cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Public subscribe endpoint doesn't need CRON_SECRET
    if (req.query.action !== 'subscribe') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const action = req.query.action;

  if (action === 'subscribe' && req.method === 'POST') return handleSubscribe(req, res);
  if (action === 'list')  return handleList(res);
  if (action === 'stats') return handleStats(res);

  // Default: cron job
  return handleCron(res);
}

export const config = { api: { bodyParser: false } };

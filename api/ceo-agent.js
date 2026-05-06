// api/ceo-agent.js — CEO Agent: Weekly digest + Daily Brief + CEO Approval workflow
import { createHmac } from 'crypto';

// Original header:
// Runs every Sunday at 9:00 PM IST via cron-job.org (reads a full week of data)
// Reads health data from Redis (coo:last_check), analytics, finance snapshot
// Calls Claude Haiku to generate a 150-word executive summary
// Emails the weekly digest to ADMIN_EMAIL
// Required env vars: RESEND_API_KEY, ADMIN_EMAIL, UPSTASH_REDIS_REST_URL,
//                    UPSTASH_REDIS_REST_TOKEN, ANTHROPIC_API_KEY, CRON_SECRET

// ── Redis helpers ─────────────────────────────────────────────────────────────

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

// ── Claude Haiku call ─────────────────────────────────────────────────────────

async function generateSummary(context) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return 'AI summary unavailable — ANTHROPIC_API_KEY not set.';

  const prompt = `You are the CEO of Orrery, a real-time geopolitical risk intelligence platform for investors.

Here is this week's operational data:

${context}

Write a concise executive digest in exactly 3 short paragraphs (≤150 words total):
1. Platform health & technical status
2. Growth metrics — what's working, what needs attention
3. One clear strategic priority for next week

Be direct and actionable. No fluff. Speak like a sharp founder reviewing the week.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5',
      max_tokens: 350,
      messages:   [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);

  if (!r || !r.ok) return 'AI summary unavailable — Claude API error.';
  const j = await r.json().catch(() => null);
  return j?.content?.[0]?.text?.trim() || 'AI summary unavailable.';
}

// ── Email helper ──────────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return;
  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      from:    'Orrery CEO Agent <coo@orreryx.io>',
      to:      [to],
      subject,
      html,
    }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}

// ── Approval token helpers ────────────────────────────────────────────────────

function makeApprovalToken(date, secret) {
  return createHmac('sha256', secret).update(`approve:${date}`).digest('hex').slice(0, 32);
}

function verifyApprovalToken(date, token, secret) {
  if (!date || !token || !secret) return false;
  const expected = makeApprovalToken(date, secret);
  return token === expected;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const cronSecret  = process.env.CRON_SECRET;
  const querySecret = req.query.secret;
  const authHeader  = req.headers['authorization'];
  const action      = req.query.action || '';

  // Allow approve action without auth (it has its own token check)
  if (action !== 'approve') {
    if (cronSecret && querySecret !== cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const upstashUrl   = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  // ── APPROVE ACTION — CEO clicks the email link ────────────────────────────────
  if (action === 'approve') {
    const date  = req.query.date || new Date().toISOString().split('T')[0];
    const token = req.query.token || '';
    if (!cronSecret || !verifyApprovalToken(date, token, cronSecret)) {
      return res.status(403).send(`
        <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#09090b;color:#f0f0ec">
          <h2 style="color:#e03836">❌ Invalid or expired approval link</h2>
          <p style="color:#888">This link may have expired. Request a new daily brief from the admin panel.</p>
        </body></html>`);
    }
    // Set approval in Redis (48h TTL so it covers any time zone lag)
    if (upstashUrl && upstashToken) {
      await fetch(upstashUrl, {
        method:  'POST',
        headers: { Authorization: `Bearer ${upstashToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(['SET', `ceo:approved:${date}`, JSON.stringify({ approvedAt: Date.now(), date }), 'EX', 172800]),
      }).catch(() => {});
    }
    return res.status(200).send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#09090b;color:#f0f0ec">
        <div style="max-width:500px;margin:0 auto">
          <div style="font-size:60px;margin-bottom:20px">✅</div>
          <h2 style="color:#3ab860;margin-bottom:8px">Team Approved for ${date}</h2>
          <p style="color:#888;margin-bottom:32px">All agents will now execute on their next scheduled run. Breaking News agent will post on the next 3-hour cycle.</p>
          <a href="https://www.orreryx.io/admin" style="background:#3ab860;color:#000;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">← Back to Admin Panel</a>
        </div>
      </body></html>`);
  }

  // ── DAILY BRIEF ACTION — generates plan + ideas, emails CEO for approval ──────
  if (action === 'daily-brief') {
    const today    = new Date().toISOString().split('T')[0];
    const host     = req.headers.host || 'www.orreryx.io';
    const proto    = host.includes('localhost') ? 'http' : 'https';
    const baseUrl  = `${proto}://${host}`;

    // Read agent statuses + ideas from Redis
    const [cooRaw, cfoRaw, salesRaw, breakingRaw, ideasRaw, pvTotal, signupTotal] = await Promise.all([
      upstashGet('coo:last_check'),
      upstashGet('cfo:last_week'),
      upstashGet('sales:last_scan'),
      upstashGet('breaking:last_post_time'),
      upstashGet('ideas:latest'),
      upstashGet('analytics:pv:total'),
      upstashGet('analytics:signup:total'),
    ]);

    const coo     = cooRaw     ? (typeof cooRaw === 'string' ? JSON.parse(cooRaw) : cooRaw) : null;
    const cfo     = cfoRaw     ? (typeof cfoRaw === 'string' ? JSON.parse(cfoRaw) : cfoRaw) : null;
    const sales   = salesRaw   ? (typeof salesRaw === 'string' ? JSON.parse(salesRaw) : salesRaw) : null;
    const ideas   = ideasRaw   ? (typeof ideasRaw === 'string' ? JSON.parse(ideasRaw) : ideasRaw) : null;

    // If no ideas yet, trigger ideas agent inline
    let ideasData = ideas;
    if (!ideasData || ideasData.date !== today) {
      try {
        const r = await fetch(`${baseUrl}/api/ideas-agent`, {
          headers: { Authorization: `Bearer ${cronSecret || ''}` },
          signal: AbortSignal.timeout(30000),
        });
        if (r.ok) {
          const d = await r.json();
          ideasData = d.ideas ? { ...d.ideas, date: today } : null;
        }
      } catch (_) {}
    }

    const approvalToken = cronSecret ? makeApprovalToken(today, cronSecret) : 'no-secret-set';
    const approveUrl    = `${baseUrl}/api/ceo-agent?action=approve&date=${today}&token=${approvalToken}`;

    const cooStatus   = coo ? (coo.allOk ? '✅ All systems operational' : `⚠️ ${(coo.results || []).filter(r => !r.ok).length} issue(s) detected`) : '⏳ Not run yet today';
    const cfoStatus   = cfo ? `✅ MRR $${(cfo.mrr || 0).toLocaleString()} · ${cfo.signups || 0} signups` : '⏳ Will run Monday';
    const salesStatus = sales ? `✅ ${sales.total || 0} subscribers scanned · ${(sales.day3 || 0) + (sales.day7 || 0)} emails queued` : '⏳ Not run yet today';
    const breakingStatus = breakingRaw ? `✅ Last post: ${Math.round((Date.now() - parseInt(breakingRaw)) / 60000)}m ago` : '⏳ No post yet today';

    const ideasHtml = ideasData ? `
      <tr><td colspan="3" style="padding:0"><table style="width:100%;border-collapse:collapse">
        ${(ideasData.social_posts || []).map((p, i) => `
          <tr style="border-bottom:1px solid #f3f4f6;background:${i % 2 === 0 ? '#fff' : '#fafafa'}">
            <td style="padding:10px 14px;font-size:12px;color:#6b7280;width:80px">${p.platform}</td>
            <td style="padding:10px 14px;font-size:13px;color:#111"><strong>${p.hook}</strong>${p.angle ? `<br><span style="color:#6b7280;font-size:11px">${p.angle}</span>` : ''}</td>
          </tr>`).join('')}
        <tr style="background:#fffbeb">
          <td style="padding:10px 14px;font-size:12px;color:#92400e">💡 Product</td>
          <td style="padding:10px 14px;font-size:13px;color:#111"><strong>${ideasData.product_idea?.title || ''}</strong><br><span style="color:#6b7280;font-size:11px">${ideasData.product_idea?.description || ''}</span></td>
        </tr>
        <tr style="background:#f0fdf4">
          <td style="padding:10px 14px;font-size:12px;color:#166534">🧪 Growth</td>
          <td style="padding:10px 14px;font-size:13px;color:#111"><strong>${ideasData.growth_experiment?.title || ''}</strong><br><span style="color:#6b7280;font-size:11px">${ideasData.growth_experiment?.hypothesis || ''}</span></td>
        </tr>
      </table></td></tr>` : `<tr><td colspan="3" style="padding:12px;color:#9ca3af;text-align:center">No ideas generated yet — run Ideas Agent first</td></tr>`;

    const html = `
    <div style="font-family:sans-serif;max-width:680px;margin:0 auto;color:#111">
      <div style="background:#09090b;padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <div style="font-size:40px;margin-bottom:8px">🤖</div>
        <h1 style="color:#f0f0ec;margin:0;font-size:22px">CEO Daily Brief</h1>
        <p style="color:#666;margin:6px 0 0;font-size:13px">${today} · Your AI team is ready and waiting for approval</p>
      </div>

      <div style="background:#fff1f2;border-left:4px solid #e03836;padding:16px 20px">
        <strong style="color:#dc2626">⏳ ACTION REQUIRED — Approve your team to start working</strong><br>
        <span style="font-size:13px;color:#6b7280">Until you approve, agents will not execute their tasks today.</span>
      </div>

      <!-- Agent plans -->
      <div style="padding:20px">
        <h3 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Today's Team Plans</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <thead>
            <tr style="background:#f9fafb">
              <th style="padding:10px 14px;text-align:left;color:#6b7280;font-weight:600;width:160px">Agent</th>
              <th style="padding:10px 14px;text-align:left;color:#6b7280;font-weight:600;width:120px">Schedule</th>
              <th style="padding:10px 14px;text-align:left;color:#6b7280;font-weight:600">Plan & Last Status</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-top:1px solid #f3f4f6">
              <td style="padding:12px 14px"><strong>🏥 COO</strong><br><span style="color:#9ca3af;font-size:11px">Health Watchdog</span></td>
              <td style="padding:12px 14px;color:#6b7280;font-size:12px">Daily 7:00 AM</td>
              <td style="padding:12px 14px">Check all APIs, Redis, feed freshness<br><span style="color:#6b7280;font-size:11px">${cooStatus}</span></td>
            </tr>
            <tr style="border-top:1px solid #f3f4f6;background:#fafafa">
              <td style="padding:12px 14px"><strong>💰 CFO</strong><br><span style="color:#9ca3af;font-size:11px">Finance Report</span></td>
              <td style="padding:12px 14px;color:#6b7280;font-size:12px">Monday 8:00 AM</td>
              <td style="padding:12px 14px">Compile P&L, MRR, week-over-week<br><span style="color:#6b7280;font-size:11px">${cfoStatus}</span></td>
            </tr>
            <tr style="border-top:1px solid #f3f4f6">
              <td style="padding:12px 14px"><strong>📧 Sales</strong><br><span style="color:#9ca3af;font-size:11px">Nurture Sequences</span></td>
              <td style="padding:12px 14px;color:#6b7280;font-size:12px">Daily 9:00 AM</td>
              <td style="padding:12px 14px">Scan subscribers, send Day 3 + Day 7 emails<br><span style="color:#6b7280;font-size:11px">${salesStatus}</span></td>
            </tr>
            <tr style="border-top:1px solid #f3f4f6;background:#fafafa">
              <td style="padding:12px 14px"><strong>📡 Breaking News</strong><br><span style="color:#9ca3af;font-size:11px">Live Social Posts</span></td>
              <td style="padding:12px 14px;color:#6b7280;font-size:12px">Every 3 hours</td>
              <td style="padding:12px 14px">Score GDELT events, post top story to Twitter + LinkedIn<br><span style="color:#6b7280;font-size:11px">${breakingStatus}</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Ideas section -->
      <div style="padding:0 20px 20px">
        <h3 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">💡 Ideas Agent — Today's Suggestions</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
          <tbody>${ideasHtml}</tbody>
        </table>
      </div>

      <!-- Approve button -->
      <div style="padding:20px;text-align:center;border-top:1px solid #f3f4f6">
        <a href="${approveUrl}" style="display:inline-block;background:#3ab860;color:#000;padding:16px 40px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:.02em">
          ✅ APPROVE TEAM — START WORKING
        </a>
        <p style="color:#9ca3af;font-size:11px;margin-top:12px">One click — agents will run on their next scheduled cycle all day today</p>
        <p style="color:#9ca3af;font-size:10px">Or approve from admin panel: <a href="${baseUrl}/admin" style="color:#4a8fe0">orreryx.io/admin</a></p>
      </div>

      <div style="background:#f9fafb;padding:14px;text-align:center;border-top:1px solid #e5e7eb;border-radius:0 0 8px 8px">
        <span style="color:#9ca3af;font-size:11px">— Orrery CEO Daily Brief · ${today} · Sent at ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</span>
      </div>
    </div>`;

    if (adminEmail) {
      await sendEmail(adminEmail, `🤖 CEO Daily Brief — ${today} — APPROVAL NEEDED`, html);
    }

    return res.status(200).json({
      ok:          true,
      date:        today,
      approveUrl,
      emailSent:   !!adminEmail,
      ideasLoaded: !!ideasData,
    });
  }

  // ── Continue with weekly digest (default action) ──────────────────────────────

  // ── Pull data from Redis ──────────────────────────────────────────────────────
  const [
    healthRaw,
    pvTotal,
    signupTotal,
    paymentTotal,
    plansRaw,
    financeRaw,
    socialRaw,
  ] = await Promise.all([
    upstashGet('coo:last_check'),
    upstashGet('analytics:pv:total'),
    upstashGet('analytics:signup:total'),
    upstashGet('analytics:payment:total'),
    upstashGet('analytics:plans'),
    upstashGet('cfo:last_week'),
    upstashGet('cmo:last_post'),
  ]);

  let health   = {};  try { health   = JSON.parse(healthRaw  || '{}'); } catch {}
  let finance  = {};  try { finance  = JSON.parse(financeRaw || '{}'); } catch {}
  let plans    = {};  try { plans    = JSON.parse(plansRaw   || '{}'); } catch {}
  let social   = {};  try { social   = JSON.parse(socialRaw  || '{}'); } catch {}

  const pageViews = parseInt(pvTotal)    || 0;
  const signups   = parseInt(signupTotal) || 0;
  const payments  = parseInt(paymentTotal) || 0;

  // Calculate MRR
  const PLAN_PRICES = { pro: 29, premium: 79, enterprise: 299 };
  let mrr = 0;
  for (const [plan, count] of Object.entries(plans)) {
    mrr += (PLAN_PRICES[plan] || 0) * (parseInt(count) || 0);
  }

  // Health summary
  const healthChecks  = health.results || [];
  const healthAllOk   = health.allOk ?? true;
  const failedChecks  = healthChecks.filter(c => !c.ok).map(c => c.name);
  const healthSummary = healthAllOk
    ? '✅ All 5 services operational'
    : `🚨 ${failedChecks.length} service(s) failing: ${failedChecks.join(', ')}`;

  // Build context string for Claude
  const contextStr = `
PLATFORM HEALTH (last check: ${health.time || 'unknown'}):
${healthSummary}
Services checked: ${healthChecks.map(c => `${c.name} — ${c.ok ? 'OK' : 'FAIL'} (${c.ms}ms)`).join('; ')}

GROWTH METRICS (cumulative):
- Page Views: ${pageViews.toLocaleString()}
- Signups: ${signups.toLocaleString()}
- Paid Customers: ${payments.toLocaleString()}
- MRR: $${mrr.toLocaleString()}
- Visitor→Signup: ${pageViews ? ((signups/pageViews)*100).toFixed(2) : 0}%
- Signup→Paid: ${signups ? ((payments/signups)*100).toFixed(1) : 0}%

PLAN BREAKDOWN: ${JSON.stringify(plans)}

WEEK-OVER-WEEK DELTA (from CFO snapshot):
- MRR change: $${finance.mrrDelta ?? 'N/A'}
- Weekly page views: ${finance.weeklyPV ?? 'N/A'}
- Weekly signups: ${finance.weeklySignups ?? 'N/A'}
- Weekly new paid: ${finance.weeklyPayments ?? 'N/A'}

SOCIAL / MARKETING:
${social.lastPost ? `Last social post: ${social.lastPost}` : 'No social post data in Redis yet'}
`.trim();

  // Generate AI summary
  const aiSummary = await generateSummary(contextStr);

  // Build health check rows
  const checkRows = healthChecks.map(c => `
    <tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:8px 12px;font-size:13px">${c.name}</td>
      <td style="padding:8px 12px;font-size:13px;color:${c.ok ? '#16a34a' : '#dc2626'};font-weight:600">${c.ok ? '✅' : '❌'}</td>
      <td style="padding:8px 12px;font-size:13px;color:#6b7280">${c.ms}ms</td>
      <td style="padding:8px 12px;font-size:13px;color:#374151">${c.info || ''}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="padding:12px;color:#9ca3af;text-align:center">No health check data available yet</td></tr>';

  const now = new Date();

  const html = `
    <div style="font-family:sans-serif;max-width:680px;margin:0 auto;color:#111">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:28px;border-radius:8px 8px 0 0">
        <h1 style="color:white;margin:0;font-size:24px">🤖 CEO Weekly Digest</h1>
        <p style="color:#94a3b8;margin:6px 0 0">Week of ${now.toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
      </div>

      <!-- AI Executive Summary -->
      <div style="background:#fffbeb;padding:20px 24px;border-left:4px solid #f59e0b">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#92400e">🤖 Claude AI Executive Summary</p>
        <p style="margin:0;font-size:15px;line-height:1.7;white-space:pre-wrap;color:#111">${aiSummary}</p>
      </div>

      <!-- KPI snapshot -->
      <div style="background:#f9fafb;padding:4px 0">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:16px;text-align:center;border-right:1px solid #e5e7eb">
              <p style="margin:0;font-size:11px;color:#9ca3af;text-transform:uppercase">MRR</p>
              <p style="margin:4px 0 0;font-size:26px;font-weight:700;color:#16a34a">$${mrr.toLocaleString()}</p>
              ${finance.mrrDelta !== undefined ? `<p style="margin:2px 0 0;font-size:12px;color:${finance.mrrDelta >= 0 ? '#16a34a' : '#dc2626'}">${finance.mrrDelta >= 0 ? '▲' : '▼'} $${Math.abs(finance.mrrDelta || 0)} vs last week</p>` : ''}
            </td>
            <td style="padding:16px;text-align:center;border-right:1px solid #e5e7eb">
              <p style="margin:0;font-size:11px;color:#9ca3af;text-transform:uppercase">Paid Users</p>
              <p style="margin:4px 0 0;font-size:26px;font-weight:700">${payments.toLocaleString()}</p>
              ${finance.weeklyPayments !== undefined ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280">+${finance.weeklyPayments} this week</p>` : ''}
            </td>
            <td style="padding:16px;text-align:center;border-right:1px solid #e5e7eb">
              <p style="margin:0;font-size:11px;color:#9ca3af;text-transform:uppercase">Total Signups</p>
              <p style="margin:4px 0 0;font-size:26px;font-weight:700">${signups.toLocaleString()}</p>
              ${finance.weeklySignups !== undefined ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280">+${finance.weeklySignups} this week</p>` : ''}
            </td>
            <td style="padding:16px;text-align:center">
              <p style="margin:0;font-size:11px;color:#9ca3af;text-transform:uppercase">Page Views</p>
              <p style="margin:4px 0 0;font-size:26px;font-weight:700">${pageViews.toLocaleString()}</p>
              ${finance.weeklyPV !== undefined ? `<p style="margin:2px 0 0;font-size:12px;color:#6b7280">+${finance.weeklyPV.toLocaleString()} this week</p>` : ''}
            </td>
          </tr>
        </table>
      </div>

      <!-- Platform health -->
      <div style="padding:16px 20px 4px">
        <h3 style="margin:0 0 8px;font-size:13px;color:#374151;text-transform:uppercase;letter-spacing:.05em">Platform Health (COO Report)</h3>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px 12px;text-align:left">Service</th>
            <th style="padding:8px 12px;text-align:left">Status</th>
            <th style="padding:8px 12px;text-align:left">Latency</th>
            <th style="padding:8px 12px;text-align:left">Details</th>
          </tr>
        </thead>
        <tbody>${checkRows}</tbody>
      </table>

      <!-- Agent status -->
      <div style="background:#f0f9ff;padding:16px 20px;margin-top:0;border-top:1px solid #e0f2fe">
        <p style="margin:0;font-size:13px;color:#0369a1">
          <strong>Active Agents:</strong> 🤖 CEO &nbsp;|&nbsp; 📊 CFO &nbsp;|&nbsp; 📡 COO &nbsp;|&nbsp; 📬 Sales<br>
          <strong>Next digest:</strong> Sunday 9 PM IST &nbsp;|&nbsp; <strong>Health check:</strong> Daily 7 AM IST
        </p>
      </div>

      <p style="color:#9ca3af;font-size:11px;padding:16px;text-align:center">
        — Orrery CEO Agent · Weekly digest every Sunday 9 PM IST<br>
        Data sources: COO health check · CFO finance snapshot · Analytics Redis keys
      </p>
    </div>
  `;

  if (adminEmail) {
    const status = healthAllOk ? '✅ All systems go' : `🚨 ${failedChecks.length} issue(s)`;
    await sendEmail(
      adminEmail,
      `🤖 CEO Weekly Digest — MRR $${mrr.toLocaleString()} · ${status}`,
      html,
    );
  }

  // Save status for admin panel
  if (upstashUrl && upstashToken) {
    await fetch(upstashUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${upstashToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', 'ceo:last_report', JSON.stringify({
        ts: Date.now(), time: now.toISOString(), mrr, pageViews, signups, payments, healthAllOk,
      })]),
    }).catch(() => {});
  }

  return res.status(200).json({
    ok: true,
    mrr,
    pageViews,
    signups,
    payments,
    healthAllOk,
    aiSummaryLength: aiSummary.length,
    time: now.toISOString(),
  });
}

export const config = { api: { bodyParser: false } };

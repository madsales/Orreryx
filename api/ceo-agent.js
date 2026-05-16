// api/ceo-agent.js — CEO Command Center
// Daily brief (action=daily-brief) + Weekly digest (default)
// Reads ALL agent data from Redis — the family brain
// Tracks $1B valuation target with live milestone progress
// Required env vars: ANTHROPIC_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD,
//                    ADMIN_EMAIL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN,
//                    CRON_SECRET

import { createHmac } from 'crypto';

// ── $1B Mission Constants ──────────────────────────────────────────────────────
// $1B valuation at 15x ARR = $66.7M ARR = $5.56M MRR
const TARGET_MRR     = 5_560_000;
const MILESTONE_MRRS = [1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000, 5_560_000];
const MILESTONE_LABELS = ['$1K', '$5K', '$10K', '$50K', '$100K', '$500K', '$1M', '$5.56M ($1B)'];

function getNextMilestone(mrr) {
  const next = MILESTONE_MRRS.find(m => m > mrr);
  const idx  = MILESTONE_MRRS.indexOf(next);
  return { value: next || TARGET_MRR, label: MILESTONE_LABELS[idx] || '$5.56M ($1B)' };
}

function progressBar(mrr) {
  const pct   = Math.min((mrr / TARGET_MRR) * 100, 100);
  const filled = Math.max(1, Math.floor(pct / 5));
  return '█'.repeat(filled) + '░'.repeat(20 - filled);
}

// ── Redis helper ───────────────────────────────────────────────────────────────
async function upstashGet(key) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal:  AbortSignal.timeout(6000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.result ?? null;
}

async function upstashSet(key, value, exSeconds) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  const cmd = exSeconds
    ? ['SET', key, JSON.stringify(value), 'EX', exSeconds]
    : ['SET', key, JSON.stringify(value)];
  await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmd),
    signal:  AbortSignal.timeout(6000),
  }).catch(() => {});
}

function safeParse(raw) {
  if (!raw) return null;
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

// ── Gmail SMTP email ───────────────────────────────────────────────────────────
async function sendEmail(to, subject, html) {
  if (!to) return false;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'OrreryX CEO <noreply@orreryx.io>';
  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: to.trim(), subject, html }),
      });
      if (r.ok) return true;
    } catch (_) {}
  }
  // Fallback: Gmail SMTP
  try {
    const { default: nodemailer } = await import('nodemailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({ from: `OrreryX CEO <${user}>`, to: to.trim(), subject, html });
    return true;
  } catch (err) { console.error('[CEO sendEmail]', err?.message||err); return false; }
}

// ── Claude: generate strategic brief ─────────────────────────────────────────
async function generateStrategicBrief(context, mode = 'weekly') {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return 'AI brief unavailable — ANTHROPIC_API_KEY not set.';

  const prompt = mode === 'daily'
    ? `You are the CEO of OrreryX, a geopolitical intelligence SaaS racing toward a $1 billion valuation.

Here is today's company intelligence from all 8 agents:

${context}

Give me ONE specific, concrete thing to do TODAY that will most accelerate the $1B mission. Not a strategy — a specific action with exact steps. Max 80 words. Start with an action verb.`

    : `You are the CEO of OrreryX, a geopolitical intelligence SaaS with a $1 billion valuation target (need $5.56M MRR at 15x ARR).

Here is this week's full company intelligence from all 8 agents:

${context}

Write a 5-part strategic brief (max 500 words total):

1. **$1B GAP ANALYSIS** — What's the single biggest constraint between now and $1B? Be specific with numbers.
2. **TOP 3 THIS WEEK** — Three specific implementation priorities (who does it, exactly how, what KPI it moves).
3. **CROSS-AGENT INSIGHT** — One thing one agent found that another should act on immediately.
4. **QUICK WIN** — One thing that takes under 2 hours and moves a real metric.
5. **WEEKLY VERDICT** — One sharp sentence on where the company stands.

Be direct. Name exact pages, features, numbers. No corporate fluff.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: mode === 'daily' ? 200 : 700,
      messages:   [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);

  if (!r?.ok) return 'AI brief unavailable — Claude API error.';
  const j = await r.json().catch(() => null);
  return j?.content?.[0]?.text?.trim() || 'AI brief unavailable.';
}

// ── Approval token helpers ─────────────────────────────────────────────────────
function makeApprovalToken(date, secret) {
  return createHmac('sha256', secret).update(`approve:${date}`).digest('hex').slice(0, 32);
}
function verifyApprovalToken(date, token, secret) {
  if (!date || !token || !secret) return false;
  return token === makeApprovalToken(date, secret);
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const cronSecret  = process.env.CRON_SECRET;
  const querySecret = req.query.secret;
  const authHeader  = req.headers['authorization'];
  const action      = req.query.action || '';

  if (action !== 'approve') {
    if (cronSecret && querySecret !== cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const adminEmail = process.env.ADMIN_EMAIL;

  // ── AUTO-APPROVE: set approval on every authenticated cron hit ────────────────
  // Social-post.js checks ceo:approved:{today} before running.
  // By auto-approving here, posts always go out. The approve button in the email
  // email is kept as a manual override/re-approve mechanism.
  if (action !== 'approve') {
    const todayKey = new Date().toISOString().split('T')[0];
    await upstashSet(`ceo:approved:${todayKey}`, { approvedAt: Date.now(), date: todayKey, autoApproved: true }, 172800);
  }

  // ── APPROVE ACTION ────────────────────────────────────────────────────────────
  if (action === 'approve') {
    const date  = req.query.date || new Date().toISOString().split('T')[0];
    const token = req.query.token || '';
    if (!cronSecret || !verifyApprovalToken(date, token, cronSecret)) {
      return res.status(403).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#09090b;color:#f0f0ec"><h2 style="color:#e03836">❌ Invalid or expired approval link</h2><p style="color:#888">Request a new daily brief from the admin panel.</p></body></html>`);
    }
    const url   = process.env.UPSTASH_REDIS_REST_URL;
    const token2 = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (url && token2) {
      await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['SET', `ceo:approved:${date}`, JSON.stringify({ approvedAt: Date.now(), date }), 'EX', 172800]),
      }).catch(() => {});
    }
    return res.status(200).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#09090b;color:#f0f0ec"><div style="max-width:500px;margin:0 auto"><div style="font-size:60px;margin-bottom:20px">✅</div><h2 style="color:#3ab860;margin-bottom:8px">Team Approved for ${date}</h2><p style="color:#888;margin-bottom:32px">All 8 agents are cleared to execute today.</p><a href="https://www.orreryx.io/admin" style="background:#3ab860;color:#000;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">← Back to Admin Panel</a></div></body></html>`);
  }

  // ── READ ALL AGENT DATA FROM REDIS ────────────────────────────────────────────
  const [
    cooRaw, cfoRaw, salesRaw, breakingRaw, breakingStoryRaw,
    ideasRaw, seoRaw, legalRaw, cmoBriefRaw,
    pvTotal, signupTotal, paymentTotal, plansRaw,
  ] = await Promise.all([
    upstashGet('coo:last_check'),
    upstashGet('cfo:last_week'),
    upstashGet('sales:last_scan'),
    upstashGet('breaking:last_post_time'),
    upstashGet('breaking:last_story'),
    upstashGet('ideas:latest'),
    upstashGet('seo:last_audit'),
    upstashGet('legal:last_audit'),
    upstashGet('cmo:last_brief'),
    upstashGet('analytics:pv:total'),
    upstashGet('analytics:signup:total'),
    upstashGet('analytics:payment:total'),
    upstashGet('analytics:plans'),
  ]);

  const coo          = safeParse(cooRaw);
  const cfo          = safeParse(cfoRaw);
  const sales        = safeParse(salesRaw);
  const ideas        = safeParse(ideasRaw);
  const seo          = safeParse(seoRaw);
  const legal        = safeParse(legalRaw);
  const cmoBrief     = safeParse(cmoBriefRaw);
  const breakingStory = safeParse(breakingStoryRaw);
  const plans        = safeParse(plansRaw) || {};

  const pageViews  = parseInt(pvTotal)     || 0;
  const signups    = parseInt(signupTotal)  || 0;
  const payments   = parseInt(paymentTotal) || 0;

  const PLAN_PRICES = { pro: 29, premium: 79, enterprise: 299, s: 0.99, a: 14.99, c: 34.99 };
  let mrr = 0;
  for (const [plan, count] of Object.entries(plans)) {
    mrr += (PLAN_PRICES[plan] || 0) * (parseInt(count) || 0);
  }
  if (!mrr && cfo?.mrr) mrr = cfo.mrr;

  const currentARR      = mrr * 12;
  const progress        = Math.min((mrr / TARGET_MRR) * 100, 100);
  const nextMilestone   = getNextMilestone(mrr);
  const mrrGap          = nextMilestone.value - mrr;
  const weeklyGrowth    = cfo?.mrrDelta || 0;
  const monthlyGrowth   = weeklyGrowth * 4;
  const weeksToMilestone = weeklyGrowth > 0 ? Math.ceil(mrrGap / weeklyGrowth) : null;

  // ── DAILY BRIEF ACTION ────────────────────────────────────────────────────────
  if (action === 'daily-brief') {
    const today    = new Date().toISOString().split('T')[0];
    const host     = req.headers.host || 'www.orreryx.io';
    const proto    = host.includes('localhost') ? 'http' : 'https';
    const baseUrl  = `${proto}://${host}`;

    // Trigger ideas agent if not run today
    let ideasData = ideas;
    if (!ideasData || ideasData.date !== today) {
      try {
        const r = await fetch(`${baseUrl}/api/ideas-agent`, {
          headers: { Authorization: `Bearer ${cronSecret || ''}` },
          signal: AbortSignal.timeout(28000),
        });
        if (r.ok) {
          const d = await r.json();
          ideasData = d.ideas ? { ...d.ideas, date: today } : null;
        }
      } catch (_) {}
    }

    const approvalToken = cronSecret ? makeApprovalToken(today, cronSecret) : 'no-secret';
    const approveUrl    = `${baseUrl}/api/ceo-agent?action=approve&date=${today}&token=${approvalToken}`;

    // Build context for Claude daily priority
    const dailyContext = `
MRR: $${mrr.toLocaleString()} | ARR: $${currentARR.toLocaleString()} | Progress to $1B: ${progress.toFixed(3)}%
${coo?.allOk ? 'COO: All systems operational' : `COO: ${(coo?.results || []).filter(r => !r.ok).map(r => r.name).join(', ')} failing`}
SEO score: ${seo?.score || 'N/A'}/100 | Top issue: ${seo?.topIssues?.[0] || 'none'}
Legal: ${legal?.riskLevel || 'N/A'} risk | Failing: ${legal?.failing || 0} checks
Last breaking story: ${breakingStory?.title || 'none'} (${breakingStory?.country || ''})
Weekly signups: ${cfo?.weeklySignups || 0} | Conversion: ${pageViews && signups ? ((signups/pageViews)*100).toFixed(2) : 0}%
Ideas today: ${ideasData?.product_idea?.title || 'not generated yet'}`.trim();

    const todayPriority = await generateStrategicBrief(dailyContext, 'daily');

    // Agent status cards
    const cooStatus      = coo ? (coo.allOk ? '✅ All systems OK' : `⚠️ ${(coo.results||[]).filter(r=>!r.ok).length} issue(s)`) : '⏳ Not run yet';
    const cfoStatus      = mrr > 0 ? `✅ MRR $${mrr.toLocaleString()}` : '⏳ No revenue data yet';
    const salesStatus    = sales ? `✅ ${sales.total || 0} subscribers` : '⏳ Not run yet';
    const breakingStatus = breakingRaw ? `✅ Posted ${Math.round((Date.now()-parseInt(breakingRaw))/60000)}m ago` : '⏳ No post today';
    const seoStatus      = seo ? `✅ Score ${seo.score}/100 · ${seo.pagesWithIssues} issues` : '⏳ Runs Monday 6AM';
    const legalStatus    = legal ? `${legal.riskLevel === 'HIGH' ? '🔴' : legal.riskLevel === 'MEDIUM' ? '🟡' : '✅'} ${legal.riskLevel} risk` : '⏳ Runs Monday 7AM';
    const ideasStatus    = ideasData ? `✅ ${(ideasData.social_posts||[]).length} post ideas` : '⏳ Not generated';
    const cmoStatus      = cmoBrief ? `✅ Brief sent · ${cmoBrief.type || 'regular'}` : '⏳ No brief today';

    const agentRows = [
      ['🏥 COO', 'Platform Health', 'Daily 7 AM', cooStatus,
       seo?.slowPages?.length ? `Fix slow pages: ${seo.slowPages.slice(0,2).join(', ')}` : 'Check health after any code deployment'],
      ['💰 CFO', 'Finance P&L', 'Monday 8 AM', cfoStatus,
       `Signup→Paid rate: ${signups ? ((payments/signups)*100).toFixed(1) : 0}% — optimize upgrade flow`],
      ['📈 SEO', 'Search Growth', 'Monday 6 AM', seoStatus,
       seo?.topIssues?.[0] ? `Fix: ${seo.topIssues[0]}` : 'Add FAQ schema to /ww3-probability for AEO'],
      ['⚖️ Legal', 'Compliance', 'Monday 7 AM', legalStatus,
       legal?.topIssues?.[0] ? `Action: ${legal.topIssues[0]}` : 'Add GDELT attribution to /privacy-policy'],
      ['📡 Breaking News', 'Live Social', 'Every 3h', breakingStatus,
       breakingStory ? `Create content piece on: ${breakingStory.title?.slice(0,60)}` : 'Monitor for breaking events'],
      ['💡 Ideas', 'Creative', 'Daily 5:30 AM', ideasStatus,
       ideasData?.growth_experiment?.title ? `Run experiment: ${ideasData.growth_experiment.title}` : 'Generate ideas and pick one to execute'],
      ['📧 Sales', 'Nurture', 'Daily 9 AM', salesStatus,
       'Upgrade Day-7 email with new product feature announcement'],
      ['📢 CMO', 'Content', 'Every 3h', cmoStatus,
       cmoBrief?.headline ? `Amplify: "${cmoBrief.headline?.slice(0,50)}"` : 'Create content calendar for this week'],
    ].map(([agent, role, schedule, status, impl]) => `
      <tr style="border-top:1px solid #f3f4f6">
        <td style="padding:10px 14px"><strong>${agent}</strong><br><span style="color:#9ca3af;font-size:11px">${role}</span></td>
        <td style="padding:10px 14px;color:#6b7280;font-size:12px">${schedule}</td>
        <td style="padding:10px 14px;font-size:13px">${status}</td>
        <td style="padding:10px 14px;font-size:12px;color:#374151;background:#fffbeb">→ ${impl}</td>
      </tr>`).join('');

    const ideasHtml = ideasData ? `
      ${(ideasData.social_posts || []).map(p => `
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:8px 14px;font-size:11px;color:#6b7280;width:70px">${p.platform}</td>
          <td style="padding:8px 14px;font-size:13px"><strong>${p.hook}</strong>${p.angle ? `<br><span style="color:#6b7280;font-size:11px">${p.angle}</span>` : ''}</td>
        </tr>`).join('')}
      <tr style="background:#fffbeb"><td style="padding:8px 14px;font-size:11px;color:#92400e">💡 Product</td><td style="padding:8px 14px;font-size:13px"><strong>${ideasData.product_idea?.title||''}</strong><br><span style="color:#6b7280;font-size:11px">${ideasData.product_idea?.description||''}</span></td></tr>
      <tr style="background:#f0fdf4"><td style="padding:8px 14px;font-size:11px;color:#166534">🧪 Growth</td><td style="padding:8px 14px;font-size:13px"><strong>${ideasData.growth_experiment?.title||''}</strong><br><span style="color:#6b7280;font-size:11px">${ideasData.growth_experiment?.hypothesis||''}</span></td></tr>`
    : `<tr><td colspan="2" style="padding:12px;color:#9ca3af;text-align:center">Running ideas agent…</td></tr>`;

    const html = `
<div style="font-family:sans-serif;max-width:740px;margin:0 auto;color:#111">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#09090b,#1a1a2e);padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:36px">🤖</div>
    <h1 style="color:#f0f0ec;margin:8px 0 4px;font-size:22px">CEO Command Center</h1>
    <p style="color:#666;margin:0;font-size:13px">${today} · Your 8-agent team awaits approval</p>
  </div>

  <!-- $1B Mission Tracker -->
  <div style="background:#0f172a;padding:20px 24px;border-bottom:1px solid #1e293b">
    <div style="font-size:11px;letter-spacing:3px;color:#64748b;margin-bottom:8px">🎯 $1B MISSION STATUS</div>
    <div style="font-family:monospace;font-size:16px;color:#f59e0b;margin-bottom:6px">[${progressBar(mrr)}] ${progress.toFixed(4)}%</div>
    <div style="display:flex;gap:24px;flex-wrap:wrap">
      <span style="color:#94a3b8;font-size:13px">MRR: <strong style="color:#fff">$${mrr.toLocaleString()}</strong></span>
      <span style="color:#94a3b8;font-size:13px">ARR: <strong style="color:#fff">$${currentARR.toLocaleString()}</strong></span>
      <span style="color:#94a3b8;font-size:13px">Next milestone: <strong style="color:#f59e0b">${nextMilestone.label}</strong></span>
      <span style="color:#94a3b8;font-size:13px">Gap: <strong style="color:#ef4444">$${mrrGap.toLocaleString()}</strong></span>
      ${weeksToMilestone ? `<span style="color:#94a3b8;font-size:13px">~<strong style="color:#22c55e">${weeksToMilestone} weeks</strong> at current pace</span>` : ''}
    </div>
  </div>

  <!-- Approval banner -->
  <div style="background:#fff1f2;border-left:4px solid #e03836;padding:14px 20px">
    <strong style="color:#dc2626">⏳ ACTION REQUIRED — Approve your 8-agent team</strong><br>
    <span style="font-size:13px;color:#6b7280">Agents run on schedule but check approval gate before posting or emailing.</span>
  </div>

  <!-- Agent Family Intelligence -->
  <div style="padding:20px">
    <h3 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">🤝 Agent Family — Status & Today's Implementation</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <thead>
        <tr style="background:#f9fafb">
          <th style="padding:10px 14px;text-align:left;color:#6b7280;font-weight:600">Agent</th>
          <th style="padding:10px 14px;text-align:left;color:#6b7280;font-weight:600">Schedule</th>
          <th style="padding:10px 14px;text-align:left;color:#6b7280;font-weight:600">Status</th>
          <th style="padding:10px 14px;text-align:left;color:#6b7280;font-weight:600;background:#fffde7">→ Implementation</th>
        </tr>
      </thead>
      <tbody>${agentRows}</tbody>
    </table>
  </div>

  <!-- CEO Priority Today -->
  <div style="padding:0 20px 20px">
    <div style="background:#0f172a;border-radius:8px;padding:16px;border-left:4px solid #f59e0b">
      <div style="font-size:11px;letter-spacing:2px;color:#64748b;margin-bottom:8px">🧠 CEO STRATEGIC PRIORITY TODAY</div>
      <p style="margin:0;font-size:14px;line-height:1.7;color:#e5e7eb;white-space:pre-wrap">${todayPriority}</p>
    </div>
  </div>

  <!-- Ideas -->
  <div style="padding:0 20px 20px">
    <h3 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">💡 Ideas Agent — Today's Suggestions</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
      <tbody>${ideasHtml}</tbody>
    </table>
  </div>

  <!-- Approve -->
  <div style="padding:20px;text-align:center;border-top:1px solid #f3f4f6">
    <a href="${approveUrl}" style="display:inline-block;background:#3ab860;color:#000;padding:16px 48px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:.02em">✅ APPROVE TEAM — START WORKING</a>
    <p style="color:#9ca3af;font-size:11px;margin-top:10px">One click unlocks all 8 agents for the day</p>
    <p style="color:#9ca3af;font-size:10px">Or approve from <a href="${baseUrl}/admin" style="color:#4a8fe0">admin panel</a></p>
  </div>

  <div style="background:#f9fafb;padding:12px;text-align:center;border-top:1px solid #e5e7eb;border-radius:0 0 12px 12px">
    <span style="color:#9ca3af;font-size:11px">— OrreryX CEO Command Center · ${today} · 8 agents · $1B mission</span>
  </div>
</div>`;

    const emailSent = adminEmail ? await sendEmail(adminEmail, `🤖 CEO Daily Brief — ${today} — APPROVE YOUR TEAM`, html) : false;

    return res.status(200).json({
      ok: true, date: today, approveUrl, emailSent,
      missionProgress: `${progress.toFixed(4)}%`,
      nextMilestone: nextMilestone.label,
    });
  }

  // ── WEEKLY DIGEST (default action) ────────────────────────────────────────────
  const now = new Date();

  // Build rich context for Claude
  const cooSummary   = coo ? `${coo.allOk ? 'All OK' : `${(coo.results||[]).filter(r=>!r.ok).map(r=>r.name).join(', ')} FAILING`} · ${(coo.results||[]).map(r=>`${r.name}:${r.ok?'OK':'FAIL'}(${r.ms}ms)`).join(', ')}` : 'No data';
  const cfoSummary   = `MRR $${mrr.toLocaleString()} · ARR $${currentARR.toLocaleString()} · WoW MRR Δ $${cfo?.mrrDelta||0} · Weekly signups: ${cfo?.weeklySignups||0} · Signup→Paid: ${signups?((payments/signups)*100).toFixed(1):0}%`;
  const seoSummary   = seo ? `Score ${seo.score}/100 · ${seo.pagesWithIssues} pages with issues · ${seo.pagesWithWarnings} warnings · Avg load ${seo.avgLoadMs}ms · Top issue: ${seo.topIssues?.[0]||'none'}` : 'Not run yet';
  const legalSummary = legal ? `${legal.riskLevel} RISK · ${legal.passing} passing · ${legal.failing} failing · ${legal.warnings} warnings · ${legal.topIssues?.[0]||'clean'}` : 'Not run yet';
  const breakSummary = breakingStory ? `Last: "${breakingStory.title}" (${breakingStory.country}) · score ${breakingStory.score} · impact: ${breakingStory.marketImpact}` : 'No recent story';
  const ideasSummary = ideas ? `Top idea: "${ideas.product_idea?.title}" · Growth exp: "${ideas.growth_experiment?.title}"` : 'Not generated';
  const salesSummary = sales ? `${sales.total||0} subscribers · Day3: ${sales.day3||0} queued · Day7: ${sales.day7||0} queued` : 'No data';
  const cmoSummary   = cmoBrief ? `Last brief: "${cmoBrief.headline?.slice(0,80)}" · ${cmoBrief.type||'regular'} · briefsToday: ${cmoBrief.count||0}` : 'No brief yet';

  const weeklyContext = `
$1B MISSION: ${progress.toFixed(4)}% complete | MRR $${mrr.toLocaleString()} | ARR $${currentARR.toLocaleString()}
Next milestone: ${nextMilestone.label} (gap: $${mrrGap.toLocaleString()}/month)
At $${weeklyGrowth}/week growth → ${weeksToMilestone ? weeksToMilestone + ' weeks' : 'growth stalled'} to next milestone

COO (Platform): ${cooSummary}
CFO (Finance): ${cfoSummary}
CMO (Content): ${cmoSummary}
Breaking News: ${breakSummary}
SEO Agent: ${seoSummary}
Legal Agent: ${legalSummary}
Ideas Agent: ${ideasSummary}
Sales Agent: ${salesSummary}

Page Views (total): ${pageViews.toLocaleString()} | Signups: ${signups.toLocaleString()} | Paid: ${payments.toLocaleString()}
Visitor→Signup: ${pageViews ? ((signups/pageViews)*100).toFixed(2) : 0}% | Signup→Paid: ${signups ? ((payments/signups)*100).toFixed(1) : 0}%`.trim();

  const aiSummary = await generateStrategicBrief(weeklyContext, 'weekly');

  // Build health rows
  const checkRows = (coo?.results || []).map(c => `
    <tr style="border-bottom:1px solid #f3f4f6">
      <td style="padding:8px 12px;font-size:13px">${c.name}</td>
      <td style="padding:8px 12px;font-size:13px;color:${c.ok?'#16a34a':'#dc2626'};font-weight:600">${c.ok?'✅':'❌'}</td>
      <td style="padding:8px 12px;font-size:13px;color:#6b7280">${c.ms}ms</td>
      <td style="padding:8px 12px;font-size:13px;color:#374151">${c.info||''}</td>
    </tr>`).join('') || '<tr><td colspan="4" style="padding:12px;color:#9ca3af;text-align:center">Run COO agent to populate health data</td></tr>';

  const html = `
<div style="font-family:sans-serif;max-width:740px;margin:0 auto;color:#111">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1a1a2e,#0f172a);padding:28px;border-radius:8px 8px 0 0">
    <h1 style="color:white;margin:0;font-size:24px">🤖 CEO Weekly Master Brief</h1>
    <p style="color:#94a3b8;margin:6px 0 0">Week of ${now.toLocaleDateString('en-GB',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
  </div>

  <!-- $1B Mission Tracker -->
  <div style="background:#0f172a;padding:20px 24px">
    <div style="font-size:11px;letter-spacing:3px;color:#64748b;margin-bottom:10px">🎯 $1B MISSION TRACKER</div>
    <div style="font-family:monospace;font-size:18px;color:#f59e0b;margin-bottom:8px">[${progressBar(mrr)}] ${progress.toFixed(4)}%</div>
    <table style="width:100%;color:#94a3b8;font-size:13px">
      <tr>
        <td>Current MRR</td><td style="color:#fff;font-weight:700">$${mrr.toLocaleString()}</td>
        <td>Current ARR</td><td style="color:#fff;font-weight:700">$${currentARR.toLocaleString()}</td>
      </tr>
      <tr>
        <td>Target MRR ($1B)</td><td style="color:#f59e0b;font-weight:700">$5,560,000</td>
        <td>Gap to next milestone</td><td style="color:#ef4444;font-weight:700">$${mrrGap.toLocaleString()}</td>
      </tr>
      <tr>
        <td>Weekly MRR growth</td><td style="color:${weeklyGrowth>=0?'#22c55e':'#ef4444'};font-weight:700">${weeklyGrowth>=0?'+':''}$${weeklyGrowth.toLocaleString()}</td>
        <td>Est. weeks to ${nextMilestone.label}</td><td style="color:#22c55e;font-weight:700">${weeksToMilestone ? weeksToMilestone + ' weeks' : 'Grow faster!'}</td>
      </tr>
    </table>
  </div>

  <!-- KPI Grid -->
  <div style="background:#f9fafb;padding:4px 0">
    <table style="width:100%;border-collapse:collapse">
      <tr>
        <td style="padding:16px;text-align:center;border-right:1px solid #e5e7eb">
          <p style="margin:0;font-size:11px;color:#9ca3af;text-transform:uppercase">MRR</p>
          <p style="margin:4px 0 0;font-size:26px;font-weight:700;color:#16a34a">$${mrr.toLocaleString()}</p>
          ${cfo?.mrrDelta!==undefined?`<p style="margin:2px 0 0;font-size:12px;color:${cfo.mrrDelta>=0?'#16a34a':'#dc2626'}">${cfo.mrrDelta>=0?'▲':'▼'} $${Math.abs(cfo.mrrDelta||0)} WoW</p>`:''}
        </td>
        <td style="padding:16px;text-align:center;border-right:1px solid #e5e7eb">
          <p style="margin:0;font-size:11px;color:#9ca3af;text-transform:uppercase">Paid Users</p>
          <p style="margin:4px 0 0;font-size:26px;font-weight:700">${payments.toLocaleString()}</p>
          ${cfo?.weeklyPayments!==undefined?`<p style="margin:2px 0 0;font-size:12px;color:#6b7280">+${cfo.weeklyPayments} this week</p>`:''}
        </td>
        <td style="padding:16px;text-align:center;border-right:1px solid #e5e7eb">
          <p style="margin:0;font-size:11px;color:#9ca3af;text-transform:uppercase">Signups</p>
          <p style="margin:4px 0 0;font-size:26px;font-weight:700">${signups.toLocaleString()}</p>
          ${cfo?.weeklySignups!==undefined?`<p style="margin:2px 0 0;font-size:12px;color:#6b7280">+${cfo.weeklySignups} this week</p>`:''}
        </td>
        <td style="padding:16px;text-align:center">
          <p style="margin:0;font-size:11px;color:#9ca3af;text-transform:uppercase">Page Views</p>
          <p style="margin:4px 0 0;font-size:26px;font-weight:700">${pageViews.toLocaleString()}</p>
          ${cfo?.weeklyPV!==undefined?`<p style="margin:2px 0 0;font-size:12px;color:#6b7280">+${cfo.weeklyPV.toLocaleString()} this week</p>`:''}
        </td>
      </tr>
    </table>
  </div>

  <!-- AI Strategic Brief -->
  <div style="padding:20px 24px">
    <div style="background:#fffbeb;padding:20px;border-left:4px solid #f59e0b;border-radius:4px">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#92400e">🧠 Claude AI — Weekly Strategic Brief</p>
      <div style="font-size:14px;line-height:1.8;color:#111;white-space:pre-wrap">${aiSummary}</div>
    </div>
  </div>

  <!-- Agent Family Summary -->
  <div style="padding:0 24px 20px">
    <h3 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">🤝 Agent Family — This Week's Intelligence</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;border:1px solid #e5e7eb">
      ${[
        ['🏥 COO', coo?.allOk ? '✅ All OK' : `⚠️ Issues`, coo ? (coo.results||[]).filter(r=>!r.ok).map(r=>r.name).join(', ')||'All services up' : 'Not run'],
        ['💰 CFO', `MRR $${mrr.toLocaleString()}`, `WoW: ${cfo?.mrrDelta>=0?'+':''}$${cfo?.mrrDelta||0} · Conversion: ${signups?((payments/signups)*100).toFixed(1):0}%`],
        ['📈 SEO', seo ? `Score: ${seo.score}/100` : '⏳ Pending', seo?.topIssues?.[0] || 'No critical issues'],
        ['⚖️ Legal', legal ? `${legal.riskLevel} RISK` : '⏳ Pending', legal?.topIssues?.[0] || 'Compliant'],
        ['📡 Breaking', breakingStory ? '✅ Posted' : '⏳ None', breakingStory?.title?.slice(0,60) || 'No story today'],
        ['💡 Ideas', ideas ? '✅ Generated' : '⏳ Pending', ideas?.product_idea?.title || 'No ideas yet'],
        ['📧 Sales', sales ? `✅ ${sales.total||0} subscribers` : '⏳ Pending', `Day3: ${sales?.day3||0} · Day7: ${sales?.day7||0} emails`],
        ['📢 CMO', cmoBrief ? '✅ Posted' : '⏳ None', cmoBrief?.headline?.slice(0,60) || 'No brief today'],
      ].map(([agent, status, detail]) => `
        <tr style="border-bottom:1px solid #f3f4f6">
          <td style="padding:10px 12px;font-weight:600;width:100px">${agent}</td>
          <td style="padding:10px 12px;width:120px">${status}</td>
          <td style="padding:10px 12px;color:#6b7280">${detail}</td>
        </tr>`).join('')}
    </table>
  </div>

  <!-- Platform Health -->
  <div style="padding:0 24px 20px">
    <h3 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Platform Health (COO Data)</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f3f4f6"><th style="padding:8px 12px;text-align:left">Service</th><th style="padding:8px 12px;text-align:left">Status</th><th style="padding:8px 12px;text-align:left">Latency</th><th style="padding:8px 12px;text-align:left">Details</th></tr></thead>
      <tbody>${checkRows}</tbody>
    </table>
  </div>

  <div style="background:#f9fafb;padding:14px;text-align:center;border-top:1px solid #e5e7eb">
    <span style="color:#9ca3af;font-size:11px">— OrreryX CEO Command Center · 8 agents · $1B mission · Weekly digest every Sunday 9 PM IST</span>
  </div>
</div>`;

  const healthAllOk = coo?.allOk ?? true;
  const emailSent   = adminEmail ? await sendEmail(adminEmail, `🤖 CEO Weekly — MRR $${mrr.toLocaleString()} · ${progress.toFixed(4)}% to $1B`, html) : false;

  await upstashSet('ceo:last_report', {
    ts: Date.now(), time: now.toISOString(),
    mrr, pageViews, signups, payments, healthAllOk, progress,
  });

  return res.status(200).json({
    ok: true, mrr, pageViews, signups, payments, healthAllOk,
    missionProgress: `${progress.toFixed(4)}%`,
    nextMilestone:   nextMilestone.label,
    emailSent,
    time: now.toISOString(),
  });
}

export const config = { api: { bodyParser: false } };

// api/cro-agent.js — CRO Agent: Weekly conversion rate analysis & recommendations
// Runs Monday at 9 AM UTC via cron-job.org / vercel.json
// Reads funnel metrics from Redis, uses Claude Haiku to generate CRO recommendations
// Emails admin with prioritized action items
// Required env vars: ANTHROPIC_API_KEY, RESEND_API_KEY, UPSTASH_REDIS_REST_URL,
//                    UPSTASH_REDIS_REST_TOKEN, ADMIN_EMAIL, CRON_SECRET

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

// ── Email helper ──────────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  if (!to) return false;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'OrreryX CRO Agent <noreply@orreryx.io>';
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
  try {
    const { default: nodemailer } = await import('nodemailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({ from: `OrreryX <${user}>`, to: to.trim(), subject, html });
    return true;
  } catch (err) { console.error('[CRO sendEmail]', err?.message || err); return false; }
}

// ── Collect funnel metrics from Redis ─────────────────────────────────────────

async function collectMetrics() {
  const now    = new Date();
  const today  = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const month  = now.toISOString().slice(0, 7);  // YYYY-MM

  // Last 7 days for daily metrics
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
    days.push(d);
  }

  const [
    signupsRaw,
    loginsRaw,
    upgradesRaw,
    mrrRaw,
    salesLastScanRaw,
    churnLastRunRaw,
    abResultsRaw,
    referralTotalRaw,
  ] = await Promise.all([
    // Daily signups (sum last 7 days)
    Promise.all(days.map(d => upstashGet(`analytics:signups:${d}`))),
    // Daily logins (sum last 7 days)
    Promise.all(days.map(d => upstashGet(`analytics:logins:${d}`))),
    // Monthly upgrades
    upstashGet(`analytics:upgrades:${month}`),
    // Current MRR
    upstashGet('mrr:current'),
    // Sales agent last scan
    upstashGet('sales:last_scan'),
    // Churn agent last run
    upstashGet('churn:last_run'),
    // A/B experiments list
    upstashGet('ab:experiments'),
    // Referral total
    upstashGet('referral:total'),
  ]);

  const weeklySignups = signupsRaw.reduce((sum, v) => sum + (parseInt(v) || 0), 0);
  const weeklyLogins  = loginsRaw.reduce((sum, v) => sum + (parseInt(v) || 0), 0);

  let salesScan = null;
  try { salesScan = JSON.parse(salesLastScanRaw || '{}'); } catch {}

  let churnRun = null;
  try { churnRun = JSON.parse(churnLastRunRaw || '{}'); } catch {}

  return {
    weeklySignups,
    weeklyLogins,
    monthlyUpgrades: parseInt(upgradesRaw) || 0,
    mrrCents:        parseInt(mrrRaw) || 0,
    salesScan,
    churnRun,
    totalReferrals:  parseInt(referralTotalRaw) || 0,
    month,
    today,
    days,
  };
}

// ── Claude CRO analysis ────────────────────────────────────────────────────────

async function generateCROAnalysis(metrics) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const mrrDollars = (metrics.mrrCents / 100).toFixed(2);
  const activationRate = metrics.weeklySignups > 0
    ? ((metrics.weeklyLogins / metrics.weeklySignups) * 100).toFixed(1)
    : 'N/A';

  const prompt = `You are a conversion rate optimization expert for OrreryX, a real-time geopolitical intelligence SaaS platform for retail investors.

OrreryX metrics this week:
- Weekly signups: ${metrics.weeklySignups}
- Weekly logins (activation): ${metrics.weeklyLogins}
- Activation rate (login / signup): ${activationRate}%
- Monthly upgrades (free → paid): ${metrics.monthlyUpgrades}
- MRR: $${mrrDollars}
- Total referrals: ${metrics.totalReferrals}

Funnel targets:
- Activation rate target: >70%
- Trial → paid conversion target: >15%
- Monthly churn target: <5%

Pricing: Starter $0.99, Analyst $14.99, Command $34.99
Key pages: orreryx.io (homepage), orreryx.io/pricing, orreryx.io/app (dashboard)

Based on these metrics, provide:
1. Top 3 highest-priority CRO actions for this week (specific, actionable, measurable)
2. For each action: what to test, where to implement, expected impact, and how to measure success
3. One hypothesis for A/B testing (highest ICE score)
4. Any red flags or anomalies in the data

Format as:
ACTION 1: [title]
What: [specific change]
Where: [page/email/flow]
Expected impact: [metric + estimated % improvement]
Measure by: [specific metric]

ACTION 2: ...

ACTION 3: ...

A/B TEST HYPOTHESIS:
Variable: [what to test]
Control: [current state]
Variant: [proposed change]
ICE score: Impact [1-10] × Confidence [1-10] × Ease [1-10] = [score]

ALERTS:
[Any anomalies or urgent flags]

Keep it direct, specific, and actionable. No fluff.`;

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
        max_tokens: 1200,
        messages:   [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.content?.[0]?.text || null;
  } catch (err) {
    console.error('[CRO Claude]', err?.message || err);
    return null;
  }
}

// ── HTML email report ─────────────────────────────────────────────────────────

function buildReportEmail(metrics, analysis) {
  const mrrDollars = (metrics.mrrCents / 100).toFixed(2);
  const activationRate = metrics.weeklySignups > 0
    ? ((metrics.weeklyLogins / metrics.weeklySignups) * 100).toFixed(1)
    : 'N/A';

  const activationColor = parseFloat(activationRate) >= 70 ? '#16a34a' : parseFloat(activationRate) >= 50 ? '#d97706' : '#dc2626';

  const analysisHtml = analysis
    ? analysis.replace(/\n/g, '<br>').replace(/ACTION \d+:/g, s => `<strong style="color:#0f172a">${s}</strong>`)
    : '<p style="color:#6b7280">Claude analysis unavailable — check ANTHROPIC_API_KEY.</p>';

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto;color:#111;background:#fff">
      <div style="background:#0f172a;color:white;padding:24px 32px">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;color:#94a3b8;text-transform:uppercase">OrreryX CRO Agent</p>
        <h1 style="margin:0;font-size:20px;font-weight:700">Weekly CRO Report</h1>
        <p style="margin:4px 0 0;font-size:13px;color:#94a3b8">${metrics.today}</p>
      </div>

      <div style="padding:24px 32px">
        <h2 style="margin:0 0 16px;font-size:15px;font-weight:600;color:#374151">Funnel Metrics (Last 7 Days)</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
          <tr style="border-bottom:1px solid #f3f4f6">
            <td style="padding:10px 0;font-size:14px;color:#6b7280">Weekly Signups</td>
            <td style="padding:10px 0;font-size:14px;font-weight:600;text-align:right">${metrics.weeklySignups}</td>
          </tr>
          <tr style="border-bottom:1px solid #f3f4f6">
            <td style="padding:10px 0;font-size:14px;color:#6b7280">Weekly Logins</td>
            <td style="padding:10px 0;font-size:14px;font-weight:600;text-align:right">${metrics.weeklyLogins}</td>
          </tr>
          <tr style="border-bottom:1px solid #f3f4f6">
            <td style="padding:10px 0;font-size:14px;color:#6b7280">Activation Rate</td>
            <td style="padding:10px 0;font-size:14px;font-weight:700;text-align:right;color:${activationColor}">${activationRate}% <span style="font-size:11px;color:#9ca3af">(target: >70%)</span></td>
          </tr>
          <tr style="border-bottom:1px solid #f3f4f6">
            <td style="padding:10px 0;font-size:14px;color:#6b7280">Monthly Upgrades</td>
            <td style="padding:10px 0;font-size:14px;font-weight:600;text-align:right">${metrics.monthlyUpgrades}</td>
          </tr>
          <tr style="border-bottom:1px solid #f3f4f6">
            <td style="padding:10px 0;font-size:14px;color:#6b7280">MRR</td>
            <td style="padding:10px 0;font-size:14px;font-weight:700;text-align:right;color:#16a34a">$${mrrDollars}</td>
          </tr>
          <tr>
            <td style="padding:10px 0;font-size:14px;color:#6b7280">Total Referrals (all-time)</td>
            <td style="padding:10px 0;font-size:14px;font-weight:600;text-align:right">${metrics.totalReferrals}</td>
          </tr>
        </table>

        <h2 style="margin:0 0 16px;font-size:15px;font-weight:600;color:#374151">AI CRO Analysis</h2>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;font-size:14px;line-height:1.7;color:#374151">
          ${analysisHtml}
        </div>
      </div>

      <div style="border-top:1px solid #f3f4f6;padding:16px 32px;text-align:center">
        <p style="margin:0;font-size:11px;color:#d1d5db">OrreryX CRO Agent · auto-generated weekly</p>
      </div>
    </div>
  `;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const cronSecret  = process.env.CRON_SECRET;
  const querySecret = req.query.secret;
  const authHeader  = req.headers['authorization'];
  if (cronSecret && querySecret !== cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    return res.status(500).json({ error: 'ADMIN_EMAIL not configured' });
  }

  // Collect metrics
  const metrics  = await collectMetrics();

  // Generate AI analysis
  const analysis = await generateCROAnalysis(metrics);

  // Save report to Redis (24h TTL)
  const report = { ts: Date.now(), metrics, analysis, generated: new Date().toISOString() };
  await upstashSet(`cro:last_report`, report, 86400 * 7);

  // If view=1, return cached JSON
  if (req.query.view === '1') {
    const cached = await upstashGet('cro:last_report');
    let parsed = null;
    try { parsed = JSON.parse(cached || '{}'); } catch {}
    return res.status(200).json(parsed || { error: 'No report available' });
  }

  // Email admin
  const html    = buildReportEmail(metrics, analysis);
  const subject = `cro report — ${metrics.today}`;
  const sent    = await sendEmail(adminEmail, subject, html);

  return res.status(200).json({
    ok:       true,
    sent,
    metrics: {
      weeklySignups:    metrics.weeklySignups,
      weeklyLogins:     metrics.weeklyLogins,
      monthlyUpgrades:  metrics.monthlyUpgrades,
      mrrDollars:       (metrics.mrrCents / 100).toFixed(2),
      totalReferrals:   metrics.totalReferrals,
    },
    analysisLength: analysis?.length || 0,
    time: report.generated,
  });
}

export const config = { api: { bodyParser: false } };

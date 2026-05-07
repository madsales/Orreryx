// api/finance-agent.js — CFO Agent: Weekly financial P&L report
// Runs every Monday at 8:00 AM IST via cron-job.org
// Pulls analytics from Redis, emails formatted P&L to admin
// Required env vars: RESEND_API_KEY, ADMIN_EMAIL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, CRON_SECRET

// ── Redis helpers ─────────────────────────────────────────────────────────────

async function upstashGet(key) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.result ?? null;
}

async function upstashSet(key, value) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(['SET', key, JSON.stringify(value)]),
    signal:  AbortSignal.timeout(6000),
  }).catch(() => {});
}

// ── Email helper ──────────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  if (!to) return false;
  try {
    const { default: nodemailer } = await import('nodemailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({ from: `Orrery CFO Agent <${user}>`, to, subject, html });
    return true;
  } catch (err) { console.error('[CFO sendEmail]', err?.message||err); return false; }
}

// ── Pricing tiers (update if you change plans) ────────────────────────────────
const PLAN_PRICES = {
  pro:        29,
  premium:    79,
  enterprise: 299,
};

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const cronSecret  = process.env.CRON_SECRET;
  const querySecret = req.query.secret;
  const authHeader  = req.headers['authorization'];
  if (cronSecret && querySecret !== cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const adminEmail = process.env.ADMIN_EMAIL;

  // ── CEO Approval check ────────────────────────────────────────────────────────
  if (req.query.admin !== '1') {
    const today    = new Date().toISOString().split('T')[0];
    const approved = await upstashGet(`ceo:approved:${today}`);
    if (!approved) {
      return res.status(200).json({ ok: false, reason: 'Awaiting CEO approval for ' + today });
    }
  }

  // ── Pull all analytics keys from Redis ───────────────────────────────────────
  const [
    pvTotal,
    signupTotal,
    paymentTotal,
    revenueCount,
    plansRaw,
    prevWeekRaw,
  ] = await Promise.all([
    upstashGet('analytics:pv:total'),
    upstashGet('analytics:signup:total'),
    upstashGet('analytics:payment:total'),
    upstashGet('analytics:revenue_count'),
    upstashGet('analytics:plans'),
    upstashGet('cfo:last_week'),
  ]);

  const pageViews  = parseInt(pvTotal)      || 0;
  const signups    = parseInt(signupTotal)   || 0;
  const payments   = parseInt(paymentTotal)  || 0;
  const revCount   = parseInt(revenueCount)  || 0;

  // Parse plan breakdown (expects JSON object like { pro: 5, premium: 2, enterprise: 1 })
  let plans = {};
  try { plans = JSON.parse(plansRaw || '{}'); } catch {}

  // Calculate MRR from plan breakdown
  let mrr = 0;
  for (const [plan, count] of Object.entries(plans)) {
    mrr += (PLAN_PRICES[plan] || 0) * (parseInt(count) || 0);
  }

  // Weekly delta from last week's snapshot
  let prevWeek = {};
  try { prevWeek = JSON.parse(prevWeekRaw || '{}'); } catch {}

  const weeklyPV       = pageViews - (prevWeek.pageViews       || 0);
  const weeklySignups  = signups   - (prevWeek.signups         || 0);
  const weeklyPayments = payments  - (prevWeek.payments        || 0);
  const mrrDelta       = mrr       - (prevWeek.mrr             || 0);

  // Save this week's snapshot for next week's delta
  await upstashSet('cfo:last_week', { pageViews, signups, payments, mrr, time: new Date().toISOString() });

  // ── Build plan breakdown rows ─────────────────────────────────────────────────
  const planRows = Object.entries(plans).length
    ? Object.entries(plans).map(([plan, count]) => `
        <tr style="border-bottom:1px solid #eee">
          <td style="padding:8px 12px;text-transform:capitalize">${plan}</td>
          <td style="padding:8px 12px;text-align:right">$${PLAN_PRICES[plan] || 0}/mo</td>
          <td style="padding:8px 12px;text-align:right">${count}</td>
          <td style="padding:8px 12px;text-align:right;font-weight:bold">$${((PLAN_PRICES[plan] || 0) * parseInt(count)).toLocaleString()}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" style="padding:12px;color:#9ca3af;text-align:center">No plan data in Redis yet</td></tr>`;

  const mrrColor  = mrrDelta >= 0 ? '#16a34a' : '#dc2626';
  const mrrArrow  = mrrDelta >= 0 ? '▲' : '▼';
  const pvColor   = weeklyPV >= 0 ? '#16a34a' : '#dc2626';
  const sigColor  = weeklySignups >= 0 ? '#16a34a' : '#dc2626';

  const now = new Date();

  const html = `
    <div style="font-family:sans-serif;max-width:660px;margin:0 auto">
      <div style="background:#1a1a2e;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="color:white;margin:0">📊 CFO Weekly P&amp;L Report</h2>
        <p style="color:#aaa;margin:4px 0 0">${now.toUTCString()} — Week ending ${now.toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
      </div>

      <!-- MRR highlight -->
      <div style="background:#f0fdf4;padding:20px;border-left:4px solid #16a34a;display:flex;align-items:center;gap:24px">
        <div>
          <p style="margin:0;font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Monthly Recurring Revenue</p>
          <p style="margin:4px 0 0;font-size:32px;font-weight:700;color:#111">$${mrr.toLocaleString()}</p>
        </div>
        <div style="color:${mrrColor};font-size:18px;font-weight:600">
          ${mrrArrow} $${Math.abs(mrrDelta).toLocaleString()} vs last week
        </div>
      </div>

      <!-- Key metrics grid -->
      <table style="width:100%;border-collapse:collapse">
        <tr style="background:#f9fafb">
          <td style="padding:16px;text-align:center;border-right:1px solid #e5e7eb">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase">Page Views (total)</p>
            <p style="margin:4px 0 0;font-size:24px;font-weight:700">${pageViews.toLocaleString()}</p>
            <p style="margin:2px 0 0;font-size:12px;color:${pvColor}">+${weeklyPV.toLocaleString()} this week</p>
          </td>
          <td style="padding:16px;text-align:center;border-right:1px solid #e5e7eb">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase">Signups (total)</p>
            <p style="margin:4px 0 0;font-size:24px;font-weight:700">${signups.toLocaleString()}</p>
            <p style="margin:2px 0 0;font-size:12px;color:${sigColor}">+${weeklySignups} this week</p>
          </td>
          <td style="padding:16px;text-align:center">
            <p style="margin:0;font-size:12px;color:#9ca3af;text-transform:uppercase">Paid Customers</p>
            <p style="margin:4px 0 0;font-size:24px;font-weight:700">${payments.toLocaleString()}</p>
            <p style="margin:2px 0 0;font-size:12px;color:#6b7280">+${weeklyPayments} this week</p>
          </td>
        </tr>
      </table>

      <!-- Conversion rates -->
      <div style="padding:16px 20px;background:#fffbeb;border-top:1px solid #fde68a">
        <p style="margin:0;font-size:13px;color:#92400e">
          <strong>Visitor→Signup:</strong> ${signups && pageViews ? ((signups/pageViews)*100).toFixed(2) : '0.00'}% &nbsp;|&nbsp;
          <strong>Signup→Paid:</strong> ${payments && signups ? ((payments/signups)*100).toFixed(1) : '0.0'}% &nbsp;|&nbsp;
          <strong>ARPU:</strong> $${payments ? (mrr/payments).toFixed(2) : '0.00'}/mo
        </p>
      </div>

      <!-- Plan breakdown -->
      <div style="padding:16px 20px 0">
        <h3 style="margin:0 0 8px;font-size:14px;color:#374151;text-transform:uppercase;letter-spacing:.05em">Revenue Breakdown by Plan</h3>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f3f4f6">
            <th style="padding:8px 12px;text-align:left">Plan</th>
            <th style="padding:8px 12px;text-align:right">Price</th>
            <th style="padding:8px 12px;text-align:right">Customers</th>
            <th style="padding:8px 12px;text-align:right">MRR</th>
          </tr>
        </thead>
        <tbody>${planRows}</tbody>
        <tfoot>
          <tr style="background:#f9fafb;font-weight:bold">
            <td style="padding:10px 12px" colspan="3">Total MRR</td>
            <td style="padding:10px 12px;text-align:right;color:#16a34a">$${mrr.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>

      <p style="color:#9ca3af;font-size:12px;padding:16px">— Orrery CFO Agent · Runs every Monday 8 AM IST</p>
    </div>
  `;

  const report = { mrr, pageViews, signups, payments, weeklyPV, weeklySignups, weeklyPayments, mrrDelta, plans, time: now.toISOString() };

  if (adminEmail) {
    await sendEmail(
      adminEmail,
      `📊 Orrery Weekly P&L — MRR $${mrr.toLocaleString()} (${mrrDelta >= 0 ? '+' : ''}$${mrrDelta})`,
      html,
    );
  }

  return res.status(200).json({ ok: true, report });
}

export const config = { api: { bodyParser: false } };

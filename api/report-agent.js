// api/report-agent.js — Daily Executive Report Agent

import { opsError, opsSuccess } from './_ops-alert.js';

// Runs every day at midnight IST (18:30 UTC)
// Collects data from ALL agents via Redis, compiles a full-day summary,
// emails it to CEO/admin as a beautiful HTML dashboard.
//
// Covers: Breaking News, SEO, Sales, Finance, Health, Ideas, CMO, Community,
//         Ads, Churn, Referral, A/B, Directory, CRO, Lead Magnet agents
//
// Redis keys read:
//   breaking:last_story, breaking:last_post_time
//   seo:weekly, seo:keywords, seo:analytics
//   sales:last_report, finance:last_report, health:last_report
//   ceo:last_report, ideas:last
//   cmo:briefs:{date}, cmo:count:{date}
//   community:last, ads:last, churn:last
//   referral:last, ab:last, directory:last
//   cro:last, lead_magnet:last
//
// Required env vars:
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//   RESEND_API_KEY (or GMAIL_USER + GMAIL_APP_PASSWORD)
//   ADMIN_EMAIL, CRON_SECRET

// ── Redis helper ──────────────────────────────────────────────────────────────

async function redisGet(key) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal:  AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = await r.json().catch(() => null);
  const raw = j?.result ?? null;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

async function redisMGet(keys) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return {};
  const r = await fetch(`${url}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(keys.map(k => ['GET', k])),
    signal:  AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!r?.ok) return {};
  const arr = await r.json().catch(() => []);
  const out = {};
  keys.forEach((k, i) => {
    const raw = arr[i]?.result;
    if (!raw) { out[k] = null; return; }
    try { out[k] = JSON.parse(raw); } catch { out[k] = raw; }
  });
  return out;
}

// ── Fetch all agent data in parallel ─────────────────────────────────────────

async function collectAllAgentData() {
  const today = new Date().toISOString().split('T')[0];

  const keys = [
    // Breaking news / social
    'breaking:last_story',
    'breaking:last_post_time',
    'breaking:last_error',
    // CMO briefs
    `cmo:briefs:${today}`,
    `cmo:count:${today}`,
    // SEO
    'seo:weekly',
    'seo:keywords',
    'seo:analytics',
    'seo:technical',
    'seo:competitive',
    'seo:chief',
    // Business agents
    'sales:last_report',
    'finance:last_report',
    'health:last_report',
    // Executive
    'ceo:last_report',
    // Content / ideas
    'ideas:last',
    // Growth agents
    'community:last',
    'ads:last',
    'churn:last',
    'referral:last',
    'ab:last',
    'directory:last',
    'cro:last',
    'lead_magnet:last',
  ];

  return redisMGet(keys);
}

// ── Time formatter ────────────────────────────────────────────────────────────

function timeAgo(ts) {
  if (!ts) return 'Never';
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (isNaN(t)) return String(ts);
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 2)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function safeStr(v, fallback = '—') {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 200);
  return String(v).slice(0, 300) || fallback;
}

// ── Build agent status row ─────────────────────────────────────────────────────

function agentRow(name, data, tsKey = null, summaryFn = null) {
  const ts = tsKey ? (data?.[tsKey] || data?.ts || data?.ran_at) : (data?.ts || data?.ran_at || data?.time);
  const hasRun = !!ts;
  const dot  = !hasRun ? '#6b7280' : (data?.error ? '#ef4444' : '#22c55e');
  const when = hasRun ? timeAgo(ts) : 'Not yet run today';
  const summary = summaryFn ? summaryFn(data) : (hasRun ? '✓ Ran successfully' : 'No data');
  return `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #1f2937">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dot};margin-right:8px;vertical-align:middle"></span>
        <strong style="color:#f9fafb">${name}</strong>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #1f2937;color:#9ca3af;font-size:13px">${when}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #1f2937;color:#d1d5db;font-size:13px">${summary}</td>
    </tr>`;
}

// ── Build full HTML report ─────────────────────────────────────────────────────

function buildReport(data, date) {
  const today = date;

  const breaking     = data['breaking:last_story'];
  const breakingTime = data['breaking:last_post_time'];
  const breakingErr  = data['breaking:last_error'];
  const cmoBriefs    = data[`cmo:briefs:${today}`];
  const cmoCount     = data[`cmo:count:${today}`];
  const seoWeekly    = data['seo:weekly'];
  const seoKeywords  = data['seo:keywords'];
  const seoAnalytics = data['seo:analytics'];
  const seoTech      = data['seo:technical'];
  const seoChief     = data['seo:chief'];
  const sales        = data['sales:last_report'];
  const finance      = data['finance:last_report'];
  const health       = data['health:last_report'];
  const ceo          = data['ceo:last_report'];
  const ideas        = data['ideas:last'];
  const community    = data['community:last'];
  const ads          = data['ads:last'];
  const churn        = data['churn:last'];
  const referral     = data['referral:last'];
  const ab           = data['ab:last'];
  const directory    = data['directory:last'];
  const cro          = data['cro:last'];
  const leadMagnet   = data['lead_magnet:last'];

  // Count how many agents ran today
  const allAgents = [breaking, cmoBriefs, seoWeekly, sales, finance, health, ideas, community, ads, churn, referral, ab, directory, cro, leadMagnet];
  const ran = allAgents.filter(Boolean).length;
  const total = allAgents.length;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#060b14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:720px;margin:0 auto;padding:24px 16px">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border:1px solid #1e3a5f;border-radius:12px;padding:24px;margin-bottom:20px">
    <div style="font-size:11px;letter-spacing:3px;color:#64748b;margin-bottom:6px">ORRERY COMMAND CENTER</div>
    <div style="font-size:28px;font-weight:900;color:#f8fafc">Daily Agent Report</div>
    <div style="font-size:14px;color:#64748b;margin-top:4px">${today} · ${ran}/${total} agents active</div>
    <div style="margin-top:16px;background:#0f172a;border-radius:8px;padding:12px 16px">
      <div style="display:flex;gap:24px;flex-wrap:wrap">
        <div><div style="font-size:11px;color:#64748b;letter-spacing:1px">AGENTS ACTIVE</div><div style="font-size:24px;font-weight:800;color:#22c55e">${ran}</div></div>
        <div><div style="font-size:11px;color:#64748b;letter-spacing:1px">SOCIAL POSTS</div><div style="font-size:24px;font-weight:800;color:#3b82f6">${cmoCount || 0}</div></div>
        <div><div style="font-size:11px;color:#64748b;letter-spacing:1px">BREAKING STORIES</div><div style="font-size:24px;font-weight:800;color:#f59e0b">${breaking ? 1 : 0}</div></div>
        <div><div style="font-size:11px;color:#64748b;letter-spacing:1px">SEO STATUS</div><div style="font-size:24px;font-weight:800;color:${seoWeekly ? '#22c55e' : '#6b7280'}">${seoWeekly ? 'ON' : 'OFF'}</div></div>
      </div>
    </div>
  </div>

  <!-- Breaking News -->
  <div style="background:#111827;border-radius:10px;padding:20px;margin-bottom:16px;border-left:4px solid #ef4444">
    <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:12px">📡 BREAKING NEWS AGENT</div>
    ${breaking ? `
      <div style="font-size:16px;font-weight:700;color:#f9fafb;margin-bottom:8px">${safeStr(breaking.title, 'Story posted')}</div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:#9ca3af">
        <span>Country: <strong style="color:#e5e7eb">${safeStr(breaking.country)}</strong></span>
        <span>Score: <strong style="color:#e5e7eb">${safeStr(breaking.score)}/10</strong></span>
        <span>Twitter: <strong style="color:${breaking.twitterId ? '#22c55e' : '#ef4444'}">${breaking.twitterId ? '✓ Posted' : '✗ Failed'}</strong></span>
        <span>LinkedIn: <strong style="color:${breaking.linkedinId ? '#22c55e' : '#ef4444'}">${breaking.linkedinId ? '✓ Posted' : '✗ Failed'}</strong></span>
      </div>
      <div style="margin-top:8px;font-size:12px;color:#6b7280">Market: ${safeStr(breaking.marketImpact)}</div>
      ${breakingErr ? `<div style="margin-top:8px;font-size:12px;color:#f87171;background:#1f1515;padding:8px 12px;border-radius:6px">⚠ Last error: ${safeStr(breakingErr)}</div>` : ''}
    ` : `<div style="color:#6b7280;font-size:14px">No breaking story posted today${breakingErr ? ` — last error: <span style="color:#f87171">${safeStr(breakingErr)}</span>` : ''}</div>`}
    <div style="margin-top:10px;font-size:12px;color:#6b7280">Last run: ${timeAgo(breakingTime)}</div>
  </div>

  <!-- CMO Briefs -->
  <div style="background:#111827;border-radius:10px;padding:20px;margin-bottom:16px;border-left:4px solid #6366f1">
    <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:12px">📰 CMO SOCIAL POST AGENT</div>
    ${cmoBriefs && Array.isArray(cmoBriefs) && cmoBriefs.length ? `
      <div style="font-size:15px;font-weight:700;color:#f9fafb;margin-bottom:10px">${cmoBriefs.length} brief${cmoBriefs.length > 1 ? 's' : ''} generated today</div>
      ${cmoBriefs.map(b => `
        <div style="background:#1f2937;border-radius:6px;padding:12px;margin-bottom:8px">
          <div style="font-size:13px;font-weight:600;color:#e5e7eb">${safeStr(b.headline, 'Untitled')}</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:4px">Score: ${b.score}/10 · Type: ${b.type || 'regular'} · Region: ${safeStr(b.region)}</div>
          <div style="font-size:12px;color:#f59e0b;margin-top:4px">📊 ${safeStr(b.marketImpact)}</div>
        </div>
      `).join('')}
    ` : '<div style="color:#6b7280;font-size:14px">No briefs generated today (daily limit or no qualifying stories)</div>'}
  </div>

  <!-- SEO Section -->
  <div style="background:#111827;border-radius:10px;padding:20px;margin-bottom:16px;border-left:4px solid #10b981">
    <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:12px">🔍 SEO AGENTS</div>
    <table style="width:100%;border-collapse:collapse">
      ${agentRow('SEO Weekly Report', seoWeekly, 'generatedAt', d => d ? `${safeStr(d.summary || d.topIssue || 'Report generated', '✓ Ran')}` : 'Not run this week')}
      ${agentRow('SEO Keywords', seoKeywords, 'ts', d => d ? `${d.keywords?.length || 0} keywords tracked` : 'Not run')}
      ${agentRow('SEO Analytics', seoAnalytics, 'ts', d => d ? `CTR: ${safeStr(d.avgCtr || d.ctr, '—')} · Clicks: ${safeStr(d.totalClicks, '—')}` : 'Not run')}
      ${agentRow('SEO Technical', seoTech, 'ts', d => d ? `${d.issues || 0} issues found` : 'Not run')}
      ${agentRow('SEO Chief', seoChief, 'ts', d => d ? `Strategy updated: ${safeStr(d.focus || 'See report', '—')}` : 'Not run this week')}
    </table>
  </div>

  <!-- Business Agents -->
  <div style="background:#111827;border-radius:10px;padding:20px;margin-bottom:16px;border-left:4px solid #f59e0b">
    <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:12px">💼 BUSINESS AGENTS</div>
    <table style="width:100%;border-collapse:collapse">
      ${agentRow('Sales Agent', sales, 'ts', d => d ? `${d.total || 0} subscribers · MRR $${d.mrr || 0}` : 'Not run')}
      ${agentRow('Finance Agent', finance, 'ts', d => d ? safeStr(d.summary || d.insight || '✓ Report generated', '✓ Ran') : 'Not run')}
      ${agentRow('Health Agent', health, 'ts', d => d ? (d.allOk === false ? '⚠ Issues detected' : '✓ All systems healthy') : 'Not run')}
      ${agentRow('Churn Agent', churn, 'ts', d => d ? `${d.at_risk || 0} at-risk users · ${d.recovered || 0} recovered` : 'Not run')}
    </table>
  </div>

  <!-- Growth Agents -->
  <div style="background:#111827;border-radius:10px;padding:20px;margin-bottom:16px;border-left:4px solid #8b5cf6">
    <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:12px">🚀 GROWTH AGENTS</div>
    <table style="width:100%;border-collapse:collapse">
      ${agentRow('Ads Agent', ads, 'ts', d => d ? safeStr(d.summary || d.recommendation || '✓ Analysis done', '✓ Ran') : 'Not run this week')}
      ${agentRow('Referral Agent', referral, 'ts', d => d ? `${d.referrals || 0} referrals tracked` : 'Not run this week')}
      ${agentRow('A/B Test Agent', ab, 'ts', d => d ? safeStr(d.winner || d.summary || '✓ Tests updated', '✓ Ran') : 'Not run this week')}
      ${agentRow('CRO Agent', cro, 'ts', d => d ? safeStr(d.topRecommendation || d.summary || '✓ Analysis done', '✓ Ran') : 'Not run this week')}
      ${agentRow('Lead Magnet Agent', leadMagnet, 'ts', d => d ? safeStr(d.summary || '✓ Ran', '✓ Ran') : 'Not run this week')}
      ${agentRow('Directory Agent', directory, 'ts', d => d ? `${d.submitted || 0} listings submitted` : 'Not run this week')}
    </table>
  </div>

  <!-- Content / Ideas -->
  <div style="background:#111827;border-radius:10px;padding:20px;margin-bottom:16px;border-left:4px solid #ec4899">
    <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:12px">💡 CONTENT & COMMUNITY</div>
    ${ideas ? `
      <div style="margin-bottom:12px">
        <div style="font-size:13px;font-weight:600;color:#e5e7eb;margin-bottom:6px">Today's Ideas (${timeAgo(ideas.generatedAt || ideas.ts)})</div>
        ${Array.isArray(ideas.social_posts) ? ideas.social_posts.map(p => `
          <div style="background:#1f2937;border-radius:6px;padding:10px 12px;margin-bottom:6px">
            <span style="font-size:11px;color:#9ca3af">${safeStr(p.platform, 'Social')}</span>
            <div style="font-size:13px;color:#d1d5db;margin-top:4px">${safeStr(p.caption || p.text || p.idea, '—').slice(0, 150)}</div>
          </div>
        `).join('') : `<div style="color:#9ca3af;font-size:13px">${safeStr(ideas.summary || ideas.insight || 'Ideas generated')}</div>`}
      </div>
    ` : '<div style="color:#6b7280;font-size:14px">Ideas agent not run today</div>'}
    ${agentRow('Community Agent', community, 'ts', d => d ? safeStr(d.summary || d.posts?.length + ' posts generated' || '✓ Ran', '✓ Ran') : 'Not run today')}
  </div>

  <!-- CEO Summary -->
  ${ceo ? `
  <div style="background:#111827;border-radius:10px;padding:20px;margin-bottom:16px;border-left:4px solid #fbbf24">
    <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:12px">🤖 CEO DIGEST (last weekly)</div>
    <div style="font-size:14px;line-height:1.7;color:#d1d5db">${safeStr(ceo.digest || ceo.summary || ceo.report || 'Report generated', 'No summary').slice(0, 800)}</div>
    <div style="margin-top:8px;font-size:12px;color:#6b7280">Generated: ${timeAgo(ceo.generatedAt || ceo.ts)}</div>
  </div>
  ` : ''}

  <!-- Footer -->
  <div style="text-align:center;padding:20px;font-size:12px;color:#374151">
    OrreryX Command Center · ${today} · ${new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} IST
    <br>Generated by Report Agent · <a href="https://www.orreryx.io/admin" style="color:#3b82f6">View Admin Panel</a>
  </div>

</div>
</body>
</html>`;
}

// ── Send email ────────────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  const resendKey = process.env.RESEND_API_KEY;
  const from      = process.env.EMAIL_FROM || 'OrreryX Reports <noreply@orreryx.io>';
  if (resendKey) {
    const r = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from, to, subject, html }),
      signal:  AbortSignal.timeout(10000),
    }).catch(() => null);
    if (r?.ok) return true;
  }
  // Gmail fallback
  try {
    const { default: nodemailer } = await import('nodemailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await t.sendMail({ from: `OrreryX Reports <${user}>`, to, subject, html });
    return true;
  } catch { return false; }
}

// ── Save to Redis ─────────────────────────────────────────────────────────────

async function saveReport(data) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  const today = new Date().toISOString().split('T')[0];
  await fetch(`${url}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify([
      ['SET', `daily:report:${today}`, JSON.stringify({ ts: Date.now(), ...data }), 'EX', 604800],
      ['SET', 'daily:report:latest', JSON.stringify({ ts: Date.now(), date: today, ...data }), 'EX', 604800],
    ]),
    signal:  AbortSignal.timeout(5000),
  }).catch(() => {});
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const auth       = req.headers['authorization'];
  const qs         = req.query.secret;
  if (cronSecret && auth !== `Bearer ${cronSecret}` && qs !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const today      = new Date().toISOString().split('T')[0];
  const adminEmail = process.env.ADMIN_EMAIL;

  // ── View latest report ────────────────────────────────────────────────────────
  if (req.query.view === '1') {
    const latest = await redisGet('daily:report:latest');
    return res.status(200).json({ ok: true, report: latest });
  }

  // ── Collect all agent data ────────────────────────────────────────────────────
  const data = await collectAllAgentData();

  // Count active agents
  const agentKeys = ['breaking:last_story', 'sales:last_report', 'finance:last_report',
    'health:last_report', 'ideas:last', 'community:last', 'ads:last',
    'churn:last', 'referral:last', 'ab:last', 'directory:last', 'cro:last', 'lead_magnet:last',
    `cmo:briefs:${today}`, 'seo:weekly'];
  const activeCount = agentKeys.filter(k => !!data[k]).length;

  // ── Build report ──────────────────────────────────────────────────────────────
  const html = buildReport(data, today);

  // ── Save to Redis ─────────────────────────────────────────────────────────────
  await saveReport({ activeAgents: activeCount, totalAgents: agentKeys.length, date: today });

  // ── Send email ────────────────────────────────────────────────────────────────
  let emailSent = false;
  if (adminEmail) {
    const subject = `📊 OrreryX Daily Report — ${today} · ${activeCount}/${agentKeys.length} agents active`;
    emailSent = await sendEmail(adminEmail, subject, html);
  }

  if (emailSent) {
    await opsSuccess('report-agent', `Daily report sent — ${activeCount}/${agentKeys.length} agents active`, { date: today });
  } else if (adminEmail) {
    await opsError('report-agent', 'Daily report email failed to send', { adminEmail, hasResend: !!process.env.RESEND_API_KEY });
  }

  return res.status(200).json({
    ok:          emailSent || !adminEmail,
    date:        today,
    activeAgents: activeCount,
    totalAgents:  agentKeys.length,
    emailSent,
    emailTarget: adminEmail || '(ADMIN_EMAIL not set)',
    preview:     emailSent ? 'Report sent — check inbox' : 'Email failed — see emailError',
    emailError:  !emailSent && adminEmail ? 'Check RESEND_API_KEY or GMAIL_USER+GMAIL_APP_PASSWORD' : undefined,
  });
}

export const config = { api: { bodyParser: false } };

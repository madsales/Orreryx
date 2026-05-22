// api/ops-agent.js — OrreryX Master Ops Agent
// "100 years of experience" — monitors every agent, detects failures, auto-fixes.
//
// Runs every hour via Vercel cron.
//
// What it watches:
//   ┌──────────────────────────────────────────────────────────────────┐
//   │  Agent              │ Expected cadence │ Redis health key        │
//   ├─────────────────────┼──────────────────┼─────────────────────────┤
//   │  social-post        │ 4× / day         │ cmo:count:{date}        │
//   │  breaking-news      │ 1× / day min     │ breaking:last_post_time │
//   │  ceo-agent          │ daily @ 8 UTC    │ ceo:last_run            │
//   │  health-agent       │ daily @ 7 UTC    │ health:last_run         │
//   │  sales-agent        │ daily @ 9 UTC    │ sales:last_run          │
//   │  churn-agent        │ daily @ 2 UTC    │ churn:last_run          │
//   │  community-agent    │ daily @ 5 UTC    │ community:last_run      │
//   │  legal-agent        │ weekly Monday    │ legal:last_run          │
//   │  seo-agent          │ weekly Monday    │ seo:last_run            │
//   │  finance-agent      │ weekly Monday    │ finance:last_run        │
//   │  ads-agent          │ weekly Monday    │ ads:last_run            │
//   │  referral-agent     │ weekly Monday    │ referral:last_run       │
//   │  ab-agent           │ weekly Monday    │ ab:last_run             │
//   │  directory-agent    │ weekly Monday    │ directory:last_run      │
//   │  cro-agent          │ weekly Monday    │ cro:last_report         │
//   │  lead-magnet-agent  │ weekly Monday    │ lm:last_run             │
//   │  seo-technical      │ weekly Monday    │ seo:technical:latest    │
//   │  seo-keyword        │ weekly Monday    │ seo:keywords:latest     │
//   │  seo-content        │ weekly Monday    │ seo:content:latest      │
//   │  seo-links          │ weekly Monday    │ seo:links:latest        │
//   │  seo-auditor        │ weekly Monday    │ seo:auditor:latest      │
//   └─────────────────────┴──────────────────┴─────────────────────────┘
//
// Auto-fixes applied:
//   • CEO approval missing after 7 AM UTC → auto-approve so social posts aren't blocked
//   • Social posts behind schedule → trigger /api/social-post directly
//   • Breaking news silent for >8h → trigger /api/breaking-news?force=1
//   • Any critical agent missing last-run key from today → trigger it
//
// Alert email sent when:
//   • Auto-fix attempted (always — transparency)
//   • Fix attempted but endpoint returned non-2xx
//   • 3+ agents failing simultaneously
//
// Required env vars:
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//   ADMIN_EMAIL, RESEND_API_KEY (or GMAIL_USER + GMAIL_APP_PASSWORD)
//   CRON_SECRET
//   BASE_URL (e.g. https://www.orreryx.io) — used for self-triggering agents

const BASE_URL = process.env.BASE_URL || 'https://www.orreryx.io';

// ── Redis helpers ─────────────────────────────────────────────────────────────

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
  return j?.result ?? null;
}

async function redisSet(key, value, exSeconds = null) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  const cmd = exSeconds
    ? ['SET', key, typeof value === 'string' ? value : JSON.stringify(value), 'EX', exSeconds]
    : ['SET', key, typeof value === 'string' ? value : JSON.stringify(value)];
  const r = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmd),
    signal:  AbortSignal.timeout(5000),
  }).catch(() => null);
  return r?.ok ?? false;
}

async function redisPipeline(cmds) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return [];
  const r = await fetch(`${url}/pipeline`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmds),
    signal:  AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!r?.ok) return [];
  const d = await r.json().catch(() => null);
  return d?.map(x => x?.result) ?? [];
}

// ── Self-trigger an agent endpoint ───────────────────────────────────────────

async function triggerAgent(path, extra = '') {
  const secret = process.env.CRON_SECRET;
  const url = `${BASE_URL}${path}${extra}`;
  try {
    const r = await fetch(url, {
      method:  'GET',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
      signal:  AbortSignal.timeout(30000),
    }).catch(() => null);
    const body = await r?.json().catch(() => null);
    return { ok: r?.ok ?? false, status: r?.status ?? 0, body };
  } catch (e) {
    return { ok: false, status: 0, error: e?.message };
  }
}

// ── Send alert email ──────────────────────────────────────────────────────────

async function sendAlert(subject, issues, fixes, adminEmail) {
  if (!adminEmail) return false;

  const issueRows = issues.map(i =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #1f2937;color:#f87171">${i.agent}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #1f2937;color:#d1d5db">${i.problem}</td>
     <td style="padding:8px 12px;border-bottom:1px solid #1f2937;color:${i.fixed ? '#4ade80' : '#f87171'}">${i.fixed ? '✅ Auto-fixed' : '❌ Needs attention'}</td></tr>`
  ).join('');

  const fixRows = fixes.map(f =>
    `<div style="background:#1f2937;border-radius:6px;padding:12px 16px;margin-bottom:8px;border-left:3px solid ${f.ok ? '#4ade80' : '#f87171'}">
      <span style="font-weight:700;color:#fff">${f.action}</span>
      <span style="margin-left:12px;font-size:12px;color:${f.ok ? '#4ade80' : '#f87171'}">${f.ok ? 'Success' : 'Failed — ' + (f.error || 'check logs')}</span>
    </div>`
  ).join('');

  const criticalCount = issues.filter(i => !i.fixed).length;
  const headerColor   = criticalCount > 0 ? '#7f1d1d' : '#14532d';
  const headerIcon    = criticalCount > 0 ? '🔴' : '✅';

  const html = `
<div style="font-family:sans-serif;max-width:680px;margin:0 auto;background:#0a0f1e;color:#fff;border-radius:8px;overflow:hidden">
  <div style="background:${headerColor};padding:20px 24px">
    <div style="font-size:11px;letter-spacing:3px;color:rgba(255,255,255,0.7);margin-bottom:4px">ORRERY OPS AGENT</div>
    <div style="font-size:22px;font-weight:900">${headerIcon} ${subject}</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px">${new Date().toUTCString()}</div>
  </div>

  <div style="padding:20px 24px">
    <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:12px">ISSUES DETECTED</div>
    <table style="width:100%;border-collapse:collapse;background:#111827;border-radius:6px;overflow:hidden">
      <thead>
        <tr style="background:#1f2937">
          <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:2px;color:#9ca3af">AGENT</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:2px;color:#9ca3af">PROBLEM</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:2px;color:#9ca3af">STATUS</th>
        </tr>
      </thead>
      <tbody>${issueRows}</tbody>
    </table>
  </div>

  ${fixes.length ? `
  <div style="padding:0 24px 20px">
    <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:12px">AUTO-FIX ACTIONS TAKEN</div>
    ${fixRows}
  </div>` : ''}

  ${criticalCount > 0 ? `
  <div style="padding:0 24px 20px">
    <div style="background:#7f1d1d;border-radius:6px;padding:16px;border-left:4px solid #ef4444">
      <div style="font-weight:700;color:#fff;margin-bottom:4px">⚠️ ${criticalCount} issue(s) require manual attention</div>
      <div style="font-size:13px;color:#fca5a5">The ops agent attempted fixes but could not fully resolve all problems. Check Vercel logs and Redis state.</div>
    </div>
  </div>` : ''}

  <div style="padding:16px 24px;background:#060b14;text-align:center;font-size:12px;color:#4b5563">
    OrreryX Ops Agent &nbsp;·&nbsp; orreryx.io &nbsp;·&nbsp; Auto-generated alert
  </div>
</div>`;

  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'OrreryX Ops <noreply@orreryx.io>';

  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: adminEmail.trim(), subject, html }),
      });
      if (r.ok) return true;
    } catch (_) {}
  }

  // Gmail fallback
  try {
    const { default: nodemailer } = await import('nodemailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({ from: `OrreryX Ops <${user}>`, to: adminEmail, subject, html });
    return true;
  } catch (_) { return false; }
}

// ── Health checks ─────────────────────────────────────────────────────────────

async function checkSocialPosting(today, utcHour) {
  const issues = [];
  const fixes  = [];

  // How many briefs sent today?
  const countRaw  = await redisGet(`cmo:count:${today}`);
  const count     = parseInt(countRaw || '0', 10);
  // By end of day UTC (21:00+) expect at least 3 briefs; by 12:00 expect at least 1
  const expected  = utcHour >= 21 ? 3 : utcHour >= 12 ? 1 : 0;

  // Posts behind schedule (approval gate removed — posting is fully automatic)
  if (utcHour >= 9 && count < expected) {
    issues.push({ agent: 'social-post', problem: `Only ${count}/${expected} expected briefs sent by ${utcHour}:00 UTC`, fixed: false });
    // Trigger social-post now (uses ?admin=1 to skip approval check since ops already handled it)
    const result = await triggerAgent('/api/social-post', '?admin=1');
    fixes.push({ action: 'Triggered /api/social-post?admin=1', ok: result.ok, error: result.error });
    if (result.ok && result.body?.ok) issues[issues.length - 1].fixed = true;
  }

  return { issues, fixes, socialCount: count };
}

async function checkBreakingNews() {
  const issues = [];
  const fixes  = [];

  const lastPostRaw = await redisGet('breaking:last_post_time');
  const lastPost    = lastPostRaw ? parseInt(lastPostRaw) : 0;
  const ageHours    = (Date.now() - lastPost) / 3600000;

  // Only alert if breaking-news hasn't run at all in 24h (not just no post)
  if (ageHours > 24) {
    issues.push({
      agent: 'breaking-news',
      problem: `Breaking-news agent hasn't run in ${Math.round(ageHours)}h — triggering now`,
      fixed: false,
    });
    const result = await triggerAgent('/api/breaking-news', '?force=1');
    fixes.push({ action: 'Triggered /api/breaking-news?force=1', ok: result.ok, error: result.error });
    if (result.ok) issues[0].fixed = true;
  }

  return { issues, fixes, lastPostAgeHours: Math.round(ageHours) };
}

async function checkDailyAgents(today, utcHour) {
  const issues = [];
  const fixes  = [];

  if (utcHour < 10) return { issues, fixes }; // Too early — agents haven't had time to run

  // Agents expected to have run today, keyed by their Redis health key
  const dailyAgents = [
    { name: 'ceo-agent',       key: 'ceo:last_run',       path: '/api/ceo-agent',       expectedHour: 8  },
    { name: 'health-agent',    key: 'health:last_run',    path: '/api/health-agent',    expectedHour: 7  },
    { name: 'sales-agent',     key: 'sales:last_run',     path: '/api/sales-agent',     expectedHour: 9  },
    { name: 'churn-agent',     key: 'churn:last_run',       path: '/api/churn-agent',     expectedHour: 3  },
    { name: 'community-agent', key: 'community:last_run',  path: '/api/community-agent', expectedHour: 6  },
    { name: 'seo-sprint',      key: 'seo:sprint:latest',   path: '/api/seo-sprint',      expectedHour: 7  },
  ];

  for (const agent of dailyAgents) {
    if (utcHour < agent.expectedHour + 1) continue; // Not due yet
    const lastRunRaw = await redisGet(agent.key);
    if (!lastRunRaw) {
      // Never run or key expired — check if today's approval was set (proxy for ceo-agent)
      const todayRunRaw = await redisGet(`${agent.key}:${today}`);
      if (!todayRunRaw) {
        issues.push({ agent: agent.name, problem: `No run recorded today (expected after ${agent.expectedHour}:00 UTC)`, fixed: false });
        const result = await triggerAgent(agent.path);
        fixes.push({ action: `Triggered ${agent.path}`, ok: result.ok, error: result.error });
        if (result.ok) issues[issues.length - 1].fixed = true;
      }
    } else {
      // Has run sometime — check if it's from today
      try {
        const runData = JSON.parse(lastRunRaw);
        const runDate = runData?.date || runData?.today;
        // If explicit date field exists, compare it
        if (runDate && runDate !== today) {
          issues.push({ agent: agent.name, problem: `Last run was ${runDate}, expected ${today}`, fixed: false });
          const result = await triggerAgent(agent.path);
          fixes.push({ action: `Triggered ${agent.path}`, ok: result.ok, error: result.error });
          if (result.ok) issues[issues.length - 1].fixed = true;
        // No date field — fall back to ts timestamp
        } else if (!runDate && runData?.ts) {
          const runDay = new Date(runData.ts).toISOString().split('T')[0];
          if (runDay !== today) {
            issues.push({ agent: agent.name, problem: `Last run was ${runDay} (ts), expected ${today}`, fixed: false });
            const result = await triggerAgent(agent.path);
            fixes.push({ action: `Triggered ${agent.path}`, ok: result.ok, error: result.error });
            if (result.ok) issues[issues.length - 1].fixed = true;
          }
        }
      } catch (_) {}
    }
  }

  return { issues, fixes };
}

async function checkWeeklyAgents(today) {
  const issues = [];
  const fixes  = [];

  const dayOfWeek = new Date().getUTCDay(); // 0=Sun, 1=Mon
  if (dayOfWeek !== 1) return { issues, fixes }; // Only check on Mondays

  const weeklyAgents = [
    { name: 'legal-agent',       key: 'legal:last_run',        path: '/api/legal-agent'       },
    { name: 'seo-agent',         key: 'seo:last_run',          path: '/api/seo-agent'         },
    { name: 'finance-agent',     key: 'finance:last_run',      path: '/api/finance-agent'     },
    { name: 'ads-agent',         key: 'ads:last_run',          path: '/api/ads-agent'         },
    { name: 'referral-agent',    key: 'referral:last_run',     path: '/api/referral-agent'    },
    { name: 'ab-agent',          key: 'ab:last_run',           path: '/api/ab-agent'          },
    { name: 'directory-agent',   key: 'directory:last_run',    path: '/api/directory-agent'   },
    { name: 'cro-agent',         key: 'cro:last_report',       path: '/api/cro-agent'         },
    { name: 'lead-magnet-agent', key: 'lm:last_run',           path: '/api/lead-magnet-agent' },
    { name: 'seo-technical',     key: 'seo:technical:latest',  path: '/api/seo-technical'     },
    { name: 'seo-keyword',       key: 'seo:keywords:latest',   path: '/api/seo-keyword'       },
    { name: 'seo-content',       key: 'seo:content:latest',    path: '/api/seo-content'       },
    { name: 'seo-links',         key: 'seo:links:latest',      path: '/api/seo-links'         },
    { name: 'seo-auditor',       key: 'seo:auditor:latest',    path: '/api/seo-auditor'       },
  ];

  const utcHour = new Date().getUTCHours();
  if (utcHour < 10) return { issues, fixes }; // Give them time to run

  for (const agent of weeklyAgents) {
    const lastRunRaw = await redisGet(agent.key);
    let ranToday = false;
    if (lastRunRaw) {
      try {
        const d = JSON.parse(lastRunRaw);
        // Check explicit date field
        if ((d?.date || d?.today) === today) {
          ranToday = true;
        // Fall back to ts (numeric ms) timestamp
        } else if (d?.ts && new Date(d.ts).toISOString().split('T')[0] === today) {
          ranToday = true;
        // Fall back to generatedAt (numeric ms) timestamp
        } else if (d?.generatedAt && new Date(d.generatedAt).toISOString().split('T')[0] === today) {
          ranToday = true;
        // Fall back to runAt (ISO string) — used by referral/ab/directory agents
        } else if (d?.runAt && d.runAt.slice(0, 10) === today) {
          ranToday = true;
        }
      } catch (_) {}
    }
    if (!ranToday) {
      issues.push({ agent: agent.name, problem: `Monday agent did not record a run for today (${today})`, fixed: false });
      const result = await triggerAgent(agent.path);
      fixes.push({ action: `Triggered ${agent.path}`, ok: result.ok, error: result.error });
      if (result.ok) issues[issues.length - 1].fixed = true;
    }
  }

  return { issues, fixes };
}

async function checkRedisConnectivity() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { ok: false, error: 'UPSTASH_REDIS_REST_URL or TOKEN not set' };
  const pingKey = 'ops:ping:' + Date.now();
  const ok = await redisSet(pingKey, '1', 60);
  return { ok, error: ok ? null : 'Redis write failed — check UPSTASH credentials' };
}

// ── Broadcast complaint from other agents to ops agent ────────────────────────
// Any agent can POST to /api/ops-agent?action=complaint with:
//   { agent: string, problem: string, severity: 'low'|'medium'|'high'|'critical' }
// Ops agent logs it to Redis and decides whether to act.

async function handleComplaint(body, adminEmail) {
  const { agent, problem, severity = 'medium', data } = body || {};
  if (!agent || !problem) return { ok: false, error: 'agent and problem required' };

  const today   = new Date().toISOString().split('T')[0];
  const ts      = Date.now();
  const complaint = { agent, problem, severity, data, ts, date: today };

  // Append to today's complaint log
  const logKey  = `ops:complaints:${today}`;
  const existing = JSON.parse((await redisGet(logKey)) || '[]');
  existing.push(complaint);
  await redisSet(logKey, JSON.stringify(existing), 172800); // 48h TTL

  const fixes  = [];
  const issues = [{ agent, problem, fixed: false }];

  // Auto-fix strategies based on known complaint patterns
  if (severity === 'critical' || severity === 'high') {
    // Attempt to restart the offending agent
    const agentPathMap = {
      'social-post':       '/api/social-post',
      'breaking-news':     '/api/breaking-news',
      'ceo-agent':         '/api/ceo-agent',
      'health-agent':      '/api/health-agent',
      'sales-agent':       '/api/sales-agent',
      'legal-agent':       '/api/legal-agent',
      'seo-agent':         '/api/seo-agent',
      'finance-agent':     '/api/finance-agent',
      'ideas-agent':       '/api/ideas-agent',
      // Marketing agents
      'churn-agent':       '/api/churn-agent',
      'community-agent':   '/api/community-agent',
      'ads-agent':         '/api/ads-agent',
      'referral-agent':    '/api/referral-agent',
      'ab-agent':          '/api/ab-agent',
      'directory-agent':   '/api/directory-agent',
      'cro-agent':         '/api/cro-agent',
      'lead-magnet-agent': '/api/lead-magnet-agent',
      // SEO agents
      'seo-sprint':        '/api/seo-sprint',
      'seo-technical':     '/api/seo-technical',
      'seo-keyword':       '/api/seo-keyword',
      'seo-content':       '/api/seo-content',
      'seo-links':         '/api/seo-links',
      'seo-auditor':       '/api/seo-auditor',
    };
    const path = agentPathMap[agent];
    if (path) {
      const result = await triggerAgent(path);
      fixes.push({ action: `Auto-restarted ${path} in response to ${severity} complaint`, ok: result.ok, error: result.error });
      if (result.ok) issues[0].fixed = true;
    }

    // Always send email for high/critical
    await sendAlert(`⚠️ ${severity.toUpperCase()} alert from ${agent}`, issues, fixes, adminEmail);
  }

  return { ok: true, logged: true, complaint, fixes };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth: CRON_SECRET or admin override
  const cronSecret   = process.env.CRON_SECRET;
  const authHeader   = req.headers['authorization'] || '';
  const querySecret  = req.query.secret;
  const isAuthed     = !cronSecret ||
                       authHeader === `Bearer ${cronSecret}` ||
                       querySecret === cronSecret;

  // ── Complaint intake (agents report problems to ops) ─────────────────────
  if (req.query.action === 'complaint') {
    if (!isAuthed) return res.status(401).json({ error: 'Unauthorized' });
    const body = typeof req.body === 'object' ? req.body : {};
    const result = await handleComplaint(body, process.env.ADMIN_EMAIL);
    return res.status(200).json(result);
  }

  // ── View today's complaints ───────────────────────────────────────────────
  if (req.query.action === 'complaints') {
    const today = new Date().toISOString().split('T')[0];
    const log   = JSON.parse((await redisGet(`ops:complaints:${today}`)) || '[]');
    return res.status(200).json({ ok: true, today, count: log.length, complaints: log });
  }

  // ── Pause / resume social posting ─────────────────────────────────────────
  if (req.query.action === 'pause-social') {
    if (!isAuthed) return res.status(401).json({ error: 'Unauthorized' });
    await redisSet('ops:social:paused', '1', 86400);
    return res.status(200).json({ ok: true, message: 'Social posting paused for 24h' });
  }
  if (req.query.action === 'resume-social') {
    if (!isAuthed) return res.status(401).json({ error: 'Unauthorized' });
    await redisSet('ops:social:paused', '0', 86400);
    return res.status(200).json({ ok: true, message: 'Social posting resumed' });
  }

  // ── Full health run (cron or manual) ─────────────────────────────────────
  if (!isAuthed) return res.status(401).json({ error: 'Unauthorized' });

  const today     = new Date().toISOString().split('T')[0];
  const utcHour   = new Date().getUTCHours();
  const adminEmail = process.env.ADMIN_EMAIL;
  const startMs   = Date.now();

  // ── Run all health checks in parallel ────────────────────────────────────
  const [redis, social, breaking, daily, weekly] = await Promise.all([
    checkRedisConnectivity(),
    checkSocialPosting(today, utcHour),
    checkBreakingNews(),
    checkDailyAgents(today, utcHour),
    checkWeeklyAgents(today),
  ]);

  const allIssues = [
    ...social.issues,
    ...breaking.issues,
    ...daily.issues,
    ...weekly.issues,
  ];
  const allFixes = [
    ...social.fixes,
    ...breaking.fixes,
    ...daily.fixes,
    ...weekly.fixes,
  ];

  if (!redis.ok) {
    allIssues.unshift({ agent: 'redis', problem: redis.error || 'Redis unreachable', fixed: false });
  }

  const criticalCount = allIssues.filter(i => !i.fixed).length;

  // ── Write ops health snapshot to Redis ────────────────────────────────────
  const snapshot = {
    date:           today,
    utcHour,
    ts:             startMs,
    issuesFound:    allIssues.length,
    issuesFixed:    allIssues.filter(i => i.fixed).length,
    unfixed:        criticalCount,
    socialCount:    social.socialCount,
    breakingAge:    breaking.lastPostAgeHours,
    redisOk:        redis.ok,
    durationMs:     Date.now() - startMs,
  };
  await redisSet('ops:last_run', JSON.stringify(snapshot));
  await redisSet(`ops:last_run:${today}`, JSON.stringify(snapshot), 172800);

  // ── Send alert email only if there were issues ─────────────────────────────
  let emailSent = false;
  if (allIssues.length > 0) {
    const subject = criticalCount > 0
      ? `🔴 Ops Alert: ${criticalCount} unresolved issue(s) — ${today}`
      : `✅ Ops: ${allIssues.length} issue(s) auto-fixed — ${today}`;
    emailSent = await sendAlert(subject, allIssues, allFixes, adminEmail);
  }

  return res.status(200).json({
    ok:          true,
    today,
    utcHour,
    redis:       redis.ok ? 'healthy' : 'ERROR',
    issues:      allIssues,
    fixes:       allFixes,
    socialCount: social.socialCount,
    breakingAgeHours: breaking.lastPostAgeHours,
    criticalUnresolved: criticalCount,
    emailSent,
    durationMs:  Date.now() - startMs,
  });
}

export const config = { api: { bodyParser: true } };

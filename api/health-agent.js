// api/health-agent.js — COO Agent: Daily platform health monitor
// Runs daily at 7:00 AM IST via cron-job.org
// Checks all endpoints, logs to Redis, emails alert if anything fails
// Required env vars: RESEND_API_KEY, ADMIN_EMAIL, UPSTASH_REDIS_REST_URL, CRON_SECRET

const CHECKS = [
  {
    name: 'News Coverage (GDELT)',
    url: 'https://orreryx.io/api/events',
    validate: j => j && j.count > 0,
    detail: j => `${j?.count || 0} events`,
  },
  {
    name: 'Market Prices (Binance/Yahoo)',
    url: 'https://orreryx.io/api/feed?type=quotes&symbols=BTC,ETH,GC=F,SI=F',
    validate: j => Array.isArray(j) && j.length > 0,
    detail: j => `${Array.isArray(j) ? j.length : 0} symbols returned`,
  },
  {
    name: 'GNews Feed',
    url: 'https://orreryx.io/api/gnews',
    validate: j => !!j && !j.error,
    detail: j => j?.articles ? `${j.articles.length} articles` : 'no articles key',
  },
  {
    name: 'Admin API',
    url: 'https://orreryx.io/api/admin?action=health',
    // 401 = auth is enforced = service is running correctly; only 5xx = truly broken
    allowNonOk: true,
    validate: (j, status) => status < 500,
    detail: j => j?.error === 'Unauthorized' ? 'auth enforced (healthy)' : (j?.checks?.redis || 'responding'),
  },
  {
    name: 'Risks API (v1)',
    url: 'https://orreryx.io/api/v1/risks',
    validate: j => Array.isArray(j) || !!j,
    detail: j => Array.isArray(j) ? `${j.length} risks` : 'ok',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function upstashSet(key, value) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(['SET', key, JSON.stringify(value)]),
  }).catch(() => {});
}

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return;
  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      from: 'Orrery COO Agent <coo@orreryx.io>',
      to:   [to],
      subject,
      html,
    }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
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
  const results    = [];
  let allOk        = true;

  for (const check of CHECKS) {
    const start = Date.now();
    try {
      const r  = await fetch(check.url, { signal: AbortSignal.timeout(12000) });
      const ms = Date.now() - start;

      let ok = r.ok;
      let info = '';

      if (check.imageCheck) {
        ok   = r.ok && (r.headers.get('content-type') || '').includes('image');
        info = ok ? check.detail() : 'wrong content-type: ' + r.headers.get('content-type');
      } else if (r.ok || check.allowNonOk) {
        const j = await r.json().catch(() => null);
        ok   = !!check.validate && check.validate(j, r.status);
        info = check.detail ? check.detail(j) : '';
      }

      results.push({ name: check.name, ok, ms, info });
      if (!ok) allOk = false;
    } catch (e) {
      results.push({ name: check.name, ok: false, ms: Date.now() - start, info: e.message });
      allOk = false;
    }
  }

  // Persist to Redis so CEO agent can read it
  await upstashSet('coo:last_check', { results, allOk, time: new Date().toISOString() });

  // Always send report if ?report=1 — otherwise only send on failure
  const forceReport = req.query.report === '1';

  if ((!allOk || forceReport) && adminEmail) {
    const rows = results.map(r => `
      <tr style="border-bottom:1px solid #eee">
        <td style="padding:10px">${r.name}</td>
        <td style="padding:10px;font-weight:bold;color:${r.ok ? '#16a34a' : '#dc2626'}">${r.ok ? '✅ OK' : '❌ FAIL'}</td>
        <td style="padding:10px;color:#666">${r.ms}ms</td>
        <td style="padding:10px;color:#444">${r.info}</td>
      </tr>`).join('');

    const subject = allOk
      ? '✅ Orrery Health — All Systems Operational'
      : '🚨 Orrery Alert — Platform Issue Detected';

    await sendEmail(adminEmail, subject, `
      <div style="font-family:sans-serif;max-width:640px;margin:0 auto">
        <div style="background:#1a1a2e;padding:20px;border-radius:8px 8px 0 0">
          <h2 style="color:white;margin:0">🤖 COO Health Report</h2>
          <p style="color:#aaa;margin:4px 0 0">${new Date().toUTCString()}</p>
        </div>
        <div style="background:${allOk ? '#f0fdf4' : '#fff1f2'};padding:16px;border-left:4px solid ${allOk ? '#16a34a' : '#dc2626'}">
          <strong>${allOk ? '✅ All systems operational' : '🚨 One or more services are failing'}</strong>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="padding:10px;text-align:left">Service</th>
              <th style="padding:10px;text-align:left">Status</th>
              <th style="padding:10px;text-align:left">Latency</th>
              <th style="padding:10px;text-align:left">Details</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="color:#9ca3af;font-size:12px;padding:16px">— Orrery COO Agent · Runs daily 7 AM IST</p>
      </div>
    `);
  }

  // ── CEO Approval check (skip if admin=1 or agent is being manually run) ────────
  // COO agent always runs — it's the watchdog. Approval affects execution agents only.

  return res.status(200).json({ ok: true, allOk, checks: results, time: new Date().toISOString() });
}

export const config = { api: { bodyParser: false } };

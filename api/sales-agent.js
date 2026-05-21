// api/sales-agent.js — Sales Agent: Automated nurture email sequences
// Runs daily at 9:00 AM IST via cron-job.org
// Scans Redis for sub:* subscriber keys, sends Day 3 and Day 7 nurture emails
// Required env vars: RESEND_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, CRON_SECRET

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

// ── Email helper (Gmail SMTP via nodemailer) ──────────────────────────────────

async function sendEmail(to, subject, html) {
  if (!to) return false;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'OrreryX Sales <noreply@orreryx.io>';
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
  } catch (err) { console.error('[Sales sendEmail]', err?.message||err); return false; }
}

// ── Email templates ───────────────────────────────────────────────────────────

function day3Email(email) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:580px;margin:0 auto;color:#111;background:#fff">
      <div style="padding:32px 32px 0">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;color:#9ca3af;text-transform:uppercase">OrreryX</p>
      </div>
      <div style="padding:24px 32px 32px">
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Hey,</p>

        <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Quick question — did you catch what happened to oil prices this week?</p>

        <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Most investors only see the number. OrreryX shows you the why: troop movements, sanctions, shipping route blockades — and which assets move as a result.</p>

        <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#374151">What's live right now:</p>
        <ul style="margin:0 0 24px;padding-left:20px;font-size:14px;line-height:2;color:#374151">
          <li>🇺🇦 Ukraine-Russia — European energy, grain, defence stocks</li>
          <li>🇮🇷 Iran — Oil futures, Strait of Hormuz risk premium</li>
          <li>🇹🇼 Taiwan Strait — Semiconductors, TSMC, supply chain</li>
          <li>🇮🇳🇵🇰 India-Pakistan — EM indices, gold safe-haven flows</li>
        </ul>

        <p style="margin:0 0 28px;font-size:15px;line-height:1.6">This is the context Bloomberg charges $2,000/month for. Worth opening before markets tomorrow?</p>

        <p style="margin:0 0 32px">
          <a href="https://orreryx.io/app" style="display:inline-block;background:#0f172a;color:white;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:.01em">
            Open OrreryX →
          </a>
        </p>

        <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6">
          Reply any time if you have questions. I read them.<br>
          — The OrreryX Team
        </p>
      </div>
      <div style="border-top:1px solid #f3f4f6;padding:16px 32px;text-align:center">
        <p style="margin:0;font-size:11px;color:#d1d5db">
          You signed up at orreryx.io ·
          <a href="https://orreryx.io/unsubscribe?email=${encodeURIComponent(email)}" style="color:#d1d5db">Unsubscribe</a>
        </p>
      </div>
    </div>
  `;
}

function day7Email(email) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:580px;margin:0 auto;color:#111;background:#fff">
      <div style="padding:32px 32px 0">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;color:#9ca3af;text-transform:uppercase">OrreryX</p>
      </div>
      <div style="padding:24px 32px 32px">
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Hey,</p>

        <p style="margin:0 0 20px;font-size:15px;line-height:1.6">You've been on OrreryX for a week. Wanted to check in.</p>

        <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Most people who stay past day 7 tell us the same thing: they opened the app before a market event they'd been watching — and for the first time, they understood <em>why</em> it moved.</p>

        <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#374151">Analyst tier ($14.99/mo) adds:</p>
        <ul style="margin:0 0 24px;padding-left:20px;font-size:14px;line-height:2;color:#374151">
          <li>Live real-time data (no 15-min delay)</li>
          <li>Email alerts the moment a breaking event hits</li>
          <li>Interactive Risk Map — 13 live conflict zones</li>
          <li>Unlimited AI event analysis (free tier: 3/day)</li>
        </ul>

        <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#6b7280">
          For context: Bloomberg charges $349/month for slower, weekly data. We're $14.99.
        </p>

        <p style="margin:0 0 28px;font-size:15px;line-height:1.6">Worth the upgrade?</p>

        <p style="margin:0 0 32px">
          <a href="https://orreryx.io/pricing" style="display:inline-block;background:#d4a843;color:#0f172a;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:.01em">
            See Analyst plan →
          </a>
        </p>

        <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6">
          Happy to stay free too — no pressure. Reply if you have any questions.<br>
          — The OrreryX Team
        </p>
      </div>
      <div style="border-top:1px solid #f3f4f6;padding:16px 32px;text-align:center">
        <p style="margin:0;font-size:11px;color:#d1d5db">
          You signed up at orreryx.io ·
          <a href="https://orreryx.io/unsubscribe?email=${encodeURIComponent(email)}" style="color:#d1d5db">Unsubscribe</a>
        </p>
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

  // CEO approval is fully automatic — no manual gate required
  const now      = Date.now();
  const DAY_MS   = 86400000;
  const results  = { day3: [], day7: [], skipped: 0, errors: [] };

  // Scan for all subscriber keys: sub:*
  // Upstash REST: SCAN 0 MATCH sub:* COUNT 100
  let cursor = '0';
  const subKeys = [];
  do {
    const scanResult = await upstashRaw(['SCAN', cursor, 'MATCH', 'sub:*', 'COUNT', '200']);
    if (!Array.isArray(scanResult) || scanResult.length < 2) break;
    cursor = scanResult[0];
    const keys = scanResult[1];
    if (Array.isArray(keys)) subKeys.push(...keys);
  } while (cursor !== '0');

  for (const key of subKeys) {
    const raw = await upstashGet(key);
    let sub;
    try { sub = JSON.parse(raw || '{}'); } catch { sub = {}; }

    const email     = sub.email || key.replace('sub:', '');
    const signedUpAt = sub.signedUpAt ? new Date(sub.signedUpAt).getTime() : null;
    if (!email || !signedUpAt) { results.skipped++; continue; }

    const ageDays = (now - signedUpAt) / DAY_MS;

    // Day 3 window: between 3 and 4 days old, not yet sent
    if (ageDays >= 3 && ageDays < 4 && !sub.day3Sent) {
      const sent = await sendEmail(email, 'markets moved today', day3Email(email));
      if (sent) {
        sub.day3Sent = new Date().toISOString();
        await upstashSet(key, sub);
        results.day3.push(email);
      } else {
        results.errors.push({ email, step: 'day3' });
      }
      continue;
    }

    // Day 7 window: between 7 and 8 days old, not yet sent
    if (ageDays >= 7 && ageDays < 8 && !sub.day7Sent) {
      const sent = await sendEmail(email, 'worth the upgrade?', day7Email(email));
      if (sent) {
        sub.day7Sent = new Date().toISOString();
        await upstashSet(key, sub);
        results.day7.push(email);
      } else {
        results.errors.push({ email, step: 'day7' });
      }
      continue;
    }

    results.skipped++;
  }

  const scanTime = new Date().toISOString();
  await upstashSet('sales:last_scan', {
    ts:      Date.now(),
    time:    scanTime,
    total:   subKeys.length,
    day3:    results.day3.length,
    day7:    results.day7.length,
    errors:  results.errors.length,
  });

  return res.status(200).json({
    ok:      true,
    total:   subKeys.length,
    results,
    time:    scanTime,
  });
}

export const config = { api: { bodyParser: false } };

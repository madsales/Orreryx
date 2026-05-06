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
  try {
    const { default: nodemailer } = await import('nodemailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({ from: `Orrery <${user}>`, to, subject, html });
    return true;
  } catch (_) { return false; }
}

// ── Email templates ───────────────────────────────────────────────────────────

function day3Email(email) {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111">
      <div style="background:#1a1a2e;padding:24px;border-radius:8px 8px 0 0">
        <h1 style="color:white;margin:0;font-size:22px">🌍 Are you tracking the right risks?</h1>
      </div>
      <div style="padding:24px;background:#fff;border:1px solid #e5e7eb;border-top:none">
        <p>Hey there,</p>
        <p>It's been 3 days since you joined Orrery. I wanted to share something most investors miss.</p>

        <p><strong>Most market moves don't come from earnings reports — they come from geopolitical events that happen before markets open.</strong></p>

        <p>Here's what Orrery is tracking right now:</p>
        <ul style="padding-left:20px;line-height:1.8">
          <li>🇺🇦 <strong>Ukraine-Russia</strong> — Energy prices & European equities exposure</li>
          <li>🇮🇷 <strong>Iran nuclear</strong> — Oil futures & Middle East risk premium</li>
          <li>🇹🇼 <strong>Taiwan Strait</strong> — Semiconductor stocks & tech supply chain</li>
          <li>🇮🇳🇵🇰 <strong>India-Pakistan</strong> — Emerging market indices & gold safe-haven flows</li>
        </ul>

        <p>Every one of these has a direct, measurable impact on oil, gold, crypto and equities.</p>

        <p style="margin:24px 0">
          <a href="https://orreryx.io/app" style="background:#1a1a2e;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
            Open Orrery now →
          </a>
        </p>

        <p style="color:#6b7280;font-size:14px">
          If you have any questions, just reply to this email.<br>
          — The Orrery Team
        </p>
      </div>
      <p style="font-size:11px;color:#9ca3af;padding:12px;text-align:center">
        You're receiving this because you signed up at orreryx.io.
        <a href="https://orreryx.io/unsubscribe?email=${encodeURIComponent(email)}" style="color:#9ca3af">Unsubscribe</a>
      </p>
    </div>
  `;
}

function day7Email(email) {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111">
      <div style="background:#1a1a2e;padding:24px;border-radius:8px 8px 0 0">
        <h1 style="color:white;margin:0;font-size:22px">📊 Unlock the full intelligence layer</h1>
      </div>
      <div style="padding:24px;background:#fff;border:1px solid #e5e7eb;border-top:none">
        <p>Hey,</p>
        <p>You've been using Orrery for a week — here's what our Pro users get that the free tier doesn't:</p>

        <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
          <thead>
            <tr style="background:#f9fafb">
              <th style="padding:10px;text-align:left;border-bottom:1px solid #e5e7eb">Feature</th>
              <th style="padding:10px;text-align:center;border-bottom:1px solid #e5e7eb">Free</th>
              <th style="padding:10px;text-align:center;border-bottom:1px solid #e5e7eb;background:#fffbeb">Pro</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:10px">Live conflict feed</td>
              <td style="padding:10px;text-align:center">✅</td>
              <td style="padding:10px;text-align:center;background:#fffbeb">✅</td>
            </tr>
            <tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:10px">Market impact data</td>
              <td style="padding:10px;text-align:center">✅</td>
              <td style="padding:10px;text-align:center;background:#fffbeb">✅</td>
            </tr>
            <tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:10px">AI event analysis</td>
              <td style="padding:10px;text-align:center">3/day</td>
              <td style="padding:10px;text-align:center;background:#fffbeb;font-weight:600">Unlimited</td>
            </tr>
            <tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:10px">Email alerts on breaking events</td>
              <td style="padding:10px;text-align:center">—</td>
              <td style="padding:10px;text-align:center;background:#fffbeb;font-weight:600">✅</td>
            </tr>
            <tr style="border-bottom:1px solid #f3f4f6">
              <td style="padding:10px">Portfolio risk mapping</td>
              <td style="padding:10px;text-align:center">—</td>
              <td style="padding:10px;text-align:center;background:#fffbeb;font-weight:600">✅</td>
            </tr>
            <tr>
              <td style="padding:10px">Export to CSV / PDF</td>
              <td style="padding:10px;text-align:center">—</td>
              <td style="padding:10px;text-align:center;background:#fffbeb;font-weight:600">✅</td>
            </tr>
          </tbody>
        </table>

        <p><strong>Pro is $29/month</strong> — less than a single Bloomberg data feed. Cancel anytime.</p>

        <p style="margin:24px 0">
          <a href="https://orreryx.io/pricing" style="background:#f59e0b;color:#111;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700">
            Upgrade to Pro →
          </a>
        </p>

        <p style="color:#6b7280;font-size:14px">
          Questions? Just reply. I read every email.<br>
          — The Orrery Team
        </p>
      </div>
      <p style="font-size:11px;color:#9ca3af;padding:12px;text-align:center">
        You're receiving this because you signed up at orreryx.io.
        <a href="https://orreryx.io/unsubscribe?email=${encodeURIComponent(email)}" style="color:#9ca3af">Unsubscribe</a>
      </p>
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

  // ── CEO Approval check ────────────────────────────────────────────────────────
  if (req.query.admin !== '1') {
    const today = new Date().toISOString().split('T')[0];
    const approvedRaw = await (async () => {
      const url   = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (!url || !token) return null;
      const r = await fetch(`${url}/get/${encodeURIComponent(`ceo:approved:${today}`)}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      if (!r?.ok) return null;
      const j = await r.json().catch(() => null);
      return j?.result ?? null;
    })();
    if (!approvedRaw) {
      return res.status(200).json({ ok: false, reason: 'Awaiting CEO approval for ' + today });
    }
  }

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
      const sent = await sendEmail(email, '🌍 3 things Orrery is tracking that move markets today', day3Email(email));
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
      const sent = await sendEmail(email, '📊 Your 7-day Orrery check-in + Pro offer', day7Email(email));
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

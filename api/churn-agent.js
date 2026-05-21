// api/churn-agent.js — Churn Prevention Agent
// Runs daily. Sends D14/D30/D60 retention emails, dunning recovery for failed payments,
// and cancel save-offer flow.
//
// Redis keys used:
//   sub:{email}               → subscriber record (signedUpAt, day3Sent, day7Sent, etc.)
//   user:{email}:sub_status   → 'active' | 'suspended' | 'cancelled'
//   user:{email}:plan         → 's' | 'a' | 'c'
//   user:{email}:sub_id       → PayPal subscription ID
//   churn:d14:{email}         → exists if D14 email sent
//   churn:d30:{email}         → exists if D30 email sent
//   churn:d60:{email}         → exists if D60 email sent
//   churn:dunning:{email}     → JSON { count, lastSent }
//   churn:paused:{email}      → exists if subscription paused
//   churn:last_run            → JSON summary of last run
//
// Required env vars: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, CRON_SECRET
// Optional: RESEND_API_KEY, ADMIN_EMAIL, GMAIL_USER, GMAIL_APP_PASSWORD, EMAIL_FROM

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
  const from = process.env.EMAIL_FROM || 'OrreryX <noreply@orreryx.io>';
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
  } catch (err) { console.error('[churn sendEmail]', err?.message || err); return false; }
}

function unsub(email) {
  return `https://orreryx.io/unsubscribe?email=${encodeURIComponent(email)}`;
}

// ── Email templates ───────────────────────────────────────────────────────────

function day14Email(email, plan) {
  const planLabel = plan === 'c' ? 'Command' : plan === 'a' ? 'Analyst' : 'Starter';
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:580px;margin:0 auto;color:#111;background:#fff">
  <div style="padding:32px 32px 0"><p style="margin:0;font-size:11px;letter-spacing:2px;color:#9ca3af;text-transform:uppercase">OrreryX</p></div>
  <div style="padding:24px 32px 32px">
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Hey,</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Two weeks in. Are you getting value from OrreryX?</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Most people open it before big macro events — before the Fed, before OPEC decisions, before anything that touches oil or gold. The idea is to walk into those moments already knowing which assets are at risk and why.</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">If you haven't tried the live risk map yet, that's the fastest way to see it. Thirteen active conflict zones, each with the specific market assets they affect.</p>
    <p style="margin:0 0 32px">
      <a href="https://orreryx.io/app" style="display:inline-block;background:#0f172a;color:white;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">Open the dashboard →</a>
    </p>
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6">Reply any time if you have questions.<br>— The OrreryX Team</p>
  </div>
  <div style="border-top:1px solid #f3f4f6;padding:16px 32px;text-align:center">
    <p style="margin:0;font-size:11px;color:#d1d5db">OrreryX ${planLabel} · <a href="${unsub(email)}" style="color:#d1d5db">Unsubscribe</a></p>
  </div>
</div>`;
}

function day30Email(email, plan) {
  const isStarter = plan === 's' || !plan;
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:580px;margin:0 auto;color:#111;background:#fff">
  <div style="padding:32px 32px 0"><p style="margin:0;font-size:11px;letter-spacing:2px;color:#9ca3af;text-transform:uppercase">OrreryX</p></div>
  <div style="padding:24px 32px 32px">
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Hey,</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">One month. Quick question — which part of OrreryX do you actually use?</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">I ask because people use it differently. Some open it every morning before checking prices. Others only pull it up when a specific region escalates. Some use it purely for the market impact layer.</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Just reply and tell me — it helps us build the right things next.</p>
    ${isStarter ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6">Also — if you want real-time data instead of the 15-minute delay, the Analyst plan is $14.99/month. That's the one most active traders use.</p>
    <p style="margin:0 0 32px"><a href="https://orreryx.io/pricing" style="display:inline-block;background:#d4a843;color:#0f172a;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">See Analyst plan →</a></p>` : `<p style="margin:0 0 32px"><a href="https://orreryx.io/app" style="display:inline-block;background:#0f172a;color:white;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">Open OrreryX →</a></p>`}
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6">— The OrreryX Team</p>
  </div>
  <div style="border-top:1px solid #f3f4f6;padding:16px 32px;text-align:center">
    <p style="margin:0;font-size:11px;color:#d1d5db">OrreryX · <a href="${unsub(email)}" style="color:#d1d5db">Unsubscribe</a></p>
  </div>
</div>`;
}

function day60Email(email, plan) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:580px;margin:0 auto;color:#111;background:#fff">
  <div style="padding:32px 32px 0"><p style="margin:0;font-size:11px;letter-spacing:2px;color:#9ca3af;text-transform:uppercase">OrreryX</p></div>
  <div style="padding:24px 32px 32px">
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Hey,</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">We noticed you haven't been back lately.</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">A lot has happened in the past 60 days — oil prices moved on Strait of Hormuz tension, gold hit new highs on safe-haven flows, and the India-Pakistan escalation sent emerging market indices sharply lower. OrreryX tracked all of it in real time.</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">If you want to come back, use code <strong>COMEBACK20</strong> for 20% off your next month. Just reply with "comeback" and we'll apply it manually, or enter it at checkout.</p>
    <p style="margin:0 0 32px"><a href="https://orreryx.io/app" style="display:inline-block;background:#0f172a;color:white;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">Open OrreryX →</a></p>
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6">No pressure either way.<br>— The OrreryX Team</p>
  </div>
  <div style="border-top:1px solid #f3f4f6;padding:16px 32px;text-align:center">
    <p style="margin:0;font-size:11px;color:#d1d5db">OrreryX · <a href="${unsub(email)}" style="color:#d1d5db">Unsubscribe</a></p>
  </div>
</div>`;
}

function dunningEmail(email, attempt, plan) {
  const planLabel = plan === 'c' ? 'Command ($34.99)' : plan === 'a' ? 'Analyst ($14.99)' : 'Starter ($0.99)';
  if (attempt === 1) return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:580px;margin:0 auto;color:#111;background:#fff">
  <div style="padding:32px 32px 0"><p style="margin:0;font-size:11px;letter-spacing:2px;color:#9ca3af;text-transform:uppercase">OrreryX</p></div>
  <div style="padding:24px 32px 32px">
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Hey,</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Your payment for OrreryX ${planLabel} didn't go through.</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">This usually happens when a card expires or a bank declines an automatic charge. Your account is still active — just update your payment method to keep it running.</p>
    <p style="margin:0 0 32px"><a href="https://orreryx.io/pricing" style="display:inline-block;background:#0f172a;color:white;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">Update payment →</a></p>
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6">— The OrreryX Team</p>
  </div>
  <div style="border-top:1px solid #f3f4f6;padding:16px 32px;text-align:center">
    <p style="margin:0;font-size:11px;color:#d1d5db">OrreryX · <a href="${unsub(email)}" style="color:#d1d5db">Unsubscribe</a></p>
  </div>
</div>`;
  if (attempt === 2) return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:580px;margin:0 auto;color:#111;background:#fff">
  <div style="padding:32px 32px 0"><p style="margin:0;font-size:11px;letter-spacing:2px;color:#9ca3af;text-transform:uppercase">OrreryX</p></div>
  <div style="padding:24px 32px 32px">
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Hey,</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Still seeing a failed payment on your OrreryX account.</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Your access will be suspended in 6 days if we can't process payment. Takes 30 seconds to update.</p>
    <p style="margin:0 0 32px"><a href="https://orreryx.io/pricing" style="display:inline-block;background:#e03836;color:white;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">Fix payment now →</a></p>
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6">— The OrreryX Team</p>
  </div>
  <div style="border-top:1px solid #f3f4f6;padding:16px 32px;text-align:center">
    <p style="margin:0;font-size:11px;color:#d1d5db">OrreryX · <a href="${unsub(email)}" style="color:#d1d5db">Unsubscribe</a></p>
  </div>
</div>`;
  // attempt 3 — final notice
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:580px;margin:0 auto;color:#111;background:#fff">
  <div style="padding:32px 32px 0"><p style="margin:0;font-size:11px;letter-spacing:2px;color:#9ca3af;text-transform:uppercase">OrreryX</p></div>
  <div style="padding:24px 32px 32px">
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Hey,</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">This is the last notice before your OrreryX account is suspended.</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">Update your payment in the next 24 hours to keep your access. If you'd rather pause than cancel, just reply and we'll hold your account for 30 days at no charge.</p>
    <p style="margin:0 0 32px"><a href="https://orreryx.io/pricing" style="display:inline-block;background:#e03836;color:white;padding:13px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px">Update payment →</a></p>
    <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6">— The OrreryX Team</p>
  </div>
  <div style="border-top:1px solid #f3f4f6;padding:16px 32px;text-align:center">
    <p style="margin:0;font-size:11px;color:#d1d5db">OrreryX · <a href="${unsub(email)}" style="color:#d1d5db">Unsubscribe</a></p>
  </div>
</div>`;
}

// ── Main scan ─────────────────────────────────────────────────────────────────

async function runChurnScan() {
  const now    = Date.now();
  const DAY_MS = 86400000;
  const results = { d14: [], d30: [], d60: [], dunning: [], skipped: 0, errors: [] };

  // ── Scan all subscriber keys ──────────────────────────────────────────────
  let cursor = '0';
  const subKeys = [];
  do {
    const scan = await upstashRaw(['SCAN', cursor, 'MATCH', 'sub:*', 'COUNT', '200']);
    if (!Array.isArray(scan) || scan.length < 2) break;
    cursor = scan[0];
    if (Array.isArray(scan[1])) subKeys.push(...scan[1]);
  } while (cursor !== '0');

  for (const key of subKeys) {
    const raw = await upstashGet(key);
    let sub;
    try { sub = JSON.parse(raw || '{}'); } catch { sub = {}; }

    const email      = sub.email || key.replace('sub:', '');
    const signedUpAt = sub.signedUpAt ? new Date(sub.signedUpAt).getTime() : null;
    if (!email || !signedUpAt) { results.skipped++; continue; }

    const ageDays   = (now - signedUpAt) / DAY_MS;
    const subStatus = await upstashGet(`user:${email}:sub_status`);
    const plan      = await upstashGet(`user:${email}:plan`) || sub.plan || 's';

    // ── Dunning: suspended (failed payment) subscribers ───────────────────
    if (subStatus === 'suspended') {
      const dunningRaw  = await upstashGet(`churn:dunning:${email}`);
      const dunning     = dunningRaw ? JSON.parse(dunningRaw) : { count: 0, lastSent: 0 };
      const daysSinceLast = (now - (dunning.lastSent || 0)) / DAY_MS;

      // D1, D4, D10 cadence
      const shouldSend =
        (dunning.count === 0) ||
        (dunning.count === 1 && daysSinceLast >= 3) ||
        (dunning.count === 2 && daysSinceLast >= 6);

      if (shouldSend && dunning.count < 3) {
        const attempt = dunning.count + 1;
        const subjects = ['payment didn\'t go through', 'quick reminder', 'last chance'];
        const sent = await sendEmail(email, subjects[dunning.count], dunningEmail(email, attempt, plan));
        if (sent) {
          await upstashSet(`churn:dunning:${email}`, { count: attempt, lastSent: now }, 2592000);
          results.dunning.push({ email, attempt });
        } else {
          results.errors.push({ email, step: `dunning-${attempt}` });
        }
      }
      continue;
    }

    // Skip non-active users for milestone emails
    if (subStatus === 'cancelled') { results.skipped++; continue; }

    // ── Day 14 ────────────────────────────────────────────────────────────
    if (ageDays >= 14 && ageDays < 15) {
      const sent14 = await upstashGet(`churn:d14:${email}`);
      if (!sent14) {
        const ok = await sendEmail(email, 'still getting value?', day14Email(email, plan));
        if (ok) {
          await upstashSet(`churn:d14:${email}`, '1', 604800 * 8); // 8 weeks
          results.d14.push(email);
        } else { results.errors.push({ email, step: 'd14' }); }
        continue;
      }
    }

    // ── Day 30 ────────────────────────────────────────────────────────────
    if (ageDays >= 30 && ageDays < 31) {
      const sent30 = await upstashGet(`churn:d30:${email}`);
      if (!sent30) {
        const ok = await sendEmail(email, 'one month in', day30Email(email, plan));
        if (ok) {
          await upstashSet(`churn:d30:${email}`, '1', 604800 * 12);
          results.d30.push(email);
        } else { results.errors.push({ email, step: 'd30' }); }
        continue;
      }
    }

    // ── Day 60 ────────────────────────────────────────────────────────────
    if (ageDays >= 60 && ageDays < 61) {
      const sent60 = await upstashGet(`churn:d60:${email}`);
      if (!sent60) {
        const ok = await sendEmail(email, 'we miss you', day60Email(email, plan));
        if (ok) {
          await upstashSet(`churn:d60:${email}`, '1', 604800 * 16);
          results.d60.push(email);
        } else { results.errors.push({ email, step: 'd60' }); }
        continue;
      }
    }

    results.skipped++;
  }

  return results;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const cronSecret  = process.env.CRON_SECRET;
  const authHeader  = req.headers['authorization'];
  const querySecret = req.query.secret;
  const action      = req.query.action || '';

  // Save-offer page is public (linked from paypal cancel flow)
  const isPublicAction = action === 'save-offer';

  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    if (!isPublicAction) return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Save offer: pause instead of cancel ──────────────────────────────────
  if (action === 'save-offer') {
    const email = req.query.email || (req.body || {}).email || '';
    if (!email) return res.status(400).json({ error: 'email required' });

    if (req.method === 'POST') {
      // Accept pause
      const choice = (req.body || {}).choice || 'pause';
      await upstashSet(`churn:paused:${email}`, JSON.stringify({ choice, pausedAt: Date.now() }), 2592000);
      // Mark subscription as paused so health check doesn't flag it
      await upstashSet(`user:${email}:sub_status`, 'paused');
      // Send confirmation
      await sendEmail(email, 'your pause is confirmed', `<div style="font-family:sans-serif;max-width:580px;margin:0 auto;padding:32px;color:#111">
        <p style="font-size:11px;letter-spacing:2px;color:#9ca3af;text-transform:uppercase;margin:0 0 24px">OrreryX</p>
        <p style="font-size:15px;line-height:1.6">Done — your OrreryX account is paused for 30 days. No charge during that time.</p>
        <p style="font-size:15px;line-height:1.6">You can reactivate any time at <a href="https://orreryx.io/pricing" style="color:#0f172a">orreryx.io/pricing</a>.</p>
        <p style="font-size:13px;color:#9ca3af;margin-top:24px">— The OrreryX Team</p>
      </div>`);
      return res.status(200).json({ ok: true, choice, email });
    }

    // GET — show options
    return res.status(200).json({
      ok: true,
      email,
      options: [
        { id: 'pause',    label: 'Pause for 30 days (free)',     description: 'Keep your account, skip one month, reactivate any time' },
        { id: 'discount', label: '20% off next month',           description: 'Use code COMEBACK20 at checkout — reply to any email to claim' },
        { id: 'downgrade',label: 'Downgrade to Starter ($0.99)', description: 'Keep access at the lowest tier' },
      ],
    });
  }

  // ── View last run ─────────────────────────────────────────────────────────
  if (req.query.view === '1') {
    const last = await upstashGet('churn:last_run');
    return res.status(200).json({ ok: true, last: JSON.parse(last || 'null') });
  }

  // ── Main cron run ─────────────────────────────────────────────────────────
  const results  = await runChurnScan();
  const scanTime = new Date().toISOString();

  await upstashSet('churn:last_run', {
    ts:      Date.now(),
    time:    scanTime,
    d14:     results.d14.length,
    d30:     results.d30.length,
    d60:     results.d60.length,
    dunning: results.dunning.length,
    errors:  results.errors.length,
    skipped: results.skipped,
  });

  return res.status(200).json({
    ok:   true,
    time: scanTime,
    results,
  });
}

export const config = { api: { bodyParser: true } };

async function upstashRaw(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!r?.ok) return null;
  return (await r.json().catch(() => null))?.result ?? null;
}
async function upstashGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  if (!r?.ok) return null;
  return (await r.json().catch(() => null))?.result ?? null;
}
async function upstashSet(key, value, exSeconds = null) {
  const cmd = exSeconds
    ? ['SET', key, typeof value === 'string' ? value : JSON.stringify(value), 'EX', exSeconds]
    : ['SET', key, typeof value === 'string' ? value : JSON.stringify(value)];
  return upstashRaw(cmd);
}

async function sendEmail(to, subject, html) {
  if (!to) return false;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'OrreryX <noreply@orreryx.io>';
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
  return false;
}

function generateCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'ORX-';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function scanKeys(pattern) {
  let cursor = '0';
  const keys = [];
  do {
    const result = await upstashRaw(['SCAN', cursor, 'MATCH', pattern, 'COUNT', '100']);
    if (!result || !Array.isArray(result)) break;
    cursor = result[0];
    if (Array.isArray(result[1])) keys.push(...result[1]);
  } while (cursor !== '0');
  return keys;
}

function rewardEmail(email, referralCount) {
  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
      <h2 style="margin:0 0 16px">You earned a free month 🎉</h2>
      <p>Hey there,</p>
      <p>You've successfully referred <strong>${referralCount} people</strong> to OrreryX. That's huge — thank you.</p>
      <p>We're adding <strong>one free month</strong> to your account. No action needed on your end; it'll show up automatically at your next renewal.</p>
      <p>Keep sharing — every 3 referrals earns you another free month.</p>
      <p style="margin-top:32px">— The OrreryX team</p>
    </div>
  `;
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}` && req.query.secret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { action } = req.query;

  // POST ?action=create { email }
  if (req.method === 'POST' && action === 'create') {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });

    // Check if user already has a code
    const existingCode = await upstashGet(`referral:user:${email}`);
    if (existingCode) {
      return res.status(200).json({
        code: existingCode,
        shareUrl: `https://orreryx.io/login?ref=${existingCode}`,
      });
    }

    let code;
    let attempts = 0;
    do {
      code = generateCode();
      const existing = await upstashGet(`referral:code:${code}`);
      if (!existing) break;
      attempts++;
    } while (attempts < 10);

    const record = {
      email,
      code,
      createdAt: new Date().toISOString(),
      referrals: [],
      rewarded: 0,
    };

    await upstashSet(`referral:code:${code}`, record);
    await upstashSet(`referral:user:${email}`, code);

    return res.status(200).json({
      code,
      shareUrl: `https://orreryx.io/login?ref=${code}`,
    });
  }

  // GET ?action=stats&email={email}
  if (req.method === 'GET' && action === 'stats') {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email required' });

    const code = await upstashGet(`referral:user:${email}`);
    if (!code) return res.status(404).json({ error: 'No referral code found for this email' });

    const raw = await upstashGet(`referral:code:${code}`);
    const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!record) return res.status(404).json({ error: 'Referral record not found' });

    const referralCount = Array.isArray(record.referrals) ? record.referrals.length : 0;
    const rewarded = record.rewarded || 0;
    const pendingRewards = Math.floor(referralCount / 3) - rewarded;

    return res.status(200).json({
      code: record.code,
      referrals: referralCount,
      rewards: Array.from({ length: rewarded }, (_, i) => ({
        type: '1 month free',
        earnedAt: `Batch ${i + 1}`,
      })),
      pendingRewards,
      shareUrl: `https://orreryx.io/login?ref=${code}`,
    });
  }

  // GET ?action=check&code={code}
  if (req.method === 'GET' && action === 'check') {
    const { code } = req.query;
    if (!code) return res.status(400).json({ error: 'code required' });

    const raw = await upstashGet(`referral:code:${code}`);
    if (!raw) return res.status(200).json({ valid: false });

    const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return res.status(200).json({ valid: true, email: record.email });
  }

  // POST ?action=convert { code, newEmail }
  if (req.method === 'POST' && action === 'convert') {
    const { code, newEmail } = req.body || {};
    if (!code || !newEmail) return res.status(400).json({ error: 'code and newEmail required' });

    const raw = await upstashGet(`referral:code:${code}`);
    if (!raw) return res.status(404).json({ error: 'Invalid referral code' });

    const record = typeof raw === 'string' ? JSON.parse(raw) : raw;

    // Avoid duplicate conversions
    if (!Array.isArray(record.referrals)) record.referrals = [];
    if (record.referrals.includes(newEmail)) {
      return res.status(200).json({ ok: true, message: 'Already converted' });
    }

    record.referrals.push(newEmail);
    await upstashSet(`referral:code:${code}`, record);
    await upstashRaw(['INCR', 'referral:total']);

    const referralCount = record.referrals.length;
    const rewarded = record.rewarded || 0;
    const earnedRewards = Math.floor(referralCount / 3);

    if (earnedRewards > rewarded) {
      // Send reward email
      await sendEmail(
        record.email,
        'you earned a free month',
        rewardEmail(record.email, referralCount)
      );
      record.rewarded = earnedRewards;
      await upstashSet(`referral:code:${code}`, record);
    }

    return res.status(200).json({ ok: true, referrals: referralCount });
  }

  // Default cron run: scan all codes, find unrewarded referrers
  if (req.method === 'GET' && !action) {
    const keys = await scanKeys('referral:code:*');
    const results = { scanned: keys.length, rewarded: [], errors: [] };

    for (const key of keys) {
      try {
        const raw = await upstashGet(key);
        if (!raw) continue;
        const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!record.email) continue;

        const referralCount = Array.isArray(record.referrals) ? record.referrals.length : 0;
        const rewarded = record.rewarded || 0;
        const earnedRewards = Math.floor(referralCount / 3);

        if (earnedRewards > rewarded) {
          const sent = await sendEmail(
            record.email,
            'you earned a free month',
            rewardEmail(record.email, referralCount)
          );
          record.rewarded = earnedRewards;
          await upstashSet(key, record);
          results.rewarded.push({ email: record.email, code: record.code, sent });
        }
      } catch (e) {
        results.errors.push({ key, error: e.message });
      }
    }

    const summary = { ...results, runAt: new Date().toISOString() };
    await upstashSet('referral:last_run', summary);
    return res.status(200).json(summary);
  }

  return res.status(400).json({ error: 'Invalid action or method' });
}

export const config = { api: { bodyParser: true } };

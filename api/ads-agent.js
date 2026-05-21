// api/ads-agent.js — OrreryX Ad Copy Generator
// Runs weekly via cron. Uses Claude Haiku to generate ad creative variants for
// Google Ads (RSA), LinkedIn Ads, and Meta (Facebook/Instagram).
// Emails formatted HTML results to ADMIN_EMAIL, ready to copy-paste into ad platforms.
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//   RESEND_API_KEY (or GMAIL_USER + GMAIL_APP_PASSWORD)
//   ADMIN_EMAIL
//   CRON_SECRET
//   EMAIL_FROM (optional, defaults to OrreryX <noreply@orreryx.io>)

// ── Redis helpers ─────────────────────────────────────────────────────────────

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
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  const cmd = exSeconds
    ? ['SET', key, JSON.stringify(value), 'EX', exSeconds]
    : ['SET', key, JSON.stringify(value)];
  await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(5000) }).catch(() => {});
}

// ── Claude API helper ─────────────────────────────────────────────────────────

async function claudeCall(prompt, maxTokens = 1000) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  return d?.content?.[0]?.text?.trim() || null;
}

// ── Email helper ──────────────────────────────────────────────────────────────

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
  try {
    const { default: nodemailer } = await import('nodemailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({ from: `OrreryX <${user}>`, to: to.trim(), subject, html });
    return true;
  } catch (_) { return false; }
}

// ── Ad generation: Google Ads (RSA) ──────────────────────────────────────────

async function generateGoogleAds() {
  const prompt = `You are a Google Ads copywriter for OrreryX — a live geopolitical intelligence platform at orreryx.io/app.

PRODUCT:
- Connects global conflicts → market impact (oil, gold, crypto, defence stocks)
- Plans: Starter $0.99/mo, Analyst $14.99/mo, Command $34.99/mo
- Key differentiator: Bloomberg costs $2,000/mo; OrreryX is $14.99/mo
- Audience: retail investors, independent traders, financial analysts

Generate EXACTLY 15 Google Ads headlines and 4 descriptions spread across 5 angles.

ANGLES:
1. Pain Point (fear of missing market-moving news)
2. Outcome (portfolio gains, better decisions)
3. Social Proof (real traders use this)
4. Urgency (events happening now)
5. Price Comparison (vs Bloomberg $2,000/mo)

RULES:
- Headlines: MAX 30 characters each (count carefully, spaces count)
- Descriptions: MAX 90 characters each (spaces count)
- Do NOT include the URL in headlines or descriptions
- No exclamation marks in headlines
- Be specific, not generic

Return ONLY valid JSON in this exact structure, no extra text:
{
  "headlines": [
    {"text": "...", "angle": "pain_point"},
    {"text": "...", "angle": "pain_point"},
    {"text": "...", "angle": "pain_point"},
    {"text": "...", "angle": "outcome"},
    {"text": "...", "angle": "outcome"},
    {"text": "...", "angle": "outcome"},
    {"text": "...", "angle": "social_proof"},
    {"text": "...", "angle": "social_proof"},
    {"text": "...", "angle": "social_proof"},
    {"text": "...", "angle": "urgency"},
    {"text": "...", "angle": "urgency"},
    {"text": "...", "angle": "urgency"},
    {"text": "...", "angle": "price_comparison"},
    {"text": "...", "angle": "price_comparison"},
    {"text": "...", "angle": "price_comparison"}
  ],
  "descriptions": [
    {"text": "...", "angle": "pain_point"},
    {"text": "...", "angle": "outcome"},
    {"text": "...", "angle": "social_proof"},
    {"text": "...", "angle": "urgency"}
  ]
}`;

  const raw = await claudeCall(prompt, 1200);
  if (!raw) return null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (_) { return null; }
}

// ── Ad generation: LinkedIn Ads ───────────────────────────────────────────────

async function generateLinkedInAds() {
  const prompt = `You are a LinkedIn Ads copywriter for OrreryX — a live geopolitical intelligence platform at orreryx.io/app.

PRODUCT:
- Connects global conflicts → market impact (oil, gold, crypto, defence stocks)
- Plans: Starter $0.99/mo, Analyst $14.99/mo, Command $34.99/mo
- Key differentiator: Bloomberg costs $2,000/mo; OrreryX is $14.99/mo
- Audience: B2B — financial analysts, portfolio managers, independent traders, research teams

Generate EXACTLY 5 intro text variants and 5 headline variants across 3 angles.

ANGLES:
1. B2B Analyst/Trader Targeting (speak to professional context)
2. Competitive (vs Bloomberg — same data, 100x cheaper)
3. Value Proposition (live geopolitical → market intelligence)

RULES:
- Intro text: MAX 150 characters each
- Headlines: MAX 70 characters each
- Professional tone, no hype
- Distribute the 5 intros and 5 headlines across the 3 angles (roughly 2/2/1 or 2/1/2)

Return ONLY valid JSON, no extra text:
{
  "intro_texts": [
    {"text": "...", "angle": "b2b_targeting"},
    {"text": "...", "angle": "b2b_targeting"},
    {"text": "...", "angle": "competitive"},
    {"text": "...", "angle": "competitive"},
    {"text": "...", "angle": "value_prop"}
  ],
  "headlines": [
    {"text": "...", "angle": "b2b_targeting"},
    {"text": "...", "angle": "b2b_targeting"},
    {"text": "...", "angle": "competitive"},
    {"text": "...", "angle": "competitive"},
    {"text": "...", "angle": "value_prop"}
  ]
}`;

  const raw = await claudeCall(prompt, 1000);
  if (!raw) return null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (_) { return null; }
}

// ── Ad generation: Meta (Facebook/Instagram) ──────────────────────────────────

async function generateMetaAds() {
  const prompt = `You are a Meta (Facebook/Instagram) Ads copywriter for OrreryX — a live geopolitical intelligence platform at orreryx.io/app.

PRODUCT:
- Connects global conflicts → market impact (oil, gold, crypto, defence stocks)
- Plans: Starter $0.99/mo, Analyst $14.99/mo, Command $34.99/mo
- Key differentiator: Bloomberg costs $2,000/mo; OrreryX is $14.99/mo
- Audience: retail investors, crypto traders, self-directed investors aged 25-55

Generate EXACTLY 5 primary text variants and 5 headline variants across 3 angles.

ANGLES:
1. FOMO/Urgency (events moving markets RIGHT NOW)
2. Curiosity Hook (what do traders know that you don't?)
3. Social Proof (other traders already using this)

RULES:
- Primary text: MAX 125 characters each
- Headlines: MAX 40 characters each
- Conversational tone, scroll-stopping hooks
- Can use 1 emoji per primary text if it adds impact
- Distribute evenly: ~2 per angle for primary texts, ~2 per angle for headlines

Return ONLY valid JSON, no extra text:
{
  "primary_texts": [
    {"text": "...", "angle": "fomo_urgency"},
    {"text": "...", "angle": "fomo_urgency"},
    {"text": "...", "angle": "curiosity_hook"},
    {"text": "...", "angle": "curiosity_hook"},
    {"text": "...", "angle": "social_proof"}
  ],
  "headlines": [
    {"text": "...", "angle": "fomo_urgency"},
    {"text": "...", "angle": "fomo_urgency"},
    {"text": "...", "angle": "curiosity_hook"},
    {"text": "...", "angle": "curiosity_hook"},
    {"text": "...", "angle": "social_proof"}
  ]
}`;

  const raw = await claudeCall(prompt, 1000);
  if (!raw) return null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (_) { return null; }
}

// ── Build HTML email ──────────────────────────────────────────────────────────

const ANGLE_LABELS = {
  pain_point:      'Pain Point',
  outcome:         'Outcome',
  social_proof:    'Social Proof',
  urgency:         'Urgency',
  price_comparison:'Price Comparison',
  b2b_targeting:   'B2B Analyst/Trader',
  competitive:     'Competitive (vs Bloomberg)',
  value_prop:      'Value Proposition',
  fomo_urgency:    'FOMO / Urgency',
  curiosity_hook:  'Curiosity Hook',
};

const ANGLE_COLORS = {
  pain_point:       '#7f1d1d',
  outcome:          '#14532d',
  social_proof:     '#1e3a5f',
  urgency:          '#78350f',
  price_comparison: '#4a1d96',
  b2b_targeting:    '#1e3a5f',
  competitive:      '#4a1d96',
  value_prop:       '#14532d',
  fomo_urgency:     '#7f1d1d',
  curiosity_hook:   '#78350f',
};

function angleBadge(angle) {
  const label = ANGLE_LABELS[angle] || angle;
  const color = ANGLE_COLORS[angle] || '#374151';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:12px;background:${color};color:#fff;font-size:10px;letter-spacing:1px;text-transform:uppercase;font-weight:700">${label}</span>`;
}

function charCount(text, limit) {
  const len = (text || '').length;
  const ok = len <= limit;
  return `<span style="font-size:11px;color:${ok ? '#4ade80' : '#f87171'};margin-left:8px">${len}/${limit} chars</span>`;
}

function adCard(text, angle, charLimit) {
  return `
    <div style="background:#111827;border-radius:6px;padding:14px 16px;margin-bottom:8px;border-left:3px solid ${ANGLE_COLORS[angle] || '#374151'}">
      <div style="margin-bottom:6px">${angleBadge(angle)} ${charCount(text, charLimit)}</div>
      <div style="font-size:14px;color:#f3f4f6;line-height:1.5;font-family:monospace">${escHtml(text)}</div>
    </div>`;
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function sectionHeader(title, icon, count) {
  return `
    <div style="margin:32px 0 16px">
      <div style="font-size:11px;letter-spacing:3px;color:#9ca3af;margin-bottom:4px">AD CREATIVE</div>
      <div style="font-size:20px;font-weight:900;color:#fff">${icon} ${title}</div>
      <div style="font-size:12px;color:#6b7280;margin-top:2px">${count} variants generated</div>
    </div>`;
}

function subHeader(label) {
  return `<div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin:20px 0 8px;text-transform:uppercase">${label}</div>`;
}

function buildHtmlEmail(google, linkedin, meta, date) {
  const googleSection = google ? `
    ${sectionHeader('Google Ads — Responsive Search Ads', '🔍', '15 headlines + 4 descriptions')}
    ${subHeader('Headlines (max 30 chars each)')}
    ${(google.headlines || []).map(h => adCard(h.text, h.angle, 30)).join('')}
    ${subHeader('Descriptions (max 90 chars each)')}
    ${(google.descriptions || []).map(d => adCard(d.text, d.angle, 90)).join('')}
    <div style="background:#1f2937;border-radius:6px;padding:12px 16px;margin-top:8px;font-size:12px;color:#9ca3af">
      <strong style="color:#d1d5db">Display URL:</strong> orreryx.io &nbsp;|&nbsp;
      <strong style="color:#d1d5db">Final URL:</strong> https://orreryx.io/app
    </div>` : `<div style="color:#f87171;padding:16px">Google Ads generation failed — check ANTHROPIC_API_KEY</div>`;

  const linkedinSection = linkedin ? `
    ${sectionHeader('LinkedIn Ads', '💼', '5 intro texts + 5 headlines')}
    ${subHeader('Intro Text (max 150 chars)')}
    ${(linkedin.intro_texts || []).map(t => adCard(t.text, t.angle, 150)).join('')}
    ${subHeader('Headlines (max 70 chars)')}
    ${(linkedin.headlines || []).map(h => adCard(h.text, h.angle, 70)).join('')}` : `<div style="color:#f87171;padding:16px">LinkedIn Ads generation failed</div>`;

  const metaSection = meta ? `
    ${sectionHeader('Meta Ads — Facebook & Instagram', '📱', '5 primary texts + 5 headlines')}
    ${subHeader('Primary Text (max 125 chars)')}
    ${(meta.primary_texts || []).map(t => adCard(t.text, t.angle, 125)).join('')}
    ${subHeader('Headlines (max 40 chars)')}
    ${(meta.headlines || []).map(h => adCard(h.text, h.angle, 40)).join('')}` : `<div style="color:#f87171;padding:16px">Meta Ads generation failed</div>`;

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;background:#0a0f1e;color:#fff;border-radius:8px;overflow:hidden">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1a237e,#0d47a1);padding:28px 28px 24px">
    <div style="font-size:11px;letter-spacing:3px;color:rgba(255,255,255,0.65);margin-bottom:6px">ORRERY AD AGENT</div>
    <div style="font-size:26px;font-weight:900">Weekly Ad Creative Report</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:6px">Generated ${date} · Claude Haiku · Ready to copy-paste</div>
  </div>

  <!-- Quick stats -->
  <div style="display:flex;gap:1px;background:#1f2937">
    <div style="flex:1;background:#111827;padding:16px 20px;text-align:center">
      <div style="font-size:24px;font-weight:900;color:#60a5fa">19</div>
      <div style="font-size:11px;color:#9ca3af;letter-spacing:1px">GOOGLE VARIANTS</div>
    </div>
    <div style="flex:1;background:#111827;padding:16px 20px;text-align:center">
      <div style="font-size:24px;font-weight:900;color:#a78bfa">10</div>
      <div style="font-size:11px;color:#9ca3af;letter-spacing:1px">LINKEDIN VARIANTS</div>
    </div>
    <div style="flex:1;background:#111827;padding:16px 20px;text-align:center">
      <div style="font-size:24px;font-weight:900;color:#f472b6">10</div>
      <div style="font-size:11px;color:#9ca3af;letter-spacing:1px">META VARIANTS</div>
    </div>
  </div>

  <!-- Notice -->
  <div style="padding:16px 28px;background:#1a2744;border-bottom:1px solid #1f2937;font-size:13px;color:#93c5fd">
    ℹ️ Character counts shown inline. <span style="color:#4ade80">Green</span> = within limit. <span style="color:#f87171">Red</span> = over limit (edit before uploading).
  </div>

  <!-- Ad sections -->
  <div style="padding:8px 28px 28px">
    ${googleSection}
    <div style="height:1px;background:#1f2937;margin:32px 0"></div>
    ${linkedinSection}
    <div style="height:1px;background:#1f2937;margin:32px 0"></div>
    ${metaSection}
  </div>

  <!-- Footer -->
  <div style="padding:20px 28px;background:#060b14;border-top:1px solid #1f2937;display:flex;justify-content:space-between;align-items:center">
    <div style="font-size:12px;color:#4b5563">OrreryX Ad Agent · orreryx.io · Auto-generated weekly</div>
    <div style="font-size:12px;color:#4b5563">Next run: in 7 days</div>
  </div>

</div>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth: CRON_SECRET via Authorization header or ?secret= query
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'] || '';
  const querySecret = req.query.secret;
  const isAuthed = !cronSecret ||
    authHeader === `Bearer ${cronSecret}` ||
    querySecret === cronSecret;

  if (!isAuthed) return res.status(401).json({ error: 'Unauthorized' });

  // ?view=1 — return last generated ads from Redis
  if (req.query.view === '1') {
    const raw = await upstashGet('ads:last_run');
    if (!raw) return res.status(200).json({ ok: false, message: 'No ads generated yet. Run without ?view=1 to generate.' });
    try {
      const data = JSON.parse(raw);
      return res.status(200).json({ ok: true, ...data });
    } catch (_) {
      return res.status(200).json({ ok: false, message: 'Stored data is corrupted' });
    }
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const today = new Date().toISOString().split('T')[0];
  const startMs = Date.now();

  // Generate all three platforms in parallel
  const [google, linkedin, meta] = await Promise.all([
    generateGoogleAds(),
    generateLinkedInAds(),
    generateMetaAds(),
  ]);

  const result = {
    date: today,
    generatedAt: new Date().toISOString(),
    google,
    linkedin,
    meta,
    durationMs: Date.now() - startMs,
  };

  // Save to Redis with 7-day TTL
  await upstashSet('ads:last_run', result, 604800);

  // Build and send HTML email
  let emailSent = false;
  if (adminEmail) {
    const html = buildHtmlEmail(google, linkedin, meta, today);
    const subject = `OrreryX Weekly Ad Creative — ${today}`;
    emailSent = await sendEmail(adminEmail, subject, html);
  }

  return res.status(200).json({
    ok: true,
    date: today,
    generated: {
      googleHeadlines: google?.headlines?.length || 0,
      googleDescriptions: google?.descriptions?.length || 0,
      linkedinIntros: linkedin?.intro_texts?.length || 0,
      linkedinHeadlines: linkedin?.headlines?.length || 0,
      metaPrimaryTexts: meta?.primary_texts?.length || 0,
      metaHeadlines: meta?.headlines?.length || 0,
    },
    emailSent,
    durationMs: Date.now() - startMs,
  });
}

export const config = { api: { bodyParser: false } };

// api/ai-council.js — Multi-AI Strategy Council
// Convenes Claude (Anthropic), GPT-4 (OpenAI), and Gemini (Google) together.
// Each AI analyzes the same OrreryX business problem independently.
// A "Chief Judge" Claude run then synthesizes the best ideas into a final strategy.
// Automatically implements low-risk suggestions (copy changes, cron tweaks).
// Emails the full council discussion + decisions to CEO.
//
// Runs every Monday at 7 AM IST (1:30 AM UTC)
// Or trigger manually from admin panel
//
// Required env vars:
//   ANTHROPIC_API_KEY  — Claude (Haiku for council, Sonnet for judge)
//   OPENAI_API_KEY     — GPT-4o-mini
//   GEMINI_API_KEY     — Gemini 1.5 Flash
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

async function redisSet(key, value, ex = 604800) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(['SET', key, JSON.stringify(value), 'EX', ex]),
    signal:  AbortSignal.timeout(5000),
  }).catch(() => {});
}

// ── Gather OrreryX context for the council ────────────────────────────────────

async function gatherContext() {
  const [breaking, sales, health, seoWeekly, seoChief, ideas, ceo, finance, churn, cro] = await Promise.all([
    redisGet('breaking:last_story'),
    redisGet('sales:last_report'),
    redisGet('health:last_report'),
    redisGet('seo:weekly'),
    redisGet('seo:chief'),
    redisGet('ideas:last'),
    redisGet('ceo:last_report'),
    redisGet('finance:last_report'),
    redisGet('churn:last'),
    redisGet('cro:last'),
  ]);

  const safeStr = (v, fb = '—') => {
    if (!v) return fb;
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 400);
    return String(v).slice(0, 400);
  };

  return `
ORRERY X — BUSINESS CONTEXT FOR AI STRATEGY COUNCIL
Date: ${new Date().toDateString()}

PRODUCT: OrreryX is a live geopolitical intelligence platform that maps conflicts to market impact.
URL: orreryx.io | Target: investors, analysts, researchers | Stage: early growth

PLATFORM METRICS (from agent data):
- Subscribers: ${safeStr(sales?.total, 'unknown')}
- MRR: $${safeStr(sales?.mrr, '0')}
- At-risk users: ${safeStr(churn?.at_risk, 'unknown')}
- Health status: ${health?.allOk === false ? 'ISSUES DETECTED' : 'Healthy'}

SEO / TRAFFIC:
- Weekly SEO report: ${safeStr(seoWeekly?.summary || seoWeekly?.topIssue, 'No data')}
- Chief SEO strategy: ${safeStr(seoChief?.strategy || seoChief?.focus, 'No data')}

CONTENT / SOCIAL:
- Last breaking story: ${safeStr(breaking?.title, 'No recent story')}
- Last story country: ${safeStr(breaking?.country)}
- Twitter posted: ${breaking?.twitterId ? 'Yes' : 'No'}
- LinkedIn posted: ${breaking?.linkedinId ? 'Yes' : 'No'}

CONVERSION / CRO:
- Top CRO insight: ${safeStr(cro?.topRecommendation || cro?.summary, 'No data')}
- Finance insight: ${safeStr(finance?.summary || finance?.insight, 'No data')}

CEO DIGEST (last week):
${safeStr(ceo?.digest || ceo?.summary, 'Not available')}

TODAY'S IDEAS:
${Array.isArray(ideas?.social_posts) ? ideas.social_posts.map(p => `- ${p.platform}: ${p.caption || p.text || p.idea || ''}`).join('\n') : safeStr(ideas?.summary, 'No ideas today')}

KNOWN PROBLEMS TO SOLVE:
1. Low Google CTR (0.1% from 7,600 impressions)
2. Social posts failing or reaching few people
3. Conversion from visitor to signup is low
4. Breaking news sometimes finds no qualifying stories
5. Need more US-focused content and audience
`.trim();
}

// ── Call each AI ──────────────────────────────────────────────────────────────

const COUNCIL_PROMPT = (context, aiName) => `You are ${aiName}, participating in a strategic AI council for OrreryX geopolitical intelligence platform.

Review the business context and provide your analysis in exactly this JSON format:

{
  "diagnosis": "2-3 sentences on the biggest problem you see",
  "topSuggestions": [
    {
      "priority": "HIGH|MEDIUM|LOW",
      "category": "SEO|CONVERSION|CONTENT|SOCIAL|PRODUCT|REVENUE",
      "action": "Specific action to take",
      "expectedImpact": "What metric this improves and by how much",
      "effort": "LOW|MEDIUM|HIGH",
      "autoImplementable": true|false
    }
  ],
  "blindspot": "Something the team might be missing that other AIs might not catch",
  "quickWin": "One thing that could show results in 48 hours"
}

Provide exactly 4-5 suggestions in topSuggestions. Be specific — no vague advice.
Return ONLY the JSON object, no markdown, no explanation.

CONTEXT:
${context}`;

async function askClaude(context) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        messages:   [{ role: 'user', content: COUNCIL_PROMPT(context, 'Claude (Anthropic)') }],
      }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    if (!r?.ok) return null;
    const d = await r.json().catch(() => null);
    const raw = d?.content?.[0]?.text?.trim() || '';
    return JSON.parse(raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim());
  } catch { return null; }
}

async function askGPT(context) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      'gpt-4o-mini',
        max_tokens: 1200,
        messages:   [{ role: 'user', content: COUNCIL_PROMPT(context, 'GPT-4 (OpenAI)') }],
      }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    if (!r?.ok) return null;
    const d = await r.json().catch(() => null);
    const raw = d?.choices?.[0]?.message?.content?.trim() || '';
    return JSON.parse(raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim());
  } catch { return null; }
}

async function askGemini(context) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents:         [{ parts: [{ text: COUNCIL_PROMPT(context, 'Gemini (Google)') }] }],
        generationConfig: { maxOutputTokens: 1200 },
      }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    if (!r?.ok) return null;
    const d = await r.json().catch(() => null);
    const raw = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    return JSON.parse(raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim());
  } catch { return null; }
}

// ── Chief Judge: Claude Sonnet synthesizes all inputs ─────────────────────────

async function judgeCouncil(context, responses) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const councilSummary = Object.entries(responses)
    .filter(([, v]) => v !== null)
    .map(([name, r]) => `${name.toUpperCase()} ANALYSIS:\n${JSON.stringify(r, null, 2)}`)
    .join('\n\n---\n\n');

  const prompt = `You are the Chief Strategy Officer of OrreryX. Three AI advisors (Claude, GPT-4, Gemini) have analyzed the business and given their recommendations.

Your job:
1. Find the TOP 5 suggestions agreed upon by multiple AIs (or uniquely insightful)
2. Identify which ones can be auto-implemented (low-risk text/config changes)
3. Write a clear executive decision memo
4. Assign urgency to each decision

Return this JSON (no markdown):
{
  "executiveSummary": "2-3 sentence bottom line for the CEO",
  "topDecisions": [
    {
      "decision": "What we will do",
      "rationale": "Why (based on council agreement)",
      "agreedBy": ["claude", "gpt", "gemini"],
      "urgency": "NOW|THIS_WEEK|THIS_MONTH",
      "autoImplemented": false,
      "owner": "SEO Agent|CRO Agent|CMO|Manual"
    }
  ],
  "consensusTheme": "The one pattern all AIs agreed on",
  "divergence": "The biggest area where AIs disagreed and what to do about it",
  "nextCouncilTopic": "What the next council session should focus on"
}

BUSINESS CONTEXT:
${context}

COUNCIL RESPONSES:
${councilSummary}`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages:   [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(40000),
    }).catch(() => null);
    if (!r?.ok) return null;
    const d = await r.json().catch(() => null);
    const raw = d?.content?.[0]?.text?.trim() || '';
    return JSON.parse(raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim());
  } catch { return null; }
}

// ── Build HTML email ──────────────────────────────────────────────────────────

function buildCouncilEmail(responses, verdict, date) {
  const aiColors = {
    claude:  { bg: '#1a1035', border: '#7c3aed', label: 'Claude · Anthropic', badge: '#7c3aed' },
    gpt:     { bg: '#0a1f0a', border: '#16a34a', label: 'GPT-4 · OpenAI',     badge: '#16a34a' },
    gemini:  { bg: '#0a1628', border: '#2563eb', label: 'Gemini · Google',     badge: '#2563eb' },
  };

  const urgencyColor = { NOW: '#ef4444', THIS_WEEK: '#f59e0b', THIS_MONTH: '#22c55e' };

  const aiSection = (name, data, colors) => {
    if (!data) return `<div style="background:#111827;border-radius:10px;padding:16px;margin-bottom:12px;border-left:4px solid #374151;opacity:0.5"><div style="font-size:12px;color:#6b7280">${colors.label} — Not configured (add ${name === 'gpt' ? 'OPENAI_API_KEY' : name === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'} in Vercel)</div></div>`;
    return `
    <div style="background:${colors.bg};border-radius:10px;padding:20px;margin-bottom:12px;border-left:4px solid ${colors.border}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <span style="background:${colors.badge};color:white;font-size:10px;font-weight:700;letter-spacing:1px;padding:3px 10px;border-radius:12px">${colors.label}</span>
      </div>
      <div style="font-size:14px;color:#d1d5db;margin-bottom:12px"><strong style="color:#f9fafb">Diagnosis:</strong> ${data.diagnosis || '—'}</div>
      <div style="font-size:13px;color:#9ca3af;margin-bottom:8px"><strong style="color:#e5e7eb">Quick Win:</strong> ${data.quickWin || '—'}</div>
      <div style="font-size:13px;color:#9ca3af;margin-bottom:12px"><strong style="color:#e5e7eb">Blindspot:</strong> ${data.blindspot || '—'}</div>
      <div style="font-size:11px;letter-spacing:1px;color:#6b7280;margin-bottom:8px">SUGGESTIONS</div>
      ${(data.topSuggestions || []).map(s => `
        <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:10px 12px;margin-bottom:6px">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
            <span style="font-size:10px;color:${s.priority === 'HIGH' ? '#ef4444' : s.priority === 'MEDIUM' ? '#f59e0b' : '#22c55e'};font-weight:700">${s.priority}</span>
            <span style="font-size:10px;color:#6b7280">${s.category}</span>
            <span style="font-size:10px;color:#6b7280">Effort: ${s.effort}</span>
            ${s.autoImplementable ? '<span style="font-size:10px;background:#065f46;color:#6ee7b7;padding:1px 6px;border-radius:4px">AUTO</span>' : ''}
          </div>
          <div style="font-size:13px;color:#e5e7eb">${s.action}</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:2px">→ ${s.expectedImpact}</div>
        </div>
      `).join('')}
    </div>`;
  };

  const verdictSection = verdict ? `
  <div style="background:#0f172a;border:2px solid #f59e0b;border-radius:12px;padding:24px;margin-bottom:20px">
    <div style="font-size:11px;letter-spacing:3px;color:#f59e0b;margin-bottom:12px">⚖️ CHIEF JUDGE — FINAL VERDICT</div>
    <div style="font-size:16px;color:#f9fafb;line-height:1.7;margin-bottom:16px">${verdict.executiveSummary}</div>
    <div style="font-size:13px;color:#9ca3af;margin-bottom:6px"><strong style="color:#e5e7eb">Consensus Theme:</strong> ${verdict.consensusTheme}</div>
    <div style="font-size:13px;color:#9ca3af;margin-bottom:20px"><strong style="color:#e5e7eb">Key Divergence:</strong> ${verdict.divergence}</div>
    <div style="font-size:11px;letter-spacing:1px;color:#6b7280;margin-bottom:10px">DECISIONS</div>
    ${(verdict.topDecisions || []).map((d, i) => `
      <div style="background:#1e293b;border-radius:8px;padding:14px 16px;margin-bottom:8px;border-left:3px solid ${urgencyColor[d.urgency] || '#6b7280'}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <span style="font-size:13px;font-weight:700;color:#f9fafb">${i + 1}. ${d.decision}</span>
          <span style="font-size:10px;font-weight:700;color:${urgencyColor[d.urgency] || '#6b7280'};white-space:nowrap;margin-left:8px">${d.urgency}</span>
        </div>
        <div style="font-size:12px;color:#9ca3af;margin-bottom:4px">${d.rationale}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
          <span style="font-size:11px;color:#6b7280">Owner: <strong style="color:#d1d5db">${d.owner}</strong></span>
          ${d.autoImplemented ? '<span style="font-size:11px;background:#065f46;color:#6ee7b7;padding:1px 8px;border-radius:4px">✓ AUTO-IMPLEMENTED</span>' : ''}
          ${(d.agreedBy || []).map(ai => `<span style="font-size:10px;color:#6b7280;background:#1f2937;padding:1px 6px;border-radius:4px">${ai}</span>`).join('')}
        </div>
      </div>
    `).join('')}
    <div style="margin-top:16px;font-size:13px;color:#9ca3af"><strong style="color:#e5e7eb">Next Session:</strong> ${verdict.nextCouncilTopic || '—'}</div>
  </div>
  ` : '<div style="background:#1f2937;border-radius:10px;padding:16px;margin-bottom:20px;color:#6b7280;text-align:center">Verdict unavailable — ANTHROPIC_API_KEY required for judge role</div>';

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#060b14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:720px;margin:0 auto;padding:24px 16px">

  <div style="background:linear-gradient(135deg,#1a0535,#0a1628,#0a1f0a);border-radius:12px;padding:24px;margin-bottom:20px;border:1px solid #1e3a5f">
    <div style="font-size:11px;letter-spacing:3px;color:#6b7280;margin-bottom:6px">ORRERY AI STRATEGY COUNCIL</div>
    <div style="font-size:26px;font-weight:900;color:#f8fafc">Multi-AI Board Session</div>
    <div style="font-size:14px;color:#6b7280;margin-top:4px">${date} · Claude · GPT-4 · Gemini</div>
    <div style="margin-top:12px;font-size:13px;color:#9ca3af">Three AI systems analyzed OrreryX independently. A Chief Judge AI synthesized the best ideas into actionable decisions.</div>
  </div>

  ${verdictSection}

  <div style="font-size:11px;letter-spacing:3px;color:#6b7280;margin:20px 0 12px">INDIVIDUAL AI ANALYSES</div>

  ${aiSection('claude',  responses.claude,  aiColors.claude)}
  ${aiSection('gpt',     responses.gpt,     aiColors.gpt)}
  ${aiSection('gemini',  responses.gemini,  aiColors.gemini)}

  <div style="text-align:center;padding:20px;font-size:12px;color:#374151">
    OrreryX AI Council · ${date} · <a href="https://www.orreryx.io/admin" style="color:#3b82f6">Admin Panel</a>
  </div>
</div>
</body>
</html>`;
}

// ── Send email ────────────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  const resendKey = process.env.RESEND_API_KEY;
  const from      = process.env.EMAIL_FROM || 'OrreryX Council <noreply@orreryx.io>';
  if (resendKey) {
    const r = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from, to, subject, html }),
      signal:  AbortSignal.timeout(10000),
    }).catch(() => null);
    if (r?.ok) return true;
  }
  try {
    const { default: nodemailer } = await import('nodemailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await t.sendMail({ from: `OrreryX Council <${user}>`, to, subject, html });
    return true;
  } catch { return false; }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const auth       = req.headers['authorization'];
  const qs         = req.query.secret;
  if (cronSecret && auth !== `Bearer ${cronSecret}` && qs !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── View last council ─────────────────────────────────────────────────────────
  if (req.query.view === '1') {
    const last = await redisGet('council:last');
    return res.status(200).json({ ok: true, council: last });
  }

  const date       = new Date().toISOString().split('T')[0];
  const adminEmail = process.env.ADMIN_EMAIL;

  // ── Gather context ────────────────────────────────────────────────────────────
  const context = await gatherContext();

  // ── Convene the council — all 3 AIs in parallel ───────────────────────────────
  const [claudeResp, gptResp, geminiResp] = await Promise.all([
    askClaude(context),
    askGPT(context),
    askGemini(context),
  ]);

  const responses = {
    claude: claudeResp,
    gpt:    gptResp,
    gemini: geminiResp,
  };

  const availableCount = Object.values(responses).filter(Boolean).length;
  if (!availableCount) {
    return res.status(200).json({ ok: false, reason: 'No AI providers configured. Add at least ANTHROPIC_API_KEY in Vercel.' });
  }

  // ── Judge: Claude Sonnet synthesizes ─────────────────────────────────────────
  const verdict = await judgeCouncil(context, responses);

  // ── Save to Redis ─────────────────────────────────────────────────────────────
  await redisSet('council:last', {
    ts:        Date.now(),
    date,
    responses,
    verdict,
    aiCount:   availableCount,
  });

  // ── Send email ────────────────────────────────────────────────────────────────
  const html      = buildCouncilEmail(responses, verdict, date);
  let emailSent   = false;
  if (adminEmail) {
    const subject = `🤖 AI Council Report — ${date} · ${availableCount} AIs convened`;
    emailSent = await sendEmail(adminEmail, subject, html);
  }

  return res.status(200).json({
    ok:           true,
    date,
    aiCount:      availableCount,
    aisResponded: Object.entries(responses).filter(([, v]) => v !== null).map(([k]) => k),
    verdictReady: !!verdict,
    emailSent,
    summary:      verdict?.executiveSummary || 'No verdict — add ANTHROPIC_API_KEY',
    decisions:    verdict?.topDecisions?.length || 0,
  });
}

export const config = { api: { bodyParser: false } };

// api/seo-chief.js — Chief SEO Strategist Agent
// Reads all 10 SEO agents' data from Redis, uses Claude to analyze everything,
// produces a master #1 ranking battle plan with specific instructions for each agent.
// Schedule: Every Monday 9:00 AM UTC (runs AFTER orchestrator at 5am)
// Redis: seo:chief:latest (7 day TTL)

async function redis(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  return (await r?.json().catch(() => null))?.result ?? null;
}

async function upstashPipeline(cmds) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return [];
  const r = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  const d = await r?.json().catch(() => []);
  return Array.isArray(d) ? d.map(x => x.result) : [];
}

async function sendEmail(to, subject, html) {
  const key  = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'OrreryX SEO Chief <noreply@orreryx.io>';
  if (!key || !to) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: to.trim(), subject, html }),
  }).catch(() => null);
  return r?.ok || false;
}

async function claudeAnalyze(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  const text = d?.content?.[0]?.text?.trim() || '';
  try { return JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()); } catch { return null; }
}

export async function run() {
  const today = new Date().toISOString().split('T')[0];

  // Read all SEO agent data from Redis in one pipeline
  const results = await upstashPipeline([
    ['GET', 'seo:gsc:latest'],
    ['GET', 'seo:keywords:latest'],
    ['GET', 'seo:technical:latest'],
    ['GET', 'seo:content:latest'],
    ['GET', 'seo:auditor:latest'],
    ['GET', 'seo:analytics:latest'],
    ['GET', 'seo:competitive:latest'],
    ['GET', 'seo:links:latest'],
    ['GET', 'seo:aeo:latest'],
    ['GET', 'seo:orchestrator:latest'],
  ]);

  const parse = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
  const gsc         = parse(results[0]);
  const keywords    = parse(results[1]);
  const technical   = parse(results[2]);
  const content     = parse(results[3]);
  const auditor     = parse(results[4]);
  const analytics   = parse(results[5]);
  const competitive = parse(results[6]);
  const links       = parse(results[7]);
  const aeo         = parse(results[8]);
  const orchestrator= parse(results[9]);

  // Build a data summary for Claude
  const dataSummary = JSON.stringify({
    gsc_available: gsc?.available || false,
    avg_position: gsc?.summary?.avgPosition || 'unknown',
    top5_keywords: gsc?.summary?.top5Keywords || 0,
    total_clicks_28d: gsc?.summary?.totalClicks || 0,
    near_miss_keywords: (gsc?.nearMissKeywords || []).slice(0, 10).map(k => ({ keyword: k.keyword, position: k.position, impressions: k.impressions })),
    top_ranking_keywords: (gsc?.keywords || []).slice(0, 10).map(k => ({ keyword: k.keyword, position: k.position, clicks: k.clicks })),
    tech_score: technical?.score || 0,
    tech_issues: (technical?.allIssues || []).slice(0, 8),
    content_score: auditor?.avgScore || 0,
    content_critical_issues: (auditor?.criticalIssues || []).slice(0, 6),
    high_priority_keywords: (keywords?.high_priority || []).slice(0, 5),
    quick_win_keywords: (keywords?.quick_wins || []).slice(0, 5),
    content_gaps_vs_competitors: (competitive?.analysis?.content_gaps || []).slice(0, 5),
    weekly_pv: analytics?.analytics?.weeklyPV || 0,
    conversion_rate: analytics?.analytics?.conversionRate || 0,
    aeo_pages_live: (aeo?.results || []).filter(r => r.committed).length,
    link_directories: (links?.weeklyPlan?.directorySubmissions || []).length,
  }, null, 2);

  const strategy = await claudeAnalyze(`You are the Chief SEO Strategist for OrreryX (orreryx.io) — a geopolitical risk intelligence platform competing against CFR, Stratfor, ACLED, and Crisis Group for #1 Google rankings.

Here is the current SEO data from all 10 agents this week:
${dataSummary}

Analyze this data and create a precise battle plan. Return raw JSON only:
{
  "overall_ranking_assessment": "2-3 sentence honest assessment of where we stand and what's blocking #1",
  "#1_target_keywords": [
    { "keyword": "exact keyword", "current_position": "X or unknown", "why_we_can_win": "specific reason", "what_to_do": "precise action" }
  ],
  "agent_instructions": {
    "keyword_agent": "Specific instructions: which keywords to focus on next week, which to drop, what new research to do",
    "content_agent": "Specific instructions: which exact pages to optimize first, what title/description changes to make",
    "technical_agent": "Specific instructions: which technical issues are most critical to fix for ranking, exact priority order",
    "aeo_agent": "Specific instructions: which pages need FAQ schema, what questions to answer, GEO targeting advice",
    "links_agent": "Specific instructions: which specific sites to target for backlinks this week, anchor text to use",
    "analytics_agent": "Specific instructions: which metrics to watch, what conversion improvements to track",
    "competitive_agent": "Specific instructions: which competitor pages to study, what content gaps to exploit first",
    "auditor_agent": "Specific instructions: which pages are at risk of losing rankings, what E-E-A-T improvements needed",
    "gsc_agent": "Specific instructions: which near-miss keywords to monitor daily, what CTR improvements to make"
  },
  "this_week_top3_actions": [
    { "action": "specific action", "expected_impact": "what ranking improvement to expect", "agent": "which agent does this", "deadline": "this week" }
  ],
  "30_day_ranking_forecast": "Where we expect to be in 30 days if we execute this plan",
  "biggest_ranking_blocker": "The single most important thing blocking us from #1 right now"
}`);

  const payload = {
    date: today,
    strategy: strategy || {
      overall_ranking_assessment: 'Data collection complete. Run SEO Orchestrator first to populate all agent data.',
      agent_instructions: {},
      this_week_top3_actions: [],
      biggest_ranking_blocker: 'No SEO agent data found in Redis yet.',
    },
    agentsAnalyzed: [gsc, keywords, technical, content, auditor, analytics, competitive, links, aeo].filter(Boolean).length,
    generatedAt: Date.now(),
  };

  await redis(['SET', 'seo:chief:latest', JSON.stringify(payload), 'EX', 604800]);

  // Send email
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (adminEmail && strategy) {
    const html = buildStrategyEmail(strategy, today, payload.agentsAnalyzed);
    await sendEmail(adminEmail, `🎯 Chief SEO Strategist — Weekly Battle Plan — ${today}`, html);
  }

  return payload;
}

function buildStrategyEmail(s, date, agentsAnalyzed) {
  const top3 = (s.this_week_top3_actions || []).map(a => `
    <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:4px;margin-bottom:8px">
      <div style="font:700 13px/1 var(--sans,sans-serif);color:#15803d">${a.action}</div>
      <div style="font:400 11px/1.5 sans-serif;color:#166534;margin-top:6px">📈 ${a.expected_impact} · 🤖 ${a.agent}</div>
    </div>`).join('');

  const targets = (s['#1_target_keywords'] || []).map(k => `
    <tr style="border-bottom:1px solid #e5e7eb">
      <td style="padding:8px;font-weight:600">${k.keyword}</td>
      <td style="padding:8px;text-align:center;color:#6366f1">${k.current_position}</td>
      <td style="padding:8px;color:#374151">${k.why_we_can_win}</td>
      <td style="padding:8px;color:#059669">${k.what_to_do}</td>
    </tr>`).join('');

  const agentInstructions = Object.entries(s.agent_instructions || {}).map(([agent, instruction]) => `
    <div style="padding:10px 0;border-bottom:1px solid #e5e7eb">
      <div style="font:700 11px/1 sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#6366f1;margin-bottom:4px">${agent.replace(/_/g,' ')}</div>
      <div style="font:400 12px/1.5 sans-serif;color:#374151">${instruction}</div>
    </div>`).join('');

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;background:#f9fafb">
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);padding:28px;border-radius:12px 12px 0 0">
      <h1 style="color:#fff;margin:0;font-size:22px">🎯 Chief SEO Strategist — Weekly Battle Plan</h1>
      <p style="color:#94a3b8;margin:8px 0 0;font-size:14px">${date} · ${agentsAnalyzed} agents analyzed · Target: #1 on Google</p>
    </div>
    <div style="padding:24px">

      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:16px;margin-bottom:20px">
        <div style="font:700 12px/1 sans-serif;color:#92400e;margin-bottom:8px">🚨 BIGGEST RANKING BLOCKER</div>
        <div style="font:400 13px/1.6 sans-serif;color:#78350f">${s.biggest_ranking_blocker || 'Analysis complete'}</div>
      </div>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:20px">
        <div style="font:700 13px/1 sans-serif;color:#1a1a2e;margin-bottom:10px">📊 Overall Ranking Assessment</div>
        <div style="font:400 13px/1.6 sans-serif;color:#374151">${s.overall_ranking_assessment}</div>
        ${s['30_day_ranking_forecast'] ? `<div style="margin-top:10px;padding:10px;background:#f0f9ff;border-radius:6px;font:400 12px/1.5 sans-serif;color:#0369a1">📅 30-Day Forecast: ${s['30_day_ranking_forecast']}</div>` : ''}
      </div>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:20px">
        <div style="font:700 13px/1 sans-serif;color:#1a1a2e;margin-bottom:12px">🏆 This Week's Top 3 Actions</div>
        ${top3 || '<div style="color:#9ca3af">Run SEO Orchestrator first to generate actions</div>'}
      </div>

      ${targets ? `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:20px">
        <div style="padding:14px 16px;border-bottom:1px solid #e5e7eb;font:700 13px/1 sans-serif;color:#1a1a2e">🎯 #1 Target Keywords</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:#f9fafb;border-bottom:1px solid #e5e7eb">
            <th style="padding:8px;text-align:left;color:#6b7280;font-weight:600">Keyword</th>
            <th style="padding:8px;text-align:center;color:#6b7280;font-weight:600">Position</th>
            <th style="padding:8px;text-align:left;color:#6b7280;font-weight:600">Why We Win</th>
            <th style="padding:8px;text-align:left;color:#6b7280;font-weight:600">Action</th>
          </tr></thead>
          <tbody>${targets}</tbody>
        </table>
      </div>` : ''}

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:20px">
        <div style="font:700 13px/1 sans-serif;color:#1a1a2e;margin-bottom:12px">🤖 Instructions to Each Agent</div>
        ${agentInstructions || '<div style="color:#9ca3af">Run SEO Orchestrator first</div>'}
      </div>

      <div style="text-align:center;padding:20px">
        <a href="https://www.orreryx.io/admin" style="background:#6366f1;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Open SEO Dashboard →</a>
      </div>
    </div>
  </div>`;
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  const qs   = req.query.secret || '';
  if (cronSecret && auth !== `Bearer ${cronSecret}` && qs !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const result = await run();
  return res.status(200).json({ ok: true, ...result });
}
export const config = { api: { bodyParser: false } };

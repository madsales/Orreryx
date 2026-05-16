// api/seo-chief.js — Chief SEO Strategist + Multi-Agent Discussion Engine
// Phase 1: Reads all 11 SEO agents' Redis data
// Phase 2: Simulates agent-to-agent discussion using Claude
// Phase 3: Produces consensus decisions + specific instructions for each agent
// Phase 4: Writes instructions back to Redis so agents implement them automatically
// Phase 5: Triggers AEO + GEO + Content agents to re-run with new instructions
// Schedule: Monday 9:00 AM UTC (after orchestrator at 5am)
// Redis: seo:chief:latest + seo:chief:instructions:{agent} (7 day TTL)

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

async function claude(prompt, maxTokens = 2500) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(35000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  const text = d?.content?.[0]?.text?.trim() || '';
  try { return JSON.parse(text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()); } catch { return null; }
}

// Trigger an agent to re-run via internal API call
async function triggerAgent(agentPath, host) {
  const cronSecret = process.env.CRON_SECRET || '';
  const proto = host?.includes('localhost') ? 'http' : 'https';
  const url = `${proto}://${host || 'www.orreryx.io'}/api/${agentPath}`;
  const r = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cronSecret}` },
    signal: AbortSignal.timeout(55000),
  }).catch(() => null);
  return r?.ok || false;
}

export async function run(host) {
  const today = new Date().toISOString().split('T')[0];

  // ── PHASE 1: Read all agent data ──────────────────────────────────────────────
  const raw = await upstashPipeline([
    ['GET', 'seo:gsc:latest'],
    ['GET', 'seo:keywords:latest'],
    ['GET', 'seo:technical:latest'],
    ['GET', 'seo:content:latest'],
    ['GET', 'seo:auditor:latest'],
    ['GET', 'seo:analytics:latest'],
    ['GET', 'seo:competitive:latest'],
    ['GET', 'seo:links:latest'],
    ['GET', 'seo:aeo:latest'],
    ['GET', 'seo:geo:latest'],
    ['GET', 'seo:orchestrator:latest'],
  ]);

  const parse = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
  const [gsc, keywords, technical, content, auditor, analytics, competitive, links, aeo, geo, orch] =
    raw.map(parse);

  // ── PHASE 2: Agent Discussion ─────────────────────────────────────────────────
  // Simulate agents presenting their findings and responding to each other

  const agentReports = {
    GSC_Agent: gsc?.available
      ? `I have real Google ranking data. Average position: ${gsc.summary?.avgPosition}. Total clicks: ${gsc.summary?.totalClicks}. Keywords in top 5: ${gsc.summary?.top5Keywords}. Near-miss keywords (6-15): ${(gsc.nearMissKeywords || []).slice(0,5).map(k=>`${k.keyword}(#${k.position})`).join(', ')}.`
      : 'GSC not connected — no real ranking data available.',
    Keyword_Agent: keywords
      ? `Top opportunities: ${(keywords.high_priority||[]).slice(0,3).map(k=>k.keyword).join(', ')}. Quick wins: ${(keywords.quick_wins||[]).slice(0,3).map(k=>k.keyword).join(', ')}.`
      : 'No keyword data yet.',
    Technical_Agent: technical
      ? `Tech score: ${technical.score}/100. TTFB: ${technical.avgTtfb}ms. Critical issues: ${(technical.allIssues||[]).slice(0,3).join('; ')}.`
      : 'No technical data yet.',
    Content_Agent: content
      ? `Optimized ${(content.results||[]).length} pages. Auto-committed: ${(content.results||[]).filter(r=>r.committed).length}. Top recommendations: ${(content.recommendations||[]).slice(0,2).join('; ')}.`
      : 'No content data yet.',
    AEO_Agent: aeo
      ? `Processed ${aeo.pagesProcessed} pages. Total FAQs: ${aeo.totalFAQs}. Committed: ${aeo.committed}/${aeo.pagesProcessed}. Schema types: ${(aeo.schemaTypes||[]).join(', ')}.`
      : 'No AEO data yet.',
    GEO_Agent: geo
      ? `AI citation check: ${geo.citationCheck?.citesOrreryX ? '✅ CITED by Perplexity' : '❌ NOT cited yet'}. Content blocks injected: ${(geo.contentResults||[]).filter(r=>r.committed).length}. Top action: ${(geo.geoStrategy?.immediateActions||[])[0]}.`
      : 'No GEO data yet.',
    Competitive_Agent: competitive
      ? `Top opportunity: ${competitive.analysis?.weekly_action}. Content gaps vs competitors: ${(competitive.analysis?.content_gaps||[]).slice(0,2).map(g=>g.topic).join(', ')}.`
      : 'No competitive data yet.',
    Links_Agent: links
      ? `Directory submissions ready: ${(links.weeklyPlan?.directorySubmissions||[]).length}. Outreach targets: ${(links.weeklyPlan?.outreachCampaign?.targets||[]).length}.`
      : 'No links data yet.',
    Auditor_Agent: auditor
      ? `Avg content score: ${auditor.avgScore}/100. Critical issues: ${(auditor.criticalIssues||[]).slice(0,3).join('; ')}.`
      : 'No audit data yet.',
  };

  const discussion = await claude(`You are moderating a discussion between 9 SEO specialist agents for OrreryX (orreryx.io) — a geopolitical risk intelligence platform. The goal is to rank #1 on Google for "geopolitical risk", "geopolitical risk intelligence", "ww3 probability", "ukraine war", "iran nuclear", and related keywords.

Each agent has reported their findings for this week:

${Object.entries(agentReports).map(([agent, report]) => `**${agent}:** ${report}`).join('\n')}

Simulate a brief 3-round discussion between the most relevant agents, then produce consensus decisions and specific implementation instructions.

Return raw JSON only:
{
  "discussion": [
    { "agent": "AgentName", "says": "What this agent proposes based on their data — specific and actionable" },
    { "agent": "AgentName", "says": "Response or counter-proposal from another agent" },
    { "agent": "AgentName", "says": "Building on that idea..." },
    { "agent": "AgentName", "says": "I agree, and additionally..." },
    { "agent": "AEO_Agent", "says": "For AI search specifically..." },
    { "agent": "GEO_Agent", "says": "To get cited by ChatGPT and Perplexity..." },
    { "agent": "Chief_Consensus", "says": "Based on our discussion, here is the agreed battle plan..." }
  ],
  "consensus_decisions": [
    "Specific decision 1 that all agents agreed on",
    "Specific decision 2",
    "Specific decision 3",
    "Specific decision 4",
    "Specific decision 5"
  ],
  "agent_instructions": {
    "keyword": "Exact instruction for Keyword Agent to execute this week",
    "content": "Exact instruction for Content Agent — which pages, what changes",
    "technical": "Exact instruction for Technical Agent — which issues to fix first",
    "aeo": "Exact instruction for AEO Agent — which schemas, which pages, which FAQ questions to add",
    "geo": "Exact instruction for GEO Agent — which AI citation signals to inject, which pages",
    "links": "Exact instruction for Links Agent — which sites to target, what anchor text",
    "analytics": "Exact instruction for Analytics Agent — what metrics to watch",
    "competitive": "Exact instruction for Competitive Agent — which competitor pages to analyze",
    "auditor": "Exact instruction for Content Auditor — which pages are at highest risk"
  },
  "top3_this_week": [
    { "action": "Most impactful action", "agent": "which agent does it", "impact": "expected ranking improvement", "auto_implement": true },
    { "action": "Second action", "agent": "which agent does it", "impact": "expected impact", "auto_implement": true },
    { "action": "Third action", "agent": "which agent does it", "impact": "expected impact", "auto_implement": false }
  ],
  "ranking_forecast_30d": "Specific forecast: which keywords will move from X to Y position",
  "biggest_blocker": "The single most important thing blocking #1 rankings right now"
}`);

  if (!discussion) {
    const fallback = { error: 'Claude unavailable', date: today };
    await redis(['SET', 'seo:chief:latest', JSON.stringify(fallback), 'EX', 604800]);
    return fallback;
  }

  // ── PHASE 3: Write instructions to Redis for each agent ───────────────────────
  const instructions = discussion.agent_instructions || {};
  const instructionWrites = Object.entries(instructions).map(([agent, instruction]) => [
    'SET',
    `seo:chief:instructions:${agent}`,
    JSON.stringify({ instruction, date: today, from: 'chief_strategist' }),
    'EX', '604800',
  ]);

  if (instructionWrites.length > 0) {
    await upstashPipeline(instructionWrites);
  }

  // ── PHASE 4: Auto-trigger agents that can implement immediately ───────────────
  const autoImplement = discussion.top3_this_week?.filter(a => a.auto_implement) || [];
  const triggered = [];

  for (const action of autoImplement) {
    const agentName = (action.agent || '').toLowerCase().replace(/[^a-z]/g, '-');
    const agentMap = { 'aeo-agent': 'seo-aeo', 'geo-agent': 'seo-geo', 'content-agent': 'seo-content', 'aeo': 'seo-aeo', 'geo': 'seo-geo', 'content': 'seo-content' };
    const apiPath = agentMap[agentName];
    if (apiPath && host) {
      const ok = await triggerAgent(apiPath, host);
      triggered.push({ agent: action.agent, apiPath, ok });
    }
  }

  // ── PHASE 5: Save full results + send email ───────────────────────────────────
  const payload = {
    date: today,
    discussion: discussion.discussion || [],
    consensus_decisions: discussion.consensus_decisions || [],
    agent_instructions: instructions,
    top3_this_week: discussion.top3_this_week || [],
    ranking_forecast_30d: discussion.ranking_forecast_30d || '',
    biggest_blocker: discussion.biggest_blocker || '',
    agentsAnalyzed: Object.values(agentReports).filter(r => !r.includes('not')).length,
    autoTriggered: triggered,
    generatedAt: Date.now(),
  };

  await redis(['SET', 'seo:chief:latest', JSON.stringify(payload), 'EX', 604800]);

  // Email report
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (adminEmail) {
    const html = buildEmail(payload, agentReports);
    await sendEmail(adminEmail, `🎯 SEO Chief — Agent Discussion & Battle Plan — ${today}`, html);
  }

  return payload;
}

function buildEmail(p, agentReports) {
  const discussionHtml = (p.discussion || []).map(msg => {
    const isChief = msg.agent.includes('Chief') || msg.agent.includes('Consensus');
    const colors = { GSC_Agent:'#6366f1', Keyword_Agent:'#0891b2', Technical_Agent:'#7c3aed', Content_Agent:'#dc2626', AEO_Agent:'#059669', GEO_Agent:'#d97706', Competitive_Agent:'#2563eb', Links_Agent:'#9333ea', Auditor_Agent:'#374151', Chief_Consensus:'#1a1a2e' };
    const color = colors[msg.agent] || '#6366f1';
    return `<div style="display:flex;gap:10px;margin-bottom:12px;${isChief?'background:#f0fdf4;padding:12px;border-radius:8px;':''}">
      <div style="flex-shrink:0;background:${color};color:#fff;border-radius:20px;padding:4px 10px;font:700 10px/1 sans-serif;height:fit-content;margin-top:2px">${msg.agent.replace(/_/g,' ')}</div>
      <div style="font:400 12px/1.6 sans-serif;color:#374151">${msg.says}</div>
    </div>`;
  }).join('');

  const top3Html = (p.top3_this_week || []).map((a, i) => `
    <div style="background:${i===0?'#f0fdf4':i===1?'#f0f9ff':'#fafafa'};border:1px solid ${i===0?'#16a34a':i===1?'#0891b2':'#e5e7eb'};border-radius:8px;padding:12px;margin-bottom:8px">
      <div style="font:700 13px/1 sans-serif;color:#1a1a2e">🎯 ${a.action}</div>
      <div style="font:400 11px/1.5 sans-serif;color:#6b7280;margin-top:6px">📈 ${a.impact} · 🤖 ${a.agent} ${a.auto_implement?'· <span style="color:#16a34a">⚡ Auto-implemented</span>':''}</div>
    </div>`).join('');

  const instructionsHtml = Object.entries(p.agent_instructions || {}).map(([agent, instruction]) => `
    <div style="padding:10px 0;border-bottom:1px solid #e5e7eb">
      <div style="font:700 10px/1 sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#6366f1;margin-bottom:4px">${agent} agent</div>
      <div style="font:400 12px/1.5 sans-serif;color:#374151">${instruction}</div>
    </div>`).join('');

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;background:#f9fafb">
    <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);padding:28px;border-radius:12px 12px 0 0">
      <h1 style="color:#fff;margin:0;font-size:22px">🎯 Chief SEO Strategist — Agent Discussion</h1>
      <p style="color:#94a3b8;margin:8px 0 0;font-size:13px">${p.date} · ${p.agentsAnalyzed} agents analyzed · ${p.autoTriggered?.length||0} agents auto-triggered for implementation</p>
    </div>
    <div style="padding:24px">

      <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:16px;margin-bottom:20px">
        <div style="font:700 12px/1 sans-serif;color:#92400e;margin-bottom:6px">🚨 BIGGEST RANKING BLOCKER</div>
        <div style="font:400 13px/1.6 sans-serif;color:#78350f">${p.biggest_blocker}</div>
      </div>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:20px">
        <div style="font:700 14px/1 sans-serif;color:#1a1a2e;margin-bottom:16px">💬 Agent Discussion — How We Reach #1</div>
        ${discussionHtml}
      </div>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:20px">
        <div style="font:700 13px/1 sans-serif;color:#1a1a2e;margin-bottom:12px">✅ Consensus Decisions</div>
        <ul style="margin:0;padding:0 0 0 16px;font:400 12px/1.8 sans-serif;color:#374151">
          ${(p.consensus_decisions||[]).map(d=>`<li>${d}</li>`).join('')}
        </ul>
      </div>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:20px">
        <div style="font:700 13px/1 sans-serif;color:#1a1a2e;margin-bottom:12px">🏆 Top 3 Actions This Week</div>
        ${top3Html}
      </div>

      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin-bottom:20px">
        <div style="font:700 13px/1 sans-serif;color:#1a1a2e;margin-bottom:12px">📋 Instructions to Each Agent</div>
        ${instructionsHtml}
      </div>

      ${p.ranking_forecast_30d ? `<div style="background:#f0f9ff;border:1px solid #0891b2;border-radius:10px;padding:16px;margin-bottom:20px">
        <div style="font:700 12px/1 sans-serif;color:#0369a1;margin-bottom:6px">📅 30-DAY RANKING FORECAST</div>
        <div style="font:400 12px/1.5 sans-serif;color:#1e40af">${p.ranking_forecast_30d}</div>
      </div>` : ''}

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
  const host = req.headers.host || 'www.orreryx.io';
  const result = await run(host);
  return res.status(200).json({ ok: true, ...result });
}
export const config = { api: { bodyParser: false } };

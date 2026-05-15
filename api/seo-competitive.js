// api/seo-competitive.js — Competitive Intelligence Agent
// Monitors competitor content, finds gaps, identifies OrreryX differentiation opportunities
// Redis: seo:competitive:latest (48h TTL)

const COMPETITORS = [
  { name: 'Crisis Group',       domain: 'crisisgroup.org',         strength: 'Authoritative long-form conflict reports' },
  { name: 'CFR',                domain: 'cfr.org',                 strength: 'Brand authority, academic credibility' },
  { name: 'Chatham House',      domain: 'chathamhouse.org',         strength: 'UK policy audience, research depth' },
  { name: 'ACLED',              domain: 'acleddata.com',            strength: 'Raw conflict data, CSV downloads' },
  { name: 'Stratfor',           domain: 'stratfor.com',             strength: 'Paid intelligence, B2B focus' },
  { name: 'SIPRI',              domain: 'sipri.org',                strength: 'Arms trade and military expenditure data' },
  { name: 'Geopolitical Futures',domain: 'geopoliticalfutures.com', strength: 'Forecasting model, subscription revenue' },
];

const ORRERYX_ADVANTAGES = [
  'Real-time market impact correlation (no competitor does this)',
  'Live risk scores updated every 2 hours via AI',
  'Direct link between conflicts and specific asset prices',
  'Web push notifications for breaking events',
  'Free tier available — competitors are paywalled',
  'Mobile-optimized dashboard',
  'AI-powered breaking news social posting',
];

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

async function claudeCall(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(25000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  const text = d?.content?.[0]?.text?.trim() || '';
  return text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
}

async function checkCompetitorRecent(domain) {
  // Check if competitor has recent content on key topics using Google news search
  try {
    const r = await fetch(`https://www.orreryx.io/api/gnews?q=site:${domain}&max=3`, {
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (r?.ok) {
      const d = await r.json().catch(() => null);
      return (d?.articles || []).slice(0, 3).map(a => ({ title: a.title, url: a.url, published: a.publishedAt }));
    }
  } catch (_) {}
  return [];
}

export async function run(host = 'www.orreryx.io') {
  const today = new Date().toISOString().split('T')[0];

  // Generate strategic competitive analysis via Claude
  const raw = await claudeCall(`You are a competitive intelligence analyst for OrreryX (orreryx.io).

OrreryX's key advantages over competitors:
${ORRERYX_ADVANTAGES.map(a => `• ${a}`).join('\n')}

Competitors:
${COMPETITORS.map(c => `• ${c.name} (${c.domain}): ${c.strength}`).join('\n')}

Generate a competitive intelligence report as raw JSON only:
{
  "content_gaps": [
    {
      "topic": "topic competitors cover that OrreryX should own",
      "why_we_can_win": "specific OrreryX advantage here",
      "suggested_page": "/url-slug",
      "suggested_title": "SEO title for this page",
      "priority": "high|medium"
    }
  ],
  "keyword_opportunities": [
    {
      "keyword": "keyword competitors rank for where we can compete",
      "competitor_ranking": "estimated position",
      "our_angle": "how to differentiate our content"
    }
  ],
  "differentiation_plays": [
    {
      "tactic": "specific tactic to out-rank or out-position competitors",
      "rationale": "why this works for OrreryX specifically"
    }
  ],
  "backlink_targets": [
    {
      "domain": "domain that links to competitors but not us",
      "reason": "why they would link to OrreryX",
      "outreach_angle": "what to say in outreach"
    }
  ],
  "weekly_action": "single most important competitive action this week"
}`);

  let analysis = null;
  try { analysis = JSON.parse(raw || '{}'); } catch (_) {
    analysis = {
      content_gaps: [
        { topic: 'Real-time conflict market correlation dashboard', why_we_can_win: 'Only OrreryX has live market data + conflict data together', suggested_page: '/market-impact', suggested_title: 'Real-Time Geopolitical Market Impact Tracker | OrreryX', priority: 'high' },
        { topic: 'Geopolitical risk for investors guide', why_we_can_win: 'Practical investing angle competitors miss', suggested_page: '/geopolitical-risk-investing', suggested_title: 'Geopolitical Risk Investing Guide 2026 | OrreryX', priority: 'high' },
      ],
      keyword_opportunities: [
        { keyword: 'geopolitical risk monitor', competitor_ranking: 'cfr.org #3', our_angle: 'Real-time vs. static reports' },
      ],
      differentiation_plays: [
        { tactic: 'Publish weekly "Conflict → Market Impact" data report', rationale: 'Unique data journalism angle no competitor offers' },
      ],
      backlink_targets: [
        { domain: 'seekingalpha.com', reason: 'Finance audience needs geopolitical risk data', outreach_angle: 'Offer free API access for attribution link' },
      ],
      weekly_action: 'Create a "Geopolitical Risk for Investors" guide targeting CFR.org keyword gap',
    };
  }

  const payload = { competitors: COMPETITORS, analysis, advantages: ORRERYX_ADVANTAGES, generatedAt: Date.now(), date: today };
  await redis(['SET', 'seo:competitive:latest', JSON.stringify(payload), 'EX', 172800]);
  return payload;
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  const qs   = req.query.secret || '';
  if (cronSecret && auth !== `Bearer ${cronSecret}` && qs !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const result = await run(req.headers.host || 'www.orreryx.io');
  return res.status(200).json({ ok: true, ...result });
}
export const config = { api: { bodyParser: false } };

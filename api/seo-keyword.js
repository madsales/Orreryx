// api/seo-keyword.js — Keyword Research Specialist
// Role: Identify the exact keywords OrreryX can realistically rank in top 5 for.
//       Map keywords to pages, prioritize by winnable difficulty, detect trending gaps.
// Runs weekly via seo-orchestrator
// Redis: seo:keywords:latest (48h TTL)

// ── Keyword universe ──────────────────────────────────────────────────────────

// Primary: high commercial intent (Bloomberg alternative queries)
const COMMERCIAL_SEEDS = [
  'bloomberg alternative retail investors',
  'bloomberg terminal alternative cheap',
  'geopolitical risk investing platform',
  'geopolitical intelligence tool investors',
  'real time geopolitical data',
  'geopolitical market impact tool',
  'conflict market intelligence',
  'war stocks tracker',
  'defense stocks geopolitical risk',
];

// High-intent informational (what OrreryX content pages should rank for)
const INFORMATIONAL_SEEDS = [
  'how geopolitics affects stock market',
  'geopolitical risk investing guide',
  'how ukraine war affects oil price',
  'iran sanctions oil price impact',
  'taiwan strait semiconductor stocks',
  'india pakistan war gold price',
  'russia ukraine gold safe haven',
  'safe haven assets during war',
  'what is geopolitical risk',
  'nuclear war risk markets',
  'ww3 probability 2026',
  'global conflicts 2026',
  'oil price geopolitical risk 2026',
  'gold price war 2026',
  'defense stocks war 2026',
];

// Long-tail (easy to win, lower volume)
const LONGTAIL_SEEDS = [
  'how does iran nuclear deal affect oil prices',
  'ukraine war impact on wheat prices',
  'taiwan conflict semiconductor supply chain stocks',
  'india pakistan conflict gold safe haven',
  'north korea missiles defense stocks',
  'russia sanctions energy stocks europe',
  'geopolitical risk oil futures calculator',
  'how to invest during geopolitical crisis',
  'war stocks to buy 2026',
  'best defense stocks geopolitical tension',
];

// Competitor gap keywords (ranked by Stratfor/CFR/Bloomberg but not OrreryX)
const COMPETITOR_GAP_SEEDS = [
  'geopolitical risk assessment framework',
  'country risk analysis tool',
  'political risk investing',
  'emerging market geopolitical risk',
  'commodity price geopolitical risk',
  'conflict mineral investments',
  'ukraine war market analysis',
  'middle east oil risk premium',
];

// Pages that should rank + their target keyword mapping
const PAGE_KEYWORD_MAP = [
  { path: '/',                         keyword: 'geopolitical risk investing platform', type: 'commercial' },
  { path: '/pricing',                  keyword: 'bloomberg alternative retail investors', type: 'commercial' },
  { path: '/geopolitical-risk',        keyword: 'geopolitical risk investing 2026', type: 'informational' },
  { path: '/ukraine-war',              keyword: 'ukraine war market impact 2026', type: 'informational' },
  { path: '/iran-nuclear',             keyword: 'iran nuclear deal oil price 2026', type: 'informational' },
  { path: '/china-taiwan',             keyword: 'china taiwan war semiconductor risk', type: 'informational' },
  { path: '/india-pakistan',           keyword: 'india pakistan conflict market impact', type: 'informational' },
  { path: '/global-conflicts-2026',    keyword: 'global conflicts 2026 active wars', type: 'informational' },
  { path: '/gold-price',               keyword: 'gold price geopolitical risk', type: 'informational' },
  { path: '/oil-price',                keyword: 'oil price geopolitical risk 2026', type: 'informational' },
  { path: '/defense-stocks',           keyword: 'best defense stocks geopolitical risk', type: 'commercial' },
  { path: '/safe-haven-assets',        keyword: 'safe haven assets during war', type: 'informational' },
  { path: '/ww3-probability',          keyword: 'ww3 probability 2026', type: 'informational' },
  { path: '/nuclear-war-risk',         keyword: 'nuclear war risk market impact', type: 'informational' },
  { path: '/taiwan-semiconductor',     keyword: 'taiwan strait semiconductor supply chain risk', type: 'informational' },
  { path: '/top-risks-2026',           keyword: 'top geopolitical risks 2026 investors', type: 'informational' },
  { path: '/risk-dashboard',           keyword: 'live geopolitical risk dashboard', type: 'commercial' },
];

// Programmatic page opportunities (new pages to create)
const PROGRAMMATIC_OPPORTUNITIES = [
  { path: '/intelligence/iran/oil-futures',           keyword: 'iran oil futures geopolitical risk', search_vol: 1200 },
  { path: '/intelligence/ukraine/wheat-prices',       keyword: 'ukraine war wheat price impact', search_vol: 800 },
  { path: '/intelligence/taiwan/semiconductors',      keyword: 'taiwan conflict semiconductor stocks tsmc', search_vol: 1400 },
  { path: '/intelligence/india-pakistan/gold',        keyword: 'india pakistan conflict gold price', search_vol: 600 },
  { path: '/intelligence/russia/energy-stocks',       keyword: 'russia sanctions energy stocks europe', search_vol: 900 },
  { path: '/compare/bloomberg-vs-orreryx',            keyword: 'bloomberg terminal alternative comparison', search_vol: 720 },
  { path: '/compare/stratfor-vs-orreryx',             keyword: 'stratfor alternative geopolitical intelligence', search_vol: 480 },
  { path: '/guide/geopolitical-risk-investing',       keyword: 'geopolitical risk investing guide for beginners', search_vol: 1100 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function claudeCall(prompt, maxTokens = 1800) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  const text = d?.content?.[0]?.text?.trim() || '';
  return text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
}

export async function run(host = 'www.orreryx.io') {
  const today = new Date().toISOString().split('T')[0];

  // Fetch current breaking news for trending opportunities
  let newsTopics = [];
  try {
    const r = await fetch(`https://${host}/api/gnews`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (r?.ok) {
      const d = await r.json().catch(() => null);
      newsTopics = (d?.articles || []).slice(0, 5).map(a => a.title || '').filter(Boolean);
    }
  } catch (_) {}

  const newsContext = newsTopics.length
    ? newsTopics.map(t => `- ${t}`).join('\n')
    : '- No live news at this time';

  const raw = await claudeCall(`You are a senior keyword research specialist for OrreryX (orreryx.io), a real-time geopolitical market intelligence SaaS targeting retail investors, traders, and analysts.

Goal: Identify keywords where OrreryX can reach TOP 5 on Google within 90 days.

Current live news (trending keyword signals):
${newsContext}

Commercial intent keywords (Bloomberg alternative queries):
${COMMERCIAL_SEEDS.join(', ')}

Informational keywords (content pages):
${INFORMATIONAL_SEEDS.slice(0, 8).join(', ')}

Competitor gap keywords (what Stratfor/CFR/Bloomberg rank for):
${COMPETITOR_GAP_SEEDS.slice(0, 5).join(', ')}

OrreryX current pages: ${PAGE_KEYWORD_MAP.map(p => p.path).join(', ')}

Analyze and return raw JSON only (no markdown, no backticks):
{
  "top5_targets": [
    {
      "keyword": "exact keyword phrase",
      "monthly_volume": "estimated monthly searches",
      "difficulty": "low|medium|high",
      "why_winnable": "specific reason OrreryX can beat current top 5",
      "current_top5_weakness": "what's weak about who ranks now",
      "target_page": "/existing-page-or-new-path",
      "action": "optimize existing|create new page|add content section",
      "expected_weeks_to_rank": "4-8|8-16|16-24"
    }
  ],
  "quick_wins": [
    {
      "keyword": "long-tail keyword rankable in 2-4 weeks",
      "volume": "monthly searches estimate",
      "target_page": "/path",
      "exact_action": "specific title/H1/content change to make right now"
    }
  ],
  "trending_now": [
    {
      "keyword": "keyword spiking due to current news",
      "news_trigger": "which news story is driving this",
      "urgency_hours": "how many hours to act before window closes",
      "content_angle": "exact angle OrreryX should publish"
    }
  ],
  "new_pages_needed": [
    {
      "url": "/suggested-path",
      "keyword": "primary keyword",
      "monthly_volume": "estimate",
      "competitor_ranking": "who currently ranks #1 and why OrreryX can beat them",
      "page_brief": "2-sentence brief of what the page should cover"
    }
  ],
  "competitor_gaps": [
    {
      "keyword": "keyword competitor ranks for but OrreryX doesn't",
      "competitor": "domain.com",
      "competitor_weakness": "why their content is beatable",
      "orreryx_advantage": "what unique angle OrreryX has"
    }
  ],
  "summary": "2-sentence strategic summary: top opportunity this week and why"
}`);

  let keywords = null;
  try { keywords = JSON.parse(raw || '{}'); } catch (_) {
    keywords = {
      top5_targets: COMMERCIAL_SEEDS.slice(0, 3).map(k => ({
        keyword: k, monthly_volume: '500-2000', difficulty: 'medium',
        why_winnable: 'Lower competition than generic finance terms',
        current_top5_weakness: 'No dedicated retail-facing tools in top 5',
        target_page: '/pricing', action: 'optimize existing',
        expected_weeks_to_rank: '8-16',
      })),
      quick_wins: LONGTAIL_SEEDS.slice(0, 3).map(k => ({
        keyword: k, volume: '100-500', target_page: '/geopolitical-risk',
        exact_action: 'Add this exact phrase to H2 and first paragraph',
      })),
      trending_now: newsTopics.slice(0, 2).map(n => ({
        keyword: n.slice(0, 60).toLowerCase().replace(/[^\w\s]/g,'').trim(),
        news_trigger: n, urgency_hours: '24', content_angle: 'Real-time tracking angle',
      })),
      new_pages_needed: PROGRAMMATIC_OPPORTUNITIES.slice(0, 3).map(p => ({
        url: p.path, keyword: p.keyword, monthly_volume: p.search_vol,
        competitor_ranking: 'Reuters/Bloomberg rank but are paywalled',
        page_brief: 'Live data + analysis for this conflict-asset combination.',
      })),
      competitor_gaps: COMPETITOR_GAP_SEEDS.slice(0, 2).map(k => ({
        keyword: k, competitor: 'stratfor.com',
        competitor_weakness: 'Paywalled, slow updates, not retail-facing',
        orreryx_advantage: 'Free trial, real-time, market impact translation',
      })),
      summary: 'Focus on Bloomberg-alternative commercial queries and conflict-specific long-tail keywords. Trending news creates 24-hour windows for traffic spikes.',
    };
  }

  // Add static programmatic page opportunities
  keywords.programmatic_opportunities = PROGRAMMATIC_OPPORTUNITIES;
  keywords.page_keyword_map = PAGE_KEYWORD_MAP;
  keywords.generatedAt = Date.now();
  keywords.date = today;

  await redis(['SET', 'seo:keywords:latest', JSON.stringify(keywords), 'EX', 172800]);
  return keywords;
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

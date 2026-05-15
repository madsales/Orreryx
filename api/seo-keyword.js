// api/seo-keyword.js — Keyword Research Agent
// Finds high-value keyword opportunities for OrreryX using Claude + news signals
// Stores results in Redis: seo:keywords:latest (48h TTL)

const SEED_TOPICS = [
  'geopolitical risk', 'ukraine war 2026', 'iran nuclear deal', 'china taiwan conflict',
  'india pakistan war', 'north korea missiles', 'global conflicts 2026', 'ww3 probability',
  'doomsday clock 2026', 'gold price geopolitical', 'oil price war', 'nuclear war risk',
  'safe haven assets war', 'defense stocks geopolitical', 'geopolitical risk investing',
  'conflict map live', 'war tracker', 'geopolitical intelligence', 'market risk geopolitics',
  'bitcoin war crash', 'wheat price war', 'copper price conflict', 'uranium price',
];

const COMPETITOR_DOMAINS = [
  'crisisgroup.org', 'cfr.org', 'chathamhouse.org', 'sipri.org',
  'geopoliticalfutures.com', 'stratfor.com', 'acleddata.com',
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
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(25000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  const text = d?.content?.[0]?.text?.trim() || '';
  return text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
}

export async function run(host = 'www.orreryx.io') {
  // Fetch current breaking news for recency signals
  let newsTopics = [];
  try {
    const r = await fetch(`https://${host}/api/gnews`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (r?.ok) {
      const d = await r.json().catch(() => null);
      newsTopics = (d?.articles || []).slice(0, 5).map(a => a.title || '').filter(Boolean);
    }
  } catch (_) {}

  const newsContext = newsTopics.length ? newsTopics.join('\n- ') : 'No live news available';

  const raw = await claudeCall(`You are a senior SEO strategist for OrreryX (orreryx.io), a real-time geopolitical market intelligence platform targeting investors, analysts, and journalists.

Current breaking news (use for recency opportunity detection):
- ${newsContext}

Seed topics we target: ${SEED_TOPICS.slice(0, 12).join(', ')}

Competitor domains: ${COMPETITOR_DOMAINS.join(', ')}

Generate a keyword research report as raw JSON only (no markdown):
{
  "high_priority": [
    {
      "keyword": "exact keyword phrase",
      "intent": "informational|commercial|navigational",
      "difficulty": "low|medium|high",
      "opportunity": "why this keyword is winnable for OrreryX",
      "target_page": "/path-that-should-rank (existing or new)",
      "monthly_volume_est": "estimated searches per month"
    }
  ],
  "quick_wins": [
    {
      "keyword": "long-tail keyword we can rank for fast",
      "rationale": "why this is a quick win",
      "action": "exact on-page change to make"
    }
  ],
  "trending_now": [
    {
      "keyword": "trending keyword based on current news",
      "urgency": "why to act now",
      "content_angle": "how OrreryX should cover this"
    }
  ],
  "gap_keywords": [
    {
      "keyword": "keyword competitors rank for but we don't",
      "competitor": "which competitor",
      "action": "create new page OR optimize existing"
    }
  ],
  "summary": "2-sentence strategic summary of keyword opportunities this week"
}`);

  let keywords = null;
  try { keywords = JSON.parse(raw); } catch (_) {
    keywords = {
      high_priority: SEED_TOPICS.slice(0, 5).map(k => ({ keyword: k, intent: 'informational', difficulty: 'medium', opportunity: 'Core topic area', target_page: '/', monthly_volume_est: '1,000-10,000' })),
      quick_wins: [{ keyword: 'geopolitical risk tracker 2026', rationale: 'Long-tail with year modifier', action: 'Add "2026" to title tags on key pages' }],
      trending_now: newsTopics.slice(0, 2).map(n => ({ keyword: n.slice(0, 60), urgency: 'Breaking news signal', content_angle: 'Real-time tracking angle' })),
      gap_keywords: [{ keyword: 'geopolitical risk assessment tool', competitor: 'cfr.org', action: 'Create dedicated landing page' }],
      summary: 'Focus on long-tail geopolitical + investing keywords. Trending news creates time-sensitive opportunities.',
    };
  }

  const payload = { ...keywords, generatedAt: Date.now(), date: new Date().toISOString().split('T')[0] };
  await redis(['SET', 'seo:keywords:latest', JSON.stringify(payload), 'EX', 172800]);
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

// api/seo-analytics.js — Analytics Manager Agent
// Reads OrreryX internal analytics from Redis, tracks organic growth signals
// Optionally integrates with Google Search Console API
// Redis: seo:analytics:latest (48h TTL)

const TARGET_KEYWORDS = [
  'geopolitical risk tracker', 'live conflict map', 'ukraine war live',
  'ww3 probability', 'geopolitical market impact', 'orreryx',
  'nuclear war risk 2026', 'india pakistan war tracker', 'doomsday clock 2026',
  'safe haven assets war', 'oil price geopolitical risk', 'gold price war',
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

async function redisPipeline(cmds) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return [];
  const r = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  const d = await r?.json().catch(() => null);
  return (d || []).map(row => row?.result ?? null);
}

function dateStr(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

async function getOwnAnalytics() {
  const today = dateStr(0);
  const days  = Array.from({ length: 7 }, (_, i) => dateStr(i));
  const cmds  = [
    ['GET', 'analytics:pv:total'],
    ['GET', 'analytics:signup:total'],
    ['GET', 'analytics:payment:total'],
    ['HGETALL', 'analytics:plans'],
    ['ZRANGE', 'analytics:refs', '0', '9', 'REV', 'WITHSCORES'],
    ['ZRANGE', 'analytics:clicks', '0', '9', 'REV', 'WITHSCORES'],
    ['HGETALL', 'analytics:device'],
    ...days.map(d => ['GET', `analytics:pv:${d}`]),
    ...days.map(d => ['GET', `analytics:signup:${d}`]),
  ];

  const results = await redisPipeline(cmds);
  const [totalPV, totalSignups, totalPayments, plans, refs, clicks, devices, ...rest] = results;
  const pvByDay  = days.map((d, i) => ({ date: d, views: parseInt(rest[i] || '0') }));
  const sgByDay  = days.map((d, i) => ({ date: d, signups: parseInt(rest[7 + i] || '0') }));
  const todayPV  = pvByDay[0]?.views || 0;
  const todaySG  = sgByDay[0]?.views || 0;
  const weeklyPV = pvByDay.reduce((a, b) => a + b.views, 0);
  const weeklySG = sgByDay.reduce((a, b) => a + b.signups, 0);

  // Parse refs
  const topRefs = [];
  if (Array.isArray(refs)) {
    for (let i = 0; i < refs.length - 1; i += 2) {
      topRefs.push({ domain: refs[i], count: parseInt(refs[i + 1] || '0') });
    }
  }

  return {
    totalPV:     parseInt(totalPV || '0'),
    totalSignups:parseInt(totalSignups || '0'),
    totalPayments:parseInt(totalPayments || '0'),
    weeklyPV, weeklySG, todayPV, todaySG,
    pvByDay, sgByDay, topRefs,
    conversionRate: weeklyPV > 0 ? ((weeklySG / weeklyPV) * 100).toFixed(3) : '0',
  };
}

async function getGSCData() {
  const clientEmail = process.env.GSC_CLIENT_EMAIL;
  const privateKey  = process.env.GSC_PRIVATE_KEY;
  const siteUrl     = process.env.GSC_SITE_URL || 'https://www.orreryx.io/';

  if (!clientEmail || !privateKey) return { available: false, reason: 'GSC credentials not configured. Set GSC_CLIENT_EMAIL and GSC_PRIVATE_KEY in Vercel.' };

  // Get OAuth token via JWT
  try {
    const now = Math.floor(Date.now() / 1000);
    const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    })).toString('base64url');

    // Note: Full JWT signing requires crypto — simplified here
    // In production, use a proper JWT library or service account flow
    return { available: false, reason: 'GSC JWT signing requires additional setup. Add GSC_SERVICE_ACCOUNT_JSON to Vercel for full GSC integration.' };
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

async function claudeInsights(analytics) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: `You are an analytics manager for OrreryX (orreryx.io).

Weekly stats: ${analytics.weeklyPV} page views, ${analytics.weeklySG} signups, conversion rate ${analytics.conversionRate}%.
Today: ${analytics.todayPV} views, ${analytics.todaySG} signups.
Top referrers: ${analytics.topRefs.slice(0,3).map(r => r.domain).join(', ') || 'none yet'}.

In 3 bullet points (max 20 words each), give the most important SEO/growth insights and ONE specific action to take this week. Be direct.` }],
    }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  return d?.content?.[0]?.text?.trim() || null;
}

export async function run() {
  const today = new Date().toISOString().split('T')[0];
  const [analytics, gsc] = await Promise.all([getOwnAnalytics(), getGSCData()]);
  const insights = await claudeInsights(analytics);

  const rankingGoals = TARGET_KEYWORDS.map(kw => ({
    keyword: kw,
    goal: 'Top 5',
    status: 'tracking',
    note: 'Connect GSC for real position data',
  }));

  const payload = { analytics, gsc, insights, rankingGoals, targetKeywords: TARGET_KEYWORDS, generatedAt: Date.now(), date: today };
  await redis(['SET', 'seo:analytics:latest', JSON.stringify(payload), 'EX', 172800]);
  return payload;
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

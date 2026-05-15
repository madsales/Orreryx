// api/seo-links.js — Link Building Manager Agent
// Identifies link opportunities, tracks backlink profile, generates outreach templates
// Redis: seo:links:latest (48h TTL)

const LINK_TARGETS = [
  { domain: 'reddit.com/r/geopolitics',     type: 'community',  da: 91, angle: 'Share OrreryX tool when relevant discussions arise' },
  { domain: 'reddit.com/r/investing',        type: 'community',  da: 91, angle: 'Post during market volatility events with geopolitical cause' },
  { domain: 'twitter.com',                   type: 'social',     da: 94, angle: 'Tag in geopolitical breaking news with OrreryX data' },
  { domain: 'producthunt.com',               type: 'directory',  da: 90, angle: 'Launch OrreryX as a product — backlink + traffic' },
  { domain: 'alternativeto.net',             type: 'directory',  da: 80, angle: 'List as alternative to Stratfor, ACLED' },
  { domain: 'g2.com',                        type: 'directory',  da: 90, angle: 'Create OrreryX listing in "Risk Management Software"' },
  { domain: 'toolify.ai',                    type: 'directory',  da: 60, angle: 'List as AI geopolitical intelligence tool' },
  { domain: 'futurepedia.io',                type: 'directory',  da: 65, angle: 'List in AI tools directory' },
  { domain: 'bensbites.com',                 type: 'newsletter', da: 70, angle: 'Pitch as AI-powered geopolitical tool for newsletter feature' },
  { domain: 'tldr.tech',                     type: 'newsletter', da: 75, angle: 'Pitch for TLDR AI or TLDR Security newsletter' },
  { domain: 'seekingalpha.com',              type: 'finance',    da: 91, angle: 'Contribute guest article on geopolitical risk investing' },
  { domain: 'marketwatch.com',               type: 'finance',    da: 94, angle: 'Get cited as data source in geopolitical market stories' },
  { domain: 'thestreet.com',                 type: 'finance',    da: 90, angle: 'Pitch as tool for geopolitical risk analysis' },
  { domain: 'substack.com',                  type: 'newsletter', da: 91, angle: 'Reach out to geopolitics Substacks for tool review' },
];

const INTERNAL_LINK_OPPORTUNITIES = [
  { from: '/ukraine-war',           to: '/russia-ukraine-war',      anchor: 'Russia-Ukraine war tracker' },
  { from: '/geopolitical-risk',     to: '/risk-dashboard',          anchor: 'live geopolitical risk dashboard' },
  { from: '/gold-price',            to: '/safe-haven-assets',       anchor: 'safe haven assets during war' },
  { from: '/china-taiwan',          to: '/taiwan-semiconductor',    anchor: 'Taiwan semiconductor risk' },
  { from: '/ww3-probability',       to: '/nuclear-war-risk',        anchor: 'nuclear war risk tracker' },
  { from: '/india-pakistan',        to: '/india-pakistan-war-2026', anchor: 'India Pakistan war 2026 live' },
  { from: '/global-conflicts-2026', to: '/top-risks-2026',          anchor: 'top geopolitical risks 2026' },
  { from: '/oil-price',             to: '/iran-nuclear',            anchor: 'Iran nuclear threat and oil prices' },
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
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  return d?.content?.[0]?.text?.trim() || '';
}

export async function run() {
  const today = new Date().toISOString().split('T')[0];

  // Generate outreach templates for top 3 targets
  const topTargets = LINK_TARGETS.filter(t => t.type === 'finance' || t.type === 'newsletter').slice(0, 3);
  const outreachTemplates = [];

  for (const target of topTargets) {
    const template = await claudeCall(`Write a short (150 words max), professional outreach email to get a backlink from ${target.domain} for OrreryX (orreryx.io).

Angle: ${target.angle}
OrreryX is: a free real-time geopolitical market intelligence platform — tracks active wars, nuclear risks, and their impact on oil, gold, stocks, crypto.

Write the email body only (no subject line). Be specific, not generic. Show you know their audience.`);
    if (template) outreachTemplates.push({ domain: target.domain, template });
  }

  // Prioritize this week's link building actions
  const weeklyPlan = {
    directorySubmissions: LINK_TARGETS.filter(t => t.type === 'directory').slice(0, 3).map(t => ({
      action: `Submit OrreryX to ${t.domain}`,
      url: `https://${t.domain}`,
      angle: t.angle,
      effort: '15 min',
    })),
    communityPosts: LINK_TARGETS.filter(t => t.type === 'community').map(t => ({
      action: `Post on ${t.domain} when next geopolitical event breaks`,
      angle: t.angle,
      effort: '5 min per post',
    })),
    outreachCampaign: {
      targets: topTargets.map(t => t.domain),
      templates: outreachTemplates.length,
      priority: 'High — finance sites have DA90+ and relevant audience',
    },
    internalLinking: {
      opportunities: INTERNAL_LINK_OPPORTUNITIES.length,
      topPriority: INTERNAL_LINK_OPPORTUNITIES[0],
      note: 'Add these internal links to improve PageRank flow between key pages',
    },
  };

  const payload = {
    linkTargets: LINK_TARGETS,
    internalLinkOpportunities: INTERNAL_LINK_OPPORTUNITIES,
    outreachTemplates,
    weeklyPlan,
    generatedAt: Date.now(),
    date: today,
  };
  await redis(['SET', 'seo:links:latest', JSON.stringify(payload), 'EX', 172800]);
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

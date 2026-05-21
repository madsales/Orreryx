// api/seo-links.js — AI-Driven Link Building Specialist
// Role: Identify + track high-value backlink opportunities, generate targeted outreach,
//       create data-journalism pitches, manage internal linking, track acquisition status
// Runs weekly via seo-orchestrator
// Redis: seo:links:latest (48h TTL), seo:links:acquired (permanent)

// ── Full link target database ─────────────────────────────────────────────────

const LINK_TARGETS = [
  // Finance media (DA 85–95) — highest SEO value
  { id: 'seekingalpha',   domain: 'seekingalpha.com',    type: 'media',       da: 91, angle: 'Guest article: "Geopolitical Risk Investing Guide for Retail Investors"', effort: 'high',   reward: 'high' },
  { id: 'marketwatch',    domain: 'marketwatch.com',     type: 'media',       da: 94, angle: 'Get cited as data source in geopolitical market stories', effort: 'medium', reward: 'high' },
  { id: 'thestreet',      domain: 'thestreet.com',       type: 'media',       da: 88, angle: 'Pitch OrreryX data for war stocks analysis articles', effort: 'medium', reward: 'high' },
  { id: 'zerohedge',      domain: 'zerohedge.com',       type: 'media',       da: 80, angle: 'Share conflict-market correlation data for editorial use', effort: 'low',    reward: 'medium' },
  { id: 'investopedia',   domain: 'investopedia.com',    type: 'media',       da: 93, angle: 'Get cited in "geopolitical risk" or "safe haven assets" definitions', effort: 'medium', reward: 'high' },
  // Newsletters (DA 70–91) — trusted audience + SEO
  { id: 'bensbites',      domain: 'bensbites.com',       type: 'newsletter',  da: 70, angle: 'Pitch as AI-powered geopolitical intelligence for investors', effort: 'low',    reward: 'medium' },
  { id: 'tldr',           domain: 'tldr.tech',           type: 'newsletter',  da: 75, angle: 'Pitch for TLDR Finance or TLDR AI newsletter feature', effort: 'low',    reward: 'medium' },
  { id: 'finimize',       domain: 'finimize.com',        type: 'newsletter',  da: 72, angle: 'Partner: OrreryX provides geopolitical context for daily briefings', effort: 'medium', reward: 'medium' },
  { id: 'morningbrew',    domain: 'morningbrew.com',     type: 'newsletter',  da: 85, angle: 'Get OrreryX cited in business news geopolitical sections', effort: 'high',   reward: 'high' },
  // Directories (quick, permanent, SEO value)
  { id: 'producthunt',    domain: 'producthunt.com',     type: 'directory',   da: 90, angle: 'Launch OrreryX — get listing + community upvotes', effort: 'high',   reward: 'high' },
  { id: 'alternativeto',  domain: 'alternativeto.net',   type: 'directory',   da: 80, angle: 'List as alternative to Bloomberg, Stratfor, Reuters, ACLED', effort: 'low',    reward: 'medium' },
  { id: 'g2',             domain: 'g2.com',              type: 'directory',   da: 90, angle: 'Create listing in "Geopolitical Risk Software" + "Financial Intelligence"', effort: 'low', reward: 'medium' },
  { id: 'capterra',       domain: 'capterra.com',        type: 'directory',   da: 86, angle: 'List in "Risk Management Software" category', effort: 'low',    reward: 'medium' },
  { id: 'toolify',        domain: 'toolify.ai',          type: 'directory',   da: 60, angle: 'List as AI geopolitical intelligence tool', effort: 'low',    reward: 'low'    },
  { id: 'futurepedia',    domain: 'futurepedia.io',      type: 'directory',   da: 65, angle: 'List in AI finance tools category', effort: 'low',    reward: 'low'    },
  // Geopolitics/research communities
  { id: 'reddit_geo',     domain: 'reddit.com/r/geopolitics', type: 'community', da: 91, angle: 'Post live conflict analysis — OrreryX as source tool', effort: 'low',    reward: 'medium' },
  { id: 'reddit_invest',  domain: 'reddit.com/r/investing',   type: 'community', da: 91, angle: 'Post war stocks analysis during market volatility events', effort: 'low',    reward: 'medium' },
  { id: 'substack',       domain: 'substack.com',        type: 'newsletter',  da: 91, angle: 'Reach out to top geopolitics Substacks for tool reviews', effort: 'medium', reward: 'medium' },
  // Academic/research (for E-E-A-T authority)
  { id: 'brookings',      domain: 'brookings.edu',       type: 'research',    da: 93, angle: 'Get OrreryX data cited in conflict economics papers', effort: 'high',   reward: 'very high' },
  { id: 'cfr',            domain: 'cfr.org',             type: 'research',    da: 89, angle: 'Pitch CFR analysts OrreryX data for conflict tracking', effort: 'high',   reward: 'very high' },
];

// Internal linking map — key for PageRank distribution
const INTERNAL_LINKS = [
  { from: '/ukraine-war',           to: '/russia-ukraine-war',       anchor: 'Russia-Ukraine war live tracker' },
  { from: '/geopolitical-risk',     to: '/risk-dashboard',           anchor: 'live geopolitical risk dashboard' },
  { from: '/gold-price',            to: '/safe-haven-assets',        anchor: 'safe haven assets during geopolitical crises' },
  { from: '/china-taiwan',          to: '/taiwan-semiconductor',     anchor: 'Taiwan Strait semiconductor supply chain risk' },
  { from: '/ww3-probability',       to: '/nuclear-war-risk',         anchor: 'nuclear war risk and market impact' },
  { from: '/india-pakistan',        to: '/india-pakistan-war-2026',  anchor: 'India Pakistan 2026 conflict live updates' },
  { from: '/global-conflicts-2026', to: '/top-risks-2026',           anchor: 'top geopolitical risks investors are watching' },
  { from: '/oil-price',             to: '/iran-nuclear',             anchor: 'Iran nuclear tensions and oil price volatility' },
  { from: '/defense-stocks',        to: '/ukraine-war',              anchor: 'Ukraine war defense spending analysis' },
  { from: '/safe-haven-assets',     to: '/gold-price',               anchor: 'gold price live geopolitical data' },
  { from: '/pricing',               to: '/',                         anchor: 'OrreryX geopolitical intelligence platform' },
  { from: '/',                      to: '/geopolitical-risk',        anchor: 'what is geopolitical risk' },
];

// Data journalism pitches — OrreryX has unique data journalists want
const DATA_JOURNALISM_PITCHES = [
  {
    angle: 'Conflict-to-Oil Correlation Study',
    pitch: 'OrreryX tracks real-time correlation between conflict escalations and oil futures movements. We can provide a dataset showing oil price changes within 4 hours of 50+ geopolitical events.',
    targets: ['marketwatch.com', 'thestreet.com', 'seekingalpha.com'],
  },
  {
    angle: 'War Stocks Performance During Active Conflicts',
    pitch: 'Defense stock (LMT, RTX, NOC, BAE) performance data correlated with OrreryX conflict severity scores across 13 active conflict zones.',
    targets: ['seekingalpha.com', 'investopedia.com', 'zerohedge.com'],
  },
  {
    angle: 'Safe Haven Asset Analysis: Gold vs. Conflict Severity',
    pitch: 'OrreryX\'s conflict severity index vs. gold price movements across Ukraine, Iran, Taiwan, India-Pakistan. First-of-kind correlation dataset for retail investors.',
    targets: ['morningbrew.com', 'finimize.com', 'marketwatch.com'],
  },
  {
    angle: 'Geopolitical Risk Sentiment Index 2026',
    pitch: 'Monthly geopolitical risk index covering 13 conflict zones, tracking how risk perception correlates with commodity prices and defense stock returns.',
    targets: ['brookings.edu', 'cfr.org', 'seekingalpha.com'],
  },
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

async function claudeCall(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 900, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(25000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  return d?.content?.[0]?.text?.trim() || '';
}

// ── Outreach template generation ──────────────────────────────────────────────

async function generateOutreach(target) {
  return claudeCall(`Write a short (120 words max), direct, non-generic outreach email to get a backlink/feature from ${target.domain} for OrreryX.

Target's audience: financial journalists/analysts/investors who care about geopolitics and markets
OrreryX: real-time geopolitical risk platform, tracks 13 conflict zones → market impact. $14.99/month vs Bloomberg's $2,000.
Link angle: ${target.angle}

Requirements:
- First line references something specific about their publication/audience
- Offer specific value (data, guest post, tool review) — not just "check us out"
- Under 120 words
- Human voice, not corporate
- End with a specific, low-friction ask

Write the email body only (no subject line, no greeting header).`);
}

// ── Acquisition status tracking ───────────────────────────────────────────────

async function getAcquisitionStatus() {
  const raw = await redis(['GET', 'seo:links:acquired']);
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

async function updateAcquisitionStatus(targetId, status) {
  const current = await getAcquisitionStatus();
  current[targetId] = { status, updatedAt: new Date().toISOString() };
  await redis(['SET', 'seo:links:acquired', JSON.stringify(current)]);
  return current;
}

// ── Weekly action plan ────────────────────────────────────────────────────────

function buildWeeklyPlan(targets, acquisitionStatus) {
  const pending    = targets.filter(t => !acquisitionStatus[t.id] || acquisitionStatus[t.id]?.status === 'pending');
  const contacted  = targets.filter(t => acquisitionStatus[t.id]?.status === 'contacted');
  const acquired   = targets.filter(t => acquisitionStatus[t.id]?.status === 'acquired');

  // Prioritize: low-effort targets first, then high-reward
  const thisWeek = pending
    .sort((a, b) => {
      const effortScore = { low: 3, medium: 2, high: 1 };
      const rewardScore = { 'very high': 4, high: 3, medium: 2, low: 1 };
      return (rewardScore[b.reward] * effortScore[b.effort]) - (rewardScore[a.reward] * effortScore[a.effort]);
    })
    .slice(0, 5);

  return {
    thisWeek: thisWeek.map(t => ({
      action: `${t.effort === 'low' ? '✅ Quick (15 min)' : t.effort === 'medium' ? '📋 Medium (1 hr)' : '📞 Investment (2+ hrs)'}: ${t.domain}`,
      angle: t.angle,
      url: `https://${t.domain}`,
      expectedValue: t.reward,
      effort: t.effort,
    })),
    pipeline: {
      pending:   pending.length,
      contacted: contacted.length,
      acquired:  acquired.length,
      total:     targets.length,
    },
    internalLinks: {
      total:       INTERNAL_LINKS.length,
      topPriority: INTERNAL_LINKS.slice(0, 3),
      note:        'Add these internal links immediately — zero external effort, direct ranking impact',
    },
    dataJournalism: DATA_JOURNALISM_PITCHES.slice(0, 2),
  };
}

// ── Main run ──────────────────────────────────────────────────────────────────

export async function run() {
  const today = new Date().toISOString().split('T')[0];
  const acquisitionStatus = await getAcquisitionStatus();

  // Generate outreach templates for top 4 unacquired high-value targets
  const outreachTargets = LINK_TARGETS
    .filter(t => !acquisitionStatus[t.id] || acquisitionStatus[t.id]?.status === 'pending')
    .filter(t => t.type === 'media' || t.type === 'newsletter')
    .sort((a, b) => b.da - a.da)
    .slice(0, 4);

  const outreachTemplates = [];
  for (const target of outreachTargets) {
    const template = await generateOutreach(target);
    if (template) {
      outreachTemplates.push({
        domain:       target.domain,
        angle:        target.angle,
        da:           target.da,
        template,
        subject:      `data partnership — OrreryX × ${target.domain.split('.')[0]}`,
      });
    }
  }

  const weeklyPlan = buildWeeklyPlan(LINK_TARGETS, acquisitionStatus);

  const payload = {
    linkTargets:         LINK_TARGETS,
    internalLinks:       INTERNAL_LINKS,
    outreachTemplates,
    weeklyPlan,
    dataJournalismPitches: DATA_JOURNALISM_PITCHES,
    acquisitionStatus,
    stats: {
      totalTargets:  LINK_TARGETS.length,
      acquired:      Object.values(acquisitionStatus).filter(s => s.status === 'acquired').length,
      contacted:     Object.values(acquisitionStatus).filter(s => s.status === 'contacted').length,
      pending:       LINK_TARGETS.length - Object.values(acquisitionStatus).filter(s => ['acquired','contacted'].includes(s.status)).length,
    },
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

  // Allow updating link status: POST ?action=update { targetId, status }
  if (req.method === 'POST' && req.query.action === 'update') {
    let body = {};
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {}
    if (!body.targetId || !body.status) return res.status(400).json({ error: 'targetId and status required' });
    const updated = await updateAcquisitionStatus(body.targetId, body.status);
    return res.status(200).json({ ok: true, updated });
  }

  const result = await run();
  return res.status(200).json({ ok: true, ...result });
}
export const config = { api: { bodyParser: false } };

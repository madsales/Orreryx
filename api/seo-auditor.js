// api/seo-auditor.js — SEO Auditor
// Role: Weekly ranking health check — detects drops, content decay, 404s, E-E-A-T gaps,
//       thin content, and ranking regressions. Alerts admin to critical issues immediately.
// Runs weekly via seo-orchestrator
// Redis: seo:auditor:latest (48h TTL), seo:auditor:history (rolling weekly snapshots)

// ── Full audit page list ──────────────────────────────────────────────────────

const AUDIT_PAGES = [
  // Critical ranking pages (must be in top 5 for these)
  { path: '/',                        kw: 'geopolitical risk investing platform', importance: 'critical', expectRank: '1-5'  },
  { path: '/pricing',                 kw: 'bloomberg alternative retail investors', importance: 'critical', expectRank: '1-5' },
  { path: '/geopolitical-risk',       kw: 'geopolitical risk investing 2026', importance: 'critical', expectRank: '1-5'      },
  { path: '/risk-dashboard',          kw: 'live geopolitical risk dashboard',  importance: 'critical', expectRank: '1-10'    },
  // High-traffic content
  { path: '/ukraine-war',             kw: 'ukraine war market impact 2026',    importance: 'high',     expectRank: '1-10'    },
  { path: '/iran-nuclear',            kw: 'iran nuclear deal oil price 2026',  importance: 'high',     expectRank: '1-10'    },
  { path: '/china-taiwan',            kw: 'china taiwan war semiconductor risk', importance: 'high',   expectRank: '1-10'    },
  { path: '/india-pakistan',          kw: 'india pakistan conflict 2026',      importance: 'high',     expectRank: '1-10'    },
  { path: '/global-conflicts-2026',   kw: 'global conflicts 2026 active wars', importance: 'high',     expectRank: '1-10'    },
  { path: '/ww3-probability',         kw: 'ww3 probability 2026',              importance: 'high',     expectRank: '1-10'    },
  // Asset pages
  { path: '/gold-price',              kw: 'gold price geopolitical risk',      importance: 'high',     expectRank: '1-20'    },
  { path: '/oil-price',               kw: 'oil price war geopolitics 2026',    importance: 'high',     expectRank: '1-20'    },
  { path: '/defense-stocks',          kw: 'best defense stocks geopolitical',  importance: 'high',     expectRank: '1-20'    },
  { path: '/safe-haven-assets',       kw: 'safe haven assets during war',      importance: 'medium',   expectRank: '1-20'    },
  { path: '/nuclear-war-risk',        kw: 'nuclear war risk 2026',             importance: 'medium',   expectRank: '1-20'    },
  { path: '/taiwan-semiconductor',    kw: 'taiwan semiconductor conflict risk', importance: 'medium',  expectRank: '1-20'    },
  { path: '/top-risks-2026',          kw: 'top geopolitical risks 2026',       importance: 'medium',   expectRank: '1-20'    },
  { path: '/what-is-geopolitics',     kw: 'what is geopolitics',               importance: 'medium',   expectRank: '1-20'    },
];

// ── E-E-A-T signals ───────────────────────────────────────────────────────────

const EEAT = {
  experience:       ['our data shows', 'we tracked', 'we analyzed', 'first-hand', 'case study', 'according to our', 'orreryx tracked'],
  expertise:        ['analysis', 'according to', 'research shows', 'data from', 'methodology', 'source:', 'cited by', 'expert'],
  authoritativeness:['as reported by', 'official', 'government data', 'cited by', 'referenced in', 'bloomberg reports', 'reuters'],
  trustworthiness:  ['last updated', 'sources:', 'disclaimer', 'privacy', 'methodology', 'about us', 'data sources'],
};

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

async function claudeAudit(path, kw, text) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !text) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 700,
      messages: [{ role: 'user', content: `You are a senior SEO auditor assessing OrreryX.io for top-5 Google rankings.

Page: ${path}
Target keyword: "${kw}"
Content sample (first 1000 chars): ${text.slice(0, 1000)}

Return raw JSON only:
{
  "content_quality_score": 0-100,
  "ai_content_risk": "low|medium|high",
  "ai_risk_reason": "one sentence why",
  "keyword_placement": "good|missing|over-optimized",
  "keyword_in_title": true/false,
  "keyword_in_h1": true/false,
  "keyword_in_first_paragraph": true/false,
  "missing_eeat": ["specific E-E-A-T elements missing"],
  "content_freshness": "fresh|stale|missing_date",
  "top_3_fixes": ["specific actionable fix #1", "fix #2", "fix #3"],
  "add_section": "one specific section that would boost rankings for this keyword",
  "competitor_likely_beats_us_because": "one specific reason"
}` }],
    }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  const text2 = d?.content?.[0]?.text?.trim() || '';
  try { return JSON.parse(text2.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()); } catch { return null; }
}

// ── Page fetcher ──────────────────────────────────────────────────────────────

async function fetchPage(path) {
  const r = await fetch(`https://www.orreryx.io${path}`, {
    signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': 'OrreryX-SEOAudit/2.0' },
  }).catch(() => null);

  if (!r?.ok) return { error: `HTTP ${r?.status || 0} — page may be down`, status: r?.status || 0 };

  const html = await r.text().catch(() => '');
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const title    = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]?.trim() || '';
  const desc     = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || [])[1]?.trim() || '';
  const h1       = (html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || [])[1]?.trim() || '';
  const wordCount = text.split(/\s+/).filter(w => w.length > 2).length;
  const hasLastUpdated = /last.?updated|updated.{0,10}\d{4}/i.test(html);
  const hasSchema  = /<script[^>]+application\/ld\+json/i.test(html);
  const hasFAQ     = html.includes('FAQPage') || /faq|frequently.asked/i.test(html);
  const hasNoIndex = /noindex/i.test(html);
  const internalLinks = (html.match(/href=["']\/[^"'#?]+["']/gi) || []).length;

  return {
    status: 200, title, desc, h1, wordCount, hasLastUpdated, hasSchema,
    hasFAQ, hasNoIndex, internalLinks,
    text: text.slice(0, 3000),
  };
}

// ── E-E-A-T scorer ────────────────────────────────────────────────────────────

function scoreEEAT(text) {
  const tl = text.toLowerCase();
  const signals = {};
  let total = 0;
  for (const [dim, kws] of Object.entries(EEAT)) {
    const found = kws.filter(kw => tl.includes(kw));
    signals[dim] = { found, score: Math.min(100, found.length * 25) };
    total += found.length;
  }
  return { signals, overallScore: Math.min(100, total * 8) };
}

// ── Readability scorer ────────────────────────────────────────────────────────

function scoreReadability(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const words     = text.split(/\s+/).filter(Boolean);
  const avg       = sentences.length > 0 ? Math.round(words.length / sentences.length) : 0;
  const longSents = sentences.filter(s => s.split(/\s+/).length > 25).length;
  const issues    = [];
  if (words.length < 300)   issues.push(`Thin content: ~${words.length} words — target 600+ for competitive keywords`);
  if (avg > 22)             issues.push(`Avg sentence length ${avg} words — aim for <20 (readability)`);
  if (longSents > 5)        issues.push(`${longSents} very long sentences — break them up`);
  return { wordCount: words.length, avgSentenceLen: avg, longSentences: longSents, issues };
}

// ── Compare with previous audit (week-over-week) ─────────────────────────────

async function getLastAudit() {
  const raw = await redis(['GET', 'seo:auditor:latest']);
  try { return JSON.parse(raw || 'null'); } catch { return null; }
}

function detectRegressions(current, previous) {
  if (!previous?.auditResults) return [];
  const regressions = [];
  for (const curr of current) {
    const prev = previous.auditResults.find(p => p.path === curr.path);
    if (!prev) continue;
    const scoreDrop = (prev.overallScore || 0) - (curr.overallScore || 0);
    if (scoreDrop >= 10) {
      regressions.push({
        path: curr.path,
        drop: scoreDrop,
        previousScore: prev.overallScore,
        currentScore: curr.overallScore,
        reason: 'Score dropped significantly — check for content removal or technical issues',
      });
    }
    if (prev.status === 200 && curr.status !== 200) {
      regressions.push({
        path: curr.path, drop: 100, type: 'page_down',
        reason: `Page returned HTTP ${curr.status} — was 200 last week`,
      });
    }
  }
  return regressions;
}

// ── Main run ──────────────────────────────────────────────────────────────────

export async function run() {
  const today = new Date().toISOString().split('T')[0];
  const prevAudit = await getLastAudit();
  const auditResults = [];

  // Process ALL pages (not just 4)
  for (const page of AUDIT_PAGES) {
    const content = await fetchPage(page.path);

    if (content.error) {
      auditResults.push({ path: page.path, keyword: page.kw, importance: page.importance, error: content.error, status: content.status, overallScore: 0 });
      continue;
    }

    const eeat        = scoreEEAT(content.text);
    const readability = scoreReadability(content.text);
    const aiAudit     = await claudeAudit(page.path, page.kw, content.text);

    // Severity flags
    const critical = [];
    const warnings = [];
    if (content.hasNoIndex)       critical.push('noindex directive — page not in Google index');
    if (!content.title)           critical.push('Missing <title> tag');
    if (!content.h1)              critical.push('Missing H1 tag');
    if (content.wordCount < 150)  critical.push(`Very thin content: ${content.wordCount} words`);
    if (!content.hasSchema)       warnings.push('No JSON-LD schema — missing rich result eligibility');
    if (!content.hasLastUpdated)  warnings.push('No "Last Updated" date — freshness signal missing');
    if (content.internalLinks < 2) warnings.push('Fewer than 2 internal links — poor PageRank flow');

    const qualityScore = aiAudit?.content_quality_score || 50;
    const overallScore = Math.max(0, Math.round(
      (eeat.overallScore * 0.3) + (qualityScore * 0.5) +
      (readability.issues.length === 0 ? 20 : Math.max(0, 20 - readability.issues.length * 5))
    ) - (critical.length * 15) - (warnings.length * 5));

    auditResults.push({
      path: page.path, keyword: page.kw, importance: page.importance,
      status: content.status,
      title: content.title, h1: content.h1, wordCount: content.wordCount,
      hasSchema: content.hasSchema, hasFAQ: content.hasFAQ, hasLastUpdated: content.hasLastUpdated,
      internalLinks: content.internalLinks,
      eeat, readability, aiAudit,
      critical, warnings,
      overallScore: Math.max(0, Math.min(100, overallScore)),
    });
  }

  const avgScore     = Math.round(auditResults.reduce((a, r) => a + (r.overallScore || 0), 0) / auditResults.length);
  const regressions  = detectRegressions(auditResults, prevAudit);
  const pagesDown    = auditResults.filter(r => r.status !== 200).length;
  const noSchema     = auditResults.filter(r => !r.hasSchema).length;
  const thinContent  = auditResults.filter(r => (r.wordCount || 0) < 300).length;
  const noLastUpdate = auditResults.filter(r => !r.hasLastUpdated).length;

  const criticalIssues = [
    ...auditResults.flatMap(r => r.critical?.map(c => `${r.path}: ${c}`) || []),
    ...regressions.map(reg => `📉 ${reg.path}: score dropped ${reg.drop} points this week`),
    pagesDown > 0 ? `🔴 ${pagesDown} pages returning non-200 status` : null,
  ].filter(Boolean);

  const recommendations = [
    criticalIssues.length > 0 ? `Fix ${criticalIssues.length} CRITICAL issues immediately` : null,
    noSchema > 0       ? `Add JSON-LD schema to ${noSchema} pages` : null,
    thinContent > 0    ? `Expand content on ${thinContent} thin pages (< 300 words)` : null,
    noLastUpdate > 0   ? `Add "Last Updated" dates to ${noLastUpdate} pages` : null,
    regressions.length > 0 ? `Investigate ${regressions.length} pages with ranking score drops` : null,
  ].filter(Boolean);

  // Store current as new "previous" for next week comparison
  const payload = {
    auditResults, avgScore, criticalIssues, recommendations, regressions,
    summary: { pagesDown, noSchema, thinContent, noLastUpdate, total: AUDIT_PAGES.length },
    generatedAt: Date.now(), date: today,
  };
  await redis(['SET', 'seo:auditor:latest', JSON.stringify(payload), 'EX', 172800]);
  // Store weekly history (keep 4 weeks)
  await redis(['SET', `seo:auditor:${today}`, JSON.stringify({ avgScore, criticalIssues: criticalIssues.length, regressions: regressions.length }), 'EX', 2419200]);

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

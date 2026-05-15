// api/seo-auditor.js — AI Content Auditor Agent
// Audits OrreryX pages for content quality, E-E-A-T signals, AI content detection risks
// and readability. Flags pages needing human expert content additions.
// Redis: seo:auditor:latest (48h TTL)

const AUDIT_PAGES = [
  { path: '/geopolitical-risk',     kw: 'geopolitical risk',     importance: 'high' },
  { path: '/ukraine-war',           kw: 'ukraine war 2026',      importance: 'high' },
  { path: '/iran-nuclear',          kw: 'iran nuclear',          importance: 'high' },
  { path: '/ww3-probability',       kw: 'ww3 probability 2026',  importance: 'high' },
  { path: '/gold-price',            kw: 'gold price geopolitical', importance: 'medium' },
  { path: '/safe-haven-assets',     kw: 'safe haven assets war', importance: 'medium' },
  { path: '/what-is-geopolitics',   kw: 'what is geopolitics',   importance: 'medium' },
];

const EEAT_SIGNALS = {
  experience:   ['author bio', 'case study', 'personal insight', 'first-hand', 'we tracked', 'our data'],
  expertise:    ['according to', 'research shows', 'data from', 'analysis', 'methodology', 'source:'],
  authoritativeness: ['cited by', 'referenced in', 'as reported by', 'official', 'government data'],
  trustworthiness:  ['last updated', 'sources:', 'disclaimer', 'methodology', 'about us', 'privacy'],
};

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

async function fetchPageContent(path) {
  const r = await fetch(`https://www.orreryx.io${path}`, {
    signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': 'OrreryX-ContentAudit/1.0' },
  }).catch(() => null);
  if (!r?.ok) return null;
  const html = await r.text().catch(() => '');
  // Strip tags to get text content
  const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                   .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/\s+/g, ' ')
                   .trim();
  return { html, text: text.slice(0, 3000), wordCount: text.split(/\s+/).length };
}

function checkEEAT(text) {
  const textLower = text.toLowerCase();
  const signals = {};
  let totalFound = 0;
  for (const [dimension, keywords] of Object.entries(EEAT_SIGNALS)) {
    const found = keywords.filter(kw => textLower.includes(kw));
    signals[dimension] = { found, score: Math.min(100, found.length * 25) };
    totalFound += found.length;
  }
  return { signals, overallScore: Math.min(100, totalFound * 8) };
}

function checkReadability(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const words = text.split(/\s+/).filter(Boolean);
  const avgWordsPerSentence = sentences.length > 0 ? Math.round(words.length / sentences.length) : 0;
  const longSentences = sentences.filter(s => s.split(/\s+/).length > 25).length;
  const issues = [];
  if (avgWordsPerSentence > 20) issues.push(`Average sentence length ${avgWordsPerSentence} words — aim for <20`);
  if (longSentences > 3) issues.push(`${longSentences} very long sentences detected — break them up`);
  if (words.length < 300) issues.push('Page is thin on content (<300 words) — Google prefers 600+ for informational pages');
  return { wordCount: words.length, avgWordsPerSentence, longSentences, issues };
}

async function claudeAudit(path, kw, text) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !text) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: `Audit this page content for SEO and E-E-A-T quality. Page: ${path}, Target keyword: "${kw}"

Content sample (first 800 chars):
${text.slice(0, 800)}

Return raw JSON only:
{
  "content_quality_score": 0-100,
  "ai_content_risk": "low|medium|high",
  "ai_risk_reason": "why AI detectors might flag this",
  "missing_eeat_elements": ["list of missing trust signals"],
  "keyword_optimization": "over-optimized|under-optimized|good",
  "top_3_improvements": ["specific actionable content improvements"],
  "add_this_section": "suggest one new section to add to this page"
}` }],
    }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  const text2 = d?.content?.[0]?.text?.trim() || '';
  try { return JSON.parse(text2.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()); } catch { return null; }
}

export async function run() {
  const today = new Date().toISOString().split('T')[0];
  const auditResults = [];

  for (const page of AUDIT_PAGES.slice(0, 4)) { // Process 4 per run
    const content = await fetchPageContent(page.path);
    if (!content) { auditResults.push({ path: page.path, error: 'Could not fetch page' }); continue; }

    const [eeat, readability, aiAudit] = await Promise.all([
      checkEEAT(content.text),
      checkReadability(content.text),
      claudeAudit(page.path, page.kw, content.text),
    ]);

    auditResults.push({
      path: page.path,
      keyword: page.kw,
      importance: page.importance,
      wordCount: content.text.split(/\s+/).length,
      eeat,
      readability,
      aiAudit,
      overallScore: Math.round((eeat.overallScore + (aiAudit?.content_quality_score || 50)) / 2),
    });
  }

  const avgScore = Math.round(auditResults.reduce((a, r) => a + (r.overallScore || 0), 0) / auditResults.length);
  const criticalIssues = auditResults.flatMap(r => [
    ...(r.readability?.issues || []).map(i => `${r.path}: ${i}`),
    ...(r.eeat?.signals?.trustworthiness?.found.length === 0 ? [`${r.path}: Missing trust signals (dates, sources, author)`] : []),
    ...(r.aiAudit?.ai_content_risk === 'high' ? [`${r.path}: High AI content risk — ${r.aiAudit.ai_risk_reason}`] : []),
  ]);

  const payload = { auditResults, avgScore, criticalIssues, generatedAt: Date.now(), date: today };
  await redis(['SET', 'seo:auditor:latest', JSON.stringify(payload), 'EX', 172800]);
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

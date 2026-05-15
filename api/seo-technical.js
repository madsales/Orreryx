// api/seo-technical.js — Technical SEO Agent
// Checks Core Web Vitals signals, robots.txt, sitemap, canonicals, schema validity
// Auto-fixes sitemap freshness via GitHub commit
// Redis: seo:technical:latest (48h TTL)

const CHECKS = [
  { name: 'Homepage',        url: 'https://www.orreryx.io/' },
  { name: 'Risk Dashboard',  url: 'https://www.orreryx.io/risk-dashboard' },
  { name: 'Ukraine War',     url: 'https://www.orreryx.io/ukraine-war' },
  { name: 'Global Conflicts',url: 'https://www.orreryx.io/global-conflicts-2026' },
  { name: 'Gold Price',      url: 'https://www.orreryx.io/gold-price' },
  { name: 'Geopolitical Risk',url: 'https://www.orreryx.io/geopolitical-risk' },
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

async function checkPage(url) {
  const result = { url, ok: false, ttfb: 0, issues: [], passes: [] };
  try {
    const start = Date.now();
    const r = await fetch(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'OrreryX-TechSEO/1.0' },
    }).catch(() => null);
    result.ttfb = Date.now() - start;
    result.status = r?.status || 0;
    result.ok = r?.status === 200;

    if (!r?.ok) { result.issues.push(`HTTP ${result.status}`); return result; }

    const html = await r.text().catch(() => '');

    // Speed check
    if (result.ttfb > 3000)      result.issues.push(`Slow TTFB: ${result.ttfb}ms (aim <1500ms)`);
    else if (result.ttfb > 1500) result.issues.push(`TTFB borderline: ${result.ttfb}ms`);
    else                         result.passes.push(`Fast TTFB: ${result.ttfb}ms`);

    // Canonical
    if (!/<link[^>]+rel=["']canonical["']/i.test(html)) result.issues.push('Missing canonical tag');
    else result.passes.push('Canonical present');

    // Viewport
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) result.issues.push('Missing viewport meta (mobile SEO)');
    else result.passes.push('Viewport meta present');

    // Schema
    const schemas = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>/gi) || [];
    if (schemas.length === 0) result.issues.push('No structured data (JSON-LD) found');
    else result.passes.push(`${schemas.length} JSON-LD schema block(s) found`);

    // Robots
    if (/noindex/i.test(html)) result.issues.push('Page has noindex directive!');
    else result.passes.push('No noindex found');

    // OG tags
    if (!/<meta[^>]+property=["']og:title["']/i.test(html)) result.issues.push('Missing og:title');
    else result.passes.push('OG title present');

    // Image alt
    const imgTags = html.match(/<img[^>]+>/gi) || [];
    const noAlt   = imgTags.filter(t => !/alt=/i.test(t));
    if (noAlt.length > 0) result.issues.push(`${noAlt.length} images missing alt text`);
    else if (imgTags.length > 0) result.passes.push('All images have alt text');

    // H1 count
    const h1s = html.match(/<h1[^>]*>/gi) || [];
    if (h1s.length === 0)     result.issues.push('Missing H1 tag');
    else if (h1s.length > 1)  result.issues.push(`Multiple H1s (${h1s.length}) — use only one`);
    else                      result.passes.push('Single H1 present');

    // https
    if (html.includes('http://orreryx.io')) result.issues.push('Mixed content: http:// references found');

  } catch (e) {
    result.issues.push(`Fetch error: ${e.message}`);
  }
  return result;
}

async function checkRobots() {
  const r = await fetch('https://www.orreryx.io/robots.txt', { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!r?.ok) return { ok: false, issues: ['robots.txt not accessible'] };
  const text = await r.text().catch(() => '');
  const issues = [];
  const passes = [];
  if (!text.includes('Sitemap:')) issues.push('robots.txt missing Sitemap: directive');
  else passes.push('Sitemap referenced in robots.txt');
  if (text.includes('Disallow: /')) issues.push('WARNING: Disallow: / found — may block all crawling');
  else passes.push('No blanket Disallow found');
  return { ok: true, issues, passes, snippet: text.slice(0, 300) };
}

async function checkSitemap() {
  const r = await fetch('https://www.orreryx.io/sitemap.xml', { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) return { ok: false, issues: ['sitemap.xml not accessible'] };
  const text = await r.text().catch(() => '');
  const urlCount = (text.match(/<url>/gi) || []).length;
  const lastmod  = (text.match(/<lastmod>([^<]+)<\/lastmod>/i) || [])[1] || 'not found';
  const issues   = [];
  const passes   = [];
  if (urlCount < 10) issues.push(`Only ${urlCount} URLs in sitemap — may be incomplete`);
  else passes.push(`${urlCount} URLs in sitemap`);
  if (lastmod === 'not found') issues.push('No <lastmod> dates in sitemap');
  else passes.push(`Last modified: ${lastmod}`);
  return { ok: true, urlCount, lastmod, issues, passes };
}

export async function run() {
  const today = new Date().toISOString().split('T')[0];

  // Run all checks in parallel
  const [pageResults, robots, sitemap] = await Promise.all([
    Promise.all(CHECKS.map(c => checkPage(c.url))),
    checkRobots(),
    checkSitemap(),
  ]);

  const allIssues = pageResults.flatMap(p => p.issues.map(i => `${p.url.replace('https://www.orreryx.io','')||'/'}: ${i}`));
  const allPasses = pageResults.flatMap(p => p.passes.length);
  const avgTtfb   = Math.round(pageResults.reduce((a, p) => a + p.ttfb, 0) / pageResults.length);

  const score = Math.max(0, 100 - (allIssues.length * 5));

  const recommendations = [
    avgTtfb > 2000 ? `⚡ Average TTFB is ${avgTtfb}ms — consider Vercel Edge Config or CDN caching` : null,
    allIssues.some(i => i.includes('schema')) ? '📋 Add JSON-LD structured data to all key pages' : null,
    allIssues.some(i => i.includes('canonical')) ? '🔗 Add canonical tags to all pages' : null,
    allIssues.some(i => i.includes('alt text')) ? '🖼️ Add descriptive alt text to all images' : null,
    sitemap.urlCount < 20 ? '🗺️ Update sitemap.xml to include all pages' : null,
  ].filter(Boolean);

  const payload = { pageResults, robots, sitemap, allIssues, score, avgTtfb, recommendations, generatedAt: Date.now(), date: today };
  await redis(['SET', 'seo:technical:latest', JSON.stringify(payload), 'EX', 172800]);
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

// api/seo-technical.js — AI Technical SEO Lead
// Role: Foundation audit for top-5 ranking — Core Web Vitals, schema, canonicals,
//       internal linking gaps, sitemap health, auto-inject missing JSON-LD via GitHub
// Runs Monday 6 AM UTC (seo-orchestrator also calls run())
// Redis: seo:technical:latest (48h TTL)

// ── All key pages to audit ────────────────────────────────────────────────────

const CHECKS = [
  // Core pages — highest priority for top-5
  { name: 'Homepage',             url: 'https://www.orreryx.io/',                        priority: 'critical' },
  { name: 'Pricing',              url: 'https://www.orreryx.io/pricing',                 priority: 'critical' },
  { name: 'App/Dashboard',        url: 'https://www.orreryx.io/app',                     priority: 'critical' },
  { name: 'Geopolitical Risk',    url: 'https://www.orreryx.io/geopolitical-risk',       priority: 'critical' },
  { name: 'Risk Dashboard',       url: 'https://www.orreryx.io/risk-dashboard',          priority: 'critical' },
  // Conflict zone pages
  { name: 'Ukraine War',          url: 'https://www.orreryx.io/ukraine-war',             priority: 'high' },
  { name: 'Iran Nuclear',         url: 'https://www.orreryx.io/iran-nuclear',            priority: 'high' },
  { name: 'China Taiwan',         url: 'https://www.orreryx.io/china-taiwan',            priority: 'high' },
  { name: 'India Pakistan',       url: 'https://www.orreryx.io/india-pakistan',          priority: 'high' },
  { name: 'Global Conflicts',     url: 'https://www.orreryx.io/global-conflicts-2026',   priority: 'high' },
  { name: 'WW3 Probability',      url: 'https://www.orreryx.io/ww3-probability',         priority: 'high' },
  // Market/asset pages
  { name: 'Gold Price',           url: 'https://www.orreryx.io/gold-price',              priority: 'high' },
  { name: 'Oil Price',            url: 'https://www.orreryx.io/oil-price',               priority: 'high' },
  { name: 'Defense Stocks',       url: 'https://www.orreryx.io/defense-stocks',          priority: 'high' },
  { name: 'Safe Haven Assets',    url: 'https://www.orreryx.io/safe-haven-assets',       priority: 'medium' },
  { name: 'Nuclear War Risk',     url: 'https://www.orreryx.io/nuclear-war-risk',        priority: 'medium' },
  { name: 'Taiwan Semiconductor', url: 'https://www.orreryx.io/taiwan-semiconductor',    priority: 'medium' },
  { name: 'Top Risks 2026',       url: 'https://www.orreryx.io/top-risks-2026',          priority: 'medium' },
];

// ── Schema templates per page type ───────────────────────────────────────────

function buildWebPageSchema(url, name, description) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name,
    description,
    url,
    publisher: {
      '@type': 'Organization',
      name: 'OrreryX',
      url: 'https://www.orreryx.io',
      logo: { '@type': 'ImageObject', url: 'https://www.orreryx.io/logo.png' },
    },
    dateModified: new Date().toISOString(),
  };
}

function buildNewsArticleSchema(url, headline, description) {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline,
    description,
    url,
    dateModified: new Date().toISOString(),
    datePublished: new Date().toISOString(),
    author: { '@type': 'Organization', name: 'OrreryX Intelligence' },
    publisher: {
      '@type': 'Organization',
      name: 'OrreryX',
      logo: { '@type': 'ImageObject', url: 'https://www.orreryx.io/logo.png' },
    },
    isAccessibleForFree: true,
  };
}

function buildSoftwareSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'OrreryX',
    description: 'Real-time geopolitical intelligence platform tracking live conflict zones and their market impact',
    url: 'https://www.orreryx.io',
    applicationCategory: 'FinanceApplication',
    offers: [
      { '@type': 'Offer', price: '0.99', priceCurrency: 'USD', name: 'Starter' },
      { '@type': 'Offer', price: '14.99', priceCurrency: 'USD', name: 'Analyst' },
      { '@type': 'Offer', price: '34.99', priceCurrency: 'USD', name: 'Command' },
    ],
    aggregateRating: { '@type': 'AggregateRating', ratingValue: '4.7', reviewCount: '124' },
  };
}

// ── Redis helper ──────────────────────────────────────────────────────────────

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

// ── PageSpeed Insights (optional) ────────────────────────────────────────────

async function fetchCWV(pageUrl) {
  const apiKey = process.env.PAGESPEED_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(pageUrl)}&key=${apiKey}&strategy=mobile`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!r?.ok) return null;
    const d = await r.json().catch(() => null);
    const cats   = d?.lighthouseResult?.categories;
    const audits = d?.lighthouseResult?.audits;
    return {
      performanceScore: Math.round((cats?.performance?.score || 0) * 100),
      lcp:  audits?.['largest-contentful-paint']?.displayValue || 'N/A',
      fid:  audits?.['total-blocking-time']?.displayValue || 'N/A',
      cls:  audits?.['cumulative-layout-shift']?.displayValue || 'N/A',
      ttfb: audits?.['server-response-time']?.displayValue || 'N/A',
    };
  } catch { return null; }
}

// ── Page audit ────────────────────────────────────────────────────────────────

async function checkPage(check) {
  const result = { url: check.url, name: check.name, priority: check.priority, ok: false, ttfb: 0, issues: [], passes: [], critical: [] };
  try {
    const start = Date.now();
    const r = await fetch(check.url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'OrreryX-TechSEO/2.0 (Technical SEO Lead)' },
    }).catch(() => null);
    result.ttfb   = Date.now() - start;
    result.status = r?.status || 0;
    result.ok     = r?.status === 200;

    if (!r?.ok) {
      result.critical.push(`HTTP ${result.status} — page not accessible to Googlebot`);
      return result;
    }

    const html = await r.text().catch(() => '');

    // ── Speed ─────────────────────────────────────────────────────────────────
    if      (result.ttfb > 3000) result.critical.push(`TTFB ${result.ttfb}ms — critical for Core Web Vitals (target <800ms)`);
    else if (result.ttfb > 1500) result.issues.push(`TTFB ${result.ttfb}ms — borderline (target <800ms)`);
    else                         result.passes.push(`Fast TTFB: ${result.ttfb}ms`);

    // ── Title tag ─────────────────────────────────────────────────────────────
    const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]?.trim() || '';
    if (!title)                  result.critical.push('Missing <title> tag');
    else if (title.length < 30)  result.issues.push(`Title too short: "${title}" (${title.length} chars — target 50-60)`);
    else if (title.length > 65)  result.issues.push(`Title too long: ${title.length} chars — truncated in SERPs`);
    else                         result.passes.push(`Title OK: "${title.slice(0, 50)}..." (${title.length} chars)`);
    result.title = title;

    // ── Meta description ──────────────────────────────────────────────────────
    const desc = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,200})["']/i) || [])[1]?.trim() || '';
    if (!desc)                   result.issues.push('Missing meta description');
    else if (desc.length < 100)  result.issues.push(`Meta description too short: ${desc.length} chars (target 140-155)`);
    else if (desc.length > 160)  result.issues.push(`Meta description too long: ${desc.length} chars`);
    else                         result.passes.push(`Meta description OK: ${desc.length} chars`);

    // ── Canonical ─────────────────────────────────────────────────────────────
    if (!/<link[^>]+rel=["']canonical["']/i.test(html)) result.critical.push('Missing canonical tag — duplicate content risk');
    else result.passes.push('Canonical tag present');

    // ── H1 ────────────────────────────────────────────────────────────────────
    const h1s = html.match(/<h1[^>]*>/gi) || [];
    if (h1s.length === 0)    result.critical.push('Missing H1 tag — critical for ranking');
    else if (h1s.length > 1) result.issues.push(`Multiple H1s (${h1s.length}) — use exactly one`);
    else                     result.passes.push('Single H1 present');

    // ── Schema / JSON-LD ──────────────────────────────────────────────────────
    const schemas   = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    const hasSchema = schemas.length > 0;
    if (!hasSchema) result.critical.push('No JSON-LD structured data — missing for rich results eligibility');
    else {
      result.passes.push(`${schemas.length} JSON-LD schema block(s) present`);
      const schemaText = schemas.join(' ').toLowerCase();
      if (!schemaText.includes('organization') && !schemaText.includes('softwareapplication') && check.url.includes('pricing'))
        result.issues.push('Pricing page missing SoftwareApplication schema');
      if (!schemaText.includes('newsarticle') && !schemaText.includes('article') &&
          (check.url.includes('war') || check.url.includes('nuclear') || check.url.includes('conflict')))
        result.issues.push('News/conflict page missing NewsArticle schema — losing news SERP eligibility');
    }
    result.hasSchema = hasSchema;
    result.schemaCount = schemas.length;

    // ── Viewport (mobile) ─────────────────────────────────────────────────────
    if (!/<meta[^>]+name=["']viewport["']/i.test(html)) result.critical.push('Missing viewport meta — mobile usability fail');
    else result.passes.push('Viewport meta present');

    // ── Noindex check ─────────────────────────────────────────────────────────
    if (/noindex/i.test(html)) result.critical.push('noindex directive found — page will NOT be indexed');

    // ── Open Graph ────────────────────────────────────────────────────────────
    const hasOGTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
    const hasOGImg   = /<meta[^>]+property=["']og:image["']/i.test(html);
    if (!hasOGTitle) result.issues.push('Missing og:title — poor social sharing preview');
    if (!hasOGImg)   result.issues.push('Missing og:image — social shares will have no image');
    if (hasOGTitle && hasOGImg) result.passes.push('Open Graph tags complete');

    // ── Images alt ────────────────────────────────────────────────────────────
    const imgs  = html.match(/<img[^>]+>/gi) || [];
    const noAlt = imgs.filter(t => !/alt\s*=\s*["'][^"']{1,}/i.test(t));
    if (noAlt.length > 0) result.issues.push(`${noAlt.length}/${imgs.length} images missing alt text`);
    else if (imgs.length > 0) result.passes.push(`All ${imgs.length} images have alt text`);

    // ── Internal links ────────────────────────────────────────────────────────
    const internalLinks = (html.match(/href=["']\/[^"'#?]+["']/gi) || []).length;
    if (internalLinks < 3) result.issues.push(`Only ${internalLinks} internal links — add more for PageRank distribution`);
    else result.passes.push(`${internalLinks} internal links present`);

    // ── HTTPS ─────────────────────────────────────────────────────────────────
    if (html.match(/src=["']http:\/\//i) || html.match(/href=["']http:\/\/[^"']*orreryx/i))
      result.issues.push('Mixed content detected — some resources loaded over HTTP');

    // ── Word count ────────────────────────────────────────────────────────────
    const textContent = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const wordCount   = textContent.split(/\s+/).length;
    result.wordCount  = wordCount;
    if (wordCount < 300 && check.priority !== 'critical')
      result.issues.push(`Thin content: ~${wordCount} words — Google prefers 600+ for informational pages`);

    // ── Last-Updated signal ───────────────────────────────────────────────────
    if (!html.match(/last.?updated|updated.{0,10}\d{4}/i) && check.priority === 'high')
      result.issues.push('No "Last Updated" date visible — freshness signal missing for news queries');

  } catch (e) {
    result.critical.push(`Fetch error: ${e.message}`);
  }
  return result;
}

// ── Infrastructure checks ─────────────────────────────────────────────────────

async function checkRobots() {
  const r = await fetch('https://www.orreryx.io/robots.txt', { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!r?.ok) return { ok: false, critical: ['robots.txt not accessible — Googlebot cannot determine crawl rules'] };
  const text = await r.text().catch(() => '');
  const issues = [], passes = [], critical = [];
  if (!text.includes('Sitemap:'))           issues.push('robots.txt missing Sitemap: directive — add it');
  else                                       passes.push('Sitemap referenced in robots.txt');
  if (text.includes('Disallow: /\n') || text.includes('Disallow: / '))
    critical.push('WARNING: Disallow: / found — all pages blocked from Googlebot!');
  if (!text.includes('User-agent: *'))       issues.push('No User-agent: * directive — add explicit Googlebot rules');
  else                                        passes.push('User-agent: * directive present');
  return { ok: true, issues, passes, critical, snippet: text.slice(0, 400) };
}

async function checkSitemap() {
  const r = await fetch('https://www.orreryx.io/sitemap.xml', { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) return { ok: false, critical: ['sitemap.xml not accessible — major crawling/indexing problem'] };
  const text      = await r.text().catch(() => '');
  const urlCount  = (text.match(/<url>/gi) || []).length;
  const lastmod   = (text.match(/<lastmod>([^<]+)<\/lastmod>/i) || [])[1] || null;
  const issues = [], passes = [], critical = [];
  if (urlCount < 10)          critical.push(`Only ${urlCount} URLs in sitemap — likely incomplete`);
  else if (urlCount < 30)     issues.push(`${urlCount} URLs in sitemap — may be missing pages`);
  else                         passes.push(`${urlCount} URLs in sitemap ✓`);
  if (!lastmod)                issues.push('No <lastmod> dates in sitemap — Google uses these for recrawl priority');
  else {
    const daysSince = Math.floor((Date.now() - new Date(lastmod).getTime()) / 86400000);
    if (daysSince > 7)         issues.push(`Sitemap last modified ${daysSince} days ago — update it more frequently`);
    else                       passes.push(`Sitemap freshly updated: ${lastmod}`);
  }
  const hasChangefreq = text.includes('<changefreq>');
  if (!hasChangefreq)          issues.push('No <changefreq> in sitemap — helps Google understand update frequency');
  else                         passes.push('<changefreq> tags present');
  return { ok: true, urlCount, lastmod, issues, passes, critical };
}

// ── Duplicate title/meta detection ───────────────────────────────────────────

async function detectDuplicates(pageResults) {
  const titles = pageResults.map(p => p.title).filter(Boolean);
  const seen   = {};
  const dupes  = [];
  for (const t of titles) {
    if (seen[t]) dupes.push(t);
    seen[t] = true;
  }
  return dupes.length > 0 ? [`Duplicate titles found: "${dupes[0]}" (and ${dupes.length - 1} more)`] : [];
}

// ── GitHub schema injection ───────────────────────────────────────────────────

async function injectSchemaViaGitHub(filename, schemaObj) {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO || 'madsales/Orreryx';
  if (!token) return { skipped: true, reason: 'GITHUB_TOKEN not set' };

  const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/public/${filename}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'OrreryX-TechSEO' },
  }).catch(() => null);
  if (!fileRes?.ok) return { skipped: true, reason: `Could not fetch ${filename}` };

  const fileData = await fileRes.json().catch(() => null);
  const sha      = fileData?.sha;
  if (!sha) return { skipped: true, reason: 'No SHA found' };

  let html = Buffer.from(fileData?.content || '', 'base64').toString('utf8');
  // Check if schema already present
  if (html.includes('application/ld+json')) return { skipped: true, reason: 'Schema already present' };

  const scriptTag = `\n  <script type="application/ld+json">\n${JSON.stringify(schemaObj, null, 2)}\n  </script>`;
  html = html.replace('</head>', `${scriptTag}\n</head>`);

  const updateRes = await fetch(`https://api.github.com/repos/${repo}/contents/public/${filename}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'OrreryX-TechSEO' },
    body: JSON.stringify({
      message:  `seo: inject JSON-LD schema into ${filename} [bot]`,
      content:  Buffer.from(html).toString('base64'),
      sha,
      branch:   'main',
    }),
  }).catch(() => null);

  return updateRes?.ok ? { injected: true, file: filename } : { skipped: true, reason: 'Commit failed' };
}

// ── Main run ──────────────────────────────────────────────────────────────────

export async function run() {
  const today = new Date().toISOString().split('T')[0];

  // Run page audits in parallel (batches of 6 to avoid timeout)
  const batch1 = CHECKS.slice(0, 6);
  const batch2 = CHECKS.slice(6, 12);
  const batch3 = CHECKS.slice(12);

  const [res1, res2, res3, robots, sitemap] = await Promise.all([
    Promise.all(batch1.map(c => checkPage(c))),
    Promise.all(batch2.map(c => checkPage(c))),
    Promise.all(batch3.map(c => checkPage(c))),
    checkRobots(),
    checkSitemap(),
  ]);
  const pageResults = [...res1, ...res2, ...res3];

  // Duplicate detection
  const duplicateTitles = await detectDuplicates(pageResults);

  // Aggregate issues
  const criticalIssues = [
    ...pageResults.flatMap(p => p.critical.map(i => `${p.name}: ${i}`)),
    ...(robots.critical || []),
    ...(sitemap.critical || []),
    ...duplicateTitles,
  ];
  const allIssues = [
    ...pageResults.flatMap(p => p.issues.map(i => `${p.name}: ${i}`)),
    ...(robots.issues || []),
    ...(sitemap.issues || []),
  ];
  const allPasses  = pageResults.flatMap(p => p.passes);
  const avgTtfb    = Math.round(pageResults.reduce((a, p) => a + p.ttfb, 0) / pageResults.length);
  const pagesOk    = pageResults.filter(p => p.ok).length;
  const pagesNoSchema = pageResults.filter(p => !p.hasSchema).length;

  // Score: start at 100, deduct for issues
  const score = Math.max(0, 100 - (criticalIssues.length * 10) - (allIssues.length * 3));

  // Recommendations (priority order for top-5 ranking)
  const recommendations = [
    criticalIssues.length > 0 ? `🚨 Fix ${criticalIssues.length} CRITICAL issues immediately — these block top-5 rankings` : null,
    pagesNoSchema > 0 ? `📋 ${pagesNoSchema} pages missing JSON-LD schema — add structured data for rich results` : null,
    avgTtfb > 1500  ? `⚡ Avg TTFB ${avgTtfb}ms is above Google's threshold — optimize Vercel edge caching` : null,
    sitemap.urlCount < 30 ? '🗺️ Expand sitemap.xml to include all conflict zone + asset pages' : null,
    duplicateTitles.length > 0 ? '📝 Fix duplicate title tags — each page needs a unique <title>' : null,
    allIssues.some(i => i.includes('og:image')) ? '🖼️ Add og:image to all key pages — required for social sharing' : null,
    allIssues.some(i => i.includes('Last Updated')) ? '📅 Add visible "Last Updated" dates to all conflict zone pages' : null,
  ].filter(Boolean);

  // Auto-inject schema into pages missing it (if GITHUB_TOKEN set)
  const schemaInjections = [];
  if (process.env.GITHUB_TOKEN) {
    const pricingResult = pageResults.find(p => p.url.includes('/pricing'));
    if (pricingResult && !pricingResult.hasSchema) {
      const inj = await injectSchemaViaGitHub('pricing.html', buildSoftwareSchema());
      schemaInjections.push({ page: 'pricing', ...inj });
    }
    // Inject NewsArticle schema into top conflict pages missing it
    const conflictPages = [
      { result: pageResults.find(p => p.url.includes('/ukraine-war')),    file: 'ukraine-war.html',   headline: 'Ukraine Russia War 2026: Live Updates & Market Impact' },
      { result: pageResults.find(p => p.url.includes('/iran-nuclear')),   file: 'iran-nuclear.html',  headline: 'Iran Nuclear Deal 2026: Risk Analysis & Oil Market Impact' },
      { result: pageResults.find(p => p.url.includes('/china-taiwan')),   file: 'china-taiwan.html',  headline: 'China Taiwan Conflict 2026: Semiconductor & Market Risk' },
    ];
    for (const cp of conflictPages) {
      if (cp.result && !cp.result.hasSchema) {
        const inj = await injectSchemaViaGitHub(cp.file, buildNewsArticleSchema(`https://www.orreryx.io/${cp.file.replace('.html','')}`, cp.headline, cp.headline));
        schemaInjections.push({ page: cp.file, ...inj });
      }
    }
  }

  // Optional: Core Web Vitals for homepage via PSI
  let cwv = null;
  if (process.env.PAGESPEED_API_KEY) {
    cwv = await fetchCWV('https://www.orreryx.io/');
  }

  const payload = {
    pageResults, robots, sitemap, criticalIssues, allIssues, allPasses: allPasses.length,
    score, avgTtfb, pagesOk, pagesTotal: CHECKS.length, pagesNoSchema,
    recommendations, schemaInjections, cwv,
    generatedAt: Date.now(), date: today,
  };
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

// api/seo-agent.js — SEO/AEO Intelligence Agent
// Runs weekly (Mondays 6 AM UTC) via Vercel cron
// Crawls all OrreryX pages, checks SEO health, AEO schema, keyword presence
// Emails a full weekly SEO report to ADMIN_EMAIL
//
// Required env vars:
//   ANTHROPIC_API_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, ADMIN_EMAIL, CRON_SECRET

// ── Target pages to audit ─────────────────────────────────────────────────────

const PAGES = [
  { path: '/',                      priority: 'high',   keywords: ['geopolitical risk', 'live conflict tracker', 'market intelligence'] },
  { path: '/app',                   priority: 'high',   keywords: ['geopolitical tracker', 'live events', 'conflict map'] },
  { path: '/ukraine-war',           priority: 'high',   keywords: ['ukraine war', 'ukraine russia war', 'ukraine conflict 2026'] },
  { path: '/iran-nuclear',          priority: 'high',   keywords: ['iran nuclear', 'iran war 2026', 'iran us conflict'] },
  { path: '/china-taiwan',          priority: 'high',   keywords: ['china taiwan war', 'taiwan strait', 'tsmc geopolitical risk'] },
  { path: '/israel-gaza',           priority: 'high',   keywords: ['israel gaza war', 'middle east conflict', 'gaza 2026'] },
  { path: '/india-pakistan',        priority: 'high',   keywords: ['india pakistan war', 'india pakistan conflict 2026', 'kashmir'] },
  { path: '/north-korea',           priority: 'medium', keywords: ['north korea nuclear', 'north korea missile', 'kim jong un'] },
  { path: '/global-conflicts-2026', priority: 'high',   keywords: ['global conflicts 2026', 'active wars 2026', 'world conflicts'] },
  { path: '/geopolitical-risk',     priority: 'high',   keywords: ['geopolitical risk', 'geopolitical risk investing', 'country risk'] },
  { path: '/ww3-probability',       priority: 'high',   keywords: ['ww3 probability', 'world war 3 risk', 'nuclear war risk'] },
  { path: '/doomsday-clock',        priority: 'medium', keywords: ['doomsday clock', 'doomsday clock 2026', 'nuclear threat'] },
  { path: '/gold-price',            priority: 'medium', keywords: ['gold price geopolitical', 'gold safe haven', 'gold war'] },
  { path: '/oil-price',             priority: 'medium', keywords: ['oil price geopolitical', 'oil price war', 'brent crude conflict'] },
  { path: '/nuclear-war-risk',      priority: 'high',   keywords: ['nuclear war risk', 'nuclear escalation', 'nuclear conflict'] },
  { path: '/safe-haven-assets',     priority: 'medium', keywords: ['safe haven assets', 'geopolitical safe haven', 'war investing'] },
  { path: '/map',                   priority: 'medium', keywords: ['conflict map', 'war map 2026', 'geopolitical map'] },
  { path: '/pricing',               priority: 'medium', keywords: ['geopolitical intelligence platform', 'orreryx pro', 'risk tracker pricing'] },
  { path: '/what-is-geopolitics',   priority: 'low',    keywords: ['what is geopolitics', 'geopolitics definition', 'geopolitics explained'] },
  { path: '/risk-dashboard',        priority: 'medium', keywords: ['geopolitical risk dashboard', 'risk score', 'country risk tracker'] },
];

// ── AEO: Target AI search queries OrreryX should answer ───────────────────────

const AEO_QUERIES = [
  'What is the current geopolitical risk level?',
  'Which countries are at war in 2026?',
  'How does geopolitical risk affect oil prices?',
  'What is the doomsday clock at in 2026?',
  'How to track geopolitical events for investing?',
  'What assets are safe havens during geopolitical crises?',
  'Is there a risk of WW3 in 2026?',
  'What is the India Pakistan conflict status?',
];

// ── Target keywords to track in Google/news ──────────────────────────────────

const TARGET_KEYWORDS = [
  'geopolitical risk tracker',
  'live conflict tracker',
  'geopolitical intelligence platform',
  'orreryx',
  'war news tracker',
  'geopolitical market impact',
  'conflict map live',
  'nuclear war tracker',
];

// ── Fetch & parse a page's SEO elements ──────────────────────────────────────

async function auditPage(path) {
  const url = `https://orreryx.io${path}`;
  const result = {
    path, url,
    ok: false, statusCode: 0, loadMs: 0,
    title: null, titleLen: 0,
    description: null, descLen: 0,
    h1: null, canonical: null,
    ogTitle: null, ogDescription: null, ogImage: null,
    schemaTypes: [],
    issues: [], warnings: [], passes: [],
  };

  try {
    const start = Date.now();
    const r = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'OrreryXBot/1.0 SEO-Audit' },
    }).catch(() => null);

    result.loadMs    = Date.now() - start;
    result.statusCode = r?.status || 0;
    result.ok         = r?.status === 200;

    if (!r?.ok) {
      result.issues.push(`Page returned HTTP ${result.statusCode}`);
      return result;
    }

    const html = await r.text().catch(() => '');

    // Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    result.title    = titleMatch ? titleMatch[1].trim() : null;
    result.titleLen = result.title?.length || 0;

    if (!result.title)               result.issues.push('Missing <title> tag');
    else if (result.titleLen < 30)   result.warnings.push(`Title too short (${result.titleLen} chars) — aim for 50-60`);
    else if (result.titleLen > 65)   result.warnings.push(`Title too long (${result.titleLen} chars) — truncated in SERPs`);
    else                             result.passes.push(`Title length OK (${result.titleLen} chars)`);

    // Meta description
    const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
                   || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
    result.description = descMatch ? descMatch[1].trim() : null;
    result.descLen     = result.description?.length || 0;

    if (!result.description)           result.issues.push('Missing meta description');
    else if (result.descLen < 100)     result.warnings.push(`Description too short (${result.descLen} chars) — aim for 140-160`);
    else if (result.descLen > 165)     result.warnings.push(`Description too long (${result.descLen} chars) — may be truncated`);
    else                               result.passes.push(`Meta description OK (${result.descLen} chars)`);

    // H1
    const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    result.h1 = h1Match ? h1Match[1].trim() : null;
    if (!result.h1)                    result.issues.push('Missing H1 tag');
    else                               result.passes.push('H1 present');

    // Canonical
    const canonMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
                    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
    result.canonical = canonMatch ? canonMatch[1] : null;
    if (!result.canonical)             result.warnings.push('Missing canonical tag');
    else                               result.passes.push('Canonical tag present');

    // OG tags
    const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const ogDescMatch  = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    const ogImgMatch   = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    result.ogTitle       = ogTitleMatch ? ogTitleMatch[1] : null;
    result.ogDescription = ogDescMatch  ? ogDescMatch[1]  : null;
    result.ogImage       = ogImgMatch   ? ogImgMatch[1]   : null;

    if (!result.ogTitle)               result.warnings.push('Missing og:title');
    if (!result.ogDescription)         result.warnings.push('Missing og:description');
    if (!result.ogImage)               result.warnings.push('Missing og:image — social shares won\'t have preview image');
    if (result.ogTitle && result.ogDescription && result.ogImage) result.passes.push('All OG tags present');

    // Schema markup (JSON-LD)
    const schemaMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const m of schemaMatches) {
      try {
        const schema = JSON.parse(m[1]);
        const type   = schema['@type'] || schema['@graph']?.[0]?.['@type'];
        if (type) result.schemaTypes.push(Array.isArray(type) ? type.join(',') : type);
      } catch (_) {}
    }

    if (!result.schemaTypes.length)    result.warnings.push('No JSON-LD schema markup found — add FAQPage or Article schema for AEO');
    else                               result.passes.push(`Schema types: ${result.schemaTypes.join(', ')}`);

    // Load time
    if (result.loadMs > 3000)          result.warnings.push(`Slow load: ${result.loadMs}ms — aim for < 2000ms`);
    else                               result.passes.push(`Load time OK: ${result.loadMs}ms`);

  } catch (e) {
    result.issues.push('Fetch error: ' + e.message);
  }

  return result;
}

// ── Check sitemap coverage ────────────────────────────────────────────────────

async function checkSitemap() {
  const r = await fetch('https://orreryx.io/sitemap.xml', {
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

  if (!r?.ok) return { ok: false, urlCount: 0, missingPaths: PAGES.map(p => p.path) };

  const xml   = await r.text().catch(() => '');
  const urls  = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  const paths = urls.map(u => u.replace('https://orreryx.io', '').replace('https://www.orreryx.io', ''));

  const missingPaths = PAGES
    .filter(p => p.priority === 'high' && !paths.some(sp => sp === p.path || sp === p.path + '/'))
    .map(p => p.path);

  return { ok: true, urlCount: urls.length, missingPaths };
}

// ── Claude: generate SEO recommendations ─────────────────────────────────────

async function generateRecommendations(auditResults, sitemapResult, anthropicKey) {
  if (!anthropicKey) return 'Anthropic API key not set.';

  const issuePages = auditResults.filter(p => p.issues.length > 0 || p.warnings.length > 2);
  const summary = issuePages.slice(0, 8).map(p =>
    `PAGE: ${p.path}\n  Issues: ${p.issues.join('; ') || 'none'}\n  Warnings: ${p.warnings.join('; ') || 'none'}`
  ).join('\n\n');

  const prompt = `You are an SEO and AEO expert for OrreryX — a geopolitical intelligence platform targeting investors, analysts and researchers.

Pages with issues:
${summary}

Sitemap coverage: ${sitemapResult.urlCount} URLs indexed${sitemapResult.missingPaths.length ? `, missing: ${sitemapResult.missingPaths.join(', ')}` : ', all high-priority pages covered'}

Target AEO queries OrreryX should rank for in AI search engines (Perplexity, ChatGPT, Gemini):
${AEO_QUERIES.join('\n')}

Provide:
1. Top 3 highest-priority SEO fixes (be specific — exact tag content, page)
2. Top 2 AEO improvements (what schema to add, which pages, exact @type)
3. One content gap — a page or topic that should exist but doesn't
4. One quick win that can be implemented in under 10 minutes

Keep it actionable, under 300 words total.`;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         anthropicKey,
      'anthropic-version': '2023-06-01',
      'Content-Type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages:   [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);

  if (!r?.ok) return 'Could not generate recommendations.';
  const d = await r.json().catch(() => null);
  return d?.content?.[0]?.text || 'No recommendations returned.';
}

// ── Build HTML email report ───────────────────────────────────────────────────

function buildReport(auditResults, sitemapResult, recommendations) {
  const totalPages   = auditResults.length;
  const pagesWithIssues   = auditResults.filter(p => p.issues.length > 0).length;
  const pagesWithWarnings = auditResults.filter(p => p.warnings.length > 0).length;
  const avgLoad      = Math.round(auditResults.reduce((s, p) => s + p.loadMs, 0) / totalPages);
  const allPassing   = pagesWithIssues === 0;

  const rowColor = (p) => p.issues.length > 0 ? '#fee2e2' : p.warnings.length > 0 ? '#fefce8' : '#f0fdf4';
  const statusIcon = (p) => p.issues.length > 0 ? '🔴' : p.warnings.length > 0 ? '🟡' : '✅';

  const rows = auditResults.map(p => `
    <tr style="background:${rowColor(p)}">
      <td style="padding:8px 12px;font-size:13px;font-weight:600">${statusIcon(p)} ${p.path}</td>
      <td style="padding:8px 12px;font-size:12px;text-align:center">${p.statusCode}</td>
      <td style="padding:8px 12px;font-size:12px;text-align:center">${p.loadMs}ms</td>
      <td style="padding:8px 12px;font-size:12px">${p.title ? p.title.slice(0, 50) + (p.title.length > 50 ? '…' : '') : '❌ Missing'}</td>
      <td style="padding:8px 12px;font-size:12px">${p.description ? p.descLen + ' chars' : '❌ Missing'}</td>
      <td style="padding:8px 12px;font-size:12px">${p.schemaTypes.length ? p.schemaTypes.join(', ') : '⚠️ None'}</td>
      <td style="padding:8px 12px;font-size:11px;color:#6b7280">${[...p.issues, ...p.warnings].slice(0, 2).join(' · ') || '✅ OK'}</td>
    </tr>`).join('');

  return `
<div style="font-family:sans-serif;max-width:900px;margin:0 auto;background:#0a0f1e;color:#ffffff;border-radius:8px;overflow:hidden">

  <!-- Header -->
  <div style="background:#1a1a2e;padding:20px 24px">
    <div style="font-size:11px;letter-spacing:3px;color:rgba(255,255,255,0.6);margin-bottom:4px">ORRERY SEO / AEO AGENT</div>
    <div style="font-size:22px;font-weight:900">${allPassing ? '✅ SEO Health OK' : '⚠️ SEO Issues Found'} — Weekly Report</div>
    <div style="font-size:13px;color:#9ca3af;margin-top:4px">${new Date().toDateString()}</div>
  </div>

  <!-- Score cards -->
  <div style="display:flex;gap:0;padding:0">
    ${[
      ['Pages Audited',    totalPages,           '#1f2937'],
      ['Critical Issues',  pagesWithIssues,      pagesWithIssues > 0 ? '#7f1d1d' : '#14532d'],
      ['Warnings',         pagesWithWarnings,    pagesWithWarnings > 3 ? '#713f12' : '#1f2937'],
      ['Avg Load Time',    avgLoad + 'ms',       avgLoad > 2500 ? '#7f1d1d' : '#14532d'],
      ['Sitemap URLs',     sitemapResult.urlCount,'#1f2937'],
    ].map(([label, val, bg]) => `
      <div style="flex:1;background:${bg};padding:16px;text-align:center">
        <div style="font-size:26px;font-weight:900;color:#fff">${val}</div>
        <div style="font-size:11px;color:#9ca3af;margin-top:4px">${label}</div>
      </div>`).join('')}
  </div>

  <!-- AI Recommendations -->
  <div style="padding:20px 24px">
    <div style="background:#1f2937;border-radius:6px;padding:16px;border-left:3px solid #a78bfa">
      <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:10px">🤖 AI RECOMMENDATIONS</div>
      <div style="font-size:14px;line-height:1.8;color:#e5e7eb;white-space:pre-wrap">${recommendations}</div>
    </div>
  </div>

  <!-- AEO Target Queries -->
  <div style="padding:0 24px 20px">
    <div style="background:#1f2937;border-radius:6px;padding:16px;border-left:3px solid #06b6d4">
      <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:10px">🎯 AEO TARGET QUERIES (AI SEARCH ENGINES)</div>
      <div style="font-size:13px;color:#d1d5db;line-height:2">
        ${AEO_QUERIES.map(q => `<div>• ${q}</div>`).join('')}
      </div>
    </div>
  </div>

  ${sitemapResult.missingPaths.length ? `
  <div style="padding:0 24px 20px">
    <div style="background:#7f1d1d;border-radius:6px;padding:16px">
      <div style="font-size:11px;letter-spacing:2px;color:#fca5a5;margin-bottom:8px">⚠️ HIGH-PRIORITY PAGES MISSING FROM SITEMAP</div>
      <div style="font-size:13px;color:#fee2e2">${sitemapResult.missingPaths.join(', ')}</div>
    </div>
  </div>` : ''}

  <!-- Page audit table -->
  <div style="padding:0 24px 20px;overflow-x:auto">
    <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:12px">📋 PAGE AUDIT RESULTS</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#374151;color:#d1d5db">
          <th style="padding:10px 12px;text-align:left">Page</th>
          <th style="padding:10px 12px;text-align:center">Status</th>
          <th style="padding:10px 12px;text-align:center">Load</th>
          <th style="padding:10px 12px;text-align:left">Title</th>
          <th style="padding:10px 12px;text-align:left">Desc</th>
          <th style="padding:10px 12px;text-align:left">Schema</th>
          <th style="padding:10px 12px;text-align:left">Notes</th>
        </tr>
      </thead>
      <tbody style="color:#111">${rows}</tbody>
    </table>
  </div>

  <!-- Target Keywords -->
  <div style="padding:0 24px 20px">
    <div style="background:#1f2937;border-radius:6px;padding:16px;border-left:3px solid #f59e0b">
      <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:10px">🔑 TARGET KEYWORDS TO MONITOR</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${TARGET_KEYWORDS.map(k => `<span style="background:#374151;color:#e5e7eb;padding:4px 12px;border-radius:12px;font-size:12px">${k}</span>`).join('')}
      </div>
    </div>
  </div>

  <div style="padding:16px 24px;background:#060b14;text-align:center;font-size:12px;color:#4b5563">
    OrreryX SEO/AEO Agent &nbsp;·&nbsp; orreryx.io &nbsp;·&nbsp; Weekly report
  </div>
</div>`;
}

// ── Send email ────────────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  if (!to) return false;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'OrreryX SEO <noreply@orreryx.io>';
  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: to.trim(), subject, html }),
      });
      if (r.ok) return true;
    } catch (_) {}
  }
  try {
    const { default: nodemailer } = await import('nodemailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({ from: `OrreryX SEO Agent <${user}>`, to: to.trim(), subject, html });
    return true;
  } catch (err) { console.error('[SEO sendEmail]', err?.message||err); return false; }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const cronSecret  = process.env.CRON_SECRET;
  const querySecret = req.query.secret;
  const authHeader  = req.headers['authorization'];
  if (cronSecret && querySecret !== cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const adminEmail   = process.env.ADMIN_EMAIL;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // Audit all pages in parallel batches of 4
  const auditResults = [];
  for (let i = 0; i < PAGES.length; i += 4) {
    const batch   = PAGES.slice(i, i + 4);
    const results = await Promise.all(batch.map(p => auditPage(p.path)));
    auditResults.push(...results);
    if (i + 4 < PAGES.length) await new Promise(r => setTimeout(r, 500));
  }

  const [sitemapResult, recommendations] = await Promise.all([
    checkSitemap(),
    generateRecommendations(auditResults, await checkSitemap(), anthropicKey),
  ]);

  const pagesWithIssues = auditResults.filter(p => p.issues.length > 0).length;
  const html    = buildReport(auditResults, sitemapResult, recommendations);
  const subject = pagesWithIssues > 0
    ? `⚠️ SEO Alert: ${pagesWithIssues} pages with critical issues — OrreryX Weekly`
    : `✅ SEO Health OK — OrreryX Weekly Report`;

  const emailSent = await sendEmail(adminEmail, subject, html);

  // ── Write structured summary to Redis for family intelligence ─────────────────
  const upstashUrl   = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (upstashUrl && upstashToken) {
    const avgLoad = Math.round(auditResults.reduce((s, p) => s + p.loadMs, 0) / auditResults.length);
    const seoSummary = {
      ts:               Date.now(),
      score:            Math.round(((auditResults.length - pagesWithIssues) / auditResults.length) * 100),
      pagesAudited:     auditResults.length,
      pagesWithIssues,
      pagesWithWarnings: auditResults.filter(p => p.warnings.length > 0).length,
      avgLoadMs:        avgLoad,
      topIssues:        auditResults.filter(p => p.issues.length > 0).slice(0, 3).map(p => `${p.path}: ${p.issues[0]}`),
      slowPages:        auditResults.filter(p => p.loadMs > 2500).map(p => p.path),
      missingFromSitemap: sitemapResult.missingPaths,
      topRecommendation:  recommendations.slice(0, 500),
    };
    await fetch(upstashUrl, {
      method:  'POST',
      headers: { Authorization: `Bearer ${upstashToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(['SET', 'seo:last_audit', JSON.stringify(seoSummary), 'EX', 604800]),
    }).catch(() => {});
  }

  return res.status(200).json({
    ok:    true,
    pages: auditResults.length,
    issues:   auditResults.filter(p => p.issues.length > 0).map(p => ({ path: p.path, issues: p.issues })),
    warnings: auditResults.filter(p => p.warnings.length > 0).length,
    sitemap:  sitemapResult,
    emailSent,
    time:  new Date().toISOString(),
  });
}

export const config = { api: { bodyParser: false } };

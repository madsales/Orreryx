// api/seo-sprint.js — Emergency 10-Day SEO Sprint Agent
// CEO target: Top 5 Google rankings by May 31, 2026
//
// Runs DAILY at 6am UTC (not weekly) during the sprint window.
// Focuses exclusively on keywords where top-5 is achievable in <10 days:
//   - Year-specific long-tail keywords (2026) with weak existing competition
//   - Keywords where OrreryX is already on page 2 (positions 11-30)
//   - Low-competition niche combos with existing page content
//
// Each day it:
//   1. Picks the highest-leverage pages from SPRINT_TARGETS
//   2. Uses Claude to generate/optimize title, H1, intro, and FAQ for that day
//   3. Auto-commits changes via GitHub
//   4. Submits pages to Google for recrawling via IndexNow API
//   5. Emails admin a daily rank-progress report
//
// Redis keys:
//   seo:sprint:day:{N}    → daily result (7-day TTL)
//   seo:sprint:latest     → latest run
//   seo:sprint:indexnow   → IndexNow submission log

// ── Sprint keyword targets (achievable top-5 in ≤10 days) ──────────────────────
// Ranked by "winnability": low competition + existing page + trending in 2026

const SPRINT_TARGETS = [
  // TIER 1: Almost certainly top-5 achievable (very low competition, specific)
  {
    path: '/india-pakistan',
    file: 'india-pakistan.html',
    keyword: 'india pakistan conflict 2026 market impact',
    why: 'Highly trending conflict, year-specific, thin existing coverage from major sites',
    expectedDays: 3,
    tier: 1,
  },
  {
    path: '/ww3-probability',
    file: 'ww3-probability.html',
    keyword: 'ww3 probability 2026',
    why: 'Fear-driven search spike, existing content, most competitors have 2024 dates',
    expectedDays: 3,
    tier: 1,
  },
  {
    path: '/global-conflicts-2026',
    file: 'global-conflicts-2026.html',
    keyword: 'global conflicts 2026 list active wars',
    why: 'Year-specific list page, most results are from 2023-2025, fresh OrreryX data wins',
    expectedDays: 4,
    tier: 1,
  },
  {
    path: '/nuclear-war-risk',
    file: 'nuclear-war-risk.html',
    keyword: 'nuclear war risk 2026 probability',
    why: 'Niche fear query, year-specific, weak competition from credible retail-focused sites',
    expectedDays: 4,
    tier: 1,
  },
  // TIER 2: Achievable with strong optimization + fresh content
  {
    path: '/iran-nuclear',
    file: 'iran-nuclear.html',
    keyword: 'iran nuclear deal oil price 2026',
    why: 'Active news cycle driving searches, 2026 suffix filters out older competitors',
    expectedDays: 5,
    tier: 2,
  },
  {
    path: '/safe-haven-assets',
    file: 'safe-haven-assets.html',
    keyword: 'safe haven assets during war 2026',
    why: 'Year-specific query, investors actively searching this during active conflicts',
    expectedDays: 5,
    tier: 2,
  },
  {
    path: '/gold-price',
    file: 'gold-price.html',
    keyword: 'gold price geopolitical risk 2026',
    why: 'Gold at record highs, geopolitical angle is OrreryX strength vs generic finance sites',
    expectedDays: 5,
    tier: 2,
  },
  {
    path: '/taiwan-semiconductor',
    file: 'taiwan-semiconductor.html',
    keyword: 'taiwan conflict semiconductor supply chain risk 2026',
    why: 'Ultra-specific long-tail, investor-focused, very weak competition for this exact phrase',
    expectedDays: 6,
    tier: 2,
  },
  // TIER 3: Stretch goals but worth optimizing
  {
    path: '/defense-stocks',
    file: 'defense-stocks.html',
    keyword: 'best defense stocks geopolitical risk 2026',
    why: 'Commercial intent + year-specific, strong OrreryX angle vs generic stock sites',
    expectedDays: 7,
    tier: 3,
  },
  {
    path: '/top-risks-2026',
    file: 'top-risks-2026.html',
    keyword: 'top geopolitical risks 2026 investors should watch',
    why: 'Listicle format, investable angle, OrreryX data gives unique edge',
    expectedDays: 7,
    tier: 3,
  },
  {
    path: '/oil-price',
    file: 'oil-price.html',
    keyword: 'oil price geopolitical risk 2026',
    why: 'Middle East tensions make this evergreen for 2026, year-specific reduces competition',
    expectedDays: 8,
    tier: 3,
  },
  {
    path: '/china-taiwan',
    file: 'china-taiwan.html',
    keyword: 'china taiwan war semiconductor stocks 2026',
    why: 'Highly specific combo, investor angle, most competitors are news sites without market data',
    expectedDays: 8,
    tier: 3,
  },
];

// Pages to submit to IndexNow every day (Bing-indexed pages surface in Google too)
const INDEXNOW_PAGES = SPRINT_TARGETS.map(t => `https://www.orreryx.io${t.path}`);

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_URL = process.env.BASE_URL || 'https://www.orreryx.io';

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

async function claudeCall(prompt, maxTokens = 1200) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  const text = d?.content?.[0]?.text?.trim() || '';
  return text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
}

// ── GitHub operations ─────────────────────────────────────────────────────────

async function getGitHubFile(filename) {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO || 'madsales/Orreryx';
  if (!token) return null;
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/public/${filename}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'OrreryX-SprintBot' },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  if (!d?.sha) return null;
  const html = Buffer.from(d.content || '', 'base64').toString('utf8');
  return { sha: d.sha, html };
}

async function commitToGitHub(filename, html, sha, message) {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO || 'madsales/Orreryx';
  if (!token) return { skipped: true, reason: 'GITHUB_TOKEN not set' };
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/public/${filename}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'OrreryX-SprintBot' },
    body: JSON.stringify({
      message,
      content: Buffer.from(html).toString('base64'),
      sha,
      branch: 'main',
    }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  return r?.ok ? { committed: true } : { skipped: true, reason: 'GitHub commit failed' };
}

// ── HTML patchers ─────────────────────────────────────────────────────────────

function patchTitle(html, title) {
  if (!title) return html;
  if (/<title[^>]*>[^<]*<\/title>/i.test(html))
    return html.replace(/<title[^>]*>[^<]*<\/title>/i, `<title>${title}</title>`);
  return html.replace('<head>', `<head>\n<title>${title}</title>`);
}

function patchMetaDescription(html, desc) {
  if (!desc) return html;
  // Standard
  if (/<meta[^>]+name=["']description["'][^>]+content=["'][^"']*["']/i.test(html))
    html = html.replace(/(<meta[^>]+name=["']description["'][^>]+content=["'])[^"']*["']/i, `$1${desc}"`);
  // OG
  if (/<meta[^>]+property=["']og:description["'][^>]+content=["'][^"']*["']/i.test(html))
    html = html.replace(/(<meta[^>]+property=["']og:description["'][^>]+content=["'])[^"']*["']/i, `$1${desc}"`);
  return html;
}

function patchH1(html, h1) {
  if (!h1) return html;
  if (/<h1[^>]*>[^<]*<\/h1>/i.test(html))
    return html.replace(/<h1[^>]*>[^<]*<\/h1>/i, `<h1>${h1}</h1>`);
  return html;
}

function injectLastUpdated(html, date) {
  if (/last.?updated.{0,30}\d{4}/i.test(html))
    return html.replace(/last.?updated.{0,30}\d{4}(-\d{2})?(-\d{2})?/gi, `Last Updated: ${date}`);
  const tag = `<p class="last-updated" style="font-size:12px;color:#6b7280;margin:6px 0">Last Updated: ${date}</p>`;
  if (html.includes('</article>')) return html.replace('</article>', `${tag}\n</article>`);
  if (html.includes('</main>'))    return html.replace('</main>', `${tag}\n</main>`);
  return html.replace('</body>', `${tag}\n</body>`);
}

function injectFAQSchema(html, faqs) {
  if (!faqs?.length || html.includes('FAQPage')) return html;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
  const tag = `\n<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
  return html.replace('</head>', `${tag}\n</head>`);
}

function injectNewsArticleSchema(html, { headline, description, datePublished, dateModified }) {
  if (html.includes('NewsArticle') || html.includes('Article')) return html;
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline,
    description,
    datePublished,
    dateModified,
    publisher: {
      '@type': 'Organization',
      name: 'OrreryX',
      url: 'https://www.orreryx.io',
      logo: { '@type': 'ImageObject', url: 'https://www.orreryx.io/logo.png' },
    },
    author: { '@type': 'Organization', name: 'OrreryX Intelligence Team' },
  };
  const tag = `\n<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
  return html.replace('</head>', `${tag}\n</head>`);
}

// ── IndexNow submission (signals Bing + Yandex; Google picks up via GSC) ───────

async function submitIndexNow(urls) {
  const key = process.env.INDEXNOW_KEY;
  if (!key) return { skipped: true, reason: 'INDEXNOW_KEY not set' };
  try {
    const r = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host: 'www.orreryx.io',
        key,
        keyLocation: `https://www.orreryx.io/${key}.txt`,
        urlList: urls.slice(0, 10), // IndexNow limit per submission
      }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);
    return { submitted: r?.ok, status: r?.status, count: urls.length };
  } catch (e) {
    return { skipped: true, reason: e?.message };
  }
}

// ── Google Search Console URL inspection (request recrawl) ───────────────────

async function requestGoogleRecrawl(pageUrl) {
  const token = process.env.GSC_ACCESS_TOKEN;
  if (!token) return { skipped: true, reason: 'GSC_ACCESS_TOKEN not set' };
  try {
    const encoded = encodeURIComponent(pageUrl);
    const r = await fetch(
      `https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inspectionUrl: pageUrl,
          siteUrl: 'https://www.orreryx.io/',
        }),
        signal: AbortSignal.timeout(10000),
      }
    ).catch(() => null);
    return { ok: r?.ok, status: r?.status };
  } catch (e) {
    return { skipped: true, reason: e?.message };
  }
}

// ── Per-page sprint optimization ──────────────────────────────────────────────

async function sprintOptimizePage(target, today) {
  const raw = await claudeCall(`You are an emergency SEO specialist. OrreryX has 10 days to hit top-5 Google rankings.

Page: ${target.path}
Target keyword: "${target.keyword}"
Why this keyword is winnable: ${target.why}
Today's date: ${today}

URGENT REQUIREMENTS (these changes must happen today):
1. Title must START with the exact target keyword (60 chars max)
2. Meta description must include exact keyword + urgency/freshness signal + CTA (155 chars max)
3. H1 must include exact keyword naturally
4. Intro paragraph: 3 sentences, first sentence contains keyword, include specific 2026 context
5. FAQ: 3 questions that exactly match what users searching "${target.keyword}" would ask
6. The "add_section" must be a section that no competitor currently has for this keyword

Return raw JSON only:
{
  "title": "keyword-first title, max 60 chars",
  "description": "keyword included, 140-155 chars, include '2026' and specific benefit",
  "h1": "H1 with keyword, can be slightly longer than title",
  "intro": "3-sentence intro paragraph. Sentence 1 contains keyword. Specific, data-driven, no fluff.",
  "faq": [
    {"question": "exact question searcher asks", "answer": "2-sentence answer with OrreryX data angle"},
    {"question": "exact question searcher asks", "answer": "2-sentence answer with OrreryX data angle"},
    {"question": "exact question searcher asks", "answer": "2-sentence answer with OrreryX data angle"}
  ],
  "add_section": "specific new section title that would outrank competitors",
  "schema_headline": "headline for NewsArticle schema (60 chars max)",
  "schema_description": "description for schema (150 chars max)",
  "keyword_density_tip": "specific phrase to repeat 3-5× in body content",
  "internal_link_add": {"anchor": "anchor text", "target": "/existing-orreryx-page"}
}`);

  let optimized = null;
  try { optimized = JSON.parse(raw || '{}'); } catch (_) {}
  if (!optimized?.title) return { path: target.path, skipped: true, reason: 'Claude failed to generate' };

  // Fetch and patch the HTML file
  const fileData = await getGitHubFile(target.file);
  if (!fileData) return { path: target.path, skipped: true, reason: `GitHub file not found: ${target.file}` };

  let { html, sha } = fileData;
  const originalHtml = html;
  const actions = [];

  html = patchTitle(html, optimized.title);
  actions.push('title patched');

  html = patchMetaDescription(html, optimized.description);
  actions.push('meta description patched');

  html = patchH1(html, optimized.h1);
  actions.push('H1 patched');

  html = injectLastUpdated(html, today);
  actions.push('Last Updated injected');

  if (optimized.faq?.length > 0) {
    html = injectFAQSchema(html, optimized.faq);
    actions.push('FAQPage schema injected');
  }

  // Inject NewsArticle schema for news-type pages
  if (target.path !== '/' && target.path !== '/pricing') {
    html = injectNewsArticleSchema(html, {
      headline: optimized.schema_headline || optimized.title,
      description: optimized.schema_description || optimized.description,
      datePublished: today,
      dateModified: today,
    });
    actions.push('NewsArticle schema injected');
  }

  if (html === originalHtml) {
    return { path: target.path, skipped: true, reason: 'No changes needed', optimized };
  }

  const commit = await commitToGitHub(
    target.file, html, sha,
    `seo-sprint: "${target.keyword}" emergency optimization — ${today} [bot]`
  );

  return {
    path:      target.path,
    keyword:   target.keyword,
    tier:      target.tier,
    why:       target.why,
    optimized,
    actions,
    committed: commit.committed || false,
    commitNote: commit.reason || 'Auto-committed',
  };
}

// ── Daily progress report email ───────────────────────────────────────────────

async function sendSprintReport(today, dayN, results, indexNow, adminEmail) {
  if (!adminEmail) return false;

  const committed = results.filter(r => r.committed).length;
  const skipped   = results.filter(r => r.skipped).length;
  const tier1Done = results.filter(r => r.tier === 1 && r.committed).length;
  const daysLeft  = Math.max(0, Math.ceil((new Date('2026-05-31') - new Date(today)) / 86400000));

  const pageRows = results.map(r => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #1f2937;color:#e2e8f0;font-size:13px">${r.path}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1f2937;color:#94a3b8;font-size:12px">${r.keyword || '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #1f2937;text-align:center">
        <span style="background:${r.tier===1?'#7c3aed':r.tier===2?'#1d4ed8':'#374151'};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">T${r.tier||'?'}</span>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #1f2937;color:${r.committed?'#4ade80':r.skipped?'#f59e0b':'#94a3b8'};font-size:12px">
        ${r.committed ? '✅ Committed' : r.skipped ? `⏭ ${r.reason||'skipped'}` : '❌ Failed'}
      </td>
    </tr>`).join('');

  const urgencyColor = daysLeft <= 3 ? '#7f1d1d' : daysLeft <= 6 ? '#78350f' : '#14532d';

  const html = `
<div style="font-family:sans-serif;max-width:700px;margin:0 auto;background:#0a0f1e;color:#fff;border-radius:8px;overflow:hidden">

  <div style="background:#1e1b4b;padding:20px 24px;border-bottom:2px solid #4f46e5">
    <div style="font-size:11px;letter-spacing:3px;color:#a5b4fc;margin-bottom:4px">ORRERY SEO SPRINT · DAY ${dayN}/10</div>
    <div style="font-size:24px;font-weight:900;color:#fff">🚀 ${today} — Sprint Update</div>
    <div style="font-size:13px;color:#a5b4fc;margin-top:4px">CEO Deadline: May 31, 2026 · ${daysLeft} days remaining</div>
  </div>

  <!-- Progress bar -->
  <div style="background:#1f2937;padding:16px 24px">
    <div style="display:flex;justify-content:space-between;margin-bottom:6px">
      <span style="font-size:12px;color:#9ca3af">Sprint progress</span>
      <span style="font-size:12px;font-weight:700;color:#a5b4fc">Day ${dayN} of 10</span>
    </div>
    <div style="background:#374151;border-radius:4px;height:8px">
      <div style="background:#4f46e5;height:8px;border-radius:4px;width:${Math.round(dayN/10*100)}%"></div>
    </div>
  </div>

  <!-- Stats -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#1f2937;margin:0">
    ${[
      { label: 'Pages Updated', val: committed, color: '#4ade80' },
      { label: 'Tier-1 Done', val: `${tier1Done}/4`, color: '#a78bfa' },
      { label: 'IndexNow', val: indexNow?.submitted ? `${indexNow.count} URLs` : 'pending', color: '#60a5fa' },
      { label: 'Days Left', val: daysLeft, color: daysLeft <= 3 ? '#f87171' : '#fbbf24' },
    ].map(s => `
      <div style="background:#111827;padding:16px;text-align:center">
        <div style="font-size:22px;font-weight:900;color:${s.color}">${s.val}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px">${s.label}</div>
      </div>`).join('')}
  </div>

  <!-- Urgency bar -->
  <div style="background:${urgencyColor};padding:12px 24px;text-align:center">
    <span style="font-size:13px;font-weight:700;color:#fff">
      ${daysLeft <= 3 ? `⚠️ CRITICAL: Only ${daysLeft} days to CEO deadline` :
        daysLeft <= 6 ? `⏰ ${daysLeft} days remaining — stay on track` :
        `✅ On track — ${daysLeft} days to go`}
    </span>
  </div>

  <!-- Today's page updates -->
  <div style="padding:20px 24px">
    <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:12px">TODAY'S PAGE UPDATES</div>
    <table style="width:100%;border-collapse:collapse;background:#111827;border-radius:6px;overflow:hidden">
      <thead>
        <tr style="background:#1f2937">
          <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:2px;color:#9ca3af">PAGE</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:2px;color:#9ca3af">TARGET KEYWORD</th>
          <th style="padding:8px 12px;text-align:center;font-size:11px;letter-spacing:2px;color:#9ca3af">TIER</th>
          <th style="padding:8px 12px;text-align:left;font-size:11px;letter-spacing:2px;color:#9ca3af">STATUS</th>
        </tr>
      </thead>
      <tbody>${pageRows}</tbody>
    </table>
  </div>

  <!-- What Google sees -->
  <div style="padding:0 24px 20px">
    <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:12px">WHAT GOOGLE SEES NOW</div>
    ${results.filter(r => r.committed && r.optimized).slice(0, 3).map(r => `
      <div style="background:#111827;border-radius:6px;padding:14px 16px;margin-bottom:8px;border-left:3px solid #4f46e5">
        <div style="color:#4ade80;font-size:11px;font-weight:700;letter-spacing:1px;margin-bottom:4px">${r.path.toUpperCase()}</div>
        <div style="color:#fff;font-size:14px;font-weight:700;margin-bottom:2px">${r.optimized.title || '—'}</div>
        <div style="color:#94a3b8;font-size:12px;margin-bottom:6px">${r.optimized.description?.slice(0, 100) || '—'}…</div>
        <div style="color:#6b7280;font-size:11px">💡 Add section: "${r.optimized.add_section || '—'}"</div>
      </div>`).join('')}
  </div>

  <!-- CEO target reminder -->
  <div style="padding:0 24px 20px">
    <div style="background:#0f172a;border-radius:6px;padding:16px;border:1px solid #334155">
      <div style="font-size:12px;font-weight:700;color:#f1f5f9;margin-bottom:8px">📊 CEO TARGET KEYWORDS — CHECK THESE DAILY</div>
      <div style="font-size:12px;color:#94a3b8;line-height:1.8">
        🥇 "india pakistan conflict 2026 market impact"<br>
        🥇 "ww3 probability 2026"<br>
        🥇 "global conflicts 2026 list active wars"<br>
        🥇 "nuclear war risk 2026 probability"<br>
        🥈 "iran nuclear deal oil price 2026"<br>
        🥈 "safe haven assets during war 2026"<br>
        🥈 "gold price geopolitical risk 2026"
      </div>
      <div style="margin-top:8px;font-size:11px;color:#64748b">
        Check rankings at: <a href="https://search.google.com/search-console" style="color:#818cf8">Google Search Console</a> or
        <a href="https://ahrefs.com/rank-checker" style="color:#818cf8">Ahrefs Rank Checker</a>
      </div>
    </div>
  </div>

  <div style="padding:16px 24px;background:#060b14;text-align:center;font-size:12px;color:#4b5563">
    OrreryX SEO Sprint Agent · Day ${dayN}/10 · Deadline May 31, 2026
  </div>
</div>`;

  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'OrreryX SEO <noreply@orreryx.io>';
  const subject = `🚀 SEO Sprint Day ${dayN}/10 — ${committed} pages updated · ${daysLeft}d to deadline`;

  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: adminEmail.trim(), subject, html }),
      });
      if (r.ok) return true;
    } catch (_) {}
  }

  // Gmail fallback
  try {
    const { default: nodemailer } = await import('nodemailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await t.sendMail({ from: `OrreryX SEO <${user}>`, to: adminEmail, subject, html });
    return true;
  } catch (_) { return false; }
}

// ── Main run ──────────────────────────────────────────────────────────────────

export async function run() {
  const today    = new Date().toISOString().split('T')[0];
  const sprintStart = '2026-05-21';
  const sprintEnd   = '2026-05-31';
  const dayN     = Math.max(1, Math.ceil((new Date(today) - new Date(sprintStart)) / 86400000) + 1);
  const adminEmail = process.env.ADMIN_EMAIL;

  // Determine which pages to optimize today based on day number
  // Day 1-3: Tier 1 only (4 pages)
  // Day 4-6: Tier 1 + Tier 2 (8 pages)
  // Day 7-10: All tiers (12 pages)
  const maxTier  = dayN <= 3 ? 1 : dayN <= 6 ? 2 : 3;
  const targets  = SPRINT_TARGETS.filter(t => t.tier <= maxTier);

  const results = [];
  for (const target of targets) {
    const result = await sprintOptimizePage(target, today);
    results.push(result);
  }

  // Submit all pages to IndexNow (Bing crawl signal)
  const indexNow = await submitIndexNow(INDEXNOW_PAGES);

  // Request GSC recrawl for committed pages
  const recrawled = [];
  for (const r of results.filter(r => r.committed)) {
    const rc = await requestGoogleRecrawl(`${BASE_URL}${r.path}`);
    recrawled.push({ path: r.path, ...rc });
  }

  const payload = {
    today,
    dayN,
    sprintEnd,
    daysLeft: Math.max(0, Math.ceil((new Date(sprintEnd) - new Date(today)) / 86400000)),
    results,
    committed: results.filter(r => r.committed).length,
    skipped:   results.filter(r => r.skipped).length,
    indexNow,
    recrawled,
    generatedAt: Date.now(),
  };

  await redis(['SET', `seo:sprint:day:${dayN}`, JSON.stringify(payload), 'EX', 604800]);
  await redis(['SET', 'seo:sprint:latest', JSON.stringify(payload), 'EX', 172800]);

  const emailSent = await sendSprintReport(today, dayN, results, indexNow, adminEmail);

  return { ...payload, emailSent };
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  const qs   = req.query.secret || '';
  if (cronSecret && auth !== `Bearer ${cronSecret}` && qs !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ?view=1 returns cached latest report
  if (req.query.view === '1') {
    const raw = await redis(['GET', 'seo:sprint:latest']);
    const data = raw ? JSON.parse(raw) : null;
    return res.status(data ? 200 : 404).json(data || { error: 'No sprint data yet' });
  }

  const result = await run();
  return res.status(200).json({ ok: true, ...result });
}

export const config = { api: { bodyParser: false } };

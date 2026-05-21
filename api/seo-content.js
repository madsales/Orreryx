// api/seo-content.js — AI Content Optimization Manager
// Role: Optimize title/meta/H1/intro/FAQ on key pages; auto-inject "Last Updated" freshness dates;
//       generate full content briefs for new programmatic pages; auto-commit via GitHub
// Runs weekly via seo-orchestrator
// Redis: seo:content:latest (48h TTL)

// ── Pages to optimize (expanded) ─────────────────────────────────────────────

const PAGES_TO_OPTIMIZE = [
  // Commercial/conversion pages (highest priority)
  { path: '/',                        file: 'index.html',              kw: 'geopolitical risk investing platform', type: 'homepage'     },
  { path: '/pricing',                 file: 'pricing.html',            kw: 'bloomberg alternative retail investors', type: 'commercial' },
  // High-traffic informational
  { path: '/geopolitical-risk',       file: 'geopolitical-risk.html',  kw: 'geopolitical risk investing 2026', type: 'informational'   },
  { path: '/global-conflicts-2026',   file: 'global-conflicts-2026.html', kw: 'global conflicts 2026 active wars', type: 'informational' },
  { path: '/ukraine-war',             file: 'ukraine-war.html',        kw: 'ukraine russia war market impact 2026', type: 'news'        },
  { path: '/iran-nuclear',            file: 'iran-nuclear.html',       kw: 'iran nuclear deal oil price 2026', type: 'news'            },
  { path: '/china-taiwan',            file: 'china-taiwan.html',       kw: 'china taiwan war semiconductor risk 2026', type: 'news'     },
  { path: '/india-pakistan',          file: 'india-pakistan.html',     kw: 'india pakistan conflict gold market', type: 'news'          },
  // Asset pages
  { path: '/gold-price',              file: 'gold-price.html',         kw: 'gold price geopolitical risk safe haven', type: 'asset'     },
  { path: '/oil-price',               file: 'oil-price.html',          kw: 'oil price geopolitical risk 2026', type: 'asset'            },
  { path: '/defense-stocks',          file: 'defense-stocks.html',     kw: 'best defense stocks geopolitical risk', type: 'asset'       },
  { path: '/safe-haven-assets',       file: 'safe-haven-assets.html',  kw: 'safe haven assets during war 2026', type: 'informational'  },
  { path: '/ww3-probability',         file: 'ww3-probability.html',    kw: 'ww3 probability 2026', type: 'informational'                },
  { path: '/top-risks-2026',          file: 'top-risks-2026.html',     kw: 'top geopolitical risks 2026 investors', type: 'informational' },
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

async function claudeCall(prompt, maxTokens = 900) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(25000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  const text = d?.content?.[0]?.text?.trim() || '';
  return text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
}

async function fetchCurrentMeta(path, host) {
  const r = await fetch(`https://${host}${path}`, {
    signal: AbortSignal.timeout(8000),
    headers: { 'User-Agent': 'OrreryX-ContentBot/2.0' },
  }).catch(() => null);
  if (!r?.ok) return {};
  const html = await r.text().catch(() => '');
  const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]?.trim() || '';
  const desc  = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || [])[1]?.trim() || '';
  const h1    = (html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || [])[1]?.trim() || '';
  const wordCount = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim().split(/\s+/).length;
  const hasLastUpdated = /last.?updated|updated.{0,10}\d{4}/i.test(html);
  const hasSchema = /<script[^>]+application\/ld\+json/i.test(html);
  const hasFAQ = /faq|frequently.asked/i.test(html);
  return { title, desc, h1, wordCount, hasLastUpdated, hasSchema, hasFAQ };
}

// ── GitHub operations ─────────────────────────────────────────────────────────

async function getGitHubFile(filename) {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO || 'madsales/Orreryx';
  if (!token) return null;
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/public/${filename}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'OrreryX-ContentBot' },
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
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'OrreryX-ContentBot' },
    body: JSON.stringify({ message, content: Buffer.from(html).toString('base64'), sha, branch: 'main' }),
  }).catch(() => null);
  return r?.ok ? { committed: true } : { skipped: true, reason: 'Commit failed' };
}

// ── HTML patchers ─────────────────────────────────────────────────────────────

function patchMetaTags(html, { title, description }) {
  let h = html;
  if (title) {
    if (/<title[^>]*>[^<]*<\/title>/i.test(h))
      h = h.replace(/<title[^>]*>[^<]*<\/title>/i, `<title>${title}</title>`);
  }
  if (description) {
    // Standard meta description
    if (/<meta[^>]+name=["']description["'][^>]+content=["'][^"']*["']/i.test(h))
      h = h.replace(/(<meta[^>]+name=["']description["'][^>]+content=["'])[^"']*["']/i, `$1${description}"`);
    // OG description
    if (/<meta[^>]+property=["']og:description["'][^>]+content=["'][^"']*["']/i.test(h))
      h = h.replace(/(<meta[^>]+property=["']og:description["'][^>]+content=["'])[^"']*["']/i, `$1${description}"`);
  }
  return h;
}

function injectLastUpdated(html, date) {
  // Try to replace existing last updated pattern
  if (/last.?updated.{0,30}\d{4}/i.test(html)) {
    return html.replace(/last.?updated.{0,30}\d{4}(-\d{2})?(-\d{2})?/gi, `Last Updated: ${date}`);
  }
  // Inject before closing </article> or </main> or </section> or before </body>
  const dateTag = `<p style="font-size:12px;color:#6b7280;margin-top:8px">Last Updated: ${date}</p>`;
  if (html.includes('</article>')) return html.replace('</article>', `${dateTag}\n</article>`);
  if (html.includes('</main>'))    return html.replace('</main>', `${dateTag}\n</main>`);
  return html.replace('</body>', `${dateTag}\n</body>`);
}

function injectFAQSchema(html, faqs) {
  if (!faqs || faqs.length === 0) return html;
  if (html.includes('FAQPage')) return html; // already has FAQ schema
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
  const scriptTag = `\n<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
  return html.replace('</head>', `${scriptTag}\n</head>`);
}

// ── Per-page optimization ─────────────────────────────────────────────────────

async function optimizePage(page, host) {
  const current = await fetchCurrentMeta(page.path, host);
  const today   = new Date().toISOString().slice(0, 10);

  const raw = await claudeCall(`You are an expert SEO content optimizer for OrreryX (orreryx.io), a real-time geopolitical market intelligence platform for retail investors.

Page: ${page.path} (type: ${page.type})
Target keyword: "${page.kw}"
Current title: "${current.title || 'MISSING'}"
Current description: "${current.desc || 'MISSING'}"
Current H1: "${current.h1 || 'MISSING'}"
Word count: ${current.wordCount || 0}
Has FAQ schema: ${current.hasFAQ}
Today's date: ${today}

Rules:
- Title: 50-60 chars, target keyword within first 3 words, include "OrreryX" or year where natural
- Description: 140-155 chars, include keyword, specific benefit, subtle CTA ("Free trial")
- H1: Slightly different from title, can be longer (60-80 chars)
- FAQ: 3 questions a searcher of this keyword would have, with 2-sentence answers each
- Intro: 2-sentence opening paragraph for this page (factual, specific, no fluff)

Return raw JSON only:
{
  "title": "optimized title",
  "description": "optimized meta description",
  "h1": "optimized H1",
  "intro": "2-sentence intro paragraph to add/replace at top of content",
  "faq": [
    {"question": "question text", "answer": "2-sentence answer"},
    {"question": "question text", "answer": "2-sentence answer"},
    {"question": "question text", "answer": "2-sentence answer"}
  ],
  "issues_fixed": ["what was wrong"],
  "score_before": 0,
  "score_after": 0
}`);

  let optimized = null;
  try { optimized = JSON.parse(raw || '{}'); } catch (_) {}

  const result = {
    path: page.path, file: page.file, keyword: page.kw, type: page.type,
    current, optimized, committed: false, actions: [],
  };

  if (!optimized?.title || !process.env.GITHUB_TOKEN) return result;

  const fileData = await getGitHubFile(page.file);
  if (!fileData) return result;

  let { html, sha } = fileData;
  const originalHtml = html;

  // Apply meta tag patches
  html = patchMetaTags(html, { title: optimized.title, description: optimized.description });

  // Inject "Last Updated" date
  if (!current.hasLastUpdated) {
    html = injectLastUpdated(html, today);
    result.actions.push('Injected Last Updated date');
  }

  // Inject FAQ schema if not present
  if (!current.hasFAQ && optimized.faq?.length > 0) {
    html = injectFAQSchema(html, optimized.faq);
    result.actions.push('Injected FAQPage JSON-LD schema');
  }

  if (html === originalHtml) {
    result.actions.push('No changes needed');
    return result;
  }

  const changes = result.actions.length > 0 ? result.actions.join(', ') : 'meta tags optimized';
  const commit  = await commitToGitHub(page.file, html, sha,
    `seo: optimize "${page.kw}" — ${changes} [bot]`);

  result.committed   = commit.committed || false;
  result.commitNote  = commit.reason || 'Auto-committed';
  return result;
}

// ── Programmatic page content brief generator ─────────────────────────────────

async function generateProgrammaticBrief(conflict, asset, keyword) {
  const raw = await claudeCall(`Generate a content brief for a new OrreryX landing page targeting "${keyword}".

This page is at: /intelligence/${conflict}/${asset}
OrreryX tracks live conflict data and maps it to market impact.

Return raw JSON only:
{
  "title": "SEO title 50-60 chars",
  "description": "meta description 140-155 chars",
  "h1": "H1 tag",
  "intro_paragraph": "Opening paragraph 50-80 words, specific, data-driven",
  "sections": ["Section 1 title", "Section 2 title", "Section 3 title"],
  "faq": [
    {"question": "relevant FAQ question", "answer": "2-sentence answer"}
  ],
  "internal_links": [
    {"anchor": "anchor text", "url": "/existing-orreryx-page"}
  ]
}`, 700);

  try { return JSON.parse(raw || 'null'); } catch { return null; }
}

// ── Main run ──────────────────────────────────────────────────────────────────

export async function run(host = 'www.orreryx.io') {
  const today = new Date().toISOString().split('T')[0];
  const results = [];

  // Process 6 pages per run (balance between coverage and Vercel timeout)
  const pagesToProcess = PAGES_TO_OPTIMIZE.slice(0, 6);
  for (const page of pagesToProcess) {
    const result = await optimizePage(page, host);
    results.push(result);
  }

  // Generate one programmatic page brief per run
  const programmaticBrief = await generateProgrammaticBrief('iran', 'oil-futures', 'iran oil futures geopolitical risk');

  const committed = results.filter(r => r.committed).length;
  const payload = {
    results, programmaticBrief, committed,
    pagesOptimized: results.length,
    pagesTotal: PAGES_TO_OPTIMIZE.length,
    nextBatch: PAGES_TO_OPTIMIZE.slice(6).map(p => p.path),
    generatedAt: Date.now(), date: today,
  };
  await redis(['SET', 'seo:content:latest', JSON.stringify(payload), 'EX', 172800]);
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

// api/seo-content.js — Content Optimizer Agent
// Uses Claude to generate optimized title, meta description, H1, and intro for each page
// Auto-commits improvements to GitHub repo → triggers Vercel redeploy
// Redis: seo:content:latest (48h TTL)

const PAGES_TO_OPTIMIZE = [
  { path: '/ukraine-war',           file: 'ukraine-war.html',           kw: 'ukraine war 2026 live updates' },
  { path: '/iran-nuclear',          file: 'iran-nuclear.html',           kw: 'iran nuclear deal 2026' },
  { path: '/china-taiwan',          file: 'china-taiwan.html',           kw: 'china taiwan war risk 2026' },
  { path: '/india-pakistan',        file: 'india-pakistan.html',         kw: 'india pakistan war 2026' },
  { path: '/global-conflicts-2026', file: 'global-conflicts-2026.html',  kw: 'global conflicts 2026 active wars' },
  { path: '/geopolitical-risk',     file: 'geopolitical-risk.html',      kw: 'geopolitical risk investing 2026' },
  { path: '/ww3-probability',       file: 'ww3-probability.html',        kw: 'ww3 probability 2026' },
  { path: '/gold-price',            file: 'gold-price.html',             kw: 'gold price geopolitical risk' },
  { path: '/oil-price',             file: 'oil-price.html',              kw: 'oil price war geopolitics' },
  { path: '/nuclear-war-risk',      file: 'nuclear-war-risk.html',       kw: 'nuclear war risk 2026' },
  { path: '/safe-haven-assets',     file: 'safe-haven-assets.html',      kw: 'safe haven assets during war' },
  { path: '/risk-dashboard',        file: 'risk-dashboard.html',         kw: 'geopolitical risk dashboard' },
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
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  const text = d?.content?.[0]?.text?.trim() || '';
  return text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
}

async function fetchCurrentMeta(path, host) {
  const r = await fetch(`https://${host}${path}`, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'OrreryX-SEOBot/1.0' } }).catch(() => null);
  if (!r?.ok) return {};
  const html = await r.text().catch(() => '');
  const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1]?.trim() || '';
  const desc  = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) || [])[1]?.trim() || '';
  const h1    = (html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || [])[1]?.trim() || '';
  return { title, desc, h1 };
}

async function commitToGitHub(filename, content, message) {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO || 'madsales/Orreryx';
  if (!token) return { skipped: true, reason: 'GITHUB_TOKEN not set' };

  // Get current file SHA
  const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/public/${filename}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'OrreryX-SEOBot' },
  }).catch(() => null);

  if (!fileRes?.ok) return { skipped: true, reason: `Could not fetch ${filename}` };
  const fileData = await fileRes.json().catch(() => null);
  const sha = fileData?.sha;
  if (!sha) return { skipped: true, reason: 'No SHA found' };

  // Update file
  const updateRes = await fetch(`https://api.github.com/repos/${repo}/contents/public/${filename}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'OrreryX-SEOBot' },
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString('base64'),
      sha,
      branch: 'main',
    }),
  }).catch(() => null);

  return updateRes?.ok ? { committed: true } : { skipped: true, reason: 'Commit failed' };
}

async function patchMetaTags(html, { title, description, h1 }) {
  let updated = html;
  if (title) {
    updated = updated.replace(/<title[^>]*>[^<]*<\/title>/i, `<title>${title}</title>`);
  }
  if (description) {
    updated = updated.replace(
      /(<meta[^>]+name=["']description["'][^>]+content=["'])[^"']*["']/i,
      `$1${description}"`,
    ).replace(
      /(<meta[^>]+content=["'])[^"']*(["'][^>]+name=["']description["'])/i,
      `$1${description}$2`,
    );
    // Also update OG description
    updated = updated.replace(
      /(<meta[^>]+property=["']og:description["'][^>]+content=["'])[^"']*["']/i,
      `$1${description}"`,
    );
  }
  return updated;
}

export async function run(host = 'www.orreryx.io') {
  const today = new Date().toISOString().split('T')[0];
  const results = [];
  // Process up to 4 pages per run to stay within timeout
  const pagesToProcess = PAGES_TO_OPTIMIZE.slice(0, 4);

  for (const page of pagesToProcess) {
    const current = await fetchCurrentMeta(page.path, host);
    const raw = await claudeCall(`You are an expert SEO content optimizer for OrreryX (orreryx.io), a geopolitical market intelligence platform.

Page: ${page.path}
Target keyword: "${page.kw}"
Current title: "${current.title || 'missing'}"
Current meta description: "${current.desc || 'missing'}"
Current H1: "${current.h1 || 'missing'}"

Generate SEO-optimized metadata as raw JSON only:
{
  "title": "optimized title 50-60 chars, include target keyword near start",
  "description": "optimized meta description 140-155 chars, include keyword, compelling CTA",
  "h1": "optimized H1, slightly different from title",
  "issues_fixed": ["list of what was wrong with the current tags"],
  "score_before": 0-100,
  "score_after": 0-100
}`);

    let optimized = null;
    try { optimized = JSON.parse(raw || '{}'); } catch (_) {}

    const result = { path: page.path, file: page.file, keyword: page.kw, current, optimized, committed: false };

    if (optimized?.title && process.env.GITHUB_TOKEN) {
      // Fetch current HTML from GitHub
      const token = process.env.GITHUB_TOKEN;
      const repo  = process.env.GITHUB_REPO || 'madsales/Orreryx';
      const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/public/${page.file}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'OrreryX-SEOBot' },
      }).catch(() => null);

      if (fileRes?.ok) {
        const fileData = await fileRes.json().catch(() => null);
        const currentHtml = Buffer.from(fileData?.content || '', 'base64').toString('utf8');
        const patchedHtml = await patchMetaTags(currentHtml, {
          title: optimized.title,
          description: optimized.description,
        });

        if (patchedHtml !== currentHtml) {
          const commitResult = await commitToGitHub(page.file, patchedHtml,
            `seo: optimize meta tags for "${page.kw}" on ${page.path} [bot]`);
          result.committed = commitResult.committed || false;
          result.commitNote = commitResult.reason || 'Auto-committed';
        }
      }
    }

    results.push(result);
  }

  const payload = { results, generatedAt: Date.now(), date: today };
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

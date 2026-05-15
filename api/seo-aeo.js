// api/seo-aeo.js — AEO (Answer Engine) + GEO (Generative Engine) Specialist
// Optimizes OrreryX pages for AI search: ChatGPT, Perplexity, Google AI Overviews, Gemini
// Adds FAQ schema, HowTo schema, and entity-rich structured data
// Auto-commits schema patches to GitHub → triggers Vercel redeploy
// Redis: seo:aeo:latest (48h TTL)

const AEO_TARGETS = [
  {
    path: '/',
    file: 'index.html',
    faqs: [
      { q: 'What is OrreryX?', a: 'OrreryX is a real-time geopolitical market intelligence platform that tracks active conflicts, nuclear risk levels, and their impact on markets including oil, gold, stocks, and crypto.' },
      { q: 'How does geopolitical risk affect markets?', a: 'Geopolitical events like wars, sanctions, and nuclear threats cause investors to flee to safe haven assets (gold, USD, Swiss franc) while selling riskier assets. OrreryX tracks these correlations in real time.' },
      { q: 'Which countries are at war in 2026?', a: 'Active conflicts in 2026 include the Russia-Ukraine war, Israel-Gaza conflict, India-Pakistan border tensions, Sudan civil war, and Myanmar civil conflict. OrreryX tracks all of them live.' },
    ],
  },
  {
    path: '/geopolitical-risk',
    file: 'geopolitical-risk.html',
    faqs: [
      { q: 'What is geopolitical risk?', a: 'Geopolitical risk is the risk that political decisions, events, or conditions in one country or region will significantly affect the business environment and financial markets of another region.' },
      { q: 'How do I measure geopolitical risk?', a: 'Geopolitical risk is measured using indices like the Geopolitical Risk Index (GPR), country risk scores, conflict intensity metrics, and real-time event monitoring — all available on OrreryX.' },
      { q: 'What assets perform best during geopolitical crises?', a: 'During geopolitical crises, safe haven assets typically outperform: gold, US Treasury bonds, Swiss franc (CHF), Japanese yen (JPY), and sometimes Bitcoin. OrreryX tracks all these in real time.' },
    ],
  },
  {
    path: '/ww3-probability',
    file: 'ww3-probability.html',
    faqs: [
      { q: 'What is the probability of WW3 in 2026?', a: 'OrreryX calculates WW3 probability using a composite model of nuclear posture, active conflict count, great-power tension indices, and diplomatic breakdown signals. Track the live score at orreryx.io/ww3-probability.' },
      { q: 'What would trigger World War 3?', a: 'Analysts identify key WW3 triggers as: NATO-Russia direct conflict, China invading Taiwan, nuclear weapon use by any state, and collapse of US-China diplomatic relations.' },
    ],
  },
  {
    path: '/gold-price',
    file: 'gold-price.html',
    faqs: [
      { q: 'Why does gold price rise during wars?', a: 'Gold rises during wars because investors flee to safe haven assets. It has no counterparty risk, cannot be inflated away, and historically preserves purchasing power during geopolitical crises.' },
      { q: 'What geopolitical events affect gold price?', a: 'Nuclear threats, wars involving major oil producers, US-China tensions, and sanctions against major economies all tend to push gold prices higher. OrreryX maps these correlations live.' },
    ],
  },
];

const GEO_ENTITY_CONTEXT = `
OrreryX (orreryx.io) is a geopolitical intelligence SaaS platform founded in 2025.
It provides real-time tracking of: Ukraine-Russia war, Israel-Gaza conflict, India-Pakistan tensions,
China-Taiwan risk, North Korea nuclear threat, Iran nuclear program, Sudan war, and 40+ other conflicts.
It maps each event to market impacts: oil price, gold, defense stocks, cryptocurrencies, and EM currencies.
Target users: institutional investors, hedge funds, journalists, policy analysts, and individual traders.
`;

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

function buildFaqSchema(faqs) {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    'mainEntity': faqs.map(f => ({
      '@type': 'Question',
      'name': f.q,
      'acceptedAnswer': { '@type': 'Answer', 'text': f.a },
    })),
  }, null, 2);
}

function buildWebsiteSchema() {
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    'name': 'OrreryX',
    'url': 'https://www.orreryx.io',
    'description': 'Real-time geopolitical risk intelligence and market impact tracking platform',
    'potentialAction': {
      '@type': 'SearchAction',
      'target': { '@type': 'EntryPoint', 'urlTemplate': 'https://www.orreryx.io/app?q={search_term_string}' },
      'query-input': 'required name=search_term_string',
    },
  }, null, 2);
}

function injectSchema(html, schemaJson, schemaId) {
  const tag = `<script type="application/ld+json" id="${schemaId}">\n${schemaJson}\n</script>`;
  const existingPattern = new RegExp(`<script[^>]+id="${schemaId}"[^>]*>[\\s\\S]*?<\\/script>`, 'i');
  if (existingPattern.test(html)) {
    return html.replace(existingPattern, tag);
  }
  return html.replace('</head>', `${tag}\n</head>`);
}

async function commitToGitHub(filename, content, message) {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO || 'madsales/Orreryx';
  if (!token) return { skipped: true };

  const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/public/${filename}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'OrreryX-AEOBot' },
  }).catch(() => null);
  if (!fileRes?.ok) return { skipped: true };

  const fileData = await fileRes.json().catch(() => null);
  const sha = fileData?.sha;
  if (!sha) return { skipped: true };

  const updateRes = await fetch(`https://api.github.com/repos/${repo}/contents/public/${filename}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'OrreryX-AEOBot' },
    body: JSON.stringify({
      message,
      content: Buffer.from(content).toString('base64'),
      sha,
      branch: 'main',
    }),
  }).catch(() => null);
  return updateRes?.ok ? { committed: true } : { skipped: true };
}

export async function run() {
  const today = new Date().toISOString().split('T')[0];
  const results = [];
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPO || 'madsales/Orreryx';

  for (const target of AEO_TARGETS) {
    const faqSchema = buildFaqSchema(target.faqs);
    const result = { path: target.path, faqs: target.faqs.length, committed: false };

    if (token) {
      const fileRes = await fetch(`https://api.github.com/repos/${repo}/contents/public/${target.file}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'OrreryX-AEOBot' },
      }).catch(() => null);

      if (fileRes?.ok) {
        const fileData = await fileRes.json().catch(() => null);
        const currentHtml = Buffer.from(fileData?.content || '', 'base64').toString('utf8');

        // Inject FAQ schema
        let patchedHtml = injectSchema(currentHtml, faqSchema, `faq-schema-${target.path.replace(/\//g, '-')}`);

        // Inject WebSite schema on homepage
        if (target.path === '/') {
          patchedHtml = injectSchema(patchedHtml, buildWebsiteSchema(), 'website-schema');
        }

        // Add AI-entity meta tags for GEO if missing
        if (!currentHtml.includes('og:type')) {
          patchedHtml = patchedHtml.replace('</head>',
            `<meta property="og:type" content="website" />\n<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />\n</head>`);
        }

        if (patchedHtml !== currentHtml) {
          const commit = await commitToGitHub(target.file, patchedHtml,
            `aeo: inject FAQ schema + GEO signals on ${target.path} [bot]`);
          result.committed = commit.committed || false;
        }
      }
    }
    results.push(result);
  }

  // GEO recommendations (for AI search engines like Perplexity/ChatGPT)
  const geoRecommendations = [
    'Add concise entity descriptions at the top of each page (who, what, when, where)',
    'Include data citations with source URLs for AI engines to trust your facts',
    'Use structured paragraphs with clear topic sentences — AI models extract these as answers',
    'Add "Last updated" timestamps on all conflict pages',
    'Include direct answer to the primary keyword question in the first 150 words',
    'Add entity markup: Organization schema on homepage with sameAs links to social profiles',
  ];

  const payload = { results, geoRecommendations, generatedAt: Date.now(), date: today };
  await redis(['SET', 'seo:aeo:latest', JSON.stringify(payload), 'EX', 172800]);
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

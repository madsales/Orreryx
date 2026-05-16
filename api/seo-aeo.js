// api/seo-aeo.js — AEO + GEO Specialist Agent v2
// Answer Engine Optimization: FAQ, Article, Speakable, HowTo, Organization schemas
// Generative Engine Optimization: AI-citation signals, entity markup, conversational answers
// Reads chief strategist instructions from Redis before running
// Auto-commits to GitHub. Redis: seo:aeo:latest (48h TTL)

const GITHUB_REPO  = process.env.GITHUB_REPO  || 'madsales/Orreryx';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN  || '';

// 8 pages with deep FAQ coverage for AI answer engines
const AEO_PAGES = [
  {
    path: '/',
    file: 'index.html',
    primaryKeyword: 'geopolitical risk intelligence',
    entities: ['OrreryX', 'geopolitical risk', 'conflict tracking', 'market intelligence'],
    faqs: [
      { q: 'What is OrreryX?', a: 'OrreryX is a real-time geopolitical risk intelligence platform that tracks active conflicts, political instability, nuclear threats, and their direct impact on financial markets including oil, gold, stocks, and cryptocurrencies across 180+ countries.' },
      { q: 'How does geopolitical risk affect financial markets?', a: 'Geopolitical risk affects markets by triggering capital flight to safe-haven assets like gold and US Treasury bonds, causing oil price spikes when conflicts involve major producers, increasing currency volatility in affected regions, and reducing investor confidence in emerging markets.' },
      { q: 'Which countries are at highest geopolitical risk in 2026?', a: 'The countries with highest geopolitical risk in 2026 include Russia (Ukraine war), Iran (nuclear program), North Korea (missile program), Sudan (civil war), Myanmar (military conflict), and Pakistan (India-Pakistan tensions). OrreryX tracks live risk scores for all 180+ countries.' },
      { q: 'What is the best tool to track geopolitical risk?', a: 'OrreryX is a leading geopolitical risk intelligence platform offering real-time conflict tracking, risk scores, market impact analysis, and AI-powered alerts. It covers 180+ countries and maps geopolitical events directly to commodities, currencies, and equity markets.' },
    ],
  },
  {
    path: '/geopolitical-risk',
    file: 'geopolitical-risk.html',
    primaryKeyword: 'geopolitical risk',
    entities: ['geopolitical risk', 'political instability', 'country risk', 'conflict risk'],
    faqs: [
      { q: 'What is geopolitical risk?', a: 'Geopolitical risk is the probability that political events — including wars, elections, sanctions, coups, and diplomatic crises — will negatively affect a country\'s economy, financial markets, or business environment. It encompasses political risk, country risk, and conflict risk.' },
      { q: 'How is geopolitical risk measured?', a: 'Geopolitical risk is measured using composite indices that track conflict intensity, political stability, government effectiveness, sanctions exposure, and diplomatic tensions. OrreryX measures geopolitical risk on a 0-100 scale updated in real time using GDELT conflict data and news analysis.' },
      { q: 'Which countries have the highest geopolitical risk?', a: 'As of 2026, countries with the highest geopolitical risk scores include Russia, Iran, North Korea, Sudan, Myanmar, Yemen, Syria, and Venezuela. These nations combine active conflicts, authoritarian governance, international sanctions, and nuclear or WMD programs.' },
      { q: 'How does geopolitical risk affect investments?', a: 'Geopolitical risk affects investments by increasing market volatility, triggering capital outflows from high-risk regions, impacting commodity prices (especially oil and gold), causing currency devaluations, and disrupting global supply chains. Portfolio managers use geopolitical risk scores to adjust country allocations.' },
      { q: 'What are safe haven assets during geopolitical crises?', a: 'The primary safe haven assets during geopolitical crises are: gold (historically rises 10-15% during major conflicts), US Treasury bonds, Swiss franc (CHF), Japanese yen (JPY), and US dollar (USD). These assets tend to hold or increase value when political uncertainty rises.' },
      { q: 'What is the difference between political risk and geopolitical risk?', a: 'Political risk refers to risks arising from a single country\'s domestic political environment — elections, policy changes, corruption. Geopolitical risk is broader and includes international dimensions: wars between nations, cross-border sanctions, alliance shifts, and global power competition between the US, China, and Russia.' },
    ],
  },
  {
    path: '/ww3-probability',
    file: 'ww3-probability.html',
    primaryKeyword: 'ww3 probability 2026',
    entities: ['World War 3', 'nuclear war risk', 'global conflict', 'NATO', 'Doomsday Clock'],
    faqs: [
      { q: 'What is the probability of World War 3 in 2026?', a: 'Most geopolitical risk models estimate the probability of a full-scale World War 3 at 3-8% in 2026. While tensions between NATO and Russia, the China-Taiwan standoff, and Middle East escalation are elevated, nuclear deterrence and economic interdependence reduce the likelihood of direct great-power war.' },
      { q: 'What would trigger World War 3?', a: 'The most likely World War 3 triggers in 2026 are: a direct military confrontation between NATO forces and Russia over Ukraine, a Chinese invasion of Taiwan drawing in the United States, the first use of nuclear weapons since 1945, or a catastrophic cyberattack on critical infrastructure of a nuclear power.' },
      { q: 'Is nuclear war possible in 2026?', a: 'The risk of nuclear weapon use is at its highest point since the 1980s. Russia has made repeated nuclear threats during the Ukraine war. The Bulletin of Atomic Scientists\' Doomsday Clock stood at 90 seconds to midnight in 2024 — the closest ever. Most analysts put the probability of any nuclear use below 5%, but acknowledge it is non-negligible.' },
      { q: 'How close are we to World War 3?', a: 'By multiple measures, global conflict risk is elevated: 56+ active armed conflicts worldwide as of 2026, record-high defense spending globally, three nuclear-armed states in active conflict zones (Russia, Pakistan/India, North Korea), and significant diplomatic breakdowns between the US, Russia, and China.' },
      { q: 'What regions are most at risk of starting WW3?', a: 'The three highest-risk flashpoints for a World War 3 scenario in 2026 are: (1) Eastern Europe — a NATO-Russia confrontation over Ukraine, (2) East Asia — China invading Taiwan with US intervention, and (3) Middle East — an Iran-Israel war escalating with US or Russian involvement.' },
    ],
  },
  {
    path: '/ukraine-war',
    file: 'ukraine-war.html',
    primaryKeyword: 'ukraine war 2026',
    entities: ['Ukraine', 'Russia', 'NATO', 'Zelensky', 'Putin', 'Donbas', 'ceasefire'],
    faqs: [
      { q: 'What is the current status of the Ukraine war in 2026?', a: 'The Russia-Ukraine war continues in 2026 with active fighting along the eastern front in Donetsk and Zaporizhzhia oblasts. NATO continues military aid to Ukraine while peace negotiations remain stalled over Russian demands for territorial recognition. OrreryX tracks the daily conflict status.' },
      { q: 'How long has the Ukraine-Russia war been going on?', a: 'Russia launched its full-scale invasion of Ukraine on February 24, 2022, making the war over 4 years old in 2026. The conflict originated in 2014 when Russia annexed Crimea and supported separatists in eastern Ukraine.' },
      { q: 'How has the Ukraine war affected oil and gas prices?', a: 'The Ukraine war triggered Europe\'s worst energy crisis since the 1970s. Russia\'s Nord Stream pipelines were sabotaged, European nations scrambled for alternative LNG suppliers, and natural gas prices spiked 10x in 2022. By 2026, Europe has largely diversified away from Russian energy, but energy prices remain elevated.' },
      { q: 'Will there be a Ukraine ceasefire in 2026?', a: 'As of 2026, a formal ceasefire agreement has not materialized. Multiple negotiation attempts have collapsed over Russia\'s demands for territorial concessions and Ukraine\'s insistence on full sovereignty restoration. Most analysts rate ceasefire probability at 30-40% within 2026.' },
      { q: 'What weapons is NATO giving Ukraine?', a: 'NATO members have supplied Ukraine with advanced weapons including US HIMARS rocket systems, F-16 fighter jets, Patriot air defense batteries, British Storm Shadow cruise missiles, German Leopard 2 tanks, and various artillery systems. Total military aid exceeded $100 billion as of 2025.' },
    ],
  },
  {
    path: '/iran-nuclear',
    file: 'iran-nuclear.html',
    primaryKeyword: 'iran nuclear program 2026',
    entities: ['Iran', 'nuclear weapons', 'JCPOA', 'uranium enrichment', 'IAEA', 'Natanz'],
    faqs: [
      { q: 'How close is Iran to a nuclear weapon in 2026?', a: 'As of 2026, Iran has enriched uranium to 60% purity — just below the 90% weapons-grade threshold. The IAEA estimates Iran could produce enough highly enriched uranium for one nuclear device within 1-2 weeks if it chose to break out. However, building and deploying a deliverable nuclear weapon would take additional months.' },
      { q: 'What is the Iran nuclear deal (JCPOA)?', a: 'The JCPOA (Joint Comprehensive Plan of Action) was a 2015 multilateral agreement limiting Iran\'s nuclear program in exchange for sanctions relief. The US unilaterally withdrew in 2018 under President Trump. Efforts to revive the deal in 2021-2023 failed, and Iran has since expanded its nuclear capabilities.' },
      { q: 'Could Israel strike Iran\'s nuclear facilities?', a: 'Israel has repeatedly stated it will not allow Iran to acquire nuclear weapons and has conducted operations against Iranian-linked nuclear assets. A military strike on Iran\'s deeply buried Fordow facility is technically challenging but considered a credible option. Such a strike would likely trigger regional war involving Iran\'s proxy network.' },
      { q: 'What would happen if Iran got nuclear weapons?', a: 'If Iran acquired nuclear weapons, analysts expect: a rapid proliferation cascade with Saudi Arabia, Turkey, and Egypt pursuing their own programs; increased deterrence stability but also crisis instability in the Middle East; tightened Israeli security posture; and potential US or Israeli preemptive strikes to prevent weaponization.' },
    ],
  },
  {
    path: '/gold-price',
    file: 'gold-price.html',
    primaryKeyword: 'gold price geopolitical risk 2026',
    entities: ['gold price', 'XAU/USD', 'safe haven asset', 'inflation hedge', 'central bank gold buying'],
    faqs: [
      { q: 'Why does gold price rise during geopolitical crises?', a: 'Gold rises during geopolitical crises because it is a universally recognized store of value with no counterparty risk. When political uncertainty increases, investors move capital from risky assets (stocks, emerging market currencies) into gold, which preserves purchasing power independent of any government or financial system.' },
      { q: 'What is the gold price forecast for 2026?', a: 'Gold price forecasts for 2026 range from $2,800 to $3,800 per ounce, supported by: central bank gold buying at record levels (1,000+ tonnes/year), ongoing geopolitical tensions, US fiscal deficit concerns, and demand from emerging market investors seeking dollar alternatives.' },
      { q: 'How does gold perform during wars?', a: 'Gold historically rises 8-20% during major military conflicts. During the 2022 Russia-Ukraine war invasion, gold surged above $2,070/oz. During the October 2023 Gaza conflict outbreak, gold jumped 5% in a week. OrreryX tracks real-time gold price correlations with conflict escalation.' },
      { q: 'Should I buy gold if WW3 starts?', a: 'Gold is the traditional safe haven during major conflicts. Investors typically allocate 5-15% of portfolios to gold as geopolitical insurance. Physical gold, gold ETFs (like GLD or IAU), and gold mining stocks each offer different risk/return profiles. OrreryX maps geopolitical risk levels to gold price impact in real time.' },
    ],
  },
  {
    path: '/what-is-geopolitics',
    file: 'what-is-geopolitics.html',
    primaryKeyword: 'what is geopolitics',
    entities: ['geopolitics', 'political geography', 'international relations', 'power politics', 'realism'],
    faqs: [
      { q: 'What is geopolitics?', a: 'Geopolitics is the study of how geographic factors — territory, resources, location, and spatial relationships — shape political power, international relations, and national strategy. It examines how nations compete for control of land, sea routes, energy resources, and strategic positions to advance their national interests.' },
      { q: 'What are examples of geopolitics in 2026?', a: 'Current geopolitical competition examples include: the US-China rivalry over Taiwan and Pacific dominance, Russia\'s war in Ukraine to prevent NATO expansion, China\'s Belt and Road Initiative building strategic infrastructure across Asia and Africa, Middle Eastern nations competing for oil influence, and Arctic territorial claims as ice melts.' },
      { q: 'Who are the main geopolitical powers in 2026?', a: 'The primary geopolitical powers in 2026 are: the United States (military and financial superpower), China (economic and technological challenger), Russia (nuclear power and energy exporter), the European Union (economic bloc), India (rising power), and regional powers including Saudi Arabia, Iran, Turkey, and Brazil.' },
      { q: 'What is the difference between geopolitics and international relations?', a: 'Geopolitics specifically focuses on how geography shapes political power and state competition, while international relations is broader — covering diplomacy, trade, international law, global governance, and non-state actors. Geopolitics is a theoretical lens within international relations studies.' },
      { q: 'Who invented geopolitics?', a: 'The term "geopolitics" was coined by Swedish political scientist Rudolf Kjellén in 1899. British geographer Halford Mackinder\'s 1904 "Heartland Theory" and American naval strategist Alfred Thayer Mahan\'s sea power theory laid the intellectual foundations of modern geopolitical thinking.' },
    ],
  },
  {
    path: '/india-pakistan',
    file: 'india-pakistan.html',
    primaryKeyword: 'india pakistan conflict 2026',
    entities: ['India', 'Pakistan', 'Kashmir', 'Line of Control', 'nuclear deterrence', 'ISI'],
    faqs: [
      { q: 'What is the India-Pakistan conflict about?', a: 'The India-Pakistan conflict centers on the disputed Kashmir region, claimed in full by both nuclear-armed nations but controlled in parts by each. They have fought three major wars (1947, 1965, 1971) and one limited conflict (Kargil 1999). Cross-border terrorism, military standoffs, and diplomatic crises remain ongoing.' },
      { q: 'How many nuclear weapons do India and Pakistan have?', a: 'India possesses approximately 160-170 nuclear warheads and Pakistan has around 170 nuclear warheads as of 2025 estimates. Both countries are expanding their arsenals. Pakistan maintains a first-use policy if facing conventional military defeat — a key difference from India\'s No First Use doctrine.' },
      { q: 'What happened between India and Pakistan in 2025?', a: 'A major escalation in 2025 followed a terrorist attack in Indian-administered Kashmir. India conducted airstrikes against militant camps in Pakistan-controlled territory. Pakistan retaliated with drone strikes. Both sides mobilized forces before international mediation by the US and Gulf states secured de-escalation.' },
      { q: 'Could India and Pakistan go to nuclear war?', a: 'The India-Pakistan nuclear risk is considered the most dangerous nuclear flashpoint globally. The combination of geographic proximity, short missile flight times (4-8 minutes), multiple active militant groups, and previous near-escalations makes inadvertent nuclear use more plausible than in other nuclear dyads. Most analysts still rate the probability below 1% per crisis.' },
    ],
  },
];

// HowTo schema for key analytical pages
const HOWTO_SCHEMAS = [
  {
    file: 'geopolitical-risk.html',
    name: 'How to Assess Geopolitical Risk for Investment Decisions',
    description: 'A step-by-step methodology for evaluating geopolitical risk exposure in investment portfolios',
    steps: [
      { name: 'Get a baseline risk score', text: 'Use OrreryX or another geopolitical risk index to establish a 0-100 risk score for your target country or region. Scores above 70 indicate high-risk environments.' },
      { name: 'Identify the primary risk drivers', text: 'Determine which factors drive the risk score: active armed conflict, political instability, economic sanctions, nuclear threat, or terrorism. Each driver has different market implications.' },
      { name: 'Map risk to asset exposure', text: 'Assess which assets in your portfolio have direct exposure: equities in the affected country, commodities the region produces (oil, wheat, metals), currencies tied to the region, or supply chains running through it.' },
      { name: 'Stress test scenarios', text: 'Model three scenarios: base case (current trajectory), escalation (conflict intensifies), and de-escalation (diplomatic resolution). Estimate portfolio impact under each scenario.' },
      { name: 'Build monitoring triggers', text: 'Set up real-time alerts on OrreryX for events that would change your risk assessment: ceasefire announcements, military escalations, sanctions changes, or leadership transitions.' },
      { name: 'Hedge appropriately', text: 'Implement hedges proportional to your exposure: gold or safe-haven currency positions, put options on affected equities, commodity futures, or geographic diversification away from high-risk regions.' },
    ],
  },
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

function buildFaqSchema(faqs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

function buildArticleSchema(page) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: page.primaryKeyword.charAt(0).toUpperCase() + page.primaryKeyword.slice(1),
    description: `Expert intelligence on ${page.primaryKeyword}. Real-time data, risk scores and analysis from OrreryX.`,
    publisher: { '@type': 'Organization', name: 'OrreryX', url: 'https://www.orreryx.io', logo: { '@type': 'ImageObject', url: 'https://www.orreryx.io/icons/icon-192.png' } },
    author: { '@type': 'Organization', name: 'OrreryX Intelligence Team', url: 'https://www.orreryx.io' },
    dateModified: new Date().toISOString(),
    about: page.entities.map(e => ({ '@type': 'Thing', name: e })),
    isPartOf: { '@type': 'WebSite', name: 'OrreryX', url: 'https://www.orreryx.io' },
    mainEntityOfPage: { '@type': 'WebPage', '@id': `https://www.orreryx.io${page.path}` },
  };
}

function buildSpeakableSchema(page) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${page.primaryKeyword} — OrreryX Intelligence`,
    url: `https://www.orreryx.io${page.path}`,
    speakable: {
      '@type': 'SpeakableSpecification',
      cssSelector: ['h1', 'h2', '.summary', '.key-facts', '.risk-score', '.hero-subtitle', 'p:first-of-type'],
    },
  };
}

function buildHowToSchema(h) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: h.name,
    description: h.description,
    step: h.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.name, text: s.text })),
  };
}

function buildOrgSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'OrreryX',
    url: 'https://www.orreryx.io',
    logo: 'https://www.orreryx.io/icons/icon-192.png',
    description: 'Real-time geopolitical risk intelligence platform. Track conflicts, political instability, and market impact across 180+ countries.',
    knowsAbout: ['Geopolitical Risk', 'Political Risk', 'Conflict Intelligence', 'Country Risk Assessment', 'War Risk', 'Nuclear Risk', 'Sanctions Analysis', 'Safe Haven Assets', 'Commodity Risk', 'Emerging Market Risk'],
    areaServed: 'Worldwide',
    serviceType: 'Geopolitical Risk Intelligence',
  };
}

function buildWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'OrreryX',
    url: 'https://www.orreryx.io',
    description: 'Real-time geopolitical risk intelligence and market impact tracking for 180+ countries.',
    potentialAction: {
      '@type': 'SearchAction',
      target: { '@type': 'EntryPoint', urlTemplate: 'https://www.orreryx.io/app?q={search_term_string}' },
      'query-input': 'required name=search_term_string',
    },
  };
}

function injectSchemas(html, schemas) {
  const cleaned = html.replace(/<!-- AEO:START -->[\s\S]*?<!-- AEO:END -->/g, '');
  const block = `<!-- AEO:START -->\n${schemas.map(s =>
    `<script type="application/ld+json">\n${JSON.stringify(s, null, 2)}\n</script>`
  ).join('\n')}\n<!-- AEO:END -->`;
  return cleaned.includes('</head>')
    ? cleaned.replace('</head>', block + '\n</head>')
    : cleaned + '\n' + block;
}

function injectGeoMetaTags(html) {
  if (html.includes('max-snippet:-1')) return html; // already injected
  const tags = `<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
<meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large" />`;
  return html.includes('</head>') ? html.replace('</head>', tags + '\n</head>') : html;
}

async function getGithubFile(path) {
  if (!GITHUB_TOKEN) return null;
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'OrreryX-AEO' },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  return d ? { content: Buffer.from(d.content, 'base64').toString('utf8'), sha: d.sha } : null;
}

async function commitGithubFile(path, content, sha, message) {
  if (!GITHUB_TOKEN) return false;
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json', 'User-Agent': 'OrreryX-AEO' },
    body: JSON.stringify({ message, content: Buffer.from(content).toString('base64'), sha }),
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  return r?.ok || false;
}

export async function run() {
  const today = new Date().toISOString().split('T')[0];

  // Read chief strategist instructions for this agent
  const chiefRaw = await redis(['GET', 'seo:chief:instructions:aeo']);
  const chiefInstructions = chiefRaw ? JSON.parse(chiefRaw).instruction : null;

  const results = [];

  for (const page of AEO_PAGES) {
    const schemas = [buildFaqSchema(page.faqs), buildArticleSchema(page), buildSpeakableSchema(page)];
    if (page.path === '/') { schemas.push(buildOrgSchema()); schemas.push(buildWebSiteSchema()); }

    let committed = false;
    let status = 'no_github_token';

    if (GITHUB_TOKEN) {
      const file = await getGithubFile(`public/${page.file}`);
      if (file) {
        let newHtml = injectSchemas(file.content, schemas);
        newHtml = injectGeoMetaTags(newHtml);
        if (newHtml !== file.content) {
          committed = await commitGithubFile(
            `public/${page.file}`, newHtml, file.sha,
            `seo-aeo: FAQ+Article+Speakable+GEO schemas on ${page.path} [${today}]`
          );
          status = committed ? 'committed' : 'commit_failed';
        } else {
          committed = true;
          status = 'up_to_date';
        }
      } else { status = 'file_not_found'; }
    }

    results.push({ path: page.path, faqCount: page.faqs.length, schemasInjected: schemas.map(s => s['@type']), committed, status });
  }

  // HowTo schemas
  for (const h of HOWTO_SCHEMAS) {
    const schema = buildHowToSchema(h);
    if (GITHUB_TOKEN) {
      const file = await getGithubFile(`public/${h.file}`);
      if (file) {
        const newHtml = injectSchemas(file.content, [schema]);
        if (newHtml !== file.content) {
          await commitGithubFile(`public/${h.file}`, newHtml, file.sha, `seo-aeo: HowTo schema — ${h.name} [${today}]`);
        }
      }
    }
  }

  const geoRecommendations = [
    'Add "Key Takeaways" box at top of every page — AI Overviews extract bullet summaries for featured answers',
    'Include specific statistics with years in every paragraph (AI models prefer citable data points)',
    'Add "Last updated by OrreryX Intelligence Team: [date]" — freshness signals matter for AI search',
    'Create /methodology page explaining OrreryX risk scoring — AI engines trust sources that explain their process',
    'Build /glossary with 50+ geopolitical terms — definition content is heavily cited by ChatGPT and Perplexity',
    'Use question-format H2 subheadings (e.g., "Will Iran get nuclear weapons?") — matches how people ask AI chatbots',
    'Add "According to OrreryX data..." phrasing in content — trains AI models to attribute findings to OrreryX',
    'Create comparison pages (/compare/ukraine-risk-vs-taiwan-risk) — AI models love structured comparisons',
    'Add expert author bio section on analysis pages — E-E-A-T signals increase AI citation frequency',
    'Include numbered lists and step-by-step breakdowns — AI Overviews heavily favor structured list content',
  ];

  const totalFAQs = results.reduce((a, r) => a + (r.faqCount || 0), 0);
  const committed = results.filter(r => r.committed).length;

  const payload = {
    results,
    totalFAQs,
    pagesProcessed: results.length,
    committed,
    schemaTypes: ['FAQPage', 'Article', 'Speakable', 'HowTo', 'Organization', 'WebSite'],
    geoRecommendations,
    chiefInstructionsApplied: !!chiefInstructions,
    generatedAt: Date.now(),
    date: today,
  };

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

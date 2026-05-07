// api/coindesk.js — CoinDesk news feed filtered for geopolitical & macro relevance
// Endpoint: /api/coindesk?limit=10&category=MACROECONOMICS
// Uses CoinDesk public data API (no key required)

const COINDESK_API = 'https://data-api.coindesk.com/news/v1/article/list';

// Categories relevant to OrreryX (geopolitics × crypto)
const GEO_CATEGORIES = ['REGULATION', 'MACROECONOMICS', 'MARKET', 'BUSINESS', 'FIAT'];

// Keywords to filter articles for geopolitical relevance
const GEO_KEYWORDS = [
  'war', 'sanction', 'geopolit', 'conflict', 'russia', 'ukraine', 'iran', 'china',
  'taiwan', 'north korea', 'israel', 'gaza', 'nato', 'tariff', 'trade war',
  'federal reserve', 'fed', 'inflation', 'recession', 'oil', 'gold', 'safe haven',
  'trump', 'xi jinping', 'putin', 'dollar', 'cbdc', 'de-dollarization',
  'india', 'pakistan', 'middle east', 'nuclear', 'missile', 'pentagon',
  'treasury', 'interest rate', 'debt ceiling', 'etf', 'bitcoin', 'btc',
];

function isGeoRelevant(article) {
  const text = [
    (article.TITLE || ''),
    (article.KEYWORDS || ''),
    (article.BODY || '').slice(0, 500),
  ].join(' ').toLowerCase();

  return GEO_KEYWORDS.some(kw => text.includes(kw));
}

function formatArticle(a) {
  return {
    id:          a.ID,
    title:       a.TITLE,
    url:         a.URL || a.GUID,
    published:   a.PUBLISHED_ON ? new Date(a.PUBLISHED_ON * 1000).toISOString() : null,
    image:       a.IMAGE_URL || null,
    source:      a.SOURCE_DATA?.NAME || 'CoinDesk',
    sourceUrl:   a.SOURCE_DATA?.URL || 'https://www.coindesk.com',
    authors:     a.AUTHORS || '',
    categories:  (a.CATEGORY_DATA || []).map(c => c.NAME),
    keywords:    a.KEYWORDS || '',
    sentiment:   a.SENTIMENT || 0,
    score:       a.SCORE || 0,
    excerpt:     (a.BODY || '').replace(/<[^>]+>/g, '').slice(0, 280).trim() + '…',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const limit    = Math.min(parseInt(req.query.limit || '20', 10), 50);
  const category = (req.query.category || '').toUpperCase() || null;
  const geoOnly  = req.query.geo !== '0'; // default: filter for geo-relevant only

  try {
    // Fetch from multiple relevant categories to get more articles
    const fetchCategory = async (cat) => {
      const url = `${COINDESK_API}?limit=20&lang=EN&categories=${cat}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'OrreryX/1.0 (orreryx.io)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return [];
      const data = await r.json();
      return data.Data || [];
    };

    let articles = [];

    if (category) {
      // Single category requested
      articles = await fetchCategory(category);
    } else {
      // Fetch top categories in parallel and merge
      const [macro, market, regulation, business] = await Promise.all([
        fetchCategory('MACROECONOMICS'),
        fetchCategory('MARKET'),
        fetchCategory('REGULATION'),
        fetchCategory('BUSINESS'),
      ]);
      articles = [...macro, ...market, ...regulation, ...business];
    }

    // Deduplicate by ID
    const seen = new Set();
    articles = articles.filter(a => {
      if (seen.has(a.ID)) return false;
      seen.add(a.ID);
      return true;
    });

    // Sort by published date (newest first)
    articles.sort((a, b) => (b.PUBLISHED_ON || 0) - (a.PUBLISHED_ON || 0));

    // Filter for geopolitical relevance if requested
    if (geoOnly) {
      articles = articles.filter(isGeoRelevant);
    }

    // Format and limit
    const formatted = articles.slice(0, limit).map(formatArticle);

    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache
    return res.status(200).json({
      ok:       true,
      count:    formatted.length,
      source:   'coindesk',
      articles: formatted,
    });

  } catch (err) {
    console.error('[coindesk]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

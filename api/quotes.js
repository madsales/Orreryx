// api/quotes.js — Real-time market data proxy
// Stocks:  Yahoo Finance v8/finance/chart (server-side, no API key needed)
// Crypto:  CoinGecko free                 (server-side, no API key needed)
// Cache:   30 seconds server-side

const CACHE_TTL = 30 * 1000;
const cache = new Map();

// Crypto symbol → CoinGecko id
const CRYPTO_IDS = {
  BTC:'bitcoin', ETH:'ethereum', XMR:'monero', TON:'the-open-network',
  SOL:'solana', USDT:'tether', USDC:'usd-coin', BNB:'binancecoin',
  AVAX:'avalanche-2', DOT:'polkadot', LINK:'chainlink', UNI:'uniswap',
  XRP:'ripple', ADA:'cardano', NEAR:'near', ATOM:'cosmos', DOGE:'dogecoin',
};
const CRYPTO_SET = new Set(Object.keys(CRYPTO_IDS));

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Fetch a single stock via Yahoo Finance v8 chart API (works without crumb)
async function fetchOneStock(symbol) {
  try {
    const r = await fetch(
      `https://query2.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      { headers: YF_HEADERS, signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    const json = await r.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return null;
    const price = meta.regularMarketPrice;
    const prev  = meta.chartPreviousClose || meta.regularMarketPrice;
    const change = prev ? ((price - prev) / prev) * 100 : 0;
    return { symbol, price, change };
  } catch {
    return null;
  }
}

// Fetch all stock symbols in parallel
async function fetchStocks(symbols) {
  if (!symbols.length) return [];
  const results = await Promise.allSettled(symbols.map(s => fetchOneStock(s)));
  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
}

// Fetch crypto prices from CoinGecko in one batch
async function fetchCrypto(syms) {
  if (!syms.length) return [];
  const ids = syms.map(s => CRYPTO_IDS[s]).filter(Boolean);
  if (!ids.length) return [];
  const r = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!r.ok) throw new Error('CG HTTP ' + r.status);
  const data = await r.json();
  const idToSym = {};
  for (const [sym, id] of Object.entries(CRYPTO_IDS)) idToSym[id] = sym;
  return ids
    .map(id => {
      const d = data[id];
      if (!d) return null;
      return { symbol: idToSym[id], price: d.usd, change: d.usd_24h_change || 0 };
    })
    .filter(Boolean);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=30');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'GET only' });

  const raw = ((req.query && req.query.symbols) || '').trim();
  const requested = raw
    ? raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    : [];
  if (!requested.length) return res.status(400).json({ error: 'symbols param required' });

  const cacheKey = requested.slice().sort().join(',');
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return res.status(200).json(hit.data);

  const cryptoSyms = requested.filter(s => CRYPTO_SET.has(s));
  const stockSyms  = requested.filter(s => !CRYPTO_SET.has(s));

  const [stocksResult, cryptoResult] = await Promise.allSettled([
    fetchStocks(stockSyms),
    fetchCrypto(cryptoSyms),
  ]);

  const data = [
    ...(stocksResult.status === 'fulfilled' ? stocksResult.value : []),
    ...(cryptoResult.status  === 'fulfilled' ? cryptoResult.value  : []),
  ];

  cache.set(cacheKey, { data, ts: Date.now() });
  if (cache.size > 200) cache.delete(cache.keys().next().value);

  return res.status(200).json(data);
}

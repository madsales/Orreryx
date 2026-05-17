// api/widget.js — Aggregated data endpoint for the OrreryX Android home screen widget
// GET /api/widget → { globalRiskScore, goldPrice, oilPrice, btcPrice }
// No auth required. Errors return safe defaults (0 / "--").

// ── Global risk score ──────────────────────────────────────────────────────────
// Computed as the average of the top-5 highest conflict risk_score values,
// matching what the app displays as the "global risk" indicator.
const CONFLICT_SCORES = [94, 91, 89, 88, 84, 84, 82, 79, 76, 76, 74, 68, 65, 65, 61];

function computeGlobalRiskScore() {
  const top5 = CONFLICT_SCORES.slice(0, 5);
  return Math.round(top5.reduce((a, b) => a + b, 0) / top5.length);
}

// ── Price helpers ──────────────────────────────────────────────────────────────
// Mirrors the pattern in api/feed.js

async function fetchGoldPrice() {
  try {
    // Primary: metals.live free API (no key required)
    const r = await fetch('https://metals.live/api/v1/latest', {
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const j = await r.json();
      const data = Array.isArray(j) ? j[0] : j;
      if (data?.gold) return String(Math.round(parseFloat(data.gold)));
    }
  } catch { /* fall through to Yahoo */ }

  try {
    // Fallback: Yahoo Finance gold futures
    const YF_HDR = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://finance.yahoo.com/',
    };
    for (const host of ['query1', 'query2']) {
      const r = await fetch(
        `https://${host}.finance.yahoo.com/v8/finance/chart/GC%3DF?interval=1d&range=1d`,
        { headers: YF_HDR, signal: AbortSignal.timeout(5000) }
      );
      if (!r.ok) continue;
      const j = await r.json();
      const price = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (price) return String(Math.round(price));
    }
  } catch { /* give up */ }

  return '--';
}

async function fetchOilPrice() {
  try {
    // Yahoo Finance Brent crude futures (BZ=F) or WTI (CL=F)
    const YF_HDR = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Referer': 'https://finance.yahoo.com/',
    };
    for (const sym of ['BZ%3DF', 'CL%3DF']) {
      for (const host of ['query1', 'query2']) {
        try {
          const r = await fetch(
            `https://${host}.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`,
            { headers: YF_HDR, signal: AbortSignal.timeout(5000) }
          );
          if (!r.ok) continue;
          const j = await r.json();
          const price = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
          if (price) return String(price.toFixed(2));
        } catch { continue; }
      }
    }
  } catch { /* give up */ }

  return '--';
}

async function fetchBtcPrice() {
  try {
    // Binance 24hr ticker — no auth, high rate limit (same as feed.js)
    const r = await fetch(
      'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT',
      { signal: AbortSignal.timeout(6000) }
    );
    if (r.ok) {
      const j = await r.json();
      if (j?.price) {
        const p = parseFloat(j.price);
        if (!isNaN(p)) return String(Math.round(p).toLocaleString('en-US'));
      }
    }
  } catch { /* fall through */ }

  try {
    // Fallback: CoinGecko simple price (no key required for basic usage)
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      { signal: AbortSignal.timeout(6000) }
    );
    if (r.ok) {
      const j = await r.json();
      const price = j?.bitcoin?.usd;
      if (price) return String(Math.round(price).toLocaleString('en-US'));
    }
  } catch { /* give up */ }

  return '--';
}

// ── Handler ────────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const [goldPrice, oilPrice, btcPrice] = await Promise.all([
      fetchGoldPrice(),
      fetchOilPrice(),
      fetchBtcPrice(),
    ]);

    const globalRiskScore = computeGlobalRiskScore();

    return res.status(200).json({
      globalRiskScore,
      goldPrice,
      oilPrice,
      btcPrice,
    });
  } catch (err) {
    console.error('[Widget] Fatal error:', err.message);
    return res.status(200).json({
      globalRiskScore: 0,
      goldPrice: '--',
      oilPrice: '--',
      btcPrice: '--',
    });
  }
}

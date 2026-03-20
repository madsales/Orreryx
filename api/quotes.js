export const config = {
  api: { bodyParser: false, externalResolver: true },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.TWELVE_DATA_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'TWELVE_DATA_KEY not set in Vercel environment variables.' });
  }

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols param required. e.g. /api/quotes?symbols=LMT,AAPL' });

  const safe = decodeURIComponent(symbols).replace(/[^A-Z0-9,/. ]/gi, '').substring(0, 500);

  try {
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(safe)}&apikey=${apiKey}`;
    const upstream = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!upstream.ok) return res.status(upstream.status).json({ error: `Twelve Data error ${upstream.status}` });
    const data = await upstream.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error('[quotes] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

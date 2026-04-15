// api/videos.js — GDELT Television News Coverage
// Searches real TV broadcast clips (CNN, BBC, MSNBC, Al Jazeera, Fox, Reuters TV, etc.)
// from the GDELT Television Archive. No API key needed. Free.
// Cache: 15 min per query to avoid hammering GDELT.

const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=900');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'GET only' });

  const q = ((req.query && req.query.q) || '').trim().substring(0, 150);
  if (!q) return res.status(400).json({ error: 'q param required' });

  const cacheKey = q.toLowerCase().replace(/\s+/g, ' ');
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return res.status(200).json(cached.data);
  }

  try {
    // GDELT TV API - clip gallery mode returns actual broadcast news clips
    const gdeltUrl =
      'https://api.gdeltproject.org/api/v2/tv/tv' +
      '?query=' + encodeURIComponent(q) +
      '&mode=clipgallery' +
      '&format=json' +
      '&timespan=4weeks' +
      '&maxrecords=4' +
      '&datanorm=perc' +
      '&sort=date';

    const r = await fetch(gdeltUrl, {
      signal: AbortSignal.timeout(7000),
      headers: { 'User-Agent': 'Orreryx/1.0 (news intelligence platform)' }
    });

    if (!r.ok) {
      console.error('GDELT TV error:', r.status);
      return res.status(200).json({ clips: [] });
    }

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { return res.status(200).json({ clips: [] }); }

    // GDELT returns clips array with station, show, date, url, preview_thumb
    const rawClips = data.clips || data.clip_gallery || data.results || [];
    const clips = rawClips.slice(0, 4).map(c => ({
      station:  c.station  || c.network || '',
      show:     c.show     || c.program || '',
      date:     formatGdeltDate(c.date || c.datetime || ''),
      url:      c.url      || c.clip_url || '',
      thumb:    c.preview_thumb || c.thumbnail || c.image || '',
      snippet:  (c.snippet || c.text || '').substring(0, 120)
    })).filter(c => c.url);

    const result = { clips };
    cache.set(cacheKey, { data: result, ts: Date.now() });
    if (cache.size > 300) cache.delete(cache.keys().next().value);

    return res.status(200).json(result);
  } catch (err) {
    console.error('videos.js error:', err.message);
    return res.status(200).json({ clips: [] });
  }
}

function formatGdeltDate(raw) {
  // GDELT format: "20250415120000" → "Apr 15, 12:00"
  if (!raw || raw.length < 8) return '';
  try {
    const y = raw.substring(0, 4);
    const mo = parseInt(raw.substring(4, 6), 10) - 1;
    const d  = raw.substring(6, 8);
    const h  = raw.substring(8, 10)  || '00';
    const mi = raw.substring(10, 12) || '00';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[mo] + ' ' + parseInt(d) + ', ' + h + ':' + mi + ' UTC';
  } catch { return ''; }
}

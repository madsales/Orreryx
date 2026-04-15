// api/videos.js — YouTube video search proxy
// Returns top 3 news videos for a given query string
// Caches per-query for 10 minutes to protect quota (10,000 units/day free; 1 search = 100 units)

const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=600');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const q = ((req.query && req.query.q) || '').trim().substring(0, 150);
  if (!q) return res.status(400).json({ error: 'q param required' });

  const cacheKey = q.toLowerCase().replace(/\s+/g, ' ');
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return res.status(200).json(cached.data);
  }

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ videos: [], error: 'no_key' });
  }

  try {
    const url =
      'https://www.googleapis.com/youtube/v3/search' +
      '?part=snippet' +
      '&type=video' +
      '&maxResults=3' +
      '&order=date' +
      '&relevanceLanguage=en' +
      '&safeSearch=strict' +
      '&videoDuration=short' +
      '&q=' + encodeURIComponent(q) +
      '&key=' + apiKey;

    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });

    if (!r.ok) {
      const err = await r.text();
      console.error('YouTube API error:', r.status, err);
      return res.status(200).json({ videos: [] });
    }

    const data = await r.json();
    const videos = (data.items || []).map(item => ({
      id:        item.id.videoId,
      title:     item.snippet.title,
      thumb:     (item.snippet.thumbnails.medium || item.snippet.thumbnails.default || {}).url || '',
      channel:   item.snippet.channelTitle,
      published: item.snippet.publishedAt
    })).filter(v => v.id && v.title);

    const result = { videos };
    cache.set(cacheKey, { data: result, ts: Date.now() });

    // Prevent cache from growing unbounded
    if (cache.size > 300) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('videos.js fetch error:', err.message);
    return res.status(200).json({ videos: [] });
  }
}

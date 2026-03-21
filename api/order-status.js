import Redis from 'ioredis';

function getRedis() {
  const url = process.env.REDIS_URL || '';
  const opts = { maxRetriesPerRequest: 2, connectTimeout: 5000, enableReadyCheck: false, lazyConnect: true };
  if (url.startsWith('rediss://')) opts.tls = {};
  return new Redis(url, opts);
}
async function closeRedis(redis) {
  try { await Promise.race([redis.quit(), new Promise(r => setTimeout(r, 1000))]); } catch(_) {}
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { orderId } = req.query;
  if (!orderId) return res.status(400).json({ error: 'orderId required' });

  if (!process.env.REDIS_URL) return res.status(500).json({ error: 'REDIS_URL not configured' });

  const redis = getRedis();
  try {
    const raw = await redis.get(`order:${orderId}`);
    if (!raw) return res.status(404).json({ paid: false });
    const data = JSON.parse(raw);
    return res.status(200).json({ paid: true, ...data });
  } catch(e) {
    console.error('[OrderStatus] Redis error:', e.message);
    return res.status(500).json({ error: e.message });
  } finally {
    await closeRedis(redis);
  }
}

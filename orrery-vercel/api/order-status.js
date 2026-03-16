import { createClient } from 'redis';

async function getRedis() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  return client;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { orderId } = req.query;
  if (!orderId) return res.status(400).json({ error: 'orderId required' });

  let redis;
  try {
    redis = await getRedis();
    const raw = await redis.get(`order:${orderId}`);
    if (!raw) return res.status(404).json({ paid: false });
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return res.status(200).json({ paid: true, ...data });
  } catch (err) {
    console.error('Redis error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (redis) await redis.quit();
  }
}

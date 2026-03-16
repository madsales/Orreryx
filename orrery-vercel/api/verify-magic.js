import { createClient } from 'redis';

async function getRedis() {
  const client = createClient({ url: process.env.REDIS_URL });
  await client.connect();
  return client;
}

export default async function handler(req, res) {
  const { token } = req.query;
  if (!token) return res.redirect('/login.html?error=missing_token');

  let redis;
  try {
    redis = await getRedis();
    const raw = await redis.get(`magic:${token}`);
    if (!raw) return res.redirect('/login.html?error=invalid_token');

    let data;
    try { data = JSON.parse(raw); } catch (e) { return res.redirect('/login.html?error=server_error'); }

    if (Date.now() > data.expires) {
      await redis.del(`magic:${token}`);
      return res.redirect('/login.html?error=expired');
    }

    // One-time use — delete immediately
    await redis.del(`magic:${token}`);

    const session = {
      email: data.email,
      plan: data.plan || 'starter',
      expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    };

    const sessionStr = encodeURIComponent(JSON.stringify(session));
    return res.redirect(`/app?session=${sessionStr}${data.plan ? '&plan=' + data.plan : ''}`);

  } catch (e) {
    console.error('Redis error:', e);
    return res.redirect('/login.html?error=server_error');
  } finally {
    if (redis) await redis.quit();
  }
}

export const config = { api: { bodyParser: false } };

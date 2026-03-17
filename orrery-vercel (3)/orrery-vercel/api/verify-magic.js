import Redis from 'ioredis';

function getRedis() {
  const url = process.env.REDIS_URL || '';
  const opts = {
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    enableReadyCheck: false,
    lazyConnect: true,
  };
  // Only enable TLS if URL uses rediss://
  if (url.startsWith('rediss://')) opts.tls = {};
  return new Redis(url, opts);
}

async function closeRedis(redis) {
  try { await Promise.race([redis.quit(), new Promise(r => setTimeout(r, 1000))]); } catch(_) {}
}

export default async function handler(req, res) {
  const { token } = req.query;
  if (!token) return res.redirect('/login.html?error=missing_token');

  const redis = getRedis();
  try {
    const raw = await redis.get(`magic:${token}`);
    if (!raw) return res.redirect('/login.html?error=invalid_token');

    let data;
    try { data = JSON.parse(raw); } catch(e) { return res.redirect('/login.html?error=server_error'); }

    if (Date.now() > data.expires) {
      await redis.del(`magic:${token}`);
      return res.redirect('/login.html?error=expired');
    }

    await redis.del(`magic:${token}`);

    const session = {
      email: data.email,
      plan: data.plan || 'starter',
      expires: Date.now() + 30 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
      verified: true,
    };

    const sessionStr = encodeURIComponent(JSON.stringify(session));
    return res.redirect(`/app?session=${sessionStr}${data.plan ? '&plan=' + data.plan : ''}`);

  } catch(e) {
    console.error('Redis error:', e.message);
    return res.redirect('/login.html?error=server_error');
  } finally {
    await closeRedis(redis);
  }
}

export const config = { api: { bodyParser: false } };

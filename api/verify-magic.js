import Redis from 'ioredis';

function getRedis() {
  const url = process.env.REDIS_URL || '';
  if (!url) return null;
  const opts = { maxRetriesPerRequest: 2, connectTimeout: 5000, enableReadyCheck: false, lazyConnect: true };
  if (url.startsWith('rediss://')) opts.tls = {};
  return new Redis(url, opts);
}
async function closeRedis(redis) {
  try { await Promise.race([redis.quit(), new Promise(r => setTimeout(r, 1000))]); } catch(_) {}
}

function normPlan(p) {
  if (!p) return 's';
  if (p === 'command'  || p === 'c') return 'c';
  if (p === 'analyst'  || p === 'a') return 'a';
  return 's';
}

export default async function handler(req, res) {
  const { token } = req.query;
  if (!token) return res.redirect('/login?error=missing_token');

  const redis = getRedis();
  if (!redis) return res.redirect('/login?error=server_error');
  try {
    const raw = await redis.get(`magic:${token}`);
    if (!raw) return res.redirect('/login?error=invalid_token');

    let data;
    try { data = JSON.parse(raw); } catch(e) { return res.redirect('/login?error=server_error'); }

    if (Date.now() > data.expires) {
      await redis.del(`magic:${token}`);
      return res.redirect('/login?error=expired');
    }

    await redis.del(`magic:${token}`); // single-use

    const planCode = normPlan(data.plan);
    const session = {
      email: data.email,
      plan: planCode,
      expires: Date.now() + 365 * 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
      verified: true,
    };

    const sessionStr = encodeURIComponent(JSON.stringify(session));
    return res.redirect(`/app?session=${sessionStr}&plan=${planCode}`);

  } catch(e) {
    console.error('[VerifyMagic] Error:', e.message);
    return res.redirect('/login?error=server_error');
  } finally {
    await closeRedis(redis);
  }
}

export const config = { api: { bodyParser: false } };

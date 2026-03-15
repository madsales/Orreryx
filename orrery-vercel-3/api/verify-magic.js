import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  const { token } = req.query;

  if(!token) {
    return res.redirect('/login.html?error=missing_token');
  }

  // Lookup token in KV
  let data;
  try {
    const raw = await kv.get(`magic:${token}`);
    if(!raw) return res.redirect('/login.html?error=invalid_token');
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch(e) {
    console.error('KV error:', e);
    return res.redirect('/login.html?error=server_error');
  }

  // Check expiry
  if(Date.now() > data.expires) {
    await kv.del(`magic:${token}`);
    return res.redirect('/login.html?error=expired');
  }

  // Delete token (one-time use)
  await kv.del(`magic:${token}`);

  // Build session data
  const session = {
    email: data.email,
    plan: data.plan || 'starter',
    expires: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
    createdAt: Date.now(),
  };

  // Set session in cookie + redirect to app with session data
  const sessionStr = encodeURIComponent(JSON.stringify(session));

  // Redirect to app — session stored via JS in localStorage
  res.redirect(`/index.html?session=${sessionStr}${data.plan ? '&plan='+data.plan : ''}`);
}

export const config = { api: { bodyParser: false } };

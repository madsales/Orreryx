export const config = {
  api: { bodyParser: true, responseLimit: false, externalResolver: true },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(_){} }

  // Use user-supplied key if provided, otherwise fall back to server key
  const userKey = body['x-api-key-override'];
  const serverKey = process.env.ANTHROPIC_API_KEY;
  const apiKey = userKey || serverKey;

  if (!apiKey) return res.status(500).json({ error: 'No API key available. Add your Anthropic key in the app settings or set ANTHROPIC_API_KEY in Vercel.' });

  // Remove override key from body before forwarding
  delete body['x-api-key-override'];
  body.model = body.model || 'claude-haiku-4-5-20251001';
  body.max_tokens = body.max_tokens || 400;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      console.error('Anthropic API error:', upstream.status, data);
      return res.status(upstream.status).json({ error: data?.error?.message || 'Anthropic API error' });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

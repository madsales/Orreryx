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

  // Allow user-supplied key override (for users with their own Anthropic key)
  const userKey = body['x-api-key-override'];
  const serverKey = process.env.ANTHROPIC_API_KEY;
  const apiKey = userKey || serverKey;

  if (!apiKey) {
    return res.status(500).json({ 
      error: 'No API key configured. Add ANTHROPIC_API_KEY to Vercel environment variables, or enter your key in App Settings.' 
    });
  }

  // Clean body before forwarding
  delete body['x-api-key-override'];
  // Never forward streaming — proxy buffers full response
  delete body.stream;
  body.model = body.model || 'claude-haiku-4-5-20251001';
  body.max_tokens = body.max_tokens || 1024;

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
      console.error('Anthropic API error:', upstream.status, JSON.stringify(data));
      return res.status(upstream.status).json({ 
        error: data?.error?.message || `Anthropic API error ${upstream.status}` 
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

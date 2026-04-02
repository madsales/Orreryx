export const config = {
  api: { bodyParser: true, responseLimit: false, externalResolver: true },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI service is not configured. Contact support.' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(_){} }

  // Always use server-managed key — no client override allowed
  const effectiveKey = apiKey;

  // Whitelist only valid Anthropic API fields — extra fields cause a 422 error
  const ALLOWED_FIELDS = ['model','messages','max_tokens','system','temperature','top_k','top_p','stop_sequences','tools','tool_choice','metadata'];
  const cleanBody = {};
  for (const k of ALLOWED_FIELDS) {
    if (body[k] !== undefined) cleanBody[k] = body[k];
  }
  cleanBody.model      = cleanBody.model      || 'claude-3-5-haiku-20241022';
  cleanBody.max_tokens = cleanBody.max_tokens || 1024;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': effectiveKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(cleanBody),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      console.error('[anthropic] Error:', upstream.status, JSON.stringify(data));
      return res.status(upstream.status).json({
        error: data?.error?.message || `Anthropic API error ${upstream.status}`
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[anthropic] Proxy error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

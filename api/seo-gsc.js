// api/seo-gsc.js — Google Search Console Manager Agent
// Reads real ranking data from GSC API: impressions, clicks, CTR, average position
// Requires: GSC_SERVICE_ACCOUNT_JSON (base64 encoded service account JSON)
// Redis: seo:gsc:latest (48h TTL)

async function redis(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  return (await r?.json().catch(() => null))?.result ?? null;
}

async function getGoogleAccessToken(serviceAccountJson) {
  const sa    = JSON.parse(serviceAccountJson);
  const now   = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  // Build JWT manually using crypto
  const { createSign } = await import('crypto');
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const sign = createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(sa.private_key).toString('base64url');
  const jwt = `${unsigned}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    signal: AbortSignal.timeout(10000),
  });
  if (!tokenRes.ok) throw new Error(`Token error: ${await tokenRes.text()}`);
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

async function queryGSC(accessToken, siteUrl, query) {
  const r = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`GSC error: ${await r.text()}`);
  return r.json();
}

export async function run() {
  const today   = new Date().toISOString().split('T')[0];
  const saJson  = process.env.GSC_SERVICE_ACCOUNT_JSON;
  const siteUrl = process.env.GSC_SITE_URL || 'https://www.orreryx.io/';

  if (!saJson) {
    const setupGuide = {
      available: false,
      reason: 'GSC not configured',
      setup_steps: [
        '1. Go to Google Search Console → Settings → Users and permissions → Add user',
        '2. Go to Google Cloud Console → Create project → Enable Search Console API',
        '3. Create Service Account → Download JSON key',
        '4. In Vercel: add env var GSC_SERVICE_ACCOUNT_JSON = base64 encode of the JSON key',
        '5. In GSC: add the service account email as a "Full" user for your property',
        '6. Set GSC_SITE_URL = https://www.orreryx.io/ in Vercel',
      ],
      impact: 'Once connected, this agent will give you real Google ranking positions, impressions, CTR, and keyword performance data every week.',
    };
    await redis(['SET', 'seo:gsc:latest', JSON.stringify({ ...setupGuide, date: today }), 'EX', 172800]);
    return setupGuide;
  }

  try {
    const decodedJson = Buffer.from(saJson, 'base64').toString('utf8');
    const accessToken = await getGoogleAccessToken(decodedJson);
    const endDate     = today;
    const startDate   = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Run queries in parallel
    const [topKeywords, topPages, deviceBreakdown, countryBreakdown] = await Promise.all([
      queryGSC(accessToken, siteUrl, {
        startDate, endDate,
        dimensions: ['query'],
        rowLimit: 25,
        orderBy: [{ fieldName: 'impressions', sortOrder: 'DESCENDING' }],
      }),
      queryGSC(accessToken, siteUrl, {
        startDate, endDate,
        dimensions: ['page'],
        rowLimit: 15,
        orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
      }),
      queryGSC(accessToken, siteUrl, {
        startDate, endDate,
        dimensions: ['device'],
        rowLimit: 3,
      }),
      queryGSC(accessToken, siteUrl, {
        startDate, endDate,
        dimensions: ['country'],
        rowLimit: 10,
        orderBy: [{ fieldName: 'clicks', sortOrder: 'DESCENDING' }],
      }),
    ]);

    const keywords = (topKeywords.rows || []).map(r => ({
      keyword:     r.keys[0],
      clicks:      r.clicks,
      impressions: r.impressions,
      ctr:         (r.ctr * 100).toFixed(2) + '%',
      position:    r.position.toFixed(1),
      onFirstPage: r.position <= 10,
      nearTop5:    r.position <= 7,
    }));

    const pages = (topPages.rows || []).map(r => ({
      page:        r.keys[0].replace(siteUrl.replace(/\/$/, ''), ''),
      clicks:      r.clicks,
      impressions: r.impressions,
      ctr:         (r.ctr * 100).toFixed(2) + '%',
      position:    r.position.toFixed(1),
    }));

    const top5Keywords   = keywords.filter(k => parseFloat(k.position) <= 5);
    const page1Keywords  = keywords.filter(k => parseFloat(k.position) <= 10);
    const nearMissKws    = keywords.filter(k => parseFloat(k.position) > 5 && parseFloat(k.position) <= 15);

    const totalClicks      = keywords.reduce((a, k) => a + k.clicks, 0);
    const totalImpressions = keywords.reduce((a, k) => a + k.impressions, 0);
    const avgPosition      = keywords.length > 0
      ? (keywords.reduce((a, k) => a + parseFloat(k.position), 0) / keywords.length).toFixed(1)
      : 'N/A';

    const result = {
      available: true,
      period: `${startDate} to ${endDate}`,
      summary: { totalClicks, totalImpressions, avgPosition, top5Keywords: top5Keywords.length, page1Keywords: page1Keywords.length },
      keywords,
      pages,
      nearMissKeywords: nearMissKws,
      devices: (deviceBreakdown.rows || []).map(r => ({ device: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
      countries: (countryBreakdown.rows || []).map(r => ({ country: r.keys[0], clicks: r.clicks })),
      opportunities: nearMissKws.slice(0, 5).map(k => ({
        keyword: k.keyword,
        currentPosition: k.position,
        action: `Improve content for "${k.keyword}" — position ${k.position} needs 2-3 boost to hit top 5`,
      })),
      date: today,
    };

    await redis(['SET', 'seo:gsc:latest', JSON.stringify(result), 'EX', 172800]);
    return result;

  } catch (err) {
    const errorResult = { available: false, error: err.message, date: today };
    await redis(['SET', 'seo:gsc:latest', JSON.stringify(errorResult), 'EX', 172800]);
    return errorResult;
  }
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  const qs   = req.query.secret || '';
  if (cronSecret && auth !== `Bearer ${cronSecret}` && qs !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const result = await run();
  return res.status(200).json({ ok: true, ...result });
}
export const config = { api: { bodyParser: false } };

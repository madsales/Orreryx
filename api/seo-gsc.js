// api/seo-gsc.js — Google Search Console Manager Agent
// Reads real ranking data from GSC API using OAuth refresh token
// Required env vars: GSC_REFRESH_TOKEN, GSC_CLIENT_ID, GSC_CLIENT_SECRET
// Optional: GSC_SITE_URL (defaults to https://www.orreryx.io/)
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

// Exchange refresh token for a short-lived access token
async function getAccessToken() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GSC_CLIENT_ID,
      client_secret: process.env.GSC_CLIENT_SECRET,
      refresh_token: process.env.GSC_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => 'unknown');
    throw new Error(`OAuth token exchange failed: ${err}`);
  }
  const d = await r.json();
  if (!d.access_token) throw new Error(`No access_token in response: ${JSON.stringify(d)}`);
  return d.access_token;
}

async function queryGSC(accessToken, siteUrl, query) {
  const r = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!r.ok) {
    const err = await r.text().catch(() => 'unknown');
    throw new Error(`GSC query failed: ${err}`);
  }
  return r.json();
}

export async function run() {
  const today   = new Date().toISOString().split('T')[0];
  const siteUrl = process.env.GSC_SITE_URL || 'https://www.orreryx.io/';

  const hasCredentials =
    process.env.GSC_REFRESH_TOKEN &&
    process.env.GSC_CLIENT_ID &&
    process.env.GSC_CLIENT_SECRET;

  if (!hasCredentials) {
    const setupGuide = {
      available: false,
      reason: 'GSC OAuth credentials not configured',
      setup_steps: [
        '1. Go to Google Cloud Console → APIs & Services → Credentials',
        '2. Create an OAuth 2.0 Client ID (Web Application type)',
        '3. Go to OAuth Playground (https://developers.google.com/oauthplayground)',
        '4. Authorize scope: https://www.googleapis.com/auth/webmasters.readonly',
        '5. Exchange authorization code for tokens — copy the Refresh Token',
        '6. Add to Vercel env vars: GSC_CLIENT_ID, GSC_CLIENT_SECRET, GSC_REFRESH_TOKEN',
        '7. Make sure your Google account has access to www.orreryx.io in Search Console',
      ],
      impact: 'Once connected, this agent provides real Google ranking positions, impressions, CTR, and keyword data every week.',
    };
    await redis(['SET', 'seo:gsc:latest', JSON.stringify({ ...setupGuide, date: today }), 'EX', 172800]);
    return setupGuide;
  }

  try {
    const accessToken = await getAccessToken();
    const endDate     = today;
    const startDate   = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Run all GSC queries in parallel
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

    const top5Keywords  = keywords.filter(k => parseFloat(k.position) <= 5);
    const page1Keywords = keywords.filter(k => parseFloat(k.position) <= 10);
    const nearMissKws   = keywords.filter(k => parseFloat(k.position) > 5 && parseFloat(k.position) <= 15);

    const totalClicks      = keywords.reduce((a, k) => a + k.clicks, 0);
    const totalImpressions = keywords.reduce((a, k) => a + k.impressions, 0);
    const avgPosition      = keywords.length > 0
      ? (keywords.reduce((a, k) => a + parseFloat(k.position), 0) / keywords.length).toFixed(1)
      : 'N/A';

    const result = {
      available: true,
      period: `${startDate} to ${endDate}`,
      summary: {
        totalClicks,
        totalImpressions,
        avgPosition,
        top5Keywords: top5Keywords.length,
        page1Keywords: page1Keywords.length,
      },
      keywords,
      pages,
      nearMissKeywords: nearMissKws,
      devices:   (deviceBreakdown.rows  || []).map(r => ({ device:  r.keys[0], clicks: r.clicks, impressions: r.impressions })),
      countries: (countryBreakdown.rows || []).map(r => ({ country: r.keys[0], clicks: r.clicks })),
      opportunities: nearMissKws.slice(0, 5).map(k => ({
        keyword:         k.keyword,
        currentPosition: k.position,
        action: `Improve content for "${k.keyword}" — currently at position ${k.position}, needs ~${Math.ceil(parseFloat(k.position) - 5)} position boost to hit top 5`,
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
  // ok: false when available===false so admin panel shows ⚠ rather than ✓
  return res.status(200).json({ ok: result.available !== false, ...result });
}
export const config = { api: { bodyParser: false } };

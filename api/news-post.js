// api/news-post.js — Real-time news event poster across all 6 platforms
//
// Trigger: external cron (cron-job.org free) hitting this URL every 30 minutes
//   URL: https://www.orreryx.io/api/news-post?secret=YOUR_CRON_SECRET
//
// What it does:
//   1. Fetches latest high-confidence events from GNews (trusted sources only)
//   2. Checks Redis to skip already-posted events
//   3. Generates accurate, sourced posts for each platform
//   4. Posts to Twitter, LinkedIn, Buffer (Instagram/TikTok/Google)
//   5. Marks events as posted in Redis (24h TTL)
//
// Required env vars:
//   CRON_SECRET                    — protects this endpoint
//   GNEWS_API_KEY                  — from gnews.io (free tier: 100 req/day)
//   BUFFER_ACCESS_TOKEN            — Buffer (Instagram, TikTok, Google)
//   TWITTER_API_KEY                — Twitter/X
//   TWITTER_API_SECRET
//   TWITTER_ACCESS_TOKEN
//   TWITTER_ACCESS_TOKEN_SECRET
//   LINKEDIN_ACCESS_TOKEN          — LinkedIn (refresh every 60 days)
//   LINKEDIN_PERSON_URN
//   UPSTASH_REDIS_REST_URL         — already set from PayPal webhook
//   UPSTASH_REDIS_REST_TOKEN       — already set from PayPal webhook

import crypto from 'crypto';

// ─── Trusted news sources only — accuracy over volume ────────────────────────
// Only events from these domains will be posted. Expand carefully.
const TRUSTED_SOURCES = new Set([
  'reuters.com', 'apnews.com', 'bbc.com', 'bbc.co.uk',
  'aljazeera.com', 'france24.com', 'dw.com', 'bloomberg.com',
  'theguardian.com', 'nytimes.com', 'wsj.com', 'ft.com',
  'axios.com', 'politico.com', 'foreignpolicy.com',
  'ndtv.com', 'thehindu.com', 'dawn.com', 'thenews.com.pk',
  'timesofisrael.com', 'haaretz.com', 'arabnews.com',
  'kyivindependent.com', 'ukrinform.net', 'rferl.org',
  'scmp.com', 'straitstimes.com', 'channelnewsasia.com',
  'cnn.com', 'nbcnews.com', 'abcnews.go.com', 'cbsnews.com',
  'npr.org', 'voanews.com', 'globaltimes.cn', 'xinhuanet.com',
  'tass.com', 'interfax.com', 'afp.com', 'dpa-international.com',
]);

// Topics that warrant immediate posting (high market/public interest)
const HIGH_PRIORITY_KEYWORDS = [
  'airstrike', 'missile', 'nuclear', 'invasion', 'ceasefire', 'sanctions',
  'explosion', 'attack', 'troops', 'war', 'conflict', 'offensive',
  'oil', 'opec', 'strait', 'blockade', 'warship', 'submarine',
  'killed', 'casualties', 'evacuation', 'coup', 'assassination',
  'ballistic', 'drone strike', 'chemical', 'biological', 'warhead',
  'embargo', 'tariff', 'trade war', 'default', 'collapse',
];

// ─── Redis helper (using existing Upstash setup) ─────────────────────────────
async function redis(url, token, ...cmd) {
  if (!url || !token) return null;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  return (await r.json()).result;
}

// ─── Fetch latest news from GNews ────────────────────────────────────────────
async function fetchLatestNews(apiKey) {
  const topics = ['world', 'nation', 'business'];
  const allArticles = [];

  for (const topic of topics) {
    try {
      const url = `https://gnews.io/api/v4/top-headlines?topic=${topic}&lang=en&max=10&apikey=${apiKey}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const j = await r.json();
      allArticles.push(...(j.articles || []));
    } catch { continue; }
  }

  return allArticles;
}

// ─── Filter to trusted, high-priority, unposted articles ────────────────────
function isTrustedSource(article) {
  try {
    const domain = new URL(article.url).hostname.replace('www.', '');
    return TRUSTED_SOURCES.has(domain);
  } catch { return false; }
}

function isHighPriority(article) {
  const text = (article.title + ' ' + (article.description || '')).toLowerCase();
  return HIGH_PRIORITY_KEYWORDS.some(kw => text.includes(kw));
}

function articleId(article) {
  // Deterministic ID from URL so duplicates are caught across runs
  return 'np:' + crypto.createHash('md5').update(article.url).digest('hex').substring(0, 12);
}

function sourceName(article) {
  return article.source?.name || new URL(article.url).hostname.replace('www.', '');
}

// ─── Image URL builder ────────────────────────────────────────────────────────

function detectCategory(title) {
  const t = title.toLowerCase();
  if (/nuclear|uranium|warhead|iaea|atomic/.test(t))              return 'nuclear';
  if (/sanction|embargo|tariff|freeze|export ban/.test(t))        return 'sanctions';
  if (/ceasefire|treaty|diplomat|summit|talks|agreement/.test(t)) return 'diplomatic';
  if (/oil|market|economy|gdp|inflation|stock|currency/.test(t))  return 'economic';
  return 'military';
}

function detectFlag(title, description = '') {
  const text = (title + ' ' + description).toLowerCase();
  const flags = {
    '🇮🇱': ['israel','idf','hamas','gaza','netanyahu','tel aviv'],
    '🇺🇦': ['ukraine','kyiv','zelensky','donbas','kharkiv'],
    '🇷🇺': ['russia','kremlin','putin','moscow'],
    '🇮🇷': ['iran','tehran','irgc','khamenei','hormuz'],
    '🇮🇳': ['india','modi','delhi','new delhi'],
    '🇵🇰': ['pakistan','islamabad','karachi'],
    '🇨🇳': ['china','beijing','pla','ccp','xi jinping'],
    '🇹🇼': ['taiwan','taipei','strait'],
    '🇰🇵': ['north korea','pyongyang','kim jong'],
    '🇺🇸': ['united states','washington','pentagon','white house'],
    '🇸🇦': ['saudi','riyadh','opec'],
    '🇱🇧': ['lebanon','beirut','hezbollah'],
    '🇸🇾': ['syria','damascus'],
    '🇾🇪': ['yemen','houthi','sanaa'],
  };
  for (const [flag, kws] of Object.entries(flags)) {
    if (kws.some(kw => text.includes(kw))) return flag;
  }
  return '';
}

function buildImageUrl(article, baseHost = 'https://www.orreryx.io') {
  const title   = article.title.replace(/\s*[-–|].*$/, '').trim().substring(0, 180);
  const source  = sourceName(article);
  const cat     = detectCategory(title);
  const flag    = detectFlag(title, article.description || '');
  // Extract location from title (text after "in " pattern)
  const locMatch = article.title.match(/\bin\s+([A-Z][a-zA-Z\s,]+?)(?:\s*[-–|,]|$)/);
  const loc     = locMatch ? locMatch[1].trim().substring(0, 50) : '';

  const params = new URLSearchParams({ title, source, cat });
  if (flag) params.set('flag', flag);
  if (loc)  params.set('loc', loc);

  return `${baseHost}/api/og-image?${params.toString()}`;
}

// ─── Post formatters ─────────────────────────────────────────────────────────

function formatTwitter(article) {
  const src   = sourceName(article);
  const title = article.title.replace(/\s*[-–|].*$/, '').trim();
  const body  = title.length > 180 ? title.substring(0, 177) + '...' : title;
  return `${body}

📰 ${src}
🔗 ${article.url}

Track live impact → https://orreryx.io/app

⚠️ Source: ${src}. Remove request: contact@orreryx.io`;
}

function formatLinkedIn(article) {
  const src  = sourceName(article);
  const desc = article.description ? article.description.substring(0, 400) : '';
  const cat  = detectCategory(article.title);
  const catLabel = {
    military:'⚔️ MILITARY', nuclear:'☢️ NUCLEAR', economic:'📊 ECONOMIC',
    diplomatic:'🌐 DIPLOMATIC', sanctions:'⚡ SANCTIONS',
  }[cat] || '🔴 BREAKING';

  return `${catLabel} — ${article.title}

${desc}

📰 Source: ${src}
🔗 Full coverage: ${article.url}

Track this story + live market impact on Orrery (free, no login):
👉 https://orreryx.io/app

#geopolitics #worldnews #breakingnews #markets #geopoliticalrisk #intelligence

⚠️ This post is based on reporting by ${src}. We do not independently verify third-party reporting. For corrections or removal: contact@orreryx.io`;
}

function formatBuffer(article) {
  const src   = sourceName(article);
  const title = article.title.replace(/\s*[-–|].*$/, '').trim();
  const flag  = detectFlag(title, article.description || '');
  const desc  = article.description ? article.description.substring(0, 200) : '';

  return `${flag ? flag + ' ' : ''}🔴 ${title}

${desc}

📰 ${src}
🔗 Full story: ${article.url}

Track this + live market impact → orreryx.io/app
👆 Link in bio

#geopolitics #worldnews #breakingnews #war #markets #intelligence #OSINT

⚠️ Source: ${src}. Removal: contact@orreryx.io`;
}

// ─── Twitter OAuth 1.0a ───────────────────────────────────────────────────────
function oauthSign(method, url, params, consumerSecret, tokenSecret) {
  const sorted = Object.keys(params).sort().map(k =>
    encodeURIComponent(k) + '=' + encodeURIComponent(params[k])
  ).join('&');
  const base = method.toUpperCase() + '&' + encodeURIComponent(url) + '&' + encodeURIComponent(sorted);
  const key  = encodeURIComponent(consumerSecret) + '&' + encodeURIComponent(tokenSecret);
  return crypto.createHmac('sha1', key).update(base).digest('base64');
}

async function postTweet(text, env) {
  const url = 'https://api.twitter.com/2/tweets';
  const p = {
    oauth_consumer_key:     env.apiKey,
    oauth_nonce:            crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        String(Math.floor(Date.now() / 1000)),
    oauth_token:            env.accessToken,
    oauth_version:          '1.0',
  };
  p.oauth_signature = oauthSign('POST', url, p, env.apiSecret, env.accessTokenSecret);
  const auth = 'OAuth ' + Object.keys(p).sort().map(k =>
    encodeURIComponent(k) + '="' + encodeURIComponent(p[k]) + '"'
  ).join(', ');

  // Twitter free API: 1,500 tweets/month cap — enforce a daily limit in Redis
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j.data?.id;
}

// ─── LinkedIn ─────────────────────────────────────────────────────────────────
async function postLinkedIn(text, accessToken, personUrn) {
  const r = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: personUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error('LinkedIn: ' + r.status + ' ' + await r.text());
  return r.headers.get('x-restli-id') || 'posted';
}

// ─── Buffer ───────────────────────────────────────────────────────────────────
async function postBuffer(text, token, imageUrl = null) {
  const pr = await fetch(`https://api.bufferapp.com/1/profiles.json?access_token=${token}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!pr.ok) throw new Error('Buffer profiles: ' + pr.status);
  const profiles = await pr.json();

  const results = [];
  for (const profile of profiles) {
    try {
      const params = new URLSearchParams({
        access_token: token,
        'profile_ids[]': profile.id,
        text,
        now: 'true',
      });
      // Attach generated image for Instagram and Google Business
      const service = (profile.service || '').toLowerCase();
      if (imageUrl && (service === 'instagram' || service === 'google' || service === 'googlebusiness')) {
        params.set('media[photo]', imageUrl);
        params.set('media[thumbnail]', imageUrl);
      }
      const r = await fetch('https://api.bufferapp.com/1/updates/create.json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json();
      results.push({ service: profile.service, ok: !j.error, id: j?.updates?.[0]?.id });
    } catch (e) {
      results.push({ service: profile.service, ok: false, error: e.message });
    }
  }
  return results;
}

// ─── Daily post count guard (prevents hitting API limits) ────────────────────
async function getDailyCount(redisUrl, redisToken, platform) {
  const key = `news_post_count:${platform}:${new Date().toISOString().substring(0, 10)}`;
  const val = await redis(redisUrl, redisToken, 'GET', key);
  return parseInt(val || '0');
}

async function incrementDailyCount(redisUrl, redisToken, platform) {
  const key = `news_post_count:${platform}:${new Date().toISOString().substring(0, 10)}`;
  await redis(redisUrl, redisToken, 'INCR', key);
  await redis(redisUrl, redisToken, 'EXPIRE', key, 86400);
}

// Platform daily limits (conservative — within free API tiers)
const DAILY_LIMITS = {
  twitter:  8,   // ~240/month well under 1,500 cap
  linkedin: 5,   // LinkedIn engagement drops after 2-3/day; 5 is max sensible
  buffer:   10,  // Buffer free: 10 posts per channel
};

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Auth check
  const cronSecret  = process.env.CRON_SECRET;
  const authHeader  = req.headers['authorization'];
  const querySecret = req.query.secret;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const gnewsKey   = process.env.GNEWS_API_KEY;
  const redisUrl   = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!gnewsKey)   return res.status(500).json({ error: 'GNEWS_API_KEY not set' });
  if (!redisUrl)   return res.status(500).json({ error: 'UPSTASH_REDIS_REST_URL not set' });

  // 1. Fetch latest news
  const articles = await fetchLatestNews(gnewsKey);

  // 2. Filter: trusted source + high priority only
  const candidates = articles
    .filter(a => isTrustedSource(a) && isHighPriority(a) && a.url && a.title);

  if (!candidates.length) {
    return res.status(200).json({ ok: true, message: 'No high-priority trusted articles found this run.' });
  }

  const posted = [];
  const skipped = [];

  for (const article of candidates) {
    const id = articleId(article);

    // 3. Check if already posted (Redis TTL = 24h)
    const exists = await redis(redisUrl, redisToken, 'GET', id);
    if (exists) { skipped.push({ id, title: article.title }); continue; }

    const articleResult = { title: article.title, source: sourceName(article), url: article.url, platforms: {} };

    // 4. Post to Twitter
    const twKey = process.env.TWITTER_API_KEY;
    if (twKey) {
      const twCount = await getDailyCount(redisUrl, redisToken, 'twitter');
      if (twCount < DAILY_LIMITS.twitter) {
        try {
          const twId = await postTweet(formatTwitter(article), {
            apiKey: twKey,
            apiSecret: process.env.TWITTER_API_SECRET,
            accessToken: process.env.TWITTER_ACCESS_TOKEN,
            accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
          });
          articleResult.platforms.twitter = { ok: true, id: twId };
          await incrementDailyCount(redisUrl, redisToken, 'twitter');
        } catch (e) {
          articleResult.platforms.twitter = { ok: false, error: e.message };
        }
      } else {
        articleResult.platforms.twitter = { ok: false, skipped: 'Daily limit reached' };
      }
    }

    // Small delay between API calls
    await new Promise(r => setTimeout(r, 1000));

    // 5. Post to LinkedIn
    const liToken = process.env.LINKEDIN_ACCESS_TOKEN;
    const liUrn   = process.env.LINKEDIN_PERSON_URN;
    if (liToken && liUrn) {
      const liCount = await getDailyCount(redisUrl, redisToken, 'linkedin');
      if (liCount < DAILY_LIMITS.linkedin) {
        try {
          const liId = await postLinkedIn(formatLinkedIn(article), liToken, liUrn);
          articleResult.platforms.linkedin = { ok: true, id: liId };
          await incrementDailyCount(redisUrl, redisToken, 'linkedin');
        } catch (e) {
          articleResult.platforms.linkedin = { ok: false, error: e.message };
        }
      } else {
        articleResult.platforms.linkedin = { ok: false, skipped: 'Daily limit reached' };
      }
    }

    await new Promise(r => setTimeout(r, 1000));

    // 6. Post to Buffer (Instagram, TikTok, Google Business)
    const bufToken = process.env.BUFFER_ACCESS_TOKEN;
    if (bufToken) {
      const bufCount = await getDailyCount(redisUrl, redisToken, 'buffer');
      if (bufCount < DAILY_LIMITS.buffer) {
        try {
          const imageUrl  = buildImageUrl(article);
          const bufResults = await postBuffer(formatBuffer(article), bufToken, imageUrl);
          articleResult.platforms.buffer = { ok: true, results: bufResults };
          await incrementDailyCount(redisUrl, redisToken, 'buffer');
        } catch (e) {
          articleResult.platforms.buffer = { ok: false, error: e.message };
        }
      } else {
        articleResult.platforms.buffer = { ok: false, skipped: 'Daily limit reached' };
      }
    }

    // 7. Mark as posted in Redis — 24h TTL so same story not repeated
    await redis(redisUrl, redisToken, 'SET', id, '1', 'EX', 86400);

    posted.push(articleResult);

    // Only post top 3 new stories per run to avoid spam
    if (posted.length >= 3) break;

    await new Promise(r => setTimeout(r, 2000));
  }

  return res.status(200).json({
    ok: true,
    run_at: new Date().toISOString(),
    posted: posted.length,
    skipped: skipped.length,
    details: posted,
  });
}

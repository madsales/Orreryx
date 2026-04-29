// api/social-post.js — Daily Twitter + LinkedIn + Monday Reddit poster
// Fires daily at 9:00 AM IST (3:30 AM UTC)
// One cron, three platforms — keeps us within Vercel free plan (2 crons max)
//
// Required env vars:
//   TWITTER_API_KEY, TWITTER_API_SECRET
//   TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET
//   LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN  (refresh every 60 days)
//   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
//   CRON_SECRET

import crypto from 'crypto';

// ══════════════════════════════════════════════════════════════════════════════
// CONTENT
// ══════════════════════════════════════════════════════════════════════════════

const TWITTER = {
  0: `Which geopolitical risk do you think markets are most underpricing right now?

A) Taiwan Strait 🇹🇼
B) Iran nuclear breakout 🇮🇷
C) India-Pakistan 🇮🇳🇵🇰
D) Russia escalation 🇷🇺

Track all four live — free, no login:
👉 https://orreryx.io/app`,

  1: `Start the week with situational awareness.

Orrery tracks live conflicts, nuclear alerts & political crises across 35 countries — with real-time market impact on stocks, oil, gold and crypto.

Free. No login. Updated every 2 minutes.
https://orreryx.io/app`,

  2: `Geopolitical risk is priced into every market:

→ Oil responds to Middle East tensions
→ Gold bids up on nuclear flashpoints
→ Defence stocks move on active conflicts
→ EM currencies react to sanctions

Track it all live, free:
https://orreryx.io/app

#geopolitics #investing #markets`,

  3: `🌍 Live conflict coverage on Orrery right now:

🇺🇦 Ukraine-Russia
🇮🇳🇵🇰 India-Pakistan
🇮🇷 Iran nuclear + Hormuz
🇮🇱 Israel-Gaza
🇹🇼 Taiwan Strait

Filter by country. AI brief on any event.
Free: https://orreryx.io/app`,

  4: `Free OSINT tool for tracking global conflicts in real-time.

Powered by GDELT — the largest open-source geopolitical database in the world.

35 countries · 9 languages · live market impact · no login

https://orreryx.io/app

#OSINT #geopolitics #opendata`,

  5: `Before you close out the week — check what geopolitical risks are building that markets haven't priced in yet.

Orrery live tracker (free): https://orreryx.io/app

35 countries · AI briefs · video coverage`,

  6: `Weekend read: conflicts tracked on Orrery + market exposure each carries.

🇺🇦 Ukraine → European gas, defence stocks
🇮🇷 Iran → Oil, shipping rates
🇹🇼 Taiwan → Semiconductors, tech supply chains
🇮🇳🇵🇰 India-Pakistan → Cotton, textile stocks

Live tracker: https://orreryx.io/app`,
};

const LINKEDIN = {
  1: `🌍 Start the week with geopolitical situational awareness.

Orrery is a free real-time platform that monitors active conflicts, sanctions and political crises across 35 countries — and shows which markets are exposed.

✅ Live feed updated every 2 minutes
✅ 9 languages including Arabic, Chinese, Russian, Hindi
✅ One-click AI analysis of any event
✅ Market impact: stocks, oil, gold, crypto
✅ Zero cost — no login, no paywall

I built this because Bloomberg terminals that surface this data cost $24,000/year. Geopolitical risk affects every portfolio, not just hedge funds.

→ Try it free: orreryx.io/app

#GeopoliticalRisk #Investing #GlobalMarkets #Intelligence #Finance`,

  2: `The geopolitical flashpoints to watch this week and their market exposure:

🇺🇦 Ukraine-Russia → European gas, wheat, defence ETFs
🇮🇳🇵🇰 India-Pakistan → Emerging market funds, cotton, rupee
🇮🇷 Iran → Oil, tanker rates, shipping stocks
🇹🇼 Taiwan → Semiconductor supply chains, TSMC, tech ETFs
🇮🇱 Gaza → Regional safe-haven premium, gold

Track all live, free at orreryx.io/app

What geopolitical risk are you watching most closely this week?

#GeopoliticalRisk #GlobalMarkets #RiskManagement #Investing`,

  3: `Why I built a free geopolitical risk tracker — and what I learned.

The problem: geopolitical events move markets fast. By the time mainstream financial media covers them, the initial price move has already happened.

What I built: Orrery — powered by GDELT (the largest open-source geopolitical database globally).

It surfaces conflict events in real-time with country + language filters, market tickers alongside each event, and AI analysis on demand.

100% free. No paywall. → orreryx.io/app

Happy to answer questions about the architecture in comments.

#ProductDevelopment #FinTech #Geopolitics #SideProject`,

  4: `Geopolitical risk is the most underrated factor in portfolio construction.

Most retail investors track:
✓ Earnings  ✓ Fed rates  ✓ Technicals

Few systematically track:
✗ Active conflict escalation
✗ Sanctions and trade disruption
✗ Nuclear flashpoint probability

Yet these cause the largest single-day moves in oil, gold, defence stocks and EM currencies.

Orrery is a free tool I built to fix this gap.
→ orreryx.io/app

#Investing #PortfolioManagement #GeopoliticalRisk #GlobalMacro`,

  5: `Weekend reading: the geopolitical risks most underpriced by markets right now.

1. India-Pakistan nuclear overhang — 325+ combined warheads, active LoC incidents
2. Iran Strait of Hormuz — 20% of global oil supply, thin volatility premium
3. Taiwan semiconductor risk — 60%+ of leading-edge chip production in one island
4. Russia energy play — infrastructure targeting, European gas exposure

Free live tracker: orreryx.io/app

What's on your geopolitical risk watchlist?

#GlobalMacro #GeopoliticalRisk #Investing #Finance`,
};

// Reddit: cycles through 5 subreddits weekly
const REDDIT_POSTS = [
  {
    sub: 'geopolitics',
    title: 'Built a free real-time geopolitical risk tracker — 35 countries, live feed, market impact',
    text: `I built Orrery because I was frustrated finding out about major geopolitical events hours after markets had already moved.

**What it does:**
- Live event feed powered by GDELT (updates every 2 minutes)
- Filter by 35 countries and 9 languages (Arabic, Chinese, Russian, Hindi, etc.)
- Real-time market quotes alongside events — stocks, oil, gold, crypto
- One-click AI brief for any event
- News video coverage per country (26 international channels)
- Share any event to X or WhatsApp

**Free, no login required:** https://orreryx.io/app

I'd genuinely love feedback — what conflicts or regions am I underrepresenting?`,
  },
  {
    sub: 'investing',
    title: 'Free real-time geopolitical risk → market impact dashboard (no signup)',
    text: `**The problem:** Geopolitical events move markets, but by the time mainstream media covers them, the initial move has already happened. Bloomberg terminals that surface this early cost $24k/year.

**What I built:** Orrery — a free live dashboard that monitors conflict events from GDELT and shows which markets are exposed.

**Markets tracked:** Major stocks (LMT, RTX, XOM, etc.), commodities (oil, gold, silver), crypto (BTC, ETH, XRP)

**35 countries, 9 languages, free forever:** https://orreryx.io/app

Not financial advice — situational awareness tool.`,
  },
  {
    sub: 'worldnews',
    title: 'Free live tracker for 35 active conflict zones — GDELT-powered, updated every 2 minutes',
    text: `Built a real-time global conflict tracker that pulls from GDELT and surfaces events as they happen.

**Currently tracking:**
🇺🇦 Ukraine-Russia · 🇮🇳🇵🇰 India-Pakistan · 🇮🇱🇵🇸 Israel-Gaza
🇮🇷 Iran nuclear · 🇹🇼 Taiwan Strait · 🇰🇵 North Korea + 29 more

**Features:** Country + language filter, AI analysis, video coverage, market impact

**Free, no account needed:** https://orreryx.io/app`,
  },
  {
    sub: 'OSINT',
    title: 'Show r/OSINT: Free geopolitical intelligence dashboard built on GDELT + open data',
    text: `**Data sources:**
- GDELT v2 Article API (LOCATIONCC filter, sourcelang for 9 languages)
- GNews API (country + language facets)
- YouTube RSS from 26 international news channels
- Yahoo Finance + CoinGecko for live market quotes

Country classification uses padded keyword matching (\`" india "\` not \`"india"\`) to prevent substring false positives. Server-side LOCATIONCC param does the heavy lifting.

**Live at:** https://orreryx.io/app — source discussion welcome.`,
  },
  {
    sub: 'stocks',
    title: 'Tracking geopolitical events in real-time alongside market tickers — free tool',
    text: `Built a live dashboard that surfaces conflict events and shows tickers that historically correlate with each event type.

**Event → Market mappings:**
- Middle East military → Oil, tanker stocks, defence (LMT, RTX, NOC)
- Nuclear/Iran → Gold, USD, oil spike risk
- India-Pakistan → Cotton futures, textile stocks, rupee
- Taiwan → Semiconductor ETFs, TSMC, Apple supply chain

**Free, no login:** https://orreryx.io/app

Not financial advice. Situational awareness layer.`,
  },
];

// ══════════════════════════════════════════════════════════════════════════════
// TWITTER — OAuth 1.0a (no external package)
// ══════════════════════════════════════════════════════════════════════════════

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
  const oauthParams = {
    oauth_consumer_key:     env.apiKey,
    oauth_nonce:            crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp:        String(Math.floor(Date.now() / 1000)),
    oauth_token:            env.accessToken,
    oauth_version:          '1.0',
  };
  oauthParams.oauth_signature = oauthSign('POST', url, oauthParams, env.apiSecret, env.accessTokenSecret);
  const authHeader = 'OAuth ' + Object.keys(oauthParams).sort().map(k =>
    encodeURIComponent(k) + '="' + encodeURIComponent(oauthParams[k]) + '"'
  ).join(', ');

  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j.data?.id;
}

// ══════════════════════════════════════════════════════════════════════════════
// LINKEDIN — UGC Posts API
// ══════════════════════════════════════════════════════════════════════════════

async function postToLinkedIn(accessToken, personUrn, text) {
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
  if (!r.ok) throw new Error('LinkedIn failed: ' + r.status + ' ' + await r.text());
  return r.headers.get('x-restli-id') || 'posted';
}

// ══════════════════════════════════════════════════════════════════════════════
// REDDIT — OAuth2 password flow
// ══════════════════════════════════════════════════════════════════════════════

async function redditToken(clientId, clientSecret, username, password) {
  const creds = Buffer.from(clientId + ':' + clientSecret).toString('base64');
  const r = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + creds,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'OrrerxyBot/1.0 (by u/' + username + ')',
    },
    body: new URLSearchParams({ grant_type: 'password', username, password }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Reddit auth failed: ' + JSON.stringify(j));
  return j.access_token;
}

async function redditSubmit(token, username, { sub, title, text }) {
  const r = await fetch('https://oauth.reddit.com/api/submit', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'User-Agent': 'OrrerxyBot/1.0 (by u/' + username + ')',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ api_type: 'json', kind: 'self', sr: sub, title, text, resubmit: 'false' }),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  if (j?.json?.errors?.length) throw new Error(JSON.stringify(j.json.errors));
  return j?.json?.data?.url;
}

// ══════════════════════════════════════════════════════════════════════════════
// HANDLER
// ══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader  = req.headers['authorization'];
  const querySecret = req.query.secret;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now       = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun…6=Sat
  const weekNum   = Math.floor((now - new Date(now.getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000));
  const results   = {};

  // ── Twitter ───────────────────────────────────────────────────────────────
  const twKey    = process.env.TWITTER_API_KEY;
  const twSecret = process.env.TWITTER_API_SECRET;
  const twToken  = process.env.TWITTER_ACCESS_TOKEN;
  const twTSec   = process.env.TWITTER_ACCESS_TOKEN_SECRET;

  if (twKey && twSecret && twToken && twTSec) {
    try {
      const id = await postTweet(TWITTER[dayOfWeek], {
        apiKey: twKey, apiSecret: twSecret,
        accessToken: twToken, accessTokenSecret: twTSec,
      });
      results.twitter = { ok: true, id };
    } catch (e) {
      results.twitter = { ok: false, error: e.message };
    }
  } else {
    results.twitter = { ok: false, error: 'Twitter credentials not set' };
  }

  // ── LinkedIn (weekdays only) ───────────────────────────────────────────────
  const liToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const liUrn   = process.env.LINKEDIN_PERSON_URN;

  if (liToken && liUrn) {
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      results.linkedin = { ok: true, skipped: 'Weekend' };
    } else {
      try {
        const id = await postToLinkedIn(liToken, liUrn, LINKEDIN[dayOfWeek]);
        results.linkedin = { ok: true, id };
      } catch (e) {
        results.linkedin = { ok: false, error: e.message };
      }
    }
  } else {
    results.linkedin = { ok: false, error: 'LinkedIn credentials not set' };
  }

  // ── Reddit (Mondays only — weekly to avoid bans) ──────────────────────────
  const rdClientId = process.env.REDDIT_CLIENT_ID;
  const rdSecret   = process.env.REDDIT_CLIENT_SECRET;
  const rdUser     = process.env.REDDIT_USERNAME;
  const rdPass     = process.env.REDDIT_PASSWORD;

  if (rdClientId && rdSecret && rdUser && rdPass) {
    if (dayOfWeek === 1) { // Monday
      const post = REDDIT_POSTS[weekNum % REDDIT_POSTS.length];
      try {
        const token = await redditToken(rdClientId, rdSecret, rdUser, rdPass);
        const url   = await redditSubmit(token, rdUser, post);
        results.reddit = { ok: true, subreddit: post.sub, url };
      } catch (e) {
        results.reddit = { ok: false, error: e.message };
      }
    } else {
      results.reddit = { ok: true, skipped: 'Not Monday' };
    }
  } else {
    results.reddit = { ok: false, error: 'Reddit credentials not set' };
  }

  return res.status(200).json({ ok: true, day: dayOfWeek, results });
}

// api/social-post.js — Daily social media poster (Twitter, LinkedIn, Instagram, Google Business, Reddit)
// Fires daily at 3:30 AM UTC (9:00 AM IST)
//
// Required env vars:
//   TWITTER_API_KEY, TWITTER_API_SECRET
//   TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET
//   LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN  (refresh every 60 days)
//   INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_LOCATION_NAME
//   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD
//   CRON_SECRET

import crypto from 'crypto';
import { TwitterApi } from 'twitter-api-v2';

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

// ─── Instagram captions (rotated daily) ─────────────────────────────────────
const INSTAGRAM = [
  `🌍 Real-time geopolitical intelligence. Free.\n\nTrack live conflicts, nuclear flashpoints & political crises across 35 countries — with market impact on stocks, oil, gold and crypto.\n\nNo login. No paywall. Updated every 2 minutes.\n👉 Link in bio — orreryx.io/app\n\n#geopolitics #worldnews #markets #investing #geopoliticalrisk #globalconflicts #intelligence #OSINT`,
  `Oil spikes when the Middle East burns 🔥\nGold bids up when nuclear headlines drop ☢️\nDefence stocks pump when missiles fly 🚀\n\nTrack the events that move markets — live, free.\n👉 Link in bio\n\n#oil #gold #defencestocks #geopolitics #investing #iran #ukraine #middleeast`,
  `35 countries tracked live 🌐\n\n🇺🇦 Ukraine-Russia · 🇮🇳🇵🇰 India-Pakistan\n🇮🇷 Iran nuclear · 🇹🇼 Taiwan Strait\n🇮🇱 Israel-Gaza · 🇰🇵 North Korea\n+ 29 more conflict zones\n\nOne free platform. No account needed.\norreryx.io/app\n\n#ukraine #indopakistan #iran #taiwan #israel #northkorea #geopolitics`,
  `Before markets open — check what's happening 📊\n\nLive geopolitical events:\n→ Filter by country\n→ See which assets are exposed\n→ AI analysis in 1 click\n\nFree at orreryx.io/app\n👉 Link in bio\n\n#premarket #trading #investing #geopoliticalrisk #markets #gold #oil`,
  `Free OSINT tool: live conflict events filtered by country + language 📡\n\n9 languages · 35 countries · real-time market impact\n\nTrack the world before markets open.\norreryx.io/app\n\n#OSINT #geopolitics #opendata #conflicttracking #intelligence`,
  `9 languages. 35 countries. One screen.\n\nArabic 🇸🇦 · Chinese 🇨🇳 · Russian 🇷🇺\nFrench 🇫🇷 · German 🇩🇪 · Spanish 🇪🇸\nPortuguese 🇧🇷 · Hindi 🇮🇳 · English 🇬🇧\n\nFree intelligence platform: orreryx.io/app\n👉 Link in bio\n\n#multilingual #geopolitics #worldnews #global`,
  `The world doesn't pause between your news checks 🌐\n\nOrrery monitors conflicts, sanctions and political crises 24/7.\n\nAI brief on any event. Video coverage per country. Market impact in real time.\n\n100% free. No login. No paywall.\norreryx.io/app\n\n#geopolitics #worldnews #AI #intelligence #freetools`,
];

// ─── Google Business posts (short, local-SEO friendly) ───────────────────────
const GOOGLE_POSTS = [
  `🌍 Track live geopolitical conflicts and their market impact — free, no login.\n\nOrrery monitors 35 countries in real-time: Ukraine, Iran, Taiwan, India-Pakistan and more.\n\nhttps://orreryx.io/app`,
  `Real-time intelligence on wars, sanctions and nuclear flashpoints — with live stock, oil and gold prices.\n\nFree at orreryx.io/app`,
  `Filter live conflict news by country and language. 35 countries, 9 languages, AI analysis on demand.\n\nhttps://orreryx.io/app`,
  `Which markets move when geopolitical events happen?\n→ Oil on Middle East tensions\n→ Gold on nuclear news\n→ Defence stocks on active conflicts\n\nTrack it live free: orreryx.io/app`,
  `Orrery: free geopolitical risk tracker used by investors, analysts and researchers.\n\nLive conflict feed · Market impact · AI briefs · Video coverage\n\norreryx.io/app`,
  `India-Pakistan, Iran, Ukraine, Taiwan — all tracked live with real-time market impact.\n\nFree intelligence platform: orreryx.io/app`,
  `Stay ahead of geopolitical risk. Free real-time tracker: orreryx.io/app\n\n35 countries · 9 languages · stocks, oil, gold, crypto · no signup needed`,
];

// ══════════════════════════════════════════════════════════════════════════════
// INSTAGRAM — Meta Graph API (image post)
// Requires: INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID
// Get token: developers.facebook.com → Your App → Instagram → Generate Token
// ══════════════════════════════════════════════════════════════════════════════

async function postToInstagram(accessToken, igUserId, caption, imageUrl) {
  // Step 1: create media container
  const createRes = await fetch(
    `https://graph.facebook.com/v19.0/${igUserId}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, caption, access_token: accessToken }),
      signal: AbortSignal.timeout(20000),
    }
  );
  const createData = await createRes.json();
  if (!createRes.ok || createData.error)
    throw new Error('Instagram container failed: ' + JSON.stringify(createData.error || createData));

  // Step 2: publish the container
  const publishRes = await fetch(
    `https://graph.facebook.com/v19.0/${igUserId}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creation_id: createData.id, access_token: accessToken }),
      signal: AbortSignal.timeout(20000),
    }
  );
  const publishData = await publishRes.json();
  if (!publishRes.ok || publishData.error)
    throw new Error('Instagram publish failed: ' + JSON.stringify(publishData.error || publishData));

  return publishData.id;
}

// ══════════════════════════════════════════════════════════════════════════════
// GOOGLE BUSINESS PROFILE — My Business API v4
// Requires: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_LOCATION_NAME
// GOOGLE_LOCATION_NAME format: accounts/XXXXXXX/locations/XXXXXXX
// ══════════════════════════════════════════════════════════════════════════════

async function getGoogleAccessToken(clientId, clientSecret, refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Google token refresh failed: ' + JSON.stringify(j));
  return j.access_token;
}

async function postToGoogleBusiness(accessToken, locationName, text) {
  const r = await fetch(
    `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        languageCode: 'en-US',
        summary: text,
        callToAction: { actionType: 'LEARN_MORE', url: 'https://orreryx.io/app' },
        topicType: 'STANDARD',
      }),
      signal: AbortSignal.timeout(10000),
    }
  );
  if (!r.ok) throw new Error('Google Business failed: ' + r.status + ' ' + await r.text());
  const j = await r.json();
  return j.name || 'posted';
}

// ══════════════════════════════════════════════════════════════════════════════
// TWITTER — OAuth 1.0a (no external package)
// ══════════════════════════════════════════════════════════════════════════════

async function postTweet(text, env) {
  const client = new TwitterApi({
    appKey:       env.apiKey,
    appSecret:    env.apiSecret,
    accessToken:  env.accessToken,
    accessSecret: env.accessTokenSecret,
  });
  const result = await client.v2.tweet(text);
  return result.data.id;
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

  const now        = new Date();
  const dayOfWeek  = now.getDay(); // 0=Sun…6=Sat
  const dayOfYear  = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const weekNum    = Math.floor((now - new Date(now.getFullYear(), 0, 1)) / (7 * 24 * 60 * 60 * 1000));
  const results    = {};

  // ── Twitter ───────────────────────────────────────────────────────────────
  const twKey    = process.env.TWITTER_API_KEY;
  const twSecret = process.env.TWITTER_API_SECRET;
  const twToken  = process.env.TWITTER_ACCESS_TOKEN;
  const twTSec   = process.env.TWITTER_ACCESS_TOKEN_SECRET;

  // Debug: show first 6 chars of each credential to verify they're loaded correctly
  if (req.query.debug === '1') {
    return res.status(200).json({
      debug: true,
      twitter: {
        api_key:              twKey    ? twKey.substring(0,6)    + '...' : 'MISSING',
        api_secret:           twSecret ? twSecret.substring(0,6) + '...' : 'MISSING',
        access_token:         twToken  ? twToken.substring(0,6)  + '...' : 'MISSING',
        access_token_secret:  twTSec   ? twTSec.substring(0,6)   + '...' : 'MISSING',
      },
    });
  }

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

  // ── Instagram (every day) ────────────────────────────────────────────────
  const igToken  = process.env.INSTAGRAM_ACCESS_TOKEN;
  const igUserId = process.env.INSTAGRAM_USER_ID;

  if (igToken && igUserId) {
    try {
      const caption  = INSTAGRAM[dayOfYear % INSTAGRAM.length];
      // Use our own og-image as the post image — publicly accessible PNG
      const imageUrl = 'https://orreryx.io/api/og-image?title=LIVE+GEOPOLITICAL+INTELLIGENCE&source=ORRERYX&cat=default';
      const id = await postToInstagram(igToken, igUserId, caption, imageUrl);
      results.instagram = { ok: true, id };
    } catch (e) {
      results.instagram = { ok: false, error: e.message };
    }
  } else {
    results.instagram = { ok: false, error: 'Instagram credentials not set' };
  }

  // ── Google Business Profile (every day) ──────────────────────────────────
  const gClientId     = process.env.GOOGLE_CLIENT_ID;
  const gClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const gRefreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const gLocationName = process.env.GOOGLE_LOCATION_NAME;

  if (gClientId && gClientSecret && gRefreshToken && gLocationName) {
    try {
      const gAccessToken = await getGoogleAccessToken(gClientId, gClientSecret, gRefreshToken);
      const id = await postToGoogleBusiness(gAccessToken, gLocationName, GOOGLE_POSTS[dayOfYear % GOOGLE_POSTS.length]);
      results.google = { ok: true, id };
    } catch (e) {
      results.google = { ok: false, error: e.message };
    }
  } else {
    results.google = { ok: false, error: 'Google Business credentials not set' };
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

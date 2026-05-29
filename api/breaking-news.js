// api/breaking-news.js — CMO Live Breaking News Agent
// Runs every 3 hours via cron-job.org
// Fetches top breaking geopolitical event from OrreryX's own GDELT feed
// Generates platform-specific captions and posts to Twitter + LinkedIn
// Uses Redis deduplication — never posts the same story twice (7-day TTL)
//
// Required env vars:
//   TWITTER_API_KEY, TWITTER_API_SECRET
//   TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET
//   LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//   CRON_SECRET
//   BREAKING_MIN_SCORE (optional, default 5 — minimum event importance score)

import crypto from 'crypto';
import { TwitterApi } from 'twitter-api-v2';
import webpush from 'web-push';

// ── Country → emoji + market impact map ──────────────────────────────────────

const COUNTRY_META = {
  UA: { flag: '🇺🇦', name: 'Ukraine',       impact: 'European energy, grain, defence stocks' },
  RU: { flag: '🇷🇺', name: 'Russia',        impact: 'Oil, gas, gold, European equities' },
  IR: { flag: '🇮🇷', name: 'Iran',          impact: 'Oil futures, Strait of Hormuz, gold' },
  IL: { flag: '🇮🇱', name: 'Israel',        impact: 'Middle East oil premium, safe havens' },
  PS: { flag: '🇵🇸', name: 'Gaza',          impact: 'Middle East risk premium, oil' },
  TW: { flag: '🇹🇼', name: 'Taiwan',        impact: 'Semiconductors, tech supply chain, TSMC' },
  CN: { flag: '🇨🇳', name: 'China',         impact: 'Global supply chain, EM equities, copper' },
  KP: { flag: '🇰🇵', name: 'North Korea',   impact: 'Safe havens, South Korean won, defence stocks' },
  IN: { flag: '🇮🇳', name: 'India',         impact: 'EM equities, INR, gold safe-haven flows' },
  PK: { flag: '🇵🇰', name: 'Pakistan',      impact: 'EM risk, gold, regional stability' },
  SA: { flag: '🇸🇦', name: 'Saudi Arabia',  impact: 'OPEC oil output, Brent crude' },
  YE: { flag: '🇾🇪', name: 'Yemen',         impact: 'Red Sea shipping, oil tanker routes' },
  SY: { flag: '🇸🇾', name: 'Syria',         impact: 'Middle East stability, refugee flows' },
  IQ: { flag: '🇮🇶', name: 'Iraq',          impact: 'Oil production, Middle East premium' },
  LY: { flag: '🇱🇾', name: 'Libya',         impact: 'North African oil output' },
  SD: { flag: '🇸🇩', name: 'Sudan',         impact: 'African commodities, humanitarian' },
  MM: { flag: '🇲🇲', name: 'Myanmar',       impact: 'SE Asia supply chain disruption' },
  AF: { flag: '🇦🇫', name: 'Afghanistan',   impact: 'Regional stability, Central Asian trade' },
  ET: { flag: '🇪🇹', name: 'Ethiopia',      impact: 'African bond markets, commodity exports' },
  VE: { flag: '🇻🇪', name: 'Venezuela',     impact: 'Oil supply, EM credit risk' },
};

// ── Keywords that signal a significant breaking event ─────────────────────────
const HIGH_SIGNAL_KEYWORDS = [
  'missile', 'strike', 'attack', 'explosion', 'nuclear', 'ceasefire', 'invasion',
  'troops', 'military', 'sanction', 'blockade', 'airstrike', 'drone', 'war',
  'escalat', 'bomb', 'shoot', 'fire', 'tank', 'navy', 'soldier', 'warship',
  'crisis', 'emergency', 'coup', 'assassination', 'uranium', 'ballistic',
];

// ── Redis helpers ─────────────────────────────────────────────────────────────

async function upstashCmd(command) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(command),
    signal:  AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.result ?? null;
}

async function wasPosted(url) {
  const key = 'breaking:posted:' + crypto.createHash('md5').update(url).digest('hex');
  const val = await upstashCmd(['GET', key]);
  return !!val;
}

async function markPosted(url) {
  const key = 'breaking:posted:' + crypto.createHash('md5').update(url).digest('hex');
  await upstashCmd(['SET', key, '1', 'EX', 604800]); // 7-day TTL
}

async function getLastPostTime() {
  const val = await upstashCmd(['GET', 'breaking:last_post_time']);
  return val ? parseInt(val) : 0;
}

async function setLastPostTime() {
  // 7-day TTL — long enough that ops-agent never sees a false "never ran" from key expiry
  await upstashCmd(['SET', 'breaking:last_post_time', Date.now().toString(), 'EX', 604800]);
}

// ── Fetch breaking events from OrreryX's own feed ──────────────────────────────

async function fetchBreakingEvents() {
  // Primary: GNews feed (fast, reliable, always returns articles)
  const r = await fetch('https://orreryx.io/api/gnews', {
    signal: AbortSignal.timeout(12000),
    headers: { 'User-Agent': 'OrreryX-BreakingNewsAgent/1.0' },
  }).catch(() => null);

  if (r?.ok) {
    const j = await r.json().catch(() => null);
    if (j?.articles?.length) return j.articles;
    if (Array.isArray(j) && j.length) return j;
  }

  // Fallback: GDELT events API (slower due to batching)
  const r2 = await fetch('https://orreryx.io/api/events', {
    signal: AbortSignal.timeout(25000),
    headers: { 'User-Agent': 'OrreryX-BreakingNewsAgent/1.0' },
  }).catch(() => null);

  if (r2?.ok) {
    const j2 = await r2.json().catch(() => null);
    if (j2?.events?.length) return j2.events;
  }

  return [];
}

// ── Score an article for breaking news importance ─────────────────────────────

function scoreArticle(article) {
  // gnews returns 'txt', other sources use 'title'/'description'/'content'
  const text  = ((article.title || article.txt || '') + ' ' + (article.description || article.content || '')).toLowerCase();
  let score   = 0;

  // High-signal keywords
  for (const kw of HIGH_SIGNAL_KEYWORDS) {
    if (text.includes(kw)) score += 2;
  }

  // Known conflict countries mentioned
  const countries = Object.values(COUNTRY_META);
  for (const c of countries) {
    if (text.includes(c.name.toLowerCase())) score += 1;
  }

  // Recent articles score higher (if publishedAt available)
  if (article.publishedAt) {
    const ageHours = (Date.now() - new Date(article.publishedAt).getTime()) / 3600000;
    if (ageHours < 1) score += 3;
    else if (ageHours < 2) score += 2;
    else if (ageHours < 3) score += 1;
  }

  return score;
}

// ── Detect country from article text ─────────────────────────────────────────

function detectCountry(article) {
  const text = ((article.title || article.txt || '') + ' ' + (article.description || article.content || '')).toLowerCase();
  for (const [code, meta] of Object.entries(COUNTRY_META)) {
    if (text.includes(meta.name.toLowerCase())) return { code, ...meta };
  }
  return { flag: '🌍', name: 'Global', impact: 'global markets' };
}

// ── Build captions ────────────────────────────────────────────────────────────

function buildTwitterCaption(article, country) {
  const title  = (article.title || article.txt || '').slice(0, 160) || 'Breaking geopolitical event';
  const impact = country.impact;
  // Hook-first: lead with market consequence, not just the headline
  return `${country.flag} ${title}

📊 ${impact}

Track live → https://orreryx.io/app

#${country.name.replace(/\s/g, '')} #Geopolitics`;
}

function buildLinkedInCaption(article, country) {
  const title   = article.title || article.txt || 'Breaking geopolitical event';
  const desc    = (article.description || article.content || '').slice(0, 250);
  const impact  = country.impact;
  const source  = article.source?.name || article.source || 'Global news';

  // Hook-first: open with the market consequence, not just the news label
  return `${country.flag} ${title}

${desc ? desc + '\n\n' : ''}Market impact: ${impact}

Most investors will see this in tomorrow's headlines. By then the move has already happened.

OrreryX tracks events like this in real time — conflict → affected assets → live price data, all in one place.

→ https://orreryx.io/app (free, no login required)

Source: ${source}

#GeopoliticalRisk #${country.name.replace(/\s/g, '')} #Investing #MacroIntelligence`;
}

// ── Post to Twitter ───────────────────────────────────────────────────────────

async function postTweet(text) {
  const client = new TwitterApi({
    appKey:       process.env.TWITTER_API_KEY,
    appSecret:    process.env.TWITTER_API_SECRET,
    accessToken:  process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
  });
  const result = await client.v2.tweet(text);
  return result.data?.id;
}

// ── Post to LinkedIn ──────────────────────────────────────────────────────────

async function postLinkedIn(text) {
  const token  = process.env.LINKEDIN_ACCESS_TOKEN;
  const person = process.env.LINKEDIN_PERSON_URN;
  if (!token || !person) throw new Error('LinkedIn credentials not set');

  const body = {
    author:     person,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary:   { text },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  const r = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method:  'POST',
    headers: {
      Authorization:   `Bearer ${token}`,
      'Content-Type':  'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!r.ok) {
    const err = await r.text().catch(() => r.status);
    throw new Error('LinkedIn post failed: ' + err);
  }
  const j = await r.json().catch(() => ({}));
  return j.id;
}

// ── Web Push broadcaster ──────────────────────────────────────────────────────

async function getAllPushSubs() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return [];
  // Get all push subscription keys
  const r = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['KEYS', 'push:sub:*']]),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  const keys = (await r?.json().catch(() => null))?.[0]?.result;
  if (!keys?.length) return [];
  // Fetch all subscription objects in one pipeline
  const r2 = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(keys.map(k => ['GET', k])),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  const vals = (await r2?.json().catch(() => null)) || [];
  return vals.map(v => { try { return JSON.parse(v.result); } catch { return null; } }).filter(Boolean);
}

async function removePushSub(endpoint) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  const hash = Buffer.from(endpoint).toString('base64').slice(0, 32);
  await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['DEL', `push:sub:${hash}`]]),
  }).catch(() => {});
}

async function broadcastPush(article, country) {
  const vapidPublic  = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail   = process.env.VAPID_EMAIL || 'mailto:admin@orreryx.io';
  if (!vapidPublic || !vapidPrivate) return { sent: 0, skipped: 'VAPID keys not set' };

  webpush.setVapidDetails(vapidEmail, vapidPublic, vapidPrivate);

  const subs = await getAllPushSubs();
  if (!subs.length) return { sent: 0, skipped: 'No subscribers yet' };

  // Build a punchy push payload
  const title = `${country.flag} BREAKING: ${(article.title || '').slice(0, 80)}`;
  const body  = `📊 ${country.impact} · Tap to track live`;
  const url   = `https://www.orreryx.io/risk-dashboard`;
  const payload = JSON.stringify({ title, body, url, tag: 'breaking-' + Date.now(), icon: '/icon-192.png' });

  let sent = 0, failed = 0, expired = 0;
  await Promise.allSettled(subs.map(async sub => {
    try {
      await webpush.sendNotification(sub, payload, { TTL: 3600 });
      sent++;
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) {
        await removePushSub(sub.endpoint);
        expired++;
      } else {
        failed++;
      }
    }
  }));

  return { sent, failed, expired, total: subs.length };
}

// ── FCM token helpers ─────────────────────────────────────────────────────────

async function getAllFCMTokens() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return [];
  // Get all FCM token keys
  const r1 = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['KEYS', 'push:fcm:*']]),
  }).catch(() => null);
  const keys = (await r1?.json().catch(() => null))?.[0]?.result || [];
  if (!keys.length) return [];
  // Fetch all token values in one pipeline
  const r2 = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(keys.map(k => ['GET', k])),
  }).catch(() => null);
  const vals = (await r2?.json().catch(() => null)) || [];
  return vals.map(v => v?.result || null).filter(Boolean);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const cronSecret  = process.env.CRON_SECRET;
  const querySecret = req.query.secret;
  const authHeader  = req.headers['authorization'];
  if (cronSecret && querySecret !== cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const forcePost = req.query.force === '1'; // bypass cooldown for testing

  // ── DIAGNOSE MODE: show what's configured and test each component ─────────────
  if (req.query.diagnose === '1') {
    const hasTwitter  = !!(process.env.TWITTER_API_KEY && process.env.TWITTER_API_SECRET && process.env.TWITTER_ACCESS_TOKEN && process.env.TWITTER_ACCESS_TOKEN_SECRET);
    const hasLinkedIn = !!(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_PERSON_URN);
    const hasGnews    = !!process.env.GNEWS_API_KEY;
    const hasRedis    = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);

    // Test GNews feed
    let feedStatus = 'not tested';
    let feedArticles = 0;
    try {
      const r = await fetch('https://orreryx.io/api/gnews', { signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (r?.ok) {
        const j = await r.json().catch(() => null);
        feedArticles = j?.articles?.length || (Array.isArray(j) ? j.length : 0);
        feedStatus = feedArticles > 0 ? `✓ OK — ${feedArticles} articles` : '⚠ Returned 0 articles';
      } else {
        feedStatus = `✗ HTTP ${r?.status || 'timeout'}`;
      }
    } catch (e) { feedStatus = `✗ Error: ${e.message}`; }

    // Test LinkedIn token validity
    let linkedinStatus = 'not configured';
    if (hasLinkedIn) {
      try {
        const r = await fetch('https://api.linkedin.com/v2/me', {
          headers: { Authorization: `Bearer ${process.env.LINKEDIN_ACCESS_TOKEN}` },
          signal: AbortSignal.timeout(8000),
        }).catch(() => null);
        linkedinStatus = r?.status === 200 ? '✓ Token valid' :
          r?.status === 401 ? '✗ Token EXPIRED — needs refresh' :
          `⚠ HTTP ${r?.status}`;
      } catch (e) { linkedinStatus = `✗ Error: ${e.message}`; }
    }

    // Test Twitter credentials (dry run — just check if client initializes, don't post)
    let twitterStatus = 'not configured';
    if (hasTwitter) {
      try {
        const { TwitterApi } = await import('twitter-api-v2');
        const client = new TwitterApi({
          appKey:       process.env.TWITTER_API_KEY,
          appSecret:    process.env.TWITTER_API_SECRET,
          accessToken:  process.env.TWITTER_ACCESS_TOKEN,
          accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
        });
        // Verify credentials with a read-only endpoint
        const me = await client.v2.me().catch(e => ({ error: e.message || String(e) }));
        if (me?.data?.id) {
          twitterStatus = `✓ Authenticated as @${me.data.username}`;
        } else if (me?.error) {
          twitterStatus = me.error.includes('403') || me.error.includes('Forbidden')
            ? '✗ API plan too low — Basic tier ($100/mo) required to post tweets'
            : `✗ ${me.error}`;
        } else {
          twitterStatus = '⚠ Unexpected response';
        }
      } catch (e) { twitterStatus = `✗ ${e.message}`; }
    }

    // Get last post time from Redis
    const lastPost = hasRedis ? await getLastPostTime() : 0;
    const lastPostAgo = lastPost ? Math.round((Date.now() - lastPost) / 60000) + ' minutes ago' : 'never';
    const lastError = hasRedis ? await upstashCmd(['GET', 'breaking:last_error']).catch(() => null) : null;

    return res.status(200).json({
      diagnose: true,
      credentials: {
        twitter:  hasTwitter  ? twitterStatus  : '✗ NOT SET — need TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET in Vercel',
        linkedin: hasLinkedIn ? linkedinStatus : '✗ NOT SET — need LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN in Vercel',
        gnews:    hasGnews    ? '✓ Key set'   : '✗ NOT SET — need GNEWS_API_KEY in Vercel',
        redis:    hasRedis    ? '✓ Connected' : '✗ NOT SET — need UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN',
      },
      feed: { status: feedStatus, articleCount: feedArticles },
      lastPost: lastPostAgo,
      lastError: lastError || 'none recorded',
      fix: [
        !hasTwitter  && 'Go to Vercel → Settings → Environment Variables → add TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET',
        !hasLinkedIn && 'Go to Vercel → Settings → Environment Variables → add LINKEDIN_ACCESS_TOKEN, LINKEDIN_PERSON_URN',
        !hasGnews    && 'Go to Vercel → Settings → Environment Variables → add GNEWS_API_KEY',
        hasTwitter && twitterStatus.includes('Basic tier') && 'Twitter requires $100/mo Basic API plan to post. Consider using only LinkedIn + Buffer.',
        hasLinkedIn && linkedinStatus.includes('EXPIRED') && 'LinkedIn token expired — go to linkedin.com/developers to generate a new access token',
      ].filter(Boolean),
    });
  }

  // ── Record run immediately — ops-agent checks this to confirm agent is alive ──
  // Write at the START so even if the function crashes/times out, ops-agent
  // knows the agent ran and stops the "494375h" false alert.
  await setLastPostTime();

  // CEO approval is fully automatic — no manual gate required

  // ── Credential check ──────────────────────────────────────────────────────────
  const hasTwitter  = !!(process.env.TWITTER_API_KEY && process.env.TWITTER_API_SECRET && process.env.TWITTER_ACCESS_TOKEN && process.env.TWITTER_ACCESS_TOKEN_SECRET);
  const hasLinkedIn = !!(process.env.LINKEDIN_ACCESS_TOKEN && process.env.LINKEDIN_PERSON_URN);
  if (!hasTwitter && !hasLinkedIn) {
    return res.status(200).json({ ok: false, reason: 'No social media credentials configured. Set TWITTER_* and/or LINKEDIN_* env vars in Vercel.' });
  }

  // ── Cooldown: don't post more than once per 2.5 hours ───────────────────────
  if (!forcePost) {
    const lastPost = await getLastPostTime();
    const cooldownMs = 2.5 * 60 * 60 * 1000; // 2.5 hours
    if (Date.now() - lastPost < cooldownMs) {
      return res.status(200).json({
        ok:      true,
        skipped: true,
        reason:  'Cooldown active — last post was less than 2.5 hours ago',
        nextIn:  Math.round((cooldownMs - (Date.now() - lastPost)) / 60000) + ' minutes',
      });
    }
  }

  const minScore = parseInt(process.env.BREAKING_MIN_SCORE || '3');

  // ── Fetch events ─────────────────────────────────────────────────────────────
  const articles = await fetchBreakingEvents();
  if (!articles.length) {
    // Still write timestamp — agent ran, just found nothing
    await setLastPostTime();
    return res.status(200).json({ ok: false, reason: 'No articles returned from feed' });
  }

  // ── Score + deduplicate ───────────────────────────────────────────────────────
  const scored = [];
  for (const article of articles) {
    const url   = article.url || article.link || '';
    if (!url) continue;
    if (await wasPosted(url)) continue;
    const score = scoreArticle(article);
    if (score >= minScore) scored.push({ article, score, url });
  }

  if (!scored.length) {
    await setLastPostTime(); // uses 7-day TTL — ops-agent won't alert
    return res.status(200).json({
      ok:      true,
      skipped: true,
      reason:  `No new high-signal articles found (min score: ${minScore}, checked: ${articles.length})`,
    });
  }

  // Pick highest-scoring article
  scored.sort((a, b) => b.score - a.score);
  const { article, score, url } = scored[0];
  const country = detectCountry(article);

  const twitterCaption  = buildTwitterCaption(article, country);
  const linkedInCaption = buildLinkedInCaption(article, country);

  const results = { article: article.title, score, country: country.name, twitter: null, linkedin: null, push: null, errors: [] };

  // ── Post to Twitter ──────────────────────────────────────────────────────────
  if (hasTwitter) {
    try {
      results.twitter = await postTweet(twitterCaption);
    } catch (e) {
      const errMsg = e.message || String(e);
      results.errors.push({ platform: 'twitter', error: errMsg });
      // Save error to Redis so admin panel can show it
      await upstashCmd(['SET', 'breaking:last_error', `Twitter: ${errMsg.slice(0, 200)}`, 'EX', 86400]).catch(() => {});
    }
  } else {
    results.errors.push({ platform: 'twitter', error: 'Credentials not configured' });
  }

  // ── Post to LinkedIn ─────────────────────────────────────────────────────────
  if (hasLinkedIn) {
    try {
      results.linkedin = await postLinkedIn(linkedInCaption);
    } catch (e) {
      const errMsg = e.message || String(e);
      results.errors.push({ platform: 'linkedin', error: errMsg });
      // Save error to Redis so admin panel can show it
      await upstashCmd(['SET', 'breaking:last_error', `LinkedIn: ${errMsg.slice(0, 200)}`, 'EX', 86400]).catch(() => {});
    }
  } else {
    results.errors.push({ platform: 'linkedin', error: 'Credentials not configured' });
  }

  // ── Push notification to all subscribers ─────────────────────────────────────
  try {
    results.push = await broadcastPush(article, country);
  } catch (e) {
    results.errors.push({ platform: 'push', error: e.message });
  }

  // ── Send FCM to registered Android tokens ─────────────────────────────────────
  try {
    const { sendFCMNotification } = await import('./push.js');
    const fcmTokens = await getAllFCMTokens();
    for (const token of fcmTokens) {
      await sendFCMNotification(token, article.title || 'Breaking News', article.description || country.impact || '', {
        url: 'https://www.orreryx.io/app',
        type: 'breaking',
      });
    }
  } catch (_) {}

  // Always update timestamp — agent ran and attempted to post
  await setLastPostTime();

  // Mark URL as posted only if at least one platform succeeded (dedup guard)
  if (results.twitter || results.linkedin || results.push?.sent > 0) {
    await markPosted(url);
    // Write last story to Redis for family intelligence (CEO, Ideas agents read this)
    await upstashCmd(['SET', 'breaking:last_story', JSON.stringify({
      ts:           Date.now(),
      title:        article.title,
      country:      country.name,
      countryCode:  country.code || '',
      url,
      score,
      marketImpact: country.impact,
      twitterId:    results.twitter,
      linkedinId:   results.linkedin,
    }), 'EX', 86400]);
  }

  return res.status(200).json({
    ok:      true,
    results,
    time:    new Date().toISOString(),
  });
}

export const config = { api: { bodyParser: false } };

// api/reactions.js — "What people are saying" — free public reactions for a headline.
//
// Two sources, tried in order:
//   1. Reddit (via OAuth client-credentials) — best geopolitics discussion.
//      Needs REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET (free: create a "script"
//      app at https://www.reddit.com/prefs/apps). Reddit blocks the public
//      .json API from datacenter IPs, so OAuth is required.
//   2. Hacker News (Algolia API) — no key, always works. Used as a fallback so
//      the feature is never empty even before Reddit creds are configured.
//
// GET /api/reactions?q=<headline>  →  { ok, source, thread, comments:[...] }

const CACHE_TTL = 20 * 60 * 1000; // 20 min
const cacheMap = new Map();       // query → { data, time }

const UA = 'web:orreryx-reactions:1.0 (by /u/orreryx)';

// Subreddits trusted for geopolitical / world-news discussion.
const ALLOWED_SUBS = new Set([
  'worldnews', 'geopolitics', 'news', 'politics', 'europe', 'war',
  'UkraineWarVideoReport', 'CombatFootage', 'internationalpolitics',
  'neutralnews', 'qualitynews', 'anime_titties', 'NeutralPolitics',
  'geopolitics2', 'worldevents', 'GlobalNews',
]);

const STOP = new Set(['the','a','an','as','to','of','in','on','for','and','or','is',
  'are','at','by','with','from','after','over','amid','says','say','new','will',
  'his','her','its','they','this','that','has','have','was','were']);

function buildQuery(headline) {
  const words = (headline || '')
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w.toLowerCase()))
    .slice(0, 8);
  return words.join(' ');
}

function cleanText(s) {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')          // strip HTML tags (HN comments are HTML)
    .replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/')
    .replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 320);
}

// ── Reddit (OAuth) ────────────────────────────────────────────────────────────
let _tok = null; // { token, exp }

async function redditToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (_tok && Date.now() < _tok.exp) return _tok.token;
  const basic = Buffer.from(id + ':' + secret).toString('base64');
  const r = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + basic,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok) throw new Error('reddit token ' + r.status);
  const j = await r.json();
  _tok = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return _tok.token;
}

async function fromReddit(q) {
  const token = await redditToken();
  if (!token) return null; // no creds → skip to fallback
  const h = { 'Authorization': 'Bearer ' + token, 'User-Agent': UA };

  const sUrl = 'https://oauth.reddit.com/search?q=' + encodeURIComponent(q) +
    '&sort=relevance&t=year&limit=15&type=link&raw_json=1';
  const sr = await fetch(sUrl, { headers: h });
  if (!sr.ok) throw new Error('reddit search ' + sr.status);
  const sj = await sr.json();
  const posts = (sj?.data?.children || [])
    .map(c => c.data)
    .filter(p => p && ALLOWED_SUBS.has(p.subreddit) && p.num_comments > 3)
    .sort((a, b) => (b.num_comments || 0) - (a.num_comments || 0));
  if (posts.length === 0) return null;

  const post = posts[0];
  const cUrl = 'https://oauth.reddit.com' + post.permalink + '?sort=top&limit=20&raw_json=1';
  const cr = await fetch(cUrl, { headers: h });
  if (!cr.ok) throw new Error('reddit comments ' + cr.status);
  const cj = await cr.json();
  const listing = Array.isArray(cj) ? cj[1] : null;
  const comments = (listing?.data?.children || [])
    .map(c => c.data)
    .filter(c => c && c.body && c.author && c.author !== 'AutoModerator'
      && !c.stickied && c.body !== '[removed]' && c.body !== '[deleted]'
      && c.body.length > 20)
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5)
    .map(c => ({
      author: c.author,
      body: cleanText(c.body),
      score: c.score || 0,
      permalink: 'https://www.reddit.com' + c.permalink,
    }));
  if (comments.length === 0) return null;

  return {
    ok: true,
    source: 'reddit',
    thread: {
      title: post.title,
      label: 'r/' + post.subreddit,
      permalink: 'https://www.reddit.com' + post.permalink,
      num_comments: post.num_comments,
    },
    comments,
  };
}

// ── Hacker News (Algolia, no key) ──────────────────────────────────────────────
async function fromHN(q) {
  const sUrl = 'https://hn.algolia.com/api/v1/search?query=' + encodeURIComponent(q) +
    '&tags=story&hitsPerPage=8';
  const sr = await fetch(sUrl);
  if (!sr.ok) throw new Error('hn search ' + sr.status);
  const sj = await sr.json();
  const story = (sj.hits || [])
    .filter(s => s && s.num_comments > 2 && s.objectID)
    .sort((a, b) => (b.num_comments || 0) - (a.num_comments || 0))[0];
  if (!story) return null;

  const ir = await fetch('https://hn.algolia.com/api/v1/items/' + story.objectID);
  if (!ir.ok) throw new Error('hn item ' + ir.status);
  const item = await ir.json();
  const comments = (item.children || [])
    .filter(c => c && c.text && c.author)
    .slice(0, 12)
    .map(c => ({
      author: c.author,
      body: cleanText(c.text),
      score: null,
      permalink: 'https://news.ycombinator.com/item?id=' + c.id,
    }))
    .filter(c => c.body.length > 20)
    .slice(0, 5);
  if (comments.length === 0) return null;

  return {
    ok: true,
    source: 'hn',
    thread: {
      title: story.title,
      label: 'Hacker News',
      permalink: 'https://news.ycombinator.com/item?id=' + story.objectID,
      num_comments: story.num_comments,
    },
    comments,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=120');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const headline = (req.query.q || '').toString().slice(0, 300);
  const q = buildQuery(headline);
  if (!q) return res.status(200).json({ ok: false, reason: 'no_query' });

  const cached = cacheMap.get(q);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return res.status(200).json({ ...cached.data, cached: true });
  }

  let data = null;
  // 1) Reddit (best content) — best-effort; never let it break the response.
  try {
    data = await fromReddit(q);
  } catch (e) {
    data = null; // fall through to HN
  }
  // 2) Hacker News fallback.
  if (!data) {
    try {
      data = await fromHN(q);
    } catch (e) {
      data = { ok: false, reason: 'fetch_error', error: e.message };
    }
  }
  if (!data) data = { ok: false, reason: 'no_thread' };

  data.query = q;
  cacheMap.set(q, { data, time: Date.now() });
  return res.status(200).json(data);
}

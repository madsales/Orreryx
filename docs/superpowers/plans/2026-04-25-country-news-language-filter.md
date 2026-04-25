# Country News Filter + Language Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact country + language filter bar to the Intel Feed in app.html, backed by extended gnews.js and events.js APIs that support `?country=XX&lang=XX` query params.

**Architecture:** Three files are modified — `api/gnews.js` (add lang tags to feeds, add 18 new non-English RSS sources, add country-code extraction, filter by params, per-combination caching), `api/events.js` (add lang param to GDELT query, add country-code extraction, per-combination caching), and `public/app.html` (add filter bar UI + JS state, update fetch functions, add lang badge to article cards). No new files, no new API endpoints, no new Vercel functions.

**Tech Stack:** Vanilla JS (no framework), Node.js ES modules, Vercel serverless functions, in-memory Map cache, GDELT Article API, RSS feeds.

---

## File Map

| File | What changes |
|---|---|
| `api/gnews.js` | Add `lang` to FEEDS entries; add 18 non-English feeds; add `CC_MAP` + `extractCC()`; update `parseRss()` to attach `cc` + `lang`; read `country`/`lang` params in handler; filter results; switch from single-variable cache to `Map` |
| `api/events.js` | Add `CC_MAP` + `extractCC()`; update `gdeltUrl()` to accept `sourcelang`; update `parseArticles()` to attach `cc`; read params in handler; add country filter; switch cache to `Map` |
| `public/app.html` | Add CSS for filter bar + lang badges; add filter bar HTML; add `feedFilter` state + `setLang()` + `applyFeedFilter()` JS; update `fetchGNews()` and `fetchLiveEvents()` to pass params; update `buildEventCard()` to show lang badge |
| `.gitignore` | Add `.superpowers/` |

---

## Task 1 — Extend `api/gnews.js`

**Files:**
- Modify: `api/gnews.js:1-6` (cache vars), `api/gnews.js:18-82` (FEEDS), `api/gnews.js:527-615` (parseRss + handler)

### Step 1.1 — Add `.superpowers/` to `.gitignore`

- [ ] Open `.gitignore` and append one line:

```
.superpowers/
```

Run:
```bash
git add .gitignore && git commit -m "chore: ignore .superpowers brainstorm dir"
```

---

### Step 1.2 — Switch cache to Map + add CC_MAP + extractCC

- [ ] Replace the top of `api/gnews.js` (lines 1–6) with:

```javascript
// api/gnews.js - Live RSS from 45+ global news outlets
// Supports ?country=XX&lang=XX query params for filtered feeds

const CACHE_TTL = 8 * 60 * 1000;
const cacheMap = new Map(); // key: 'country:lang' → { data, time }

// ISO country code extraction from article geo location + title
const CC_MAP = {
  'ukraine':'UA','russia':'RU','china':'CN','israel':'IL','iran':'IR',
  'india':'IN','pakistan':'PK','north korea':'KP','taiwan':'TW',
  'saudi arabia':'SA','united states':'US',' us ':'US','germany':'DE',
  'france':'FR','japan':'JP','south korea':'KR','syria':'SY','yemen':'YE',
  'sudan':'SD','ethiopia':'ET','nigeria':'NG','somalia':'SO','turkey':'TR',
  'brazil':'BR','venezuela':'VE','colombia':'CO','myanmar':'MM',
  'afghanistan':'AF','iraq':'IQ','lebanon':'LB','libya':'LY','mali':'ML',
  'belarus':'BY','egypt':'EG','zimbabwe':'ZW','finland':'FI','sweden':'SE',
  'poland':'PL','georgia':'GE','gaza':'IL','west bank':'IL',
  'crimea':'UA','donbas':'UA','kherson':'UA','zaporizhzhia':'UA',
};

function extractCC(loc, txt) {
  const s = ' ' + ((loc || '') + ' ' + (txt || '')).toLowerCase() + ' ';
  for (const [kw, cc] of Object.entries(CC_MAP)) {
    if (s.includes(kw)) return cc;
  }
  return null;
}
```

---

### Step 1.3 — Add `lang` field to every existing FEED entry

- [ ] In `api/gnews.js`, replace the entire `const FEEDS = [` block (lines 18–82) with the version below. Every existing feed gets `lang: 'en'`. 18 new non-English feeds are appended at the end.

```javascript
const FEEDS = [
  // --- GLOBAL WIRE SERVICES (EN) ---
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',                        source: 'BBC World',           lang: 'en' },
  { url: 'https://www.theguardian.com/world/rss',                              source: 'The Guardian',        lang: 'en' },
  { url: 'https://feeds.skynews.com/feeds/rss/world.xml',                      source: 'Sky News',            lang: 'en' },
  { url: 'https://rss.dw.com/rdf/rss-en-all',                                  source: 'Deutsche Welle',      lang: 'en' },
  { url: 'https://www.france24.com/en/rss',                                    source: 'France 24',           lang: 'en' },
  { url: 'https://feeds.npr.org/1004/rss.xml',                                 source: 'NPR News',            lang: 'en' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',                          source: 'Al Jazeera',          lang: 'en' },
  { url: 'https://www.rfi.fr/en/rss',                                          source: 'RFI English',         lang: 'en' },
  { url: 'https://feeds.reuters.com/reuters/worldNews',                        source: 'Reuters World',       lang: 'en' },

  // --- BBC REGIONAL (EN) ---
  { url: 'https://feeds.bbci.co.uk/news/world/africa/rss.xml',                 source: 'BBC Africa',          lang: 'en' },
  { url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml',            source: 'BBC Middle East',     lang: 'en' },
  { url: 'https://feeds.bbci.co.uk/news/world/latin_america/rss.xml',          source: 'BBC Latin America',   lang: 'en' },
  { url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml',                   source: 'BBC Asia',            lang: 'en' },
  { url: 'https://feeds.bbci.co.uk/news/world/europe/rss.xml',                 source: 'BBC Europe',          lang: 'en' },
  { url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml',          source: 'BBC US & Canada',     lang: 'en' },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',                     source: 'BBC Business',        lang: 'en' },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',                   source: 'BBC Technology',      lang: 'en' },

  // --- ASIA & OCEANIA (EN) ---
  { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml',                           source: 'NHK World',           lang: 'en' },
  { url: 'https://www.japantimes.co.jp/feed/topstories/',                      source: 'Japan Times',         lang: 'en' },
  { url: 'https://www.abc.net.au/news/feed/51120/rss.xml',                     source: 'ABC Australia',       lang: 'en' },
  { url: 'https://www.cbc.ca/cmlink/rss-world',                                source: 'CBC Canada',          lang: 'en' },
  { url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml', source: 'Channel News Asia', lang: 'en' },
  { url: 'https://www.straitstimes.com/news/world/rss.xml',                    source: 'Straits Times',       lang: 'en' },
  { url: 'https://www.scmp.com/rss/91/feed',                                   source: 'South China Morning Post', lang: 'en' },

  // --- MIDDLE EAST (EN) ---
  { url: 'https://www.arabnews.com/rss.xml',                                   source: 'Arab News',           lang: 'en' },
  { url: 'https://english.alarabiya.net/rss.xml',                              source: 'Al Arabiya',          lang: 'en' },
  { url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx',                   source: 'Jerusalem Post',      lang: 'en' },
  { url: 'https://gulfnews.com/rss',                                           source: 'Gulf News',           lang: 'en' },
  { url: 'https://www.middleeasteye.net/rss',                                  source: 'Middle East Eye',     lang: 'en' },
  { url: 'https://www.dailysabah.com/rssfeed/home',                            source: 'Daily Sabah',         lang: 'en' },

  // --- EUROPE (EN) ---
  { url: 'https://feeds.feedburner.com/euronews/en/home',                      source: 'Euronews',            lang: 'en' },
  { url: 'https://kyivindependent.com/feed/',                                  source: 'Kyiv Independent',    lang: 'en' },
  { url: 'https://www.themoscowtimes.com/rss/news',                            source: 'Moscow Times',        lang: 'en' },

  // --- SOUTH ASIA (EN) ---
  { url: 'https://www.dawn.com/feeds/home',                                    source: 'Dawn Pakistan',       lang: 'en' },
  { url: 'https://feeds.feedburner.com/ndtvnews-top-stories',                  source: 'NDTV',                lang: 'en' },
  { url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',         source: 'Times of India',      lang: 'en' },
  { url: 'https://www.thehindu.com/news/national/feeder/default.rss',          source: 'The Hindu',           lang: 'en' },
  { url: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms',        source: 'Economic Times',      lang: 'en' },
  { url: 'https://feeds.feedburner.com/ndtvnews-india-news',                   source: 'NDTV India',          lang: 'en' },
  { url: 'https://www.livemint.com/rss/news',                                  source: 'Mint',                lang: 'en' },
  { url: 'https://www.business-standard.com/rss/home_page_top_stories.rss',   source: 'Business Standard',   lang: 'en' },
  { url: 'https://www.indiatoday.in/rss/home',                                 source: 'India Today',         lang: 'en' },
  { url: 'https://www.thehindu.com/business/feeder/default.rss',               source: 'The Hindu Business',  lang: 'en' },

  // --- AFRICA (EN) ---
  { url: 'https://www.theeastafrican.co.ke/tea/rss',                           source: 'The East African',    lang: 'en' },
  { url: 'https://www.dailymaverick.co.za/rss/',                               source: 'Daily Maverick SA',   lang: 'en' },

  // --- FINANCE & MARKETS (EN) ---
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines',  source: 'MarketWatch',         lang: 'en' },
  { url: 'https://www.france24.com/en/economy/rss',                            source: 'France24 Economy',    lang: 'en' },
  { url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html',              source: 'CNBC World',          lang: 'en' },

  // --- ARABIC (AR) ---
  { url: 'https://www.aljazeera.net/xml/rss2.0.xml',                           source: 'Al Jazeera AR',       lang: 'ar' },
  { url: 'https://feeds.bbci.co.uk/arabic/rss.xml',                            source: 'BBC Arabic',          lang: 'ar' },
  { url: 'https://www.france24.com/ar/rss',                                    source: 'France 24 AR',        lang: 'ar' },

  // --- FRENCH (FR) ---
  { url: 'https://www.france24.com/fr/rss',                                    source: 'France 24 FR',        lang: 'fr' },
  { url: 'https://www.rfi.fr/fr/rss',                                          source: 'RFI Français',        lang: 'fr' },
  { url: 'https://www.lemonde.fr/rss/une.xml',                                 source: 'Le Monde',            lang: 'fr' },

  // --- GERMAN (DE) ---
  { url: 'https://rss.dw.com/rdf/rss-de-all',                                  source: 'DW Deutsch',          lang: 'de' },
  { url: 'https://www.spiegel.de/schlagzeilen/index.rss',                      source: 'Der Spiegel',         lang: 'de' },

  // --- SPANISH (ES) ---
  { url: 'https://feeds.bbci.co.uk/mundo/rss.xml',                             source: 'BBC Mundo',           lang: 'es' },
  { url: 'https://www.france24.com/es/rss',                                    source: 'France 24 ES',        lang: 'es' },

  // --- RUSSIAN (RU) ---
  { url: 'https://tass.ru/rss/v2.xml',                                         source: 'TASS',                lang: 'ru' },
  { url: 'https://meduza.io/rss2/all',                                         source: 'Meduza',              lang: 'ru' },

  // --- CHINESE (ZH) ---
  { url: 'https://www.cgtn.com/subscribe/rss/section/world.xml',               source: 'CGTN',                lang: 'zh' },
  { url: 'https://www.globaltimes.cn/rss/outbrain.xml',                        source: 'Global Times',        lang: 'zh' },

  // --- JAPANESE (JA) ---
  { url: 'https://www.nhk.or.jp/rss/news/cat0.xml',                            source: 'NHK Japanese',        lang: 'ja' },

  // --- HINDI (HI) ---
  { url: 'https://feeds.bbci.co.uk/hindi/rss.xml',                             source: 'BBC Hindi',           lang: 'hi' },
  { url: 'https://feeds.feedburner.com/ndtvnews-hindi-top-stories',             source: 'NDTV Hindi',          lang: 'hi' },

  // --- PORTUGUESE (PT) ---
  { url: 'https://feeds.bbci.co.uk/portuguese/rss.xml',                        source: 'BBC Português',       lang: 'pt' },
];
```

---

### Step 1.4 — Update `parseRss()` to attach `cc` and `lang` to each article

- [ ] In `api/gnews.js`, update `parseRss()` signature and the `items.push({...})` call. The function receives the feed object so it can attach `lang`.

Find the function signature (currently line 573):
```javascript
function parseRss(xml, fallbackSource) {
```

Replace with:
```javascript
function parseRss(xml, feed) {
  const fallbackSource = feed.source;
  const feedLang = feed.lang || 'en';
```

Find the `items.push({` block (currently lines 600–613) and replace with:
```javascript
    const { cat, catLabel, severity } = categorize(title);
    const { lat, lng, loc: geoLoc } = geolocate(title);
    const locStr = geoLoc || fallbackSource;
    items.push({
      id:      stableId(rawLink.trim(), title),
      isDemo:  false,
      cat, catLabel, severity,
      lat, lng,
      loc:     locStr,
      cc:      extractCC(locStr, title),
      lang:    feedLang,
      txt:     title,
      url:     rawLink.trim(),
      source:  rawSrc.replace(/<[^>]+>/g,'').trim() || fallbackSource,
      tags:    [],
      time:    pubIso,
      fromRss: true,
    });
```

---

### Step 1.5 — Update handler to read params, filter, and use Map cache

- [ ] In `api/gnews.js`, replace the entire `export default async function handler(req, res) {` block (lines 628–672) with:

```javascript
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=480, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const country = (req.query.country || 'all').toUpperCase();
  const lang    = (req.query.lang    || 'en').toLowerCase();
  const cacheKey = `${country}:${lang}`;
  const cacheTTL = (country === 'ALL' && lang === 'en') ? CACHE_TTL : 5 * 60 * 1000;

  const cached = cacheMap.get(cacheKey);
  if (cached && Date.now() - cached.time < cacheTTL) {
    return res.status(200).json(cached.data);
  }

  // For filtered requests, only fetch feeds matching the requested language
  const feedsToFetch = lang === 'all' ? FEEDS : FEEDS.filter(f => f.lang === lang);
  // Always include 'en' feeds as fallback if no feeds match the language
  const activeFeed = feedsToFetch.length > 0 ? feedsToFetch : FEEDS.filter(f => f.lang === 'en');

  try {
    const results = await Promise.allSettled(
      activeFeed.map(feed =>
        fetch(feed.url, {
          headers: {
            'User-Agent': 'OrreryIntelligence/1.0 (https://www.orreryx.io)',
            'Accept': 'application/rss+xml, application/xml, text/xml',
          },
          signal: AbortSignal.timeout(8000),
        })
          .then(r => r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status)))
          .then(xml => parseRss(xml, feed))
          .catch(e => { console.error('[GNews] ' + feed.source + ' failed:', e.message); return []; })
      )
    );

    let all = [];
    results.forEach(r => { if (r.status === 'fulfilled') all = all.concat(r.value); });

    // Filter by country code if requested
    if (country !== 'ALL') {
      all = all.filter(a => a.cc === country);
    }

    all.sort((a, b) => new Date(b.time) - new Date(a.time));
    const final = dedupByTitle(all).slice(0, 200);

    const successFeeds = results.filter(r => r.status === 'fulfilled' && r.value.length > 0).length;
    const data = { articles: final, fetched: Date.now(), count: final.length, source: 'rss', feeds: successFeeds, country, lang };
    cacheMap.set(cacheKey, { data, time: Date.now() });

    console.log('[GNews] ' + final.length + ' articles from ' + successFeeds + '/' + activeFeed.length + ' feeds [' + cacheKey + ']');
    return res.status(200).json(data);

  } catch (err) {
    console.error('[GNews] Fatal:', err.message);
    return res.status(200).json({ articles: [], error: err.message, source: 'rss', fetched: Date.now() });
  }
}
```

---

### Step 1.6 — Fix the `parseRss` call site to pass full feed object

- [ ] In the handler (the `activeFeed.map(feed => ...)` block written above), confirm `parseRss(xml, feed)` is already passing the full feed object — it is, from the Step 1.5 code. No extra change needed.

- [ ] Verify Step 1.3 changed the call inside the old handler from `.then(xml => parseRss(xml, feed.source))` to `.then(xml => parseRss(xml, feed))`. The new handler block in Step 1.5 already does this correctly.

---

### Step 1.7 — Commit Task 1

- [ ] Run:
```bash
git add api/gnews.js .gitignore
git commit -m "feat(gnews): add country+lang filter params, 18 new non-english feeds, per-combo cache"
```

---

## Task 2 — Extend `api/events.js`

**Files:**
- Modify: `api/events.js:1-6` (cache vars), `api/events.js:67-73` (gdeltUrl), `api/events.js:590-608` (parseArticles), `api/events.js:620-669` (handler)

### Step 2.1 — Replace cache var + add CC_MAP + extractCC

- [ ] Replace the top of `api/events.js` (lines 1–6) with:

```javascript
// api/events.js - Orrery Global News Coverage
// Uses GDELT Article API (mode=artlist) - updates every 15 minutes
// Supports ?country=XX&lang=XX query params

const CACHE_TTL = 5 * 60 * 1000;
const cacheMap = new Map(); // key: 'country:lang' → { data, time }

// ISO country code extraction — same map as gnews.js
const CC_MAP = {
  'ukraine':'UA','russia':'RU','china':'CN','israel':'IL','iran':'IR',
  'india':'IN','pakistan':'PK','north korea':'KP','taiwan':'TW',
  'saudi arabia':'SA','united states':'US',' us ':'US','germany':'DE',
  'france':'FR','japan':'JP','south korea':'KR','syria':'SY','yemen':'YE',
  'sudan':'SD','ethiopia':'ET','nigeria':'NG','somalia':'SO','turkey':'TR',
  'brazil':'BR','venezuela':'VE','colombia':'CO','myanmar':'MM',
  'afghanistan':'AF','iraq':'IQ','lebanon':'LB','libya':'LY','mali':'ML',
  'belarus':'BY','egypt':'EG','zimbabwe':'ZW','finland':'FI','sweden':'SE',
  'poland':'PL','georgia':'GE','gaza':'IL','west bank':'IL',
  'crimea':'UA','donbas':'UA','kherson':'UA','zaporizhzhia':'UA',
};

function extractCC(loc, txt) {
  const s = ' ' + ((loc || '') + ' ' + (txt || '')).toLowerCase() + ' ';
  for (const [kw, cc] of Object.entries(CC_MAP)) {
    if (s.includes(kw)) return cc;
  }
  return null;
}
```

---

### Step 2.2 — Update `gdeltUrl()` to accept a `sourcelang` argument

- [ ] Find `gdeltUrl()` (currently lines 67–73) and replace with:

```javascript
// GDELT language code map
const GDELT_LANG = {
  en:'english', ar:'arabic', fr:'french', de:'german',
  es:'spanish', ru:'russian', zh:'chinese', ja:'japanese', hi:'hindi', pt:'portuguese',
};

// GDELT Article API - fresh articles, updates every 15 min
function gdeltUrl(query, max, sourcelang) {
  const langParam = sourcelang ? '&sourcelang=' + sourcelang : '&sourcelang=english';
  return (
    'https://api.gdeltproject.org/api/v2/doc/doc' +
    '?query=' + encodeURIComponent(query) +
    '&mode=artlist&format=json&timespan=12h&maxrecords=' + max + '&sort=DateDesc' + langParam
  );
}
```

---

### Step 2.3 — Update `parseArticles()` to attach `cc` field

- [ ] Find `parseArticles()` (currently lines 590–608). Find the `return {` block inside `.map(a => {` and add `cc` after `loc`:

```javascript
function parseArticles(articles) {
  return (articles || [])
    .filter(a => a && a.title && String(a.title).trim().length > 15)
    .map(a => {
      const title = String(a.title).replace(/\s+/g, ' ').trim();
      const { cat, catLabel, severity } = categorize(title);
      const { lat, lng, loc } = geolocate(title);
      return {
        id:       stableId(a.url, title),
        cat, catLabel, severity,
        lat, lng, loc,
        cc:       extractCC(loc, title),
        txt:      title,
        url:      a.url || '',
        source:   a.domain || '',
        tags:     [],
        time:     parseGdeltDate(a.seendate) || new Date().toISOString(),
      };
    });
}
```

---

### Step 2.4 — Update handler to read params, use lang in GDELT, filter by country, use Map cache

- [ ] Replace the entire `export default async function handler(req, res) {` block (lines 620–669) with:

```javascript
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const country = (req.query.country || 'all').toUpperCase();
  const lang    = (req.query.lang    || 'en').toLowerCase();
  const cacheKey = `${country}:${lang}`;

  const cached = cacheMap.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return res.status(200).json(cached.data);
  }

  // Map UI lang code → GDELT sourcelang param value. 'all' = omit (multilingual).
  const sourcelang = lang === 'all' ? null : (GDELT_LANG[lang] || 'english');

  try {
    const results = await Promise.allSettled(
      STREAMS.map(s =>
        fetch(gdeltUrl(s.query, s.max, sourcelang), {
          headers: { 'User-Agent': 'OrreryIntelligence/1.0 (https://www.orreryx.io)' },
          signal:  AbortSignal.timeout(9000),
        })
          .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
          .then(j => parseArticles(j.articles))
          .catch(() => [])
      )
    );

    let all = [];
    results.forEach(r => { if (r.status === 'fulfilled') all = all.concat(r.value); });

    // Filter by country code if requested
    if (country !== 'ALL') {
      all = all.filter(e => e.cc === country);
    }

    all.sort((a, b) => new Date(b.time) - new Date(a.time));
    const final = dedup(all).slice(0, 200);

    const counts = {};
    final.forEach(e => { counts[e.cat] = (counts[e.cat] || 0) + 1; });

    const data = {
      events:  final,
      fetched: Date.now(),
      count:   final.length,
      bycat:   counts,
      source:  'gdelt-articles',
      country, lang,
    };
    cacheMap.set(cacheKey, { data, time: Date.now() });

    console.log('[Events] GDELT: ' + final.length + ' events [' + cacheKey + '], newest: ' + (final[0] && final[0].time || 'n/a'));
    return res.status(200).json(data);

  } catch (err) {
    console.error('[Events] Fatal:', err.message);
    return res.status(200).json({ events: [], error: err.message, source: 'fallback', fetched: Date.now() });
  }
}
```

---

### Step 2.5 — Commit Task 2

- [ ] Run:
```bash
git add api/events.js
git commit -m "feat(events): add country+lang filter params to GDELT handler, per-combo cache"
```

---

## Task 3 — Update `public/app.html`

**Files:**
- Modify: `public/app.html` (CSS ~line 173, HTML ~line 722, JS ~lines 1640/2516/2328)

### Step 3.1 — Add CSS for filter bar and language badges

- [ ] Find the line `.intel-filter-bar{padding:6px 12px;...` (around line 173) and insert the following CSS block **immediately before** it:

```css
/* ── COUNTRY + LANGUAGE FILTER BAR ── */
.feed-country-bar{display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--brd);background:var(--bg2);flex-shrink:0}
.feed-country-lbl{font:700 7px/1 var(--mono);letter-spacing:.1em;color:var(--txt4);flex-shrink:0}
#filter-country{background:var(--bg3);border:1px solid var(--brd2);border-radius:var(--radius-sm);color:var(--txt2);font:500 11px/1 var(--sans);padding:3px 7px;cursor:pointer;flex:1;min-width:0;max-width:180px}
.lang-pills{display:flex;gap:2px;flex-shrink:0;flex-wrap:nowrap}
.lang-pill{background:var(--bg3);border:1px solid var(--brd);border-radius:var(--radius-sm);color:var(--txt3);font:600 8px/1 var(--mono);padding:3px 6px;cursor:pointer;transition:all .12s;white-space:nowrap}
.lang-pill:hover{color:var(--txt2);border-color:var(--brd2)}
.lang-pill.active{background:rgba(59,130,246,.15);border-color:#3b82f6;color:#3b82f6}
/* Language badges on article cards */
.lang-badge{font:600 7px/1 var(--mono);border-radius:2px;padding:1px 4px;flex-shrink:0;margin-left:2px}
.lb-en{background:rgba(59,130,246,.15);color:#3b82f6}
.lb-ar{background:rgba(139,92,246,.15);color:#8b5cf6}
.lb-fr{background:rgba(20,184,166,.15);color:#14b8a6}
.lb-de{background:rgba(234,179,8,.15);color:#eab308}
.lb-es{background:rgba(249,115,22,.15);color:#f97316}
.lb-ru{background:rgba(239,68,68,.15);color:#ef4444}
.lb-zh{background:rgba(236,72,153,.15);color:#ec4899}
.lb-ja{background:rgba(168,85,247,.15);color:#a855f7}
.lb-hi{background:rgba(245,158,11,.15);color:#f59e0b}
.lb-pt{background:rgba(34,197,94,.15);color:#22c55e}
```

---

### Step 3.2 — Add filter bar HTML into the intel feed

- [ ] Find the `<div class="intel-filter-bar">` line (around line 723). Insert the following block **immediately before** it:

```html
      <div class="feed-country-bar" id="feed-country-bar">
        <span class="feed-country-lbl">FILTER</span>
        <select id="filter-country" onchange="applyFeedFilter()">
          <option value="all">🌍 All Countries</option>
          <option value="UA">🇺🇦 Ukraine</option>
          <option value="RU">🇷🇺 Russia</option>
          <option value="CN">🇨🇳 China</option>
          <option value="IL">🇮🇱 Israel</option>
          <option value="IR">🇮🇷 Iran</option>
          <option value="IN">🇮🇳 India</option>
          <option value="PK">🇵🇰 Pakistan</option>
          <option value="KP">🇰🇵 North Korea</option>
          <option value="TW">🇹🇼 Taiwan</option>
          <option value="SA">🇸🇦 Saudi Arabia</option>
          <option value="AF">🇦🇫 Afghanistan</option>
          <option value="BY">🇧🇾 Belarus</option>
          <option value="BR">🇧🇷 Brazil</option>
          <option value="CO">🇨🇴 Colombia</option>
          <option value="EG">🇪🇬 Egypt</option>
          <option value="ET">🇪🇹 Ethiopia</option>
          <option value="DE">🇩🇪 Germany</option>
          <option value="FR">🇫🇷 France</option>
          <option value="IQ">🇮🇶 Iraq</option>
          <option value="JP">🇯🇵 Japan</option>
          <option value="LB">🇱🇧 Lebanon</option>
          <option value="LY">🇱🇾 Libya</option>
          <option value="ML">🇲🇱 Mali</option>
          <option value="MM">🇲🇲 Myanmar</option>
          <option value="NG">🇳🇬 Nigeria</option>
          <option value="SO">🇸🇴 Somalia</option>
          <option value="KR">🇰🇷 South Korea</option>
          <option value="SD">🇸🇩 Sudan</option>
          <option value="SY">🇸🇾 Syria</option>
          <option value="TR">🇹🇷 Turkey</option>
          <option value="US">🇺🇸 United States</option>
          <option value="VE">🇻🇪 Venezuela</option>
          <option value="YE">🇾🇪 Yemen</option>
          <option value="ZW">🇿🇼 Zimbabwe</option>
        </select>
        <div class="lang-pills" id="lang-pills">
          <button class="lang-pill" data-lang="all" onclick="setLang(this,'all')">All</button>
          <button class="lang-pill active" data-lang="en" onclick="setLang(this,'en')">EN</button>
          <button class="lang-pill" data-lang="ar" onclick="setLang(this,'ar')">AR</button>
          <button class="lang-pill" data-lang="fr" onclick="setLang(this,'fr')">FR</button>
          <button class="lang-pill" data-lang="de" onclick="setLang(this,'de')">DE</button>
          <button class="lang-pill" data-lang="es" onclick="setLang(this,'es')">ES</button>
          <button class="lang-pill" data-lang="ru" onclick="setLang(this,'ru')">RU</button>
          <button class="lang-pill" data-lang="zh" onclick="setLang(this,'zh')">ZH</button>
          <button class="lang-pill" data-lang="ja" onclick="setLang(this,'ja')">JA</button>
          <button class="lang-pill" data-lang="hi" onclick="setLang(this,'hi')">HI</button>
          <button class="lang-pill" data-lang="pt" onclick="setLang(this,'pt')">PT</button>
        </div>
      </div>
```

---

### Step 3.3 — Add feedFilter state and filter functions to JS

- [ ] Find `let activeFilter = 'all';` (around line 1640). Insert the following **immediately after** that line:

```javascript
// ── COUNTRY + LANGUAGE FILTER STATE ──
let feedFilter = { country: 'all', lang: 'en' }; // 'en' default = same as live behavior today

function setLang(btn, lang) {
  document.querySelectorAll('.lang-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  feedFilter.lang = lang;
  applyFeedFilter();
}

function applyFeedFilter() {
  const sel = document.getElementById('filter-country');
  if (sel) feedFilter.country = sel.value;
  // Clear feed and re-fetch with new params
  feedEvents = feedEvents.filter(e => e.isDemo); // keep demo events as skeleton
  const body = document.getElementById('intel-feed-body');
  if (body) body.innerHTML = '<div style="padding:24px 16px;text-align:center;color:var(--txt4);font:500 10px/1 var(--mono);letter-spacing:.08em">LOADING FILTERED FEED...</div>';
  fetchLiveEvents();
  fetchGNews();
}
```

---

### Step 3.4 — Update `fetchGNews()` to pass filter params

- [ ] Find `async function fetchGNews() {` (around line 2516). Replace the first line inside it:

**Find:**
```javascript
    const r = await fetch('/api/gnews', { signal: AbortSignal.timeout(12000) });
```

**Replace with:**
```javascript
    const { country, lang } = feedFilter;
    const params = new URLSearchParams();
    if (country && country !== 'all') params.set('country', country);
    if (lang && lang !== 'all') params.set('lang', lang);
    const qs = params.toString() ? '?' + params.toString() : '';
    const r = await fetch('/api/gnews' + qs, { signal: AbortSignal.timeout(12000) });
```

---

### Step 3.5 — Update `fetchLiveEvents()` to pass filter params

- [ ] Find `async function fetchLiveEvents() {` (around line 2540). Replace the first line inside it:

**Find:**
```javascript
    const r = await fetch('/api/events', { signal: AbortSignal.timeout(12000) });
```

**Replace with:**
```javascript
    const { country, lang } = feedFilter;
    const params = new URLSearchParams();
    if (country && country !== 'all') params.set('country', country);
    if (lang && lang !== 'all') params.set('lang', lang);
    const qs = params.toString() ? '?' + params.toString() : '';
    const r = await fetch('/api/events' + qs, { signal: AbortSignal.timeout(12000) });
```

---

### Step 3.6 — Add language badge to `buildEventCard()`

- [ ] Find `function buildEventCard(e) {` (around line 2328). Find this line inside it:

```javascript
  const srcLabel = e.source ? e.source : 'Source';
```

Add the following **immediately after** that line:
```javascript
  const langCode = e.lang || 'en';
  const langBadge = `<span class="lang-badge lb-${langCode}">${langCode.toUpperCase()}</span>`;
```

Then find the ev-foot line:
```javascript
    <div class="ev-foot">${tags}<span class="tag" style="background:var(--bg4);color:var(--txt3);cursor:pointer" onclick="event.stopPropagation();handleEvStockClick(this)">🤖 AI Brief →</span><a class="tag ev-src-link" href="${srcUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Read original source">🔗 ${srcLabel} →</a></div>
```

Replace it with:
```javascript
    <div class="ev-foot">${tags}${langBadge}<span class="tag" style="background:var(--bg4);color:var(--txt3);cursor:pointer" onclick="event.stopPropagation();handleEvStockClick(this)">🤖 AI Brief →</span><a class="tag ev-src-link" href="${srcUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Read original source">🔗 ${srcLabel} →</a></div>
```

---

### Step 3.7 — Verify default behavior is unchanged

- [ ] Open the browser (or use curl) and confirm:

```bash
# Default fetch — no params — same as today
curl "https://orreryx.io/api/gnews" | python3 -c "import sys,json; d=json.load(sys.stdin); print('count:', d['count'], 'lang:', d.get('lang','n/a'))"
# Expected: count: 150-200, lang: en

curl "https://orreryx.io/api/events" | python3 -c "import sys,json; d=json.load(sys.stdin); print('count:', d['count'], 'lang:', d.get('lang','n/a'))"
# Expected: count: 100-200, lang: en
```

- [ ] Test country filter:
```bash
curl "https://orreryx.io/api/gnews?country=UA&lang=en" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Ukraine articles:', d['count'])"
# Expected: count > 0 (Ukraine is heavily covered)
```

- [ ] Test language filter:
```bash
curl "https://orreryx.io/api/gnews?lang=ar" | python3 -c "import sys,json; d=json.load(sys.stdin); print('Arabic articles:', d['count'], 'feeds:', d['feeds'])"
# Expected: count > 0, feeds: 3
```

---

### Step 3.8 — Commit Task 3

- [ ] Run:
```bash
git add public/app.html
git commit -m "feat(app): add country + language filter bar to intel feed with lang badges"
```

---

### Step 3.9 — Push to production

- [ ] Run:
```bash
git push origin main
```

Expected: Vercel deploys in ~30 seconds. Open https://orreryx.io/app, navigate to Intel Feed — the filter bar should appear between the feed header and the category filter buttons. Default state (EN, All Countries) should show the same live feed as before.

---

## Verification Checklist

- [ ] Filter bar visible on Intel page between feed header and category buttons
- [ ] Selecting "Ukraine" country → feed shows only Ukraine-tagged articles
- [ ] Selecting "AR" lang → feed shows Arabic-source headlines (Al Jazeera AR, BBC Arabic, France 24 AR)
- [ ] Selecting "All Countries" + "EN" → identical to the feed before this feature was added
- [ ] Each article card shows a coloured language badge (EN=blue, AR=purple, FR=teal, etc.)
- [ ] Auto-refresh every 90s continues with active filter (EN pill stays active, country stays selected)
- [ ] No new Vercel functions added (still under 12-function limit)
- [ ] `/api/gnews` with no params returns same result as before (200 articles, EN, all countries)

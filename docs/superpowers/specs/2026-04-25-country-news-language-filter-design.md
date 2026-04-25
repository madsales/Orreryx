# Country News Filter + Language Selection — Design Spec

**Date:** 2026-04-25  
**Status:** Approved

---

## Objective

Add a compact country filter dropdown and language pill selector to the existing Intel Feed inside `app.html`. When both filters are at their defaults, the feed behaves exactly as it does today. When a user selects a country and/or language, the feed re-fetches and shows only articles matching that combination.

---

## Architecture

Two existing API endpoints are extended with optional query params. A compact filter bar is added to the Intel page UI. No new endpoints, no new pages, no breaking changes to existing behavior.

```
app.html (Intel Feed UI)
  └── filter bar: country <select> + language pills
        ├── fetchGNews(?country=XX&lang=XX)  →  /api/gnews
        └── fetchLiveEvents(?lang=XX)        →  /api/events  (GDELT)
```

---

## Section 1 — UI: Filter Bar (`app.html`)

### Placement
Inserted between the `.intel-feed-hd` header div and the first article card, inside `#pg-intel`.

### HTML structure
```html
<div class="feed-filter-bar" id="feed-filter-bar">
  <span class="filter-lbl">FILTER</span>
  <select id="filter-country" onchange="applyFeedFilter()">
    <option value="all">🌍 All Countries</option>
    <!-- ~50 countries, conflict-relevant first, then alphabetical -->
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
    <!-- divider then alphabetical global list -->
    <option value="AF">🇦🇫 Afghanistan</option>
    <option value="BY">🇧🇾 Belarus</option>
    <option value="BR">🇧🇷 Brazil</option>
    <option value="EG">🇪🇬 Egypt</option>
    <option value="ET">🇪🇹 Ethiopia</option>
    <option value="FR">🇫🇷 France</option>
    <option value="DE">🇩🇪 Germany</option>
    <option value="IQ">🇮🇶 Iraq</option>
    <option value="JP">🇯🇵 Japan</option>
    <option value="LY">🇱🇾 Libya</option>
    <option value="ML">🇲🇱 Mali</option>
    <option value="MM">🇲🇲 Myanmar</option>
    <option value="NI">🇳🇮 Nicaragua</option>
    <option value="NG">🇳🇬 Nigeria</option>
    <option value="SO">🇸🇴 Somalia</option>
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
    <button class="lang-pill active" data-lang="en"  onclick="setLang(this,'en')">EN</button>
    <button class="lang-pill" data-lang="ar"  onclick="setLang(this,'ar')">AR</button>
    <button class="lang-pill" data-lang="fr"  onclick="setLang(this,'fr')">FR</button>
    <button class="lang-pill" data-lang="de"  onclick="setLang(this,'de')">DE</button>
    <button class="lang-pill" data-lang="es"  onclick="setLang(this,'es')">ES</button>
    <button class="lang-pill" data-lang="ru"  onclick="setLang(this,'ru')">RU</button>
    <button class="lang-pill" data-lang="zh"  onclick="setLang(this,'zh')">ZH</button>
    <button class="lang-pill" data-lang="ja"  onclick="setLang(this,'ja')">JA</button>
    <button class="lang-pill" data-lang="hi"  onclick="setLang(this,'hi')">HI</button>
  </div>
</div>
```

### CSS additions (inside existing `<style>`)
```css
.feed-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 13px;
  border-bottom: 1px solid var(--brd);
  background: var(--bg2);
  flex-shrink: 0;
}
.filter-lbl {
  font: 700 7px/1 var(--mono);
  letter-spacing: .1em;
  color: var(--txt4);
  flex-shrink: 0;
}
#filter-country {
  background: var(--bg3);
  border: 1px solid var(--brd2);
  border-radius: var(--radius-sm);
  color: var(--txt2);
  font: 500 11px/1 var(--sans);
  padding: 4px 8px;
  cursor: pointer;
  flex: 1;
  min-width: 0;
}
.lang-pills {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}
.lang-pill {
  background: var(--bg3);
  border: 1px solid var(--brd);
  border-radius: var(--radius-sm);
  color: var(--txt3);
  font: 600 9px/1 var(--mono);
  padding: 3px 7px;
  cursor: pointer;
  transition: all .12s;
}
.lang-pill.active {
  background: rgba(59,130,246,.15);
  border-color: #3b82f6;
  color: #3b82f6;
}
.lang-badge {
  font: 600 7px/1 var(--mono);
  border-radius: 2px;
  padding: 1px 4px;
  flex-shrink: 0;
}
.lang-badge-en { background: rgba(59,130,246,.15); color: #3b82f6; }
.lang-badge-ar { background: rgba(139,92,246,.15);  color: #8b5cf6; }
.lang-badge-fr { background: rgba(20,184,166,.15);  color: #14b8a6; }
.lang-badge-de { background: rgba(234,179,8,.15);   color: #eab308; }
.lang-badge-es { background: rgba(249,115,22,.15);  color: #f97316; }
.lang-badge-ru { background: rgba(239,68,68,.15);   color: #ef4444; }
.lang-badge-zh { background: rgba(236,72,153,.15);  color: #ec4899; }
.lang-badge-ja { background: rgba(168,85,247,.15);  color: #a855f7; }
.lang-badge-hi { background: rgba(245,158,11,.15);  color: #f59e0b; }
```

### JavaScript state + filter logic (added to app.html)
```javascript
// Feed filter state — lang defaults to 'en' to preserve existing English-only behavior
let feedFilter = { country: 'all', lang: 'en' };

function setLang(btn, lang) {
  document.querySelectorAll('.lang-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  feedFilter.lang = lang;
  applyFeedFilter();
}

function applyFeedFilter() {
  feedFilter.country = document.getElementById('filter-country').value;
  // Clear current feed and re-fetch with new filters
  document.getElementById('intel-feed-body').innerHTML = '<div class="feed-loading">Loading...</div>';
  fetchGNews();
  fetchLiveEvents();
}
```

### Article card language badge
Each rendered article card appends a `<span class="lang-badge lang-badge-${article.lang}">` with the language code next to the source/time line. This is added inside the existing `buildEventCard()` function in app.html, in the card footer row where source name and timestamp are rendered.

### Default state
On page load: `feedFilter = { country: 'all', lang: 'all' }`. Both `fetchGNews()` and `fetchLiveEvents()` are called with no params — identical to current behavior.

---

## Section 2 — Backend: `api/gnews.js`

### Query params accepted
- `country` — ISO 3166-1 alpha-2 code (e.g. `UA`, `CN`) or `all` (default)
- `lang` — ISO 639-1 code (e.g. `en`, `ar`) or `all` (default)

### Country filtering
gnews.js already geo-tags every article via a 250+ city/region → country code lookup. After building the article list, add:
```javascript
if (country && country !== 'all') {
  articles = articles.filter(a => a.country === country.toUpperCase());
}
```

### Language filtering
Each RSS feed source object gains a `lang` field at definition time:
```javascript
{ url: 'https://feeds.bbci.co.uk/news/world/rss.xml',        name: 'BBC',             lang: 'en' },
{ url: 'https://www.aljazeera.net/xml/rss2.0.xml',           name: 'Al Jazeera AR',   lang: 'ar' },
{ url: 'https://feeds.bbci.co.uk/arabic/rss.xml',            name: 'BBC Arabic',      lang: 'ar' },
// ...etc
```

After fetching and parsing all feeds, filter:
```javascript
if (lang && lang !== 'all') {
  articles = articles.filter(a => a.lang === lang);
}
```

Each article object gains: `lang: sourceFeed.lang`.

### New RSS feed sources added (20 feeds across 8 languages)

| Lang | Source | RSS URL |
|---|---|---|
| AR | Al Jazeera Arabic | `https://www.aljazeera.net/xml/rss2.0.xml` |
| AR | BBC Arabic | `https://feeds.bbci.co.uk/arabic/rss.xml` |
| AR | France 24 Arabic | `https://www.france24.com/ar/rss` |
| FR | France 24 French | `https://www.france24.com/fr/rss` |
| FR | RFI French | `https://www.rfi.fr/fr/rss` |
| FR | Le Monde | `https://www.lemonde.fr/rss/une.xml` |
| DE | DW Deutsch | `https://rss.dw.com/rdf/rss-de-all` |
| DE | Der Spiegel | `https://www.spiegel.de/schlagzeilen/index.rss` |
| ES | BBC Mundo | `https://feeds.bbci.co.uk/mundo/rss.xml` |
| ES | France 24 Spanish | `https://www.france24.com/es/rss` |
| RU | TASS | `https://tass.ru/rss/v2.xml` |
| RU | Meduza | `https://meduza.io/rss2/all` |
| ZH | CGTN | `https://www.cgtn.com/subscribe/rss/section/world.xml` |
| ZH | Global Times | `https://www.globaltimes.cn/rss/outbrain.xml` |
| JA | NHK Japanese | `https://www.nhk.or.jp/rss/news/cat0.xml` |
| HI | BBC Hindi | `https://feeds.bbci.co.uk/hindi/rss.xml` |
| HI | NDTV Hindi | `https://feeds.feedburner.com/ndtvnews-hindi-top-stories` |
| PT | BBC Portuguese | `https://feeds.bbci.co.uk/portuguese/rss.xml` |

### Cache key
Change from: `gnews:cache`  
Change to: `gnews:${country || 'all'}:${lang || 'all'}`  
TTL: 8 min for default combo (`all:all`), 5 min for specific combos.  
Default combo (`all:all`) continues hitting the same cache as today.

---

## Section 3 — Backend: `api/events.js` (GDELT)

### Language param
GDELT already accepts `sourcelang`. Currently hardcoded to `english`.

Change to read from query param `lang` and map:
```javascript
const GDELT_LANG_MAP = {
  en: 'english', ar: 'arabic', fr: 'french', de: 'german',
  es: 'spanish', ru: 'russian', zh: 'chinese', ja: 'japanese', hi: 'hindi'
};
const sourcelang = GDELT_LANG_MAP[lang] || 'english';
// if lang === 'all': omit sourcelang param entirely from GDELT query
```

### Country param
GDELT supports `LOCATIONCC` filter. When `country !== 'all'`, append `&LOCATIONCC=${country}` to the GDELT query URL.

### Cache key
Change from: `gdelt:cache`  
Change to: `gdelt:${country || 'all'}:${lang || 'all'}`  
TTL: 5 min (same as today for default).

---

## Section 4 — app.html: fetch function changes

### `fetchGNews()`
```javascript
async function fetchGNews() {
  const { country, lang } = feedFilter;
  const params = new URLSearchParams();
  if (country !== 'all') params.set('country', country);
  if (lang !== 'all') params.set('lang', lang);
  const qs = params.toString() ? '?' + params.toString() : '';
  const res = await fetch('/api/gnews' + qs);
  // ... existing handling unchanged
}
```

### `fetchLiveEvents()`
```javascript
async function fetchLiveEvents() {
  const { country, lang } = feedFilter;
  const params = new URLSearchParams();
  if (country !== 'all') params.set('country', country);
  if (lang !== 'all') params.set('lang', lang);
  const qs = params.toString() ? '?' + params.toString() : '';
  const res = await fetch('/api/events' + qs);
  // ... existing handling unchanged
}
```

When both filters are default (`all`/`all`), `qs` is empty string → URLs are `/api/gnews` and `/api/events` — exactly as today.

---

## Section 5 — Backward Compatibility Guarantee

| Scenario | Behavior |
|---|---|
| Page load, no filters touched | `feedFilter = {country:'all', lang:'en'}` → `/api/gnews?lang=en` + GDELT `sourcelang=english` → identical to today |
| User selects "All" language pill | `lang:'all'` → sourcelang param omitted → multilingual GDELT results |
| User selects a country | `/api/gnews?country=UA` → server filters by country tag |
| User selects a language | `/api/gnews?lang=ar` → server returns only Arabic-source articles |
| User selects country + language | `/api/gnews?country=IR&lang=ar` → double-filtered |
| Filter cleared back to All | Returns to default fetch — live feed resumes as normal |

The interval-based auto-refresh (`setInterval fetchGNews/fetchLiveEvents, 90s`) continues to work — it reads `feedFilter` state at call time, so filtered feeds also auto-refresh.

---

## Files Modified

| File | Change |
|---|---|
| `public/app.html` | Add filter bar HTML, CSS, JS state, badge rendering, update fetch functions |
| `api/gnews.js` | Add `country`/`lang` params, tag feeds with `lang`, add 18 new RSS feeds, update cache key |
| `api/events.js` | Add `lang`/`country` params to GDELT query, update cache key |

## Files Created

None — this feature lives entirely within existing files.

---

## Success Criteria

- Default feed (no filters) shows exactly the same articles as before
- Selecting "Ukraine" shows only articles geo-tagged to Ukraine
- Selecting "AR" shows only articles from Arabic-language sources
- Selecting "China" + "ZH" shows Chinese-language articles about China
- Language badge appears on each article card
- Auto-refresh every 90s continues to respect active filters
- No Vercel function limit impact (reuses existing 2 functions, no new ones)

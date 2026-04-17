// api/videos.js — News Channel Video Coverage
// Fetches public RSS feeds from major news channels (CNN, BBC, Reuters, Al Jazeera, Sky News, etc.)
// No API key needed. YouTube provides free channel RSS feeds publicly.
// Scores each video title against the query keywords for relevance.
//
// Query is now built client-side as "Country + topic" (e.g. "Iran military conflict")
// so it matches real news titles instead of fictional scenario text.

const CHANNELS = [
  { name: 'CNN',          id: 'UCupvZG-5ko_eiXAupbDfxWw' },
  { name: 'BBC News',     id: 'UCnUYZLuoy1rq1aVMwx4aTzw' },
  { name: 'Reuters',      id: 'UChqUTb7kYRX8-EiaN3XFrSQ' },
  { name: 'Al Jazeera',  id: 'UCNye-wNBqNL5ZzHSJdba5zA'  },
  { name: 'Sky News',     id: 'UCIK31bDqkH8lsYsYMoHcFJQ' },
  { name: 'France 24',    id: 'UCQfwfsi5VrQ8yKZ-UWmAEFg' },
  { name: 'DW News',      id: 'UCknLrEdhRCp1aegoMqRaCZg' },
  { name: 'NBC News',     id: 'UCeY0bbntWzzVIaj2z3QigXg' },
  { name: 'ABC News',     id: 'UCBi2mrWuNuyYy4gbM6fU18Q' },
];

// Synonym map — expands query terms so e.g. "conflict" also matches "war", "attack", "strike"
const SYNONYMS = {
  military:  ['military','war','attack','strike','troops','army','navy','airstrike','missile','drone','combat','forces'],
  conflict:  ['conflict','war','fighting','battle','clash','offensive','operation'],
  oil:       ['oil','crude','opec','petroleum','brent','energy','fuel','gas'],
  energy:    ['energy','oil','gas','fuel','power','electricity'],
  nuclear:   ['nuclear','atomic','uranium','iaea','warhead','radiation','nuke'],
  economy:   ['economy','economic','gdp','inflation','recession','market','finance'],
  markets:   ['market','stocks','trading','index','shares','equities','wall street'],
  diplomacy: ['diplomacy','diplomatic','talks','negotiations','ceasefire','summit','peace','sanctions'],
  talks:     ['talks','negotiations','summit','meeting','diplomacy','ceasefire'],
  cyber:     ['cyber','hack','ransomware','malware','breach','attack'],
  politics:  ['politics','political','government','election','president','minister','coup'],
  crisis:    ['crisis','emergency','collapse','instability','chaos'],
  disaster:  ['disaster','earthquake','flood','hurricane','tsunami','wildfire','emergency'],
  health:    ['health','disease','outbreak','epidemic','pandemic','virus'],
  iran:      ['iran','iranian','tehran','irgc','persian'],
  russia:    ['russia','russian','kremlin','moscow','putin'],
  china:     ['china','chinese','beijing','xi','prc'],
  ukraine:   ['ukraine','ukrainian','kyiv','zelensky','donbas'],
  israel:    ['israel','israeli','gaza','idf','hamas','netanyahu'],
  usa:       ['usa','us','american','washington','pentagon','white house'],
  saudi:     ['saudi','riyadh','aramco','mbs','opec'],
  uae:       ['uae','dubai','abu dhabi','emirates'],
};

// Cache for individual channel feeds (30 min) and query results (10 min)
const channelCache = new Map();  // channelId → { items, ts }
const queryCache   = new Map();  // query key → { data, ts }
const CHANNEL_TTL  = 30 * 60 * 1000;
const QUERY_TTL    = 10 * 60 * 1000;

const STOPWORDS = new Set([
  'that','this','with','from','they','have','been','will','would','could',
  'about','into','over','after','were','says','said','their','there','where',
  'when','what','which','while','than','then','also','news','more','some',
  'your','just','time','year','most','such','even','well','only','very',
  'both','each','many','much','make','like','look','come','know',
]);

function keywords(q) {
  return [...new Set(
    q.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w))
  )];
}

// Expand keywords with synonyms — returns flat deduplicated list
function expandKeywords(kws) {
  const expanded = new Set(kws);
  for (const kw of kws) {
    const syns = SYNONYMS[kw];
    if (syns) syns.forEach(s => expanded.add(s));
  }
  return [...expanded];
}

// Score a title against keywords — exact match = 2pts, partial/synonym = 1pt
function relevance(title, kws, expandedKws) {
  const t = title.toLowerCase();
  let score = 0;
  for (const k of kws) {
    if (t.includes(k)) score += 2; // direct match worth more
  }
  for (const k of expandedKws) {
    if (!kws.includes(k) && t.includes(k)) score += 1; // synonym match
  }
  return score;
}

// Parse YouTube RSS XML without a DOM parser
function parseYtRss(xml, channelName) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const getId    = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
    const getTitle = block.match(/<media:title>([^<]*)<\/media:title>/) ||
                     block.match(/<title>([^<]*)<\/title>/);
    const getThumb = block.match(/url="([^"]+)"\s+width="([^"]+)"\s+height/);
    const getDate  = block.match(/<published>([^<]+)<\/published>/);
    if (!getId || !getTitle) continue;
    const videoId = getId[1].trim();
    entries.push({
      id:      videoId,
      title:   getTitle[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').trim(),
      thumb:   getThumb ? getThumb[1] : 'https://i.ytimg.com/vi/' + videoId + '/mqdefault.jpg',
      url:     'https://www.youtube.com/watch?v=' + videoId,
      date:    getDate ? getDate[1].substring(0, 10) : '',
      channel: channelName,
    });
  }
  return entries;
}

async function fetchChannel(ch) {
  const now = Date.now();
  const hit = channelCache.get(ch.id);
  if (hit && (now - hit.ts) < CHANNEL_TTL) return hit.items;

  try {
    const url = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + ch.id;
    const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = parseYtRss(xml, ch.name);
    channelCache.set(ch.id, { items, ts: now });
    return items;
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'public, max-age=600');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')    return res.status(405).json({ error: 'GET only' });

  const q = ((req.query && req.query.q) || '').trim().substring(0, 150);
  if (!q) return res.status(400).json({ error: 'q param required' });

  const ckey = q.toLowerCase().replace(/\s+/g, ' ');
  const cached = queryCache.get(ckey);
  if (cached && (Date.now() - cached.ts) < QUERY_TTL) {
    return res.status(200).json(cached.data);
  }

  const kws = keywords(q);
  const expandedKws = expandKeywords(kws);

  // Fetch ALL 9 channels in parallel for maximum coverage
  const allVideos = (await Promise.all(
    CHANNELS.map(ch => fetchChannel(ch))
  )).flat();

  // Score and rank with expanded keyword matching
  let scored = allVideos.map(v => ({
    ...v,
    score: relevance(v.title, kws, expandedKws),
  }));

  // Sort: relevance desc, then date desc (most recent first)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.date.localeCompare(a.date);
  });

  // Return top 3 relevant results. Only fall back to recents if truly nothing matched.
  let results = scored.filter(v => v.score >= 1).slice(0, 3);
  // If still nothing, return empty rather than unrelated clips
  // (client shows "No coverage found" — better than wrong clips)
  const data = { clips: results };

  queryCache.set(ckey, { data, ts: Date.now() });
  if (queryCache.size > 400) queryCache.delete(queryCache.keys().next().value);

  return res.status(200).json(data);
}

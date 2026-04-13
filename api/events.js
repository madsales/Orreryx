// api/events.js — Orrery Global News Coverage
// Uses GDELT Article API (mode=artlist) — updates every 15 minutes, NOT the GeoJSON endpoint
// which can lag 2-3 days. Article API gives real seendate timestamps.

const CACHE_TTL = 5 * 60 * 1000;
let cache = null, cacheTime = 0;

const STREAMS = [
  {
    key: 'conflict',
    query: 'war OR military OR attack OR airstrike OR coup OR missile OR frontline OR ceasefire OR troops OR offensive OR bombing OR siege OR insurgent OR drone',
    max: 30,
  },
  {
    key: 'politics',
    query: 'election OR president OR parliament OR government OR minister OR sanctions OR summit OR treaty OR protest OR NATO OR "United Nations" OR diplomacy OR rally OR resignation OR congress OR senate',
    max: 30,
  },
  {
    key: 'economy',
    query: 'economy OR inflation OR recession OR tariff OR "interest rate" OR "stock market" OR trade OR bankruptcy OR GDP OR cryptocurrency OR "central bank" OR "market crash" OR unemployment',
    max: 25,
  },
  {
    key: 'society',
    query: 'earthquake OR tsunami OR hurricane OR flood OR wildfire OR volcano OR cybersecurity OR "artificial intelligence" OR outbreak OR pandemic OR crime OR explosion OR disaster OR shooting OR nuclear',
    max: 25,
  },
];

// GDELT Article API — fresh articles, updates every 15 min
function gdeltUrl(query, max) {
  return (
    'https://api.gdeltproject.org/api/v2/doc/doc' +
    `?query=${encodeURIComponent(query)}` +
    `&mode=artlist&format=json&timespan=6h&maxrecords=${max}&sort=DateDesc&sourcelang=english`
  );
}

// Stable numeric ID from URL (or title fallback) — same article always same ID,
// regardless of its position in the response. Avoids false deduplication on re-fetch.
function stableId(url, title) {
  const s = (url || title || '').toLowerCase().trim().substring(0, 120);
  let h = 2166136261; // FNV-1a 32-bit offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // Keep in range 100001–9999999 — never collides with WAR_EVENTS (ids 1–99)
  return (h % 9899999) + 100001;
}

// GDELT date format: 20260404T120000Z → 2026-04-04T12:00:00Z
function parseGdeltDate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  return s;
}

function categorize(title) {
  const t = (title || '').toLowerCase();
  if (/nuclear|nuke|uranium|enrich|warhead|radiolog|plutonium|iaea|atomic/.test(t))
    return { cat: 'nuc', catLabel: 'NUCLEAR',      severity: 'critical' };
  if (/cyber|hack|ransomware|malware|data.breach|ddos|phish|intrusion|zero.day|spyware/.test(t))
    return { cat: 'cyb', catLabel: 'CYBER',         severity: 'high' };
  if (/artificial.intelligence|\bai\b|chatgpt|openai|tech.giant|semiconductor|chip.ban|autonomous|robot|quantum|5g/.test(t))
    return { cat: 'tech', catLabel: 'TECHNOLOGY',   severity: 'low' };
  if (/earthquake|tsunami|hurricane|typhoon|cyclone|flood|wildfire|volcano|eruption|tornado|avalanche|landslide|drought/.test(t))
    return { cat: 'dis', catLabel: 'DISASTER',      severity: 'high' };
  if (/climate|global.warming|carbon|emissions|cop\d+|deforestation|glacier|sea.level|pollution|renewable/.test(t))
    return { cat: 'env', catLabel: 'ENVIRONMENT',   severity: 'medium' };
  if (/disease|virus|epidemic|pandemic|outbreak|health.emergency|vaccine|hospital|who.declares|mpox|cholera|ebola|dengue/.test(t))
    return { cat: 'hlt', catLabel: 'HEALTH',        severity: 'medium' };
  if (/\boil\b|\bgas\b|energy.crisis|pipeline|fuel|opec|petroleum|lng|refinery|power.plant|electricity|blackout/.test(t))
    return { cat: 'nrg', catLabel: 'ENERGY',        severity: 'medium' };
  if (/crime|murder|arrest|corruption|trial|court|prison|drug.cartel|trafficking|sentenced|assassination|gang|terrorist/.test(t))
    return { cat: 'cri', catLabel: 'CRIME',         severity: 'medium' };
  if (/ceasefire|peace.talks|treaty|agreement|ambassador|foreign.minister|un.security|nato|summit|negotiation|sanction|diplomatic/.test(t))
    return { cat: 'dip', catLabel: 'DIPLOMATIC',    severity: 'medium' };
  if (/economy|inflation|recession|gdp|market.crash|trade.war|tariff|central.bank|interest.rate|unemployment|bankruptcy|stock|currency|debt/.test(t))
    return { cat: 'eco', catLabel: 'ECONOMIC',      severity: 'medium' };
  if (/company|merger|acquisition|ipo|earnings|billion|ceo|corporation|investment|startup|layoff|strike|labor/.test(t))
    return { cat: 'biz', catLabel: 'BUSINESS',      severity: 'low' };
  if (/war|attack|bomb|missile|military|army|troops|combat|airstrike|soldier|armed.forces|offensive|frontline|weapon|shooting/.test(t))
    return { cat: 'mil', catLabel: 'MILITARY',      severity: 'high' };
  if (/election|president|parliament|minister|government|vote|political|congress|senate|resign|protest|rally|demonstration/.test(t))
    return { cat: 'pol', catLabel: 'POLITICS',      severity: 'low' };
  return { cat: 'pol', catLabel: 'POLITICS', severity: 'low' };
}

function severityRank(s) {
  return s === 'critical' ? 3 : s === 'high' ? 2 : s === 'medium' ? 1 : 0;
}

// ── GEO LOOKUP — map location names → [lat, lng, displayName] ──
const GEO = [
  // Hot-zones first (checked in order — more specific before general)
  ['gaza',          [31.4,  34.3,  'Gaza']],
  ['west bank',     [31.9,  35.2,  'West Bank']],
  ['jerusalem',     [31.8,  35.2,  'Jerusalem']],
  ['tel aviv',      [32.1,  34.8,  'Tel Aviv']],
  ['israel',        [31.5,  35.0,  'Israel']],
  ['kyiv',          [50.4,  30.5,  'Kyiv, Ukraine']],
  ['ukraine',       [48.5,  31.5,  'Ukraine']],
  ['moscow',        [55.7,  37.6,  'Moscow, Russia']],
  ['russia',        [61.5, 105.0,  'Russia']],
  ['crimea',        [45.0,  34.0,  'Crimea']],
  ['donbas',        [48.0,  37.5,  'Donbas']],
  ['zaporizhzhia',  [47.8,  35.2,  'Zaporizhzhia']],
  ['kharkiv',       [49.9,  36.3,  'Kharkiv']],
  ['beijing',       [39.9, 116.4,  'Beijing, China']],
  ['taiwan',        [23.7, 121.0,  'Taiwan']],
  ['taipei',        [25.0, 121.5,  'Taipei']],
  ['hong kong',     [22.3, 114.2,  'Hong Kong']],
  ['south china sea',[12.0,115.0,  'South China Sea']],
  ['xinjiang',      [41.0,  85.0,  'Xinjiang, China']],
  ['china',         [35.0, 105.0,  'China']],
  ['pyongyang',     [39.0, 125.7,  'Pyongyang, N. Korea']],
  ['north korea',   [40.0, 127.0,  'North Korea']],
  ['south korea',   [36.0, 128.0,  'South Korea']],
  ['seoul',         [37.6, 127.0,  'Seoul']],
  ['tehran',        [35.7,  51.4,  'Tehran, Iran']],
  ['iran',          [32.0,  53.0,  'Iran']],
  ['baghdad',       [33.3,  44.4,  'Baghdad, Iraq']],
  ['iraq',          [33.0,  44.0,  'Iraq']],
  ['damascus',      [33.5,  36.3,  'Damascus, Syria']],
  ['syria',         [35.0,  38.0,  'Syria']],
  ['sanaa',         [15.4,  44.2,  "Sana'a, Yemen"]],
  ['yemen',         [15.0,  48.0,  'Yemen']],
  ['red sea',       [20.0,  38.0,  'Red Sea']],
  ['hormuz',        [26.0,  56.0,  'Strait of Hormuz']],
  ['kabul',         [34.5,  69.2,  'Kabul, Afghanistan']],
  ['afghanistan',   [33.0,  66.0,  'Afghanistan']],
  ['islamabad',     [33.7,  73.1,  'Islamabad, Pakistan']],
  ['pakistan',      [30.0,  70.0,  'Pakistan']],
  ['new delhi',     [28.6,  77.2,  'New Delhi, India']],
  ['india',         [20.0,  78.0,  'India']],
  ['mumbai',        [19.0,  72.8,  'Mumbai']],
  ['myanmar',       [17.0,  96.0,  'Myanmar']],
  ['yangon',        [16.8,  96.2,  'Yangon']],
  ['khartoum',      [15.6,  32.5,  'Khartoum, Sudan']],
  ['sudan',         [15.0,  32.0,  'Sudan']],
  ['addis ababa',   [ 9.0,  38.7,  'Addis Ababa, Ethiopia']],
  ['ethiopia',      [ 8.0,  38.0,  'Ethiopia']],
  ['nairobi',       [-1.3,  36.8,  'Nairobi, Kenya']],
  ['lagos',         [ 6.4,   3.4,  'Lagos, Nigeria']],
  ['nigeria',       [10.0,   8.0,  'Nigeria']],
  ['kinshasa',      [-4.3,  15.3,  'Kinshasa, DRC']],
  ['congo',         [-2.0,  25.0,  'DR Congo']],
  ['mogadishu',     [ 2.0,  45.3,  'Mogadishu, Somalia']],
  ['somalia',       [ 5.0,  46.0,  'Somalia']],
  ['tripoli',       [32.9,  13.2,  'Tripoli, Libya']],
  ['libya',         [26.0,  17.0,  'Libya']],
  ['cairo',         [30.0,  31.2,  'Cairo, Egypt']],
  ['egypt',         [26.0,  30.0,  'Egypt']],
  ['tunis',         [36.8,  10.2,  'Tunis, Tunisia']],
  ['caracas',       [10.5, -66.9,  'Caracas, Venezuela']],
  ['venezuela',     [ 8.0, -65.0,  'Venezuela']],
  ['haiti',         [18.9, -72.3,  'Haiti']],
  ['mexico city',   [19.4, -99.1,  'Mexico City']],
  ['mexico',        [23.0,-102.0,  'Mexico']],
  ['brasilia',      [-15.8,-47.9,  'Brasília, Brazil']],
  ['brazil',        [-10.0,-55.0,  'Brazil']],
  ['washington',    [38.9, -77.0,  'Washington DC, USA']],
  ['new york',      [40.7, -74.0,  'New York, USA']],
  ['united states', [38.0, -97.0,  'United States']],
  [' us ',          [38.0, -97.0,  'United States']],
  ['london',        [51.5,  -0.1,  'London, UK']],
  ['britain',       [54.0,  -3.0,  'UK']],
  ['uk',            [54.0,  -3.0,  'UK']],
  ['paris',         [48.8,   2.3,  'Paris, France']],
  ['france',        [46.0,   2.0,  'France']],
  ['berlin',        [52.5,  13.4,  'Berlin, Germany']],
  ['germany',       [51.0,  10.0,  'Germany']],
  ['brussels',      [50.8,   4.4,  'Brussels']],
  ['nato',          [50.0,  10.0,  'NATO Region']],
  ['europe',        [50.0,  15.0,  'Europe']],
  ['singapore',     [ 1.3, 103.8,  'Singapore']],
  ['jakarta',       [-6.2, 106.8,  'Jakarta, Indonesia']],
  ['indonesia',     [-5.0, 120.0,  'Indonesia']],
  ['manila',        [14.6, 120.9,  'Manila, Philippines']],
  ['bangkok',       [13.8, 100.5,  'Bangkok, Thailand']],
  ['tokyo',         [35.7, 139.7,  'Tokyo, Japan']],
  ['japan',         [36.0, 138.0,  'Japan']],
  ['middle east',   [28.0,  40.0,  'Middle East']],
  ['persian gulf',  [26.0,  53.0,  'Persian Gulf']],
  ['africa',        [ 0.0,  20.0,  'Africa']],
  ['asia',          [30.0,  90.0,  'Asia']],
];

function geolocate(title) {
  const t = ' ' + title.toLowerCase() + ' ';
  for (const [kw, [lat, lng, name]] of GEO) {
    if (t.includes(kw)) return { lat, lng, loc: name };
  }
  // Fallback: random scatter across known tension zones so globe always has dots
  const fallbacks = [
    [48.5,31.5,'Ukraine'],[31.4,34.3,'Middle East'],[20,38,'Red Sea'],
    [39.9,116.4,'China'],[35,105,'Asia'],[38,-97,'US'],[50,10,'Europe'],
  ];
  const f = fallbacks[Math.floor(Math.random() * fallbacks.length)];
  return { lat: f[0], lng: f[1], loc: f[2] };
}

function parseArticles(articles) {
  return (articles || [])
    .filter(a => a?.title && String(a.title).trim().length > 15)
    .map(a => {
      const title = String(a.title).replace(/\s+/g, ' ').trim();
      const { cat, catLabel, severity } = categorize(title);
      const { lat, lng, loc } = geolocate(title);
      return {
        id:       stableId(a.url, title),   // stable — same article = same ID every fetch
        cat, catLabel, severity,
        lat, lng,
        loc,
        txt:      title,
        url:      a.url || '',
        source:   a.domain || '',
        tags:     [],
        time:     parseGdeltDate(a.seendate) || new Date().toISOString(),
      };
    });
}

function dedup(events) {
  const titleSeen = new Set();
  return events.filter(e => {
    const key = e.txt.toLowerCase().replace(/\s+/g, ' ').substring(0, 80);
    if (titleSeen.has(key)) return false;
    titleSeen.add(key);
    return true;
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (cache && Date.now() - cacheTime < CACHE_TTL) {
    return res.status(200).json(cache);
  }

  try {
    const results = await Promise.allSettled(
      STREAMS.map(s =>
        fetch(gdeltUrl(s.query, s.max), {
          headers: { 'User-Agent': 'OrreryIntelligence/1.0 (https://www.orreryx.io)' },
          signal:  AbortSignal.timeout(9000),
        })
          .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
          .then(j => parseArticles(j.articles))
          .catch(() => [])
      )
    );

    let all = [];
    results.forEach(r => { if (r.status === 'fulfilled') all = all.concat(r.value); });

    // Sort newest first, then dedup by title
    all.sort((a, b) => new Date(b.time) - new Date(a.time));
    const final = dedup(all).slice(0, 120);

    const counts = {};
    final.forEach(e => { counts[e.cat] = (counts[e.cat] || 0) + 1; });

    cache = {
      events:  final,
      fetched: Date.now(),
      count:   final.length,
      bycat:   counts,
      source:  'gdelt-articles',
    };
    cacheTime = Date.now();

    console.log(`[Events] GDELT Articles: ${final.length} events, newest: ${final[0]?.time || 'n/a'}`);
    return res.status(200).json(cache);

  } catch (err) {
    console.error('[Events] Fatal:', err.message);
    return res.status(200).json({ events: [], error: err.message, source: 'fallback', fetched: Date.now() });
  }
}

export const config = { api: { bodyParser: false } };

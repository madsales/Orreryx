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
    `&mode=artlist&format=json&timespan=4h&maxrecords=${max}&sort=DateDesc&sourcelang=english`
  );
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

function parseArticles(articles, offset) {
  return (articles || [])
    .filter(a => a?.title && String(a.title).trim().length > 15)
    .map((a, i) => {
      const title = String(a.title).replace(/\s+/g, ' ').trim();
      const { cat, catLabel, severity } = categorize(title);
      return {
        id:       3000 + offset + i,
        cat, catLabel, severity,
        lat:      null,
        lng:      null,
        loc:      a.domain || 'Global',
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
      STREAMS.map((s, i) =>
        fetch(gdeltUrl(s.query, s.max), {
          headers: { 'User-Agent': 'OrreryIntelligence/1.0 (https://www.orreryx.io)' },
          signal:  AbortSignal.timeout(9000),
        })
          .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
          .then(j => parseArticles(j.articles, i * 200))
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

// api/events.js — Orrery Global News Coverage
// Fetches 4 parallel GDELT topic streams → merges → returns up to 120 geocoded events
// covering every country: politics, conflict, economy, environment, tech, health, crime, disasters
// GDELT is free, no API key, updates every 15 minutes.

const CACHE_TTL = 5 * 60 * 1000; // 5-minute cache
let cache = null, cacheTime = 0;

// ── GDELT QUERY TOPICS ─────────────────────────────────────────────────────
// Each stream targets a different slice of world news. Results are merged and deduped.
const STREAMS = [
  {
    // Stream 1 — Conflict / Security / Military
    key: 'conflict',
    url: gdelt('(war OR military OR attack OR bombing OR airstrike OR coup OR conflict OR rebel OR missile OR troops OR soldier OR armed OR siege OR offensive OR ceasefire OR frontline OR artillery OR drone strike OR sniper OR hostage OR insurgent OR paramilitary)', 50),
  },
  {
    // Stream 2 — Politics / Government / Diplomacy / Law
    key: 'politics',
    url: gdelt('(election OR president OR parliament OR government OR minister OR senate OR congress OR vote OR referendum OR resign OR inaugurate OR diplomat OR summit OR treaty OR sanctions OR ambassador OR foreign policy OR UN OR NATO OR G7 OR G20 OR prime minister OR cabinet OR legislation OR supreme court OR protest OR demonstration OR rally)', 50),
  },
  {
    // Stream 3 — Economy / Business / Finance / Trade
    key: 'economy',
    url: gdelt('(economy OR inflation OR recession OR market OR trade OR tariff OR GDP OR investment OR central bank OR interest rate OR stock market OR cryptocurrency OR merger OR acquisition OR bankruptcy OR IPO OR earnings OR export OR import OR supply chain OR unemployment OR poverty OR debt OR bond OR currency OR forex OR commodities OR oil price OR gas price)', 50),
  },
  {
    // Stream 4 — Environment / Tech / Health / Disasters / Crime / Society
    key: 'society',
    url: gdelt('(earthquake OR tsunami OR hurricane OR typhoon OR flood OR wildfire OR volcano OR drought OR climate change OR tornado OR avalanche OR technology OR artificial intelligence OR cybersecurity OR space OR disease OR virus OR outbreak OR hospital OR vaccine OR WHO OR pandemic OR crime OR arrest OR court OR corruption OR drug trafficking OR shooting OR explosion OR fire OR accident OR migration OR refugee OR famine OR humanitarian)', 50),
  },
];

function gdelt(query, max) {
  return (
    'https://api.gdeltproject.org/api/v2/geo/geo' +
    `?query=${encodeURIComponent(query)}` +
    `&format=geojson&timespan=24h&maxrecords=${max}&MAXPOINTS=${max}`
  );
}

// ── CATEGORISATION ──────────────────────────────────────────────────────────
function categorize(title) {
  const t = (title || '').toLowerCase();

  // Nuclear (highest priority — always override)
  if (/nuclear|nuke|uranium|enrich|warhead|radiolog|plutonium|iaea|atomic/.test(t))
    return { cat: 'nuc', catLabel: 'NUCLEAR',      severity: 'critical' };

  // Cyber / Digital Security
  if (/cyber|hack|ransomware|malware|data.breach|ddos|phish|intrusion|zero.day|spyware/.test(t))
    return { cat: 'cyb', catLabel: 'CYBER',         severity: 'high' };

  // Technology / AI
  if (/artificial.intelligence|\bai\b|chatgpt|openai|tech.giant|silicon.valley|semiconductor|chip.ban|autonomous|robot|quantum|5g|6g/.test(t))
    return { cat: 'tech', catLabel: 'TECHNOLOGY',   severity: 'low' };

  // Natural Disasters
  if (/earthquake|tsunami|hurricane|typhoon|cyclone|flood|wildfire|volcano|eruption|tornado|avalanche|landslide|drought/.test(t))
    return { cat: 'dis', catLabel: 'DISASTER',      severity: 'high' };

  // Environment / Climate
  if (/climate|global.warming|carbon|emissions|cop\d+|deforestation|glacier|sea.level|pollution|biodiversity|renewable|solar.farm|wind.farm/.test(t))
    return { cat: 'env', catLabel: 'ENVIRONMENT',   severity: 'medium' };

  // Health / Pandemic
  if (/disease|virus|epidemic|pandemic|outbreak|health.emergency|vaccine|hospital|who.declares|mpox|cholera|ebola|dengue|cancer|malaria/.test(t))
    return { cat: 'hlt', catLabel: 'HEALTH',        severity: 'medium' };

  // Energy
  if (/\boil\b|\bgas\b|energy.crisis|pipeline|fuel|opec|petroleum|lng|refinery|power.plant|electricity|blackout|nuclear.plant/.test(t))
    return { cat: 'nrg', catLabel: 'ENERGY',        severity: 'medium' };

  // Crime / Justice
  if (/crime|murder|arrest|corruption|trial|court|prison|drug.cartel|trafficking|sentenced|assassination|gang|terrorist|death.penalty/.test(t))
    return { cat: 'cri', catLabel: 'CRIME',         severity: 'medium' };

  // Diplomatic / International Relations
  if (/ceasefire|peace.talks|treaty|agreement|ambassador|foreign.minister|un.security|nato|summit|negotiation|sanction|diplomatic/.test(t))
    return { cat: 'dip', catLabel: 'DIPLOMATIC',    severity: 'medium' };

  // Economy / Finance
  if (/economy|inflation|recession|gdp|market.crash|trade.war|tariff|central.bank|interest.rate|unemployment|bankruptcy|stock|currency|debt.crisis/.test(t))
    return { cat: 'eco', catLabel: 'ECONOMIC',      severity: 'medium' };

  // Business / Corporate
  if (/company|merger|acquisition|ipo|earnings|billion|ceo|corporation|investment|startup|layoff|strike|labor|trade/.test(t))
    return { cat: 'biz', catLabel: 'BUSINESS',      severity: 'low' };

  // Military / Conflict
  if (/war|attack|bomb|missile|military|army|troops|combat|airstrike|soldier|armed.forces|offensive|frontline|weapon|shooting/.test(t))
    return { cat: 'mil', catLabel: 'MILITARY',      severity: 'high' };

  // Politics / Government (broad default for news)
  if (/election|president|parliament|minister|government|vote|political|congress|senate|resign|inaugurate|protest|rally|demonstration/.test(t))
    return { cat: 'pol', catLabel: 'POLITICS',      severity: 'low' };

  // Default: Politics (most general news is political)
  return { cat: 'pol', catLabel: 'POLITICS', severity: 'low' };
}

function severityRank(s) {
  return s === 'critical' ? 3 : s === 'high' ? 2 : s === 'medium' ? 1 : 0;
}

// ── DEDUP: remove events with coords within ~1° of an already-kept event ──
function dedup(events, gridDeg = 1.0) {
  const seen = new Set();
  return events.filter(e => {
    const key = `${Math.round(e.lat / gridDeg)},${Math.round(e.lng / gridDeg)},${e.cat}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── PARSE GDELT GEOJSON → Orrery event format ──────────────────────────────
function parseFeatures(features, offset) {
  return (features || [])
    .filter(f =>
      f?.geometry?.type === 'Point' &&
      Array.isArray(f.geometry.coordinates) &&
      f.properties?.name
    )
    .map((f, i) => {
      const [lng, lat] = f.geometry.coordinates;
      const title = String(f.properties.name || '').trim();
      const { cat, catLabel, severity } = categorize(title);
      return {
        id:       3000 + offset + i,
        cat,
        catLabel,
        severity,
        lat:      Math.round(parseFloat(lat) * 100) / 100,
        lng:      Math.round(parseFloat(lng) * 100) / 100,
        loc:      title.length > 55 ? title.substring(0, 55) + '…' : title,
        txt:      title,
        url:      f.properties.url || '',
        source:   f.properties.domain || '',
        tags:     [],
        time:     f.properties.dateadded || new Date().toISOString(),
      };
    });
}

// ── HANDLER ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Serve cached result if still fresh
  if (cache && Date.now() - cacheTime < CACHE_TTL) {
    return res.status(200).json(cache);
  }

  try {
    // Fire all 4 streams in parallel
    const results = await Promise.allSettled(
      STREAMS.map(s =>
        fetch(s.url, {
          headers: { 'User-Agent': 'OrreryIntelligence/1.0 (https://www.orreryx.io)' },
          signal: AbortSignal.timeout(9000),
        })
          .then(r => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
          .then(j => j.features || [])
          .catch(() => []) // if one stream fails, return empty — others still used
      )
    );

    // Merge all features
    let allEvents = [];
    results.forEach((r, i) => {
      const features = r.status === 'fulfilled' ? r.value : [];
      const parsed   = parseFeatures(features, i * 200);
      allEvents = allEvents.concat(parsed);
    });

    // Sort by severity desc, then deduplicate by ~1° grid per category
    allEvents.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    const unique = dedup(allEvents, 0.8);

    // Cap at 120 events — spread across categories for global variety
    const final = unique.slice(0, 120);

    const counts = {};
    final.forEach(e => { counts[e.cat] = (counts[e.cat] || 0) + 1; });

    cache = {
      events:  final,
      fetched: Date.now(),
      count:   final.length,
      bycat:   counts,
      source:  'gdelt',
    };
    cacheTime = Date.now();

    console.log(`[Events] GDELT: ${final.length} events across ${Object.keys(counts).length} categories`);
    return res.status(200).json(cache);

  } catch (err) {
    console.error('[Events] Fatal error:', err.message);
    return res.status(200).json({
      events:  [],
      error:   err.message,
      source:  'fallback',
      fetched: Date.now(),
    });
  }
}

export const config = { api: { bodyParser: false } };

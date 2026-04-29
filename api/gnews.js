// api/gnews.js - Live RSS from 45+ global news outlets + Geopolitical Risk API
// Supports ?country=XX&lang=XX query params for filtered feeds
// Also serves /api/v1/risks/* endpoints (merged from risks.js)

// ── RISKS HANDLER (merged from risks.js) ─────────────────────────────────────
const RISK_LAST_UPDATED = '2026-04-21';
const RISK_LAST_UPDATED_ISO = '2026-04-21T00:00:00Z';
const CONFLICTS = [
  { id:'ukraine-russia', name:'Russia-Ukraine War', type:'conflict', status:'deteriorating', risk_score:94, trend:'up', countries:['Ukraine','Russia'], region:'Europe', casualties_estimate:'500000+', started:'2022-02-24', last_updated:RISK_LAST_UPDATED, market_impact:{natural_gas:'high',wheat:'high',gold:'moderate',defence_stocks:'high'}, summary:'Full-scale invasion ongoing. Spring offensive underway. NATO logistics active.', orreryx_url:'https://www.orreryx.io/russia-ukraine-war' },
  { id:'israel-gaza', name:'Israel-Gaza War', type:'conflict', status:'deteriorating', risk_score:91, trend:'stable', countries:['Israel','Palestine'], region:'Middle East', casualties_estimate:'40000+', started:'2023-10-07', last_updated:RISK_LAST_UPDATED, market_impact:{oil:'moderate',gold:'high',defence_stocks:'moderate'}, summary:'Ground operations ongoing in Rafah. Humanitarian corridors contested.', orreryx_url:'https://www.orreryx.io/israel-gaza' },
  { id:'india-pakistan', name:'India-Pakistan Tensions', type:'conflict', status:'volatile', risk_score:88, trend:'up', countries:['India','Pakistan'], region:'South Asia', casualties_estimate:'disputed', started:'1947-08-14', last_updated:RISK_LAST_UPDATED, market_impact:{gold:'high',oil:'moderate',emerging_markets:'high'}, summary:'LoC violations at 2-year high. Both sides mobilising reserves.', orreryx_url:'https://www.orreryx.io/india-pakistan' },
  { id:'iran-nuclear', name:'Iran Nuclear Crisis', type:'nuclear', status:'volatile', risk_score:84, trend:'stable', countries:['Iran','Israel','USA'], region:'Middle East', casualties_estimate:'N/A', started:'2002-01-01', last_updated:RISK_LAST_UPDATED, market_impact:{oil:'critical',gold:'high',defence_stocks:'high'}, summary:'Enrichment at 60%. IAEA access restricted. Strike window analysis active.', orreryx_url:'https://www.orreryx.io/iran-nuclear' },
  { id:'middle-east-regional', name:'Middle East Regional War Risk', type:'conflict', status:'deteriorating', risk_score:82, trend:'up', countries:['Iran','Israel','Lebanon','Yemen','Syria'], region:'Middle East', casualties_estimate:'100000+', started:'2023-10-07', last_updated:RISK_LAST_UPDATED, market_impact:{oil:'critical',gold:'high',shipping:'high'}, summary:'Multi-front escalation risk. Hezbollah, Houthi, IRGC proxy coordination increasing.', orreryx_url:'https://www.orreryx.io/middle-east-war' },
  { id:'iran-country', name:'Iran Political Risk', type:'economic', status:'volatile', risk_score:84, trend:'stable', countries:['Iran'], region:'Middle East', casualties_estimate:'N/A', started:'1979-02-11', last_updated:RISK_LAST_UPDATED, market_impact:{oil:'high',gold:'moderate'}, summary:'Sanctions pressure, IRGC dominance, succession uncertainty.', orreryx_url:'https://www.orreryx.io/iran-nuclear' },
  { id:'russia-nato', name:'Russia-NATO Escalation Risk', type:'nuclear', status:'volatile', risk_score:79, trend:'up', countries:['Russia','NATO'], region:'Europe', casualties_estimate:'N/A', started:'2022-02-24', last_updated:RISK_LAST_UPDATED, market_impact:{natural_gas:'high',defence_stocks:'high',gold:'high'}, summary:'Nuclear signalling intensifying. Article 5 red lines being tested.', orreryx_url:'https://www.orreryx.io/nuclear-war-risk' },
  { id:'china-taiwan', name:'China-Taiwan Strait Crisis', type:'conflict', status:'volatile', risk_score:74, trend:'up', countries:['China','Taiwan','USA'], region:'Asia-Pacific', casualties_estimate:'N/A', started:'1949-12-07', last_updated:RISK_LAST_UPDATED, market_impact:{semiconductors:'critical',gold:'high',shipping:'high'}, summary:'PLA air incursions increasing. Naval exercises near ADIZ monthly.', orreryx_url:'https://www.orreryx.io/china-taiwan-war' },
  { id:'south-china-sea', name:'South China Sea Dispute', type:'conflict', status:'volatile', risk_score:76, trend:'up', countries:['China','Philippines','Vietnam','USA'], region:'Asia-Pacific', casualties_estimate:'disputed', started:'1974-01-19', last_updated:RISK_LAST_UPDATED, market_impact:{shipping:'high',oil:'moderate',semiconductors:'moderate'}, summary:'Philippines confrontations at Second Thomas Shoal escalating.', orreryx_url:'https://www.orreryx.io/south-china-sea' },
  { id:'north-korea', name:'North Korea Missile Crisis', type:'nuclear', status:'volatile', risk_score:76, trend:'stable', countries:['North Korea','South Korea','USA','Japan'], region:'Asia-Pacific', casualties_estimate:'N/A', started:'2006-10-09', last_updated:RISK_LAST_UPDATED, market_impact:{jpy:'high',south_korea_equities:'moderate',defence_stocks:'high'}, summary:'ICBM tests continuing. Russia arms deal providing revenue and tech exchange.', orreryx_url:'https://www.orreryx.io/north-korea' },
  { id:'sudan-war', name:'Sudan Civil War', type:'conflict', status:'deteriorating', risk_score:68, trend:'stable', countries:['Sudan'], region:'Africa', casualties_estimate:'150000+', started:'2023-04-15', last_updated:RISK_LAST_UPDATED, market_impact:{wheat:'moderate',gold:'low',emerging_markets:'low'}, summary:"RSF vs SAF conflict. World's largest displacement crisis.", orreryx_url:'https://www.orreryx.io/sudan-war' },
  { id:'europe-energy', name:'Europe Energy Crisis', type:'energy', status:'volatile', risk_score:65, trend:'stable', countries:['EU','Russia','Norway'], region:'Europe', casualties_estimate:'N/A', started:'2022-02-24', last_updated:RISK_LAST_UPDATED, market_impact:{natural_gas:'critical',eur:'high',inflation:'high'}, summary:'LNG import dependency. Storage below 5-year average. Winter risk window returning.', orreryx_url:'https://www.orreryx.io/europe-energy-crisis' },
  { id:'myanmar', name:'Myanmar Civil War', type:'conflict', status:'deteriorating', risk_score:65, trend:'up', countries:['Myanmar'], region:'Asia-Pacific', casualties_estimate:'50000+', started:'2021-02-01', last_updated:RISK_LAST_UPDATED, market_impact:{emerging_markets:'low',gold:'low'}, summary:'Resistance forces controlling 60% of territory.', orreryx_url:'https://www.orreryx.io/global-conflicts-2025' },
  { id:'ww3-risk', name:'World War III Risk Index', type:'nuclear', status:'elevated', risk_score:61, trend:'up', countries:['Global'], region:'Global', casualties_estimate:'N/A', started:'2024-01-01', last_updated:RISK_LAST_UPDATED, market_impact:{gold:'critical',oil:'high',defence_stocks:'critical'}, summary:'Doomsday Clock at 89 seconds. Multiple nuclear-armed states in active conflict adjacency.', orreryx_url:'https://www.orreryx.io/ww3-news' },
  { id:'doomsday-clock', name:'Doomsday Clock', type:'nuclear', status:'critical', risk_score:89, trend:'stable', countries:['Global'], region:'Global', casualties_estimate:'N/A', started:'1947-01-01', last_updated:RISK_LAST_UPDATED, market_impact:{gold:'high',defence_stocks:'moderate'}, summary:'At 89 seconds to midnight — closest in 77-year history.', orreryx_url:'https://www.orreryx.io/doomsday-clock' },
];
const RISK_COUNTRIES = [
  { id:'ukraine', name:'Ukraine', flag:'🇺🇦', risk_score:88, political:91, security:94, economic:79, trend:'up', status:'high-risk', orreryx_url:'https://www.orreryx.io/country/ukraine' },
  { id:'russia', name:'Russia', flag:'🇷🇺', risk_score:82, political:78, security:85, economic:83, trend:'stable', status:'high-risk', orreryx_url:'https://www.orreryx.io/country/russia' },
  { id:'china', name:'China', flag:'🇨🇳', risk_score:71, political:68, security:74, economic:71, trend:'up', status:'elevated', orreryx_url:'https://www.orreryx.io/country/china' },
  { id:'iran', name:'Iran', flag:'🇮🇷', risk_score:84, political:81, security:88, economic:83, trend:'stable', status:'high-risk', orreryx_url:'https://www.orreryx.io/country/iran' },
  { id:'israel', name:'Israel', flag:'🇮🇱', risk_score:79, political:76, security:88, economic:73, trend:'stable', status:'high-risk', orreryx_url:'https://www.orreryx.io/country/israel' },
  { id:'india', name:'India', flag:'🇮🇳', risk_score:67, political:62, security:71, economic:68, trend:'up', status:'elevated', orreryx_url:'https://www.orreryx.io/country/india' },
  { id:'pakistan', name:'Pakistan', flag:'🇵🇰', risk_score:78, political:82, security:79, economic:73, trend:'up', status:'high-risk', orreryx_url:'https://www.orreryx.io/country/pakistan' },
  { id:'north-korea', name:'North Korea', flag:'🇰🇵', risk_score:76, political:71, security:88, economic:61, trend:'stable', status:'high-risk', orreryx_url:'https://www.orreryx.io/country/north-korea' },
  { id:'taiwan', name:'Taiwan', flag:'🇹🇼', risk_score:69, political:66, security:74, economic:67, trend:'up', status:'elevated', orreryx_url:'https://www.orreryx.io/country/taiwan' },
  { id:'saudi-arabia', name:'Saudi Arabia', flag:'🇸🇦', risk_score:58, political:54, security:62, economic:58, trend:'stable', status:'moderate', orreryx_url:'https://www.orreryx.io/country/saudi-arabia' },
];
function handleRisks(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Orreryx-Attribution', 'orreryx.io - Free Geopolitical Risk API');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  const { url } = req;
  const { country, type } = req.query || {};
  if (url && url.includes('/summary')) {
    const scores = CONFLICTS.map(c => c.risk_score);
    return res.status(200).json({ version:'1.0', updated:RISK_LAST_UPDATED_ISO, attribution:'Orreryx Intelligence — orreryx.io', total_conflicts:CONFLICTS.length, critical_count:CONFLICTS.filter(c=>c.risk_score>=80).length, avg_score:Math.round(scores.reduce((a,b)=>a+b,0)/scores.length), last_updated:RISK_LAST_UPDATED_ISO, countries:RISK_COUNTRIES.length });
  }
  let results = [...CONFLICTS];
  if (country) { const q=country.toLowerCase(); results=results.filter(c=>c.countries.some(n=>n.toLowerCase().includes(q))); }
  if (type) { const q=type.toLowerCase(); results=results.filter(c=>c.type.toLowerCase()===q); }
  return res.status(200).json({ version:'1.0', updated:RISK_LAST_UPDATED_ISO, attribution:'Orreryx Intelligence — orreryx.io', data:results });
}

const CACHE_TTL = 8 * 60 * 1000;
const cacheMap = new Map(); // key: 'country:lang' → { data, time }

// ISO country code extraction from article geo location + title
const CC_MAP = {
  'ukraine':'UA','russia':'RU','china':'CN','israel':'IL','iran':'IR',
  ' india ':'IN','pakistan':'PK','north korea':'KP','taiwan':'TW',
  'saudi arabia':'SA','south korea':'KR','united states':'US',' us ':'US','germany':'DE',
  'france':'FR','japan':'JP','syria':'SY','yemen':'YE',
  'sudan':'SD','ethiopia':'ET','nigeria':'NG',' somalia ':'SO','turkey':'TR',
  'brazil':'BR','venezuela':'VE','colombia':'CO','myanmar':'MM',
  'afghanistan':'AF','iraq':'IQ','lebanon':'LB','libya':'LY',' mali ':'ML',
  'belarus':'BY','egypt':'EG','zimbabwe':'ZW','finland':'FI','sweden':'SE',
  'poland':'PL',' georgia ':'GE','gaza':'IL','west bank':'IL',
  'crimea':'UA','donbas':'UA','kherson':'UA','zaporizhzhia':'UA',
};

function extractCC(loc, txt) {
  const s = ' ' + ((loc || '') + ' ' + (txt || '')).toLowerCase() + ' ';
  for (const [kw, cc] of Object.entries(CC_MAP)) {
    if (s.includes(kw)) return cc;
  }
  return null;
}

// Stable ID - same article always same ID across polls (FNV-1a 32-bit, range 10000001-19999999)
function stableId(url, title) {
  const s = (url || title || '').toLowerCase().trim().substring(0, 120);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 9999999) + 10000001;
}

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

  // --- CHINA (EN) — Chinese state media publishing in English ---
  { url: 'https://www.cgtn.com/subscribe/rss/section/world.xml',               source: 'CGTN',                lang: 'en' },
  { url: 'https://www.globaltimes.cn/rss/outbrain.xml',                        source: 'Global Times',        lang: 'en' },

  // --- JAPANESE (JA) ---
  { url: 'https://www.nhk.or.jp/rss/news/cat0.xml',                            source: 'NHK Japanese',        lang: 'ja' },

  // --- HINDI (HI) ---
  { url: 'https://feeds.bbci.co.uk/hindi/rss.xml',                             source: 'BBC Hindi',           lang: 'hi' },
  { url: 'https://feeds.feedburner.com/ndtvnews-hindi-top-stories',             source: 'NDTV Hindi',          lang: 'hi' },

  // --- PORTUGUESE (PT) ---
  { url: 'https://feeds.bbci.co.uk/portuguese/rss.xml',                        source: 'BBC Português',       lang: 'pt' },
];

// GEO LOOKUP - 250+ cities and regions worldwide
// Order: more specific before general (e.g. "New Delhi" before "Delhi" before "India")
// Spaces around short/ambiguous keywords prevent false substring matches
const GEO = [
  // --- ACTIVE CONFLICT ZONES ---
  ['gaza',             [31.4,  34.3,  'Gaza']],
  ['rafah',            [31.3,  34.2,  'Rafah, Gaza']],
  ['west bank',        [31.9,  35.2,  'West Bank']],
  ['jerusalem',        [31.8,  35.2,  'Jerusalem']],
  ['tel aviv',         [32.1,  34.8,  'Tel Aviv']],
  ['haifa',            [32.8,  35.0,  'Haifa, Israel']],
  ['israel',           [31.5,  35.0,  'Israel']],
  ['kyiv',             [50.4,  30.5,  'Kyiv, Ukraine']],
  ['kharkiv',          [49.9,  36.3,  'Kharkiv, Ukraine']],
  ['odessa',           [46.5,  30.7,  'Odessa, Ukraine']],
  ['zaporizhzhia',     [47.8,  35.2,  'Zaporizhzhia, Ukraine']],
  ['mariupol',         [47.1,  37.5,  'Mariupol, Ukraine']],
  ['donbas',           [48.0,  37.5,  'Donbas, Ukraine']],
  ['crimea',           [45.0,  34.0,  'Crimea']],
  ['ukraine',          [48.5,  31.5,  'Ukraine']],
  ['moscow',           [55.7,  37.6,  'Moscow, Russia']],
  ['st. petersburg',   [59.9,  30.3,  'St. Petersburg, Russia']],
  ['russia',           [61.5, 105.0,  'Russia']],
  ['pyongyang',        [39.0, 125.7,  'Pyongyang, N.Korea']],
  ['north korea',      [40.0, 127.0,  'North Korea']],
  ['south korea',      [36.0, 128.0,  'South Korea']],
  ['seoul',            [37.6, 127.0,  'Seoul, South Korea']],
  ['busan',            [35.1, 129.0,  'Busan, South Korea']],
  ['taiwan',           [23.7, 121.0,  'Taiwan']],
  ['taipei',           [25.0, 121.5,  'Taipei, Taiwan']],
  ['hong kong',        [22.3, 114.2,  'Hong Kong']],
  ['south china sea',  [12.0, 115.0,  'South China Sea']],
  ['xinjiang',         [41.0,  85.0,  'Xinjiang, China']],
  ['tibet',            [31.0,  90.0,  'Tibet, China']],
  ['beijing',          [39.9, 116.4,  'Beijing, China']],
  ['shanghai',         [31.2, 121.5,  'Shanghai, China']],
  ['guangzhou',        [23.1, 113.3,  'Guangzhou, China']],
  ['shenzhen',         [22.5, 114.1,  'Shenzhen, China']],
  ['wuhan',            [30.6, 114.3,  'Wuhan, China']],
  ['chengdu',          [30.6, 104.1,  'Chengdu, China']],
  ['china',            [35.0, 105.0,  'China']],
  ['tehran',           [35.7,  51.4,  'Tehran, Iran']],
  ['iran',             [32.0,  53.0,  'Iran']],
  ['baghdad',          [33.3,  44.4,  'Baghdad, Iraq']],
  ['mosul',            [36.3,  43.1,  'Mosul, Iraq']],
  ['iraq',             [33.0,  44.0,  'Iraq']],
  ['damascus',         [33.5,  36.3,  'Damascus, Syria']],
  ['aleppo',           [36.2,  37.2,  'Aleppo, Syria']],
  ['syria',            [35.0,  38.0,  'Syria']],
  ['sanaa',            [15.4,  44.2,  'Sanaa, Yemen']],
  ['aden',             [12.8,  45.0,  'Aden, Yemen']],
  ['yemen',            [15.0,  48.0,  'Yemen']],
  ['red sea',          [20.0,  38.0,  'Red Sea']],
  ['hormuz',           [26.0,  56.0,  'Strait of Hormuz']],
  ['suez',             [30.0,  32.5,  'Suez Canal']],
  ['kabul',            [34.5,  69.2,  'Kabul, Afghanistan']],
  ['kandahar',         [31.6,  65.7,  'Kandahar, Afghanistan']],
  ['afghanistan',      [33.0,  66.0,  'Afghanistan']],
  ['islamabad',        [33.7,  73.1,  'Islamabad, Pakistan']],
  ['karachi',          [24.9,  67.1,  'Karachi, Pakistan']],
  ['lahore',           [31.5,  74.3,  'Lahore, Pakistan']],
  ['pakistan',         [30.0,  70.0,  'Pakistan']],
  ['myanmar',          [17.0,  96.0,  'Myanmar']],
  ['naypyidaw',        [19.8,  96.1,  'Naypyidaw, Myanmar']],
  ['yangon',           [16.8,  96.2,  'Yangon, Myanmar']],

  // --- INDIA ---
  ['new delhi',        [28.6,  77.2,  'New Delhi, India']],
  ['delhi',            [28.6,  77.2,  'Delhi, India']],
  ['mumbai',           [19.0,  72.8,  'Mumbai, India']],
  ['bengaluru',        [12.9,  77.6,  'Bengaluru, India']],
  ['bangalore',        [12.9,  77.6,  'Bengaluru, India']],
  ['hyderabad',        [17.4,  78.5,  'Hyderabad, India']],
  ['chennai',          [13.1,  80.3,  'Chennai, India']],
  ['kolkata',          [22.6,  88.4,  'Kolkata, India']],
  ['pune',             [18.5,  73.9,  'Pune, India']],
  ['ahmedabad',        [23.0,  72.6,  'Ahmedabad, India']],
  ['jaipur',           [26.9,  75.8,  'Jaipur, India']],
  ['lucknow',          [26.8,  80.9,  'Lucknow, India']],
  ['surat',            [21.2,  72.8,  'Surat, India']],
  ['patna',            [25.6,  85.1,  'Patna, India']],
  ['bhopal',           [23.3,  77.4,  'Bhopal, India']],
  ['nagpur',           [21.1,  79.1,  'Nagpur, India']],
  ['chandigarh',       [30.7,  76.8,  'Chandigarh, India']],
  ['kochi',            [10.0,  76.3,  'Kochi, India']],
  ['visakhapatnam',    [17.7,  83.3,  'Visakhapatnam, India']],
  ['kashmir',          [34.1,  74.8,  'Kashmir, India']],
  ['jammu',            [32.7,  74.9,  'Jammu, India']],
  ['gujarat',          [22.3,  71.2,  'Gujarat, India']],
  ['rajasthan',        [27.0,  74.0,  'Rajasthan, India']],
  ['kerala',           [10.0,  76.5,  'Kerala, India']],
  ['tamil nadu',       [11.0,  78.7,  'Tamil Nadu, India']],
  ['maharashtra',      [19.8,  75.3,  'Maharashtra, India']],
  ['uttar pradesh',    [27.0,  80.0,  'Uttar Pradesh, India']],
  ['west bengal',      [22.6,  88.4,  'West Bengal, India']],
  ['karnataka',        [15.3,  75.7,  'Karnataka, India']],
  ['andhra pradesh',   [16.5,  79.7,  'Andhra Pradesh, India']],
  ['telangana',        [17.4,  78.5,  'Telangana, India']],
  ['bihar',            [25.1,  85.3,  'Bihar, India']],
  ['punjab',           [31.1,  75.3,  'Punjab, India']],
  ['haryana',          [29.1,  76.1,  'Haryana, India']],
  ['assam',            [26.2,  92.9,  'Assam, India']],
  ['manipur',          [24.7,  93.9,  'Manipur, India']],
  [' goa ',            [15.3,  74.0,  'Goa, India']],
  ['sensex',           [19.0,  72.8,  'Mumbai, India']],
  ['nifty',            [19.0,  72.8,  'Mumbai, India']],
  [' rbi ',            [19.0,  72.8,  'RBI, Mumbai']],
  ['isro',             [13.1,  80.3,  'ISRO, Bengaluru']],
  [' modi ',           [28.6,  77.2,  'New Delhi, India']],
  ['india',            [20.0,  78.0,  'India']],

  // --- SOUTH ASIA ---
  ['dhaka',            [23.7,  90.4,  'Dhaka, Bangladesh']],
  ['chittagong',       [22.3,  91.8,  'Chittagong, Bangladesh']],
  ['bangladesh',       [23.7,  90.4,  'Bangladesh']],
  ['colombo',          [ 6.9,  79.9,  'Colombo, Sri Lanka']],
  ['sri lanka',        [ 7.9,  80.7,  'Sri Lanka']],
  ['kathmandu',        [27.7,  85.3,  'Kathmandu, Nepal']],
  ['nepal',            [28.0,  84.0,  'Nepal']],
  ['bhutan',           [27.0,  90.0,  'Bhutan']],
  ['maldives',         [ 3.2,  73.2,  'Maldives']],

  // --- SOUTHEAST ASIA ---
  ['bangkok',          [13.8, 100.5,  'Bangkok, Thailand']],
  ['thailand',         [15.0, 101.0,  'Thailand']],
  ['hanoi',            [21.0, 105.9,  'Hanoi, Vietnam']],
  ['ho chi minh',      [10.8, 106.7,  'Ho Chi Minh City, Vietnam']],
  ['saigon',           [10.8, 106.7,  'Ho Chi Minh City, Vietnam']],
  ['vietnam',          [16.0, 108.0,  'Vietnam']],
  ['phnom penh',       [11.6, 104.9,  'Phnom Penh, Cambodia']],
  ['cambodia',         [12.0, 105.0,  'Cambodia']],
  ['vientiane',        [18.0, 102.6,  'Vientiane, Laos']],
  ['kuala lumpur',     [ 3.1, 101.7,  'Kuala Lumpur, Malaysia']],
  ['malaysia',         [ 4.0, 109.0,  'Malaysia']],
  ['jakarta',          [-6.2, 106.8,  'Jakarta, Indonesia']],
  ['bali',             [-8.4, 115.2,  'Bali, Indonesia']],
  ['indonesia',        [-5.0, 120.0,  'Indonesia']],
  ['manila',           [14.6, 120.9,  'Manila, Philippines']],
  ['philippines',      [13.0, 122.0,  'Philippines']],
  ['singapore',        [ 1.3, 103.8,  'Singapore']],
  ['brunei',           [ 4.5, 114.7,  'Brunei']],

  // --- EAST ASIA ---
  ['tokyo',            [35.7, 139.7,  'Tokyo, Japan']],
  ['osaka',            [34.7, 135.5,  'Osaka, Japan']],
  ['hiroshima',        [34.4, 132.5,  'Hiroshima, Japan']],
  ['japan',            [36.0, 138.0,  'Japan']],
  ['ulaanbaatar',      [47.9, 106.9,  'Ulaanbaatar, Mongolia']],
  ['mongolia',         [46.0, 105.0,  'Mongolia']],

  // --- CENTRAL ASIA ---
  ['tashkent',         [41.3,  69.3,  'Tashkent, Uzbekistan']],
  ['uzbekistan',       [41.0,  64.0,  'Uzbekistan']],
  ['almaty',           [43.2,  76.9,  'Almaty, Kazakhstan']],
  ['astana',           [51.2,  71.4,  'Astana, Kazakhstan']],
  ['kazakhstan',       [48.0,  68.0,  'Kazakhstan']],
  ['bishkek',          [42.9,  74.6,  'Bishkek, Kyrgyzstan']],
  ['dushanbe',         [38.6,  68.8,  'Dushanbe, Tajikistan']],
  ['ashgabat',         [37.9,  58.4,  'Ashgabat, Turkmenistan']],

  // --- MIDDLE EAST ---
  ['riyadh',           [24.7,  46.7,  'Riyadh, Saudi Arabia']],
  ['jeddah',           [21.5,  39.2,  'Jeddah, Saudi Arabia']],
  ['mecca',            [21.4,  39.8,  'Mecca, Saudi Arabia']],
  ['saudi arabia',     [24.0,  45.0,  'Saudi Arabia']],
  ['dubai',            [25.2,  55.3,  'Dubai, UAE']],
  ['abu dhabi',        [24.5,  54.4,  'Abu Dhabi, UAE']],
  [' uae ',            [24.0,  54.0,  'UAE']],
  ['doha',             [25.3,  51.5,  'Doha, Qatar']],
  ['qatar',            [25.3,  51.2,  'Qatar']],
  ['kuwait',           [29.4,  48.0,  'Kuwait']],
  ['manama',           [26.2,  50.6,  'Manama, Bahrain']],
  ['bahrain',          [26.0,  50.6,  'Bahrain']],
  ['muscat',           [23.6,  58.6,  'Muscat, Oman']],
  [' oman ',           [21.0,  57.0,  'Oman']],
  ['beirut',           [33.9,  35.5,  'Beirut, Lebanon']],
  ['lebanon',          [33.9,  35.5,  'Lebanon']],
  ['amman',            [31.9,  35.9,  'Amman, Jordan']],
  ['jordan',           [31.0,  36.0,  'Jordan']],
  ['ankara',           [39.9,  32.9,  'Ankara, Turkey']],
  ['istanbul',         [41.0,  29.0,  'Istanbul, Turkey']],
  ['turkey',           [39.0,  35.0,  'Turkey']],
  ['baku',             [40.4,  49.9,  'Baku, Azerbaijan']],
  ['azerbaijan',       [40.5,  47.5,  'Azerbaijan']],
  ['tbilisi',          [41.7,  44.8,  'Tbilisi, Georgia']],
  ['yerevan',          [40.2,  44.5,  'Yerevan, Armenia']],
  ['armenia',          [40.0,  45.0,  'Armenia']],
  ['persian gulf',     [26.0,  53.0,  'Persian Gulf']],
  ['middle east',      [28.0,  40.0,  'Middle East']],

  // --- EUROPE ---
  ['london',           [51.5,  -0.1,  'London, UK']],
  ['manchester',       [53.5,  -2.2,  'Manchester, UK']],
  ['edinburgh',        [55.9,  -3.2,  'Edinburgh, UK']],
  ['britain',          [54.0,  -3.0,  'United Kingdom']],
  [' uk ',             [54.0,  -3.0,  'United Kingdom']],
  ['paris',            [48.8,   2.3,  'Paris, France']],
  ['marseille',        [43.3,   5.4,  'Marseille, France']],
  ['france',           [46.0,   2.0,  'France']],
  ['berlin',           [52.5,  13.4,  'Berlin, Germany']],
  ['munich',           [48.1,  11.6,  'Munich, Germany']],
  ['hamburg',          [53.6,  10.0,  'Hamburg, Germany']],
  ['frankfurt',        [50.1,   8.7,  'Frankfurt, Germany']],
  ['germany',          [51.0,  10.0,  'Germany']],
  ['rome',             [41.9,  12.5,  'Rome, Italy']],
  ['milan',            [45.5,   9.2,  'Milan, Italy']],
  ['naples',           [40.8,  14.3,  'Naples, Italy']],
  ['italy',            [42.0,  12.0,  'Italy']],
  ['madrid',           [40.4,  -3.7,  'Madrid, Spain']],
  ['barcelona',        [41.4,   2.2,  'Barcelona, Spain']],
  ['spain',            [40.0,  -4.0,  'Spain']],
  ['amsterdam',        [52.4,   4.9,  'Amsterdam, Netherlands']],
  ['netherlands',      [52.0,   5.3,  'Netherlands']],
  ['brussels',         [50.8,   4.4,  'Brussels, Belgium']],
  ['belgium',          [50.6,   4.5,  'Belgium']],
  ['vienna',           [48.2,  16.4,  'Vienna, Austria']],
  ['austria',          [47.5,  13.0,  'Austria']],
  ['zurich',           [47.4,   8.5,  'Zurich, Switzerland']],
  ['geneva',           [46.2,   6.1,  'Geneva, Switzerland']],
  ['switzerland',      [47.0,   8.0,  'Switzerland']],
  ['warsaw',           [52.2,  21.0,  'Warsaw, Poland']],
  ['krakow',           [50.1,  19.9,  'Krakow, Poland']],
  ['poland',           [52.0,  20.0,  'Poland']],
  ['prague',           [50.1,  14.4,  'Prague, Czech Republic']],
  ['budapest',         [47.5,  19.1,  'Budapest, Hungary']],
  ['hungary',          [47.0,  19.0,  'Hungary']],
  ['bucharest',        [44.4,  26.1,  'Bucharest, Romania']],
  ['romania',          [46.0,  25.0,  'Romania']],
  ['sofia',            [42.7,  23.3,  'Sofia, Bulgaria']],
  ['bulgaria',         [43.0,  25.0,  'Bulgaria']],
  ['athens',           [38.0,  23.7,  'Athens, Greece']],
  ['greece',           [39.0,  22.0,  'Greece']],
  ['lisbon',           [38.7,  -9.1,  'Lisbon, Portugal']],
  ['portugal',         [39.5,  -8.0,  'Portugal']],
  ['stockholm',        [59.3,  18.1,  'Stockholm, Sweden']],
  ['sweden',           [62.0,  17.0,  'Sweden']],
  ['oslo',             [59.9,  10.8,  'Oslo, Norway']],
  ['norway',           [64.0,  11.0,  'Norway']],
  ['copenhagen',       [55.7,  12.6,  'Copenhagen, Denmark']],
  ['denmark',          [56.0,   9.5,  'Denmark']],
  ['helsinki',         [60.2,  25.0,  'Helsinki, Finland']],
  ['finland',          [62.0,  26.0,  'Finland']],
  ['dublin',           [53.3,  -6.3,  'Dublin, Ireland']],
  ['ireland',          [53.0,  -8.0,  'Ireland']],
  ['reykjavik',        [64.1, -21.9,  'Reykjavik, Iceland']],
  ['iceland',          [65.0, -18.0,  'Iceland']],
  ['belgrade',         [44.8,  20.5,  'Belgrade, Serbia']],
  ['serbia',           [44.0,  21.0,  'Serbia']],
  ['zagreb',           [45.8,  16.0,  'Zagreb, Croatia']],
  ['croatia',          [45.0,  16.0,  'Croatia']],
  ['sarajevo',         [43.9,  17.7,  'Sarajevo, Bosnia']],
  ['bosnia',           [44.0,  17.5,  'Bosnia']],
  ['pristina',         [42.7,  21.2,  'Pristina, Kosovo']],
  ['kosovo',           [42.6,  21.0,  'Kosovo']],
  ['tirana',           [41.3,  19.8,  'Tirana, Albania']],
  ['albania',          [41.0,  20.0,  'Albania']],
  ['skopje',           [42.0,  21.4,  'Skopje, N.Macedonia']],
  ['vilnius',          [54.7,  25.3,  'Vilnius, Lithuania']],
  ['riga',             [57.0,  24.1,  'Riga, Latvia']],
  ['tallinn',          [59.4,  24.8,  'Tallinn, Estonia']],
  ['minsk',            [53.9,  27.6,  'Minsk, Belarus']],
  ['belarus',          [53.0,  28.0,  'Belarus']],
  ['chisinau',         [47.0,  28.9,  'Chisinau, Moldova']],
  ['nato',             [50.9,   4.4,  'NATO HQ, Brussels']],
  ['european union',   [50.8,   4.4,  'European Union']],
  ['europe',           [50.0,  15.0,  'Europe']],

  // --- NORTH AFRICA ---
  ['cairo',            [30.0,  31.2,  'Cairo, Egypt']],
  ['alexandria',       [31.2,  29.9,  'Alexandria, Egypt']],
  ['egypt',            [26.0,  30.0,  'Egypt']],
  ['tunis',            [36.8,  10.2,  'Tunis, Tunisia']],
  ['tunisia',          [34.0,   9.0,  'Tunisia']],
  ['tripoli',          [32.9,  13.2,  'Tripoli, Libya']],
  ['benghazi',         [32.1,  20.1,  'Benghazi, Libya']],
  ['libya',            [26.0,  17.0,  'Libya']],
  ['algiers',          [36.7,   3.2,  'Algiers, Algeria']],
  ['algeria',          [28.0,   3.0,  'Algeria']],
  ['rabat',            [34.0,  -6.8,  'Rabat, Morocco']],
  ['casablanca',       [33.6,  -7.6,  'Casablanca, Morocco']],
  ['morocco',          [32.0,  -5.0,  'Morocco']],

  // --- SUB-SAHARAN AFRICA ---
  ['khartoum',         [15.6,  32.5,  'Khartoum, Sudan']],
  ['sudan',            [15.0,  32.0,  'Sudan']],
  ['juba',             [ 4.9,  31.6,  'Juba, South Sudan']],
  ['south sudan',      [ 7.0,  30.0,  'South Sudan']],
  ['addis ababa',      [ 9.0,  38.7,  'Addis Ababa, Ethiopia']],
  ['ethiopia',         [ 8.0,  38.0,  'Ethiopia']],
  ['asmara',           [15.3,  38.9,  'Asmara, Eritrea']],
  ['eritrea',          [15.0,  39.0,  'Eritrea']],
  ['djibouti',         [11.6,  43.1,  'Djibouti']],
  ['mogadishu',        [ 2.0,  45.3,  'Mogadishu, Somalia']],
  ['somalia',          [ 5.0,  46.0,  'Somalia']],
  ['nairobi',          [-1.3,  36.8,  'Nairobi, Kenya']],
  ['mombasa',          [-4.1,  39.7,  'Mombasa, Kenya']],
  ['kenya',            [ 0.0,  37.0,  'Kenya']],
  ['kampala',          [ 0.3,  32.6,  'Kampala, Uganda']],
  ['uganda',           [ 1.0,  32.0,  'Uganda']],
  ['dar es salaam',    [-6.8,  39.3,  'Dar es Salaam, Tanzania']],
  ['tanzania',         [-6.0,  35.0,  'Tanzania']],
  ['kigali',           [-1.9,  30.1,  'Kigali, Rwanda']],
  ['rwanda',           [-2.0,  30.0,  'Rwanda']],
  ['bujumbura',        [-3.4,  29.4,  'Bujumbura, Burundi']],
  ['burundi',          [-3.0,  29.5,  'Burundi']],
  ['kinshasa',         [-4.3,  15.3,  'Kinshasa, DRC']],
  ['congo',            [-2.0,  25.0,  'DR Congo']],
  ['luanda',           [-8.8,  13.2,  'Luanda, Angola']],
  ['angola',           [-11.0,  18.0,  'Angola']],
  ['lusaka',           [-15.4,  28.3,  'Lusaka, Zambia']],
  ['zambia',           [-13.0,  28.0,  'Zambia']],
  ['harare',           [-17.8,  31.1,  'Harare, Zimbabwe']],
  ['zimbabwe',         [-20.0,  30.0,  'Zimbabwe']],
  ['maputo',           [-25.9,  32.6,  'Maputo, Mozambique']],
  ['mozambique',       [-18.0,  35.0,  'Mozambique']],
  ['antananarivo',     [-18.9,  47.5,  'Antananarivo, Madagascar']],
  ['madagascar',       [-20.0,  47.0,  'Madagascar']],
  ['johannesburg',     [-26.2,  28.0,  'Johannesburg, South Africa']],
  ['cape town',        [-33.9,  18.4,  'Cape Town, South Africa']],
  ['pretoria',         [-25.7,  28.2,  'Pretoria, South Africa']],
  ['durban',           [-29.9,  31.0,  'Durban, South Africa']],
  ['south africa',     [-30.0,  25.0,  'South Africa']],
  ['windhoek',         [-22.6,  17.1,  'Windhoek, Namibia']],
  ['namibia',          [-22.0,  17.0,  'Namibia']],
  ['gaborone',         [-24.7,  25.9,  'Gaborone, Botswana']],
  ['botswana',         [-22.0,  24.0,  'Botswana']],
  ['lilongwe',         [-13.9,  33.8,  'Lilongwe, Malawi']],
  ['malawi',           [-13.0,  34.0,  'Malawi']],
  ['abuja',            [ 9.1,   7.5,  'Abuja, Nigeria']],
  ['lagos',            [ 6.4,   3.4,  'Lagos, Nigeria']],
  ['kano',             [12.0,   8.5,  'Kano, Nigeria']],
  ['nigeria',          [10.0,   8.0,  'Nigeria']],
  ['accra',            [ 5.6,  -0.2,  'Accra, Ghana']],
  ['ghana',            [ 8.0,  -1.0,  'Ghana']],
  ['abidjan',          [ 5.3,  -4.0,  'Abidjan, Ivory Coast']],
  ['ivory coast',      [ 7.0,  -5.5,  'Ivory Coast']],
  ['dakar',            [14.7, -17.4,  'Dakar, Senegal']],
  ['senegal',          [14.0, -14.0,  'Senegal']],
  ['bamako',           [12.6,  -8.0,  'Bamako, Mali']],
  [' mali ',           [17.0,  -4.0,  'Mali']],
  ['niamey',           [13.5,   2.1,  'Niamey, Niger']],
  [' niger ',          [16.0,   8.0,  'Niger']],
  ['ouagadougou',      [12.4,  -1.5,  'Ouagadougou, Burkina Faso']],
  ['burkina faso',     [12.0,  -2.0,  'Burkina Faso']],
  ['ndjamena',         [12.1,  15.0,  "N'Djamena, Chad"]],
  [' chad ',           [15.0,  19.0,  'Chad']],
  ['bangui',           [ 4.4,  18.6,  'Bangui, CAR']],
  ['libreville',       [ 0.4,   9.5,  'Libreville, Gabon']],
  ['yaounde',          [ 3.9,  11.5,  'Yaounde, Cameroon']],
  ['douala',           [ 4.1,   9.7,  'Douala, Cameroon']],
  ['cameroon',         [ 5.7,  12.4,  'Cameroon']],
  ['freetown',         [ 8.5, -13.2,  'Freetown, Sierra Leone']],
  ['monrovia',         [ 6.3, -10.8,  'Monrovia, Liberia']],
  ['conakry',          [ 9.5, -13.7,  'Conakry, Guinea']],
  ['lome',             [ 6.1,   1.2,  'Lome, Togo']],
  ['cotonou',          [ 6.4,   2.4,  'Cotonou, Benin']],
  ['banjul',           [13.5, -16.6,  'Banjul, Gambia']],
  ['africa',           [ 0.0,  20.0,  'Africa']],

  // --- AMERICAS ---
  ['washington',       [38.9, -77.0,  'Washington DC, USA']],
  ['new york',         [40.7, -74.0,  'New York, USA']],
  ['los angeles',      [34.1,-118.2,  'Los Angeles, USA']],
  ['chicago',          [41.9, -87.6,  'Chicago, USA']],
  ['houston',          [29.8, -95.4,  'Houston, USA']],
  ['miami',            [25.8, -80.2,  'Miami, USA']],
  ['atlanta',          [33.7, -84.4,  'Atlanta, USA']],
  ['dallas',           [32.8, -96.8,  'Dallas, USA']],
  ['san francisco',    [37.8,-122.4,  'San Francisco, USA']],
  ['seattle',          [47.6,-122.3,  'Seattle, USA']],
  ['boston',           [42.4, -71.1,  'Boston, USA']],
  ['united states',    [38.0, -97.0,  'United States']],
  [' us ',             [38.0, -97.0,  'United States']],
  ['toronto',          [43.7, -79.4,  'Toronto, Canada']],
  ['ottawa',           [45.4, -75.7,  'Ottawa, Canada']],
  ['vancouver',        [49.3,-123.1,  'Vancouver, Canada']],
  ['montreal',         [45.5, -73.6,  'Montreal, Canada']],
  ['canada',           [56.0, -96.0,  'Canada']],
  ['mexico city',      [19.4, -99.1,  'Mexico City, Mexico']],
  ['guadalajara',      [20.7,-103.3,  'Guadalajara, Mexico']],
  ['monterrey',        [25.7,-100.3,  'Monterrey, Mexico']],
  ['mexico',           [23.0,-102.0,  'Mexico']],
  ['havana',           [23.1, -82.4,  'Havana, Cuba']],
  ['cuba',             [22.0, -79.5,  'Cuba']],
  ['port-au-prince',   [18.5, -72.3,  'Port-au-Prince, Haiti']],
  ['haiti',            [18.9, -72.3,  'Haiti']],
  ['kingston',         [18.0, -76.8,  'Kingston, Jamaica']],
  ['jamaica',          [18.1, -77.3,  'Jamaica']],
  ['panama',           [ 9.0, -80.0,  'Panama']],
  ['managua',          [12.1, -86.3,  'Managua, Nicaragua']],
  ['tegucigalpa',      [14.1, -87.2,  'Tegucigalpa, Honduras']],
  ['san salvador',     [13.7, -89.2,  'San Salvador, El Salvador']],
  ['guatemala city',   [14.6, -90.5,  'Guatemala City']],
  ['bogota',           [ 4.7, -74.1,  'Bogota, Colombia']],
  ['medellin',         [ 6.2, -75.6,  'Medellin, Colombia']],
  ['colombia',         [ 4.0, -72.0,  'Colombia']],
  ['caracas',          [10.5, -66.9,  'Caracas, Venezuela']],
  ['venezuela',        [ 8.0, -65.0,  'Venezuela']],
  ['quito',            [-0.2, -78.5,  'Quito, Ecuador']],
  ['ecuador',          [-2.0, -77.5,  'Ecuador']],
  ['lima',             [-12.1,-77.0,  'Lima, Peru']],
  ['peru',             [-10.0,-75.0,  'Peru']],
  ['la paz',           [-16.5,-68.1,  'La Paz, Bolivia']],
  ['bolivia',          [-17.0,-65.0,  'Bolivia']],
  ['brasilia',         [-15.8,-47.9,  'Brasilia, Brazil']],
  ['rio de janeiro',   [-22.9,-43.2,  'Rio de Janeiro, Brazil']],
  ['sao paulo',        [-23.5,-46.6,  'Sao Paulo, Brazil']],
  ['manaus',           [-3.1, -60.0,  'Manaus, Brazil']],
  ['brazil',           [-10.0,-55.0,  'Brazil']],
  ['buenos aires',     [-34.6,-58.4,  'Buenos Aires, Argentina']],
  ['argentina',        [-38.0,-65.0,  'Argentina']],
  ['santiago',         [-33.5,-70.6,  'Santiago, Chile']],
  ['chile',            [-35.0,-71.0,  'Chile']],
  ['montevideo',       [-34.9,-56.2,  'Montevideo, Uruguay']],
  ['uruguay',          [-33.0,-56.0,  'Uruguay']],
  ['asuncion',         [-25.3,-57.6,  'Asuncion, Paraguay']],
  ['paraguay',         [-23.0,-58.0,  'Paraguay']],
  ['guyana',           [ 5.0, -59.0,  'Guyana']],
  ['trinidad',         [10.7, -61.5,  'Trinidad and Tobago']],

  // --- OCEANIA ---
  ['sydney',           [-33.9, 151.2,  'Sydney, Australia']],
  ['melbourne',        [-37.8, 145.0,  'Melbourne, Australia']],
  ['brisbane',         [-27.5, 153.0,  'Brisbane, Australia']],
  ['perth',            [-31.9, 115.9,  'Perth, Australia']],
  ['canberra',         [-35.3, 149.1,  'Canberra, Australia']],
  ['australia',        [-25.0, 133.0,  'Australia']],
  ['auckland',         [-36.9, 174.8,  'Auckland, New Zealand']],
  ['wellington',       [-41.3, 174.8,  'Wellington, New Zealand']],
  ['new zealand',      [-41.0, 174.0,  'New Zealand']],
  ['port moresby',     [ -9.5, 147.2,  'Port Moresby, Papua New Guinea']],
  ['fiji',             [-18.0, 178.0,  'Fiji']],

  // --- FINANCE HUBS ---
  ['wall street',      [40.7, -74.0,  'New York, USA']],
  ['nasdaq',           [40.7, -74.0,  'New York, USA']],
  ['federal reserve',  [38.9, -77.0,  'Washington DC, USA']],
  ['imf',              [38.9, -77.0,  'Washington DC, USA']],
  ['world bank',       [38.9, -77.0,  'Washington DC, USA']],
  ['ecb',              [50.1,   8.7,  'Frankfurt, Germany']],
  ['asia',             [30.0,  90.0,  'Asia']],
];

function geolocate(title) {
  const t = ' ' + (title || '').toLowerCase() + ' ';
  for (const [kw, coord] of GEO) {
    if (t.includes(kw)) return { lat: coord[0], lng: coord[1], loc: coord[2] };
  }
  const fb = [
    [48.5,31.5],[31.4,34.3],[35,105],
    [38,-97],[50,10],[0,20],[4,-72],
  ];
  const f = fb[Math.floor(Math.random() * fb.length)];
  // loc: null so extractCC uses title text only — avoids random country misclassification
  return { lat: f[0], lng: f[1], loc: null };
}

function categorize(title) {
  const t = (title || '').toLowerCase();
  if (/nuclear|nuke|uranium|warhead|atomic|iaea/.test(t))
    return { cat:'nuc', catLabel:'NUCLEAR',     severity:'critical' };
  if (/cyber|hack|ransomware|malware|data.breach|ddos/.test(t))
    return { cat:'cyb', catLabel:'CYBER',       severity:'high' };
  if (/\bai\b|artificial intelligence|chatgpt|openai|semiconductor/.test(t))
    return { cat:'tech', catLabel:'TECHNOLOGY', severity:'low' };
  if (/earthquake|tsunami|hurricane|typhoon|flood|wildfire|volcano/.test(t))
    return { cat:'dis', catLabel:'DISASTER',    severity:'high' };
  if (/climate|carbon|emissions|cop\d+|deforestation/.test(t))
    return { cat:'env', catLabel:'ENVIRONMENT', severity:'medium' };
  if (/disease|virus|pandemic|outbreak|vaccine|who.declares/.test(t))
    return { cat:'hlt', catLabel:'HEALTH',      severity:'medium' };
  if (/\boil\b|\bgas\b|opec|pipeline|petroleum|energy/.test(t))
    return { cat:'nrg', catLabel:'ENERGY',      severity:'medium' };
  if (/crime|murder|arrest|corruption|terrorist|cartel|shooting/.test(t))
    return { cat:'cri', catLabel:'CRIME',       severity:'medium' };
  if (/ceasefire|peace.talks|treaty|sanction|summit|diplomat/.test(t))
    return { cat:'dip', catLabel:'DIPLOMATIC',  severity:'medium' };
  if (/economy|inflation|recession|gdp|trade.war|tariff|central.bank/.test(t))
    return { cat:'eco', catLabel:'ECONOMIC',    severity:'medium' };
  if (/stock market|nasdaq|s&p|dow jones|wall street|bond yield|interest rate|fed |federal reserve|rate cut|rate hike|forex|currency|treasury|ipo|earnings|dividend|market rally|market crash|bitcoin|crypto/.test(t))
    return { cat:'fin', catLabel:'FINANCE',     severity:'medium' };
  if (/company|merger|acquisition|billion|ceo|startup|layoff|strike/.test(t))
    return { cat:'biz', catLabel:'BUSINESS',    severity:'low' };
  if (/war|attack|bomb|missile|military|army|troops|airstrike/.test(t))
    return { cat:'mil', catLabel:'MILITARY',    severity:'high' };
  if (/election|president|parliament|minister|government|vote|protest/.test(t))
    return { cat:'pol', catLabel:'POLITICS',    severity:'low' };
  return { cat:'pol', catLabel:'POLITICS', severity:'low' };
}

function parseRss(xml, feed) {
  const fallbackSource = feed.source; const feedLang = feed.lang || 'en';
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m, i = 0;
  while ((m = itemRe.exec(xml)) !== null && i < 30) {
    const b = m[1];
    const rawTitle = (b.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const rawLink  = (b.match(/<link>([\s\S]*?)<\/link>/) || b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/) || [])[1] || '';
    const rawDate  = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    const rawSrc   = (b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || fallbackSource;

    const title = rawTitle
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+-\s+\S{2,30}$/, '')
      .replace(/\s+/g, ' ').trim();

    if (!title || title.length < 10) { i++; continue; }

    let pubIso = new Date().toISOString();
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) pubIso = d.toISOString();
    }

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
    i++;
  }
  return items;
}

function dedupByTitle(events) {
  const seen = new Set();
  return events.filter(e => {
    const key = e.txt.toLowerCase().replace(/\s+/g,' ').substring(0, 75);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default async function handler(req, res) {
  // Route risk API requests (check query param first — Vercel rewrites req.url for nested routes)
  const _isRisks = (req.query && req.query.__route === 'risks') || (req.url || '').includes('/v1/risks');
  if (_isRisks) {
    try { return handleRisks(req, res); }
    catch (e) { return res.status(500).json({ error: e.message, stack: e.stack }); }
  }

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

  // For filtered requests, only fetch feeds matching the requested language.
  // If no feeds match (e.g. a language with no RSS coverage), return empty — don't fall back to EN.
  const activeFeed = lang === 'all' ? FEEDS : FEEDS.filter(f => f.lang === lang);

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

export const config = { api: { bodyParser: false } };

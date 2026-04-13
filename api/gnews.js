// api/gnews.js — Live RSS from major news outlets
// Uses direct RSS feeds (BBC, Guardian, Sky, DW, France24, NPR) — reliable from cloud/Vercel.
// Google News RSS often blocks datacenter IPs; these feeds do not.

const CACHE_TTL = 8 * 60 * 1000; // 8-minute cache
let cache = null, cacheTime = 0;

// Stable ID from URL — same article always same ID across polls (range 10000001–19999999)
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
  // ── GLOBAL MAJORS ──
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',                       source: 'BBC News' },
  { url: 'https://www.theguardian.com/world/rss',                             source: 'The Guardian' },
  { url: 'https://feeds.skynews.com/feeds/rss/world.xml',                     source: 'Sky News' },
  { url: 'https://rss.dw.com/rdf/rss-en-all',                                 source: 'Deutsche Welle' },
  { url: 'https://www.france24.com/en/rss',                                   source: 'France 24' },
  { url: 'https://feeds.npr.org/1004/rss.xml',                                source: 'NPR News' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',                         source: 'Al Jazeera' },
  { url: 'https://www.rfi.fr/en/rss',                                         source: 'RFI English' },
  { url: 'https://www3.nhk.or.jp/rss/news/cat0.xml',                         source: 'NHK World' },
  { url: 'https://www.cbc.ca/cmlink/rss-world',                               source: 'CBC News' },
  { url: 'https://www.abc.net.au/news/feed/51120/rss.xml',                    source: 'ABC Australia' },
  { url: 'https://www.arabnews.com/rss.xml',                                  source: 'Arab News' },
  { url: 'https://www.japantimes.co.jp/feed/topstories/',                     source: 'Japan Times' },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',                    source: 'BBC Business' },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',                  source: 'BBC Technology' },
  { url: 'https://www.france24.com/en/economy/rss',                           source: 'France24 Economy' },

  // ── INDIA ──
  { url: 'https://feeds.feedburner.com/ndtvnews-top-stories',                 source: 'NDTV' },
  { url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms',        source: 'Times of India' },
  { url: 'https://www.thehindu.com/news/national/feeder/default.rss',         source: 'The Hindu' },
  { url: 'https://economictimes.indiatimes.com/rssfeedstopstories.cms',       source: 'Economic Times' },
  { url: 'https://www.thehindu.com/business/feeder/default.rss',              source: 'The Hindu Business' },
  { url: 'https://feeds.feedburner.com/ndtvnews-india-news',                  source: 'NDTV India' },
  { url: 'https://www.livemint.com/rss/news',                                 source: 'Mint' },
  { url: 'https://www.business-standard.com/rss/home_page_top_stories.rss',  source: 'Business Standard' },
  { url: 'https://www.indiatoday.in/rss/home',                                source: 'India Today' },

  // ── FINANCE & MARKETS ──
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', source: 'MarketWatch' },
  { url: 'https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best', source: 'Reuters Finance' },
];

// Geo lookup — maps headline keywords → [lat, lng, displayName]
const GEO = [
  ['gaza',[31.4,34.3,'Gaza']],['west bank',[31.9,35.2,'West Bank']],['israel',[31.5,35.0,'Israel']],
  ['kyiv',[50.4,30.5,'Kyiv']],['ukraine',[48.5,31.5,'Ukraine']],['russia',[61.5,105.0,'Russia']],
  ['moscow',[55.7,37.6,'Moscow']],['crimea',[45.0,34.0,'Crimea']],['donbas',[48.0,37.5,'Donbas']],
  ['beijing',[39.9,116.4,'Beijing']],['taiwan',[23.7,121.0,'Taiwan']],['china',[35.0,105.0,'China']],
  ['hong kong',[22.3,114.2,'Hong Kong']],['south china sea',[12.0,115.0,'South China Sea']],
  ['north korea',[40.0,127.0,'North Korea']],['south korea',[36.0,128.0,'South Korea']],
  ['seoul',[37.6,127.0,'Seoul']],['pyongyang',[39.0,125.7,'Pyongyang']],
  ['tehran',[35.7,51.4,'Tehran']],['iran',[32.0,53.0,'Iran']],
  ['baghdad',[33.3,44.4,'Baghdad']],['iraq',[33.0,44.0,'Iraq']],
  ['damascus',[33.5,36.3,'Damascus']],['syria',[35.0,38.0,'Syria']],
  ['yemen',[15.0,48.0,'Yemen']],['red sea',[20.0,38.0,'Red Sea']],
  ['kabul',[34.5,69.2,'Kabul']],['afghanistan',[33.0,66.0,'Afghanistan']],
  ['pakistan',[30.0,70.0,'Pakistan']],['islamabad',[33.7,73.1,'Islamabad']],['karachi',[24.9,67.1,'Karachi']],
  // India — national + major cities + states
  ['new delhi',[28.6,77.2,'New Delhi']],['delhi',[28.6,77.2,'New Delhi']],
  ['mumbai',[19.0,72.8,'Mumbai']],['bangalore',[12.9,77.6,'Bengaluru']],['bengaluru',[12.9,77.6,'Bengaluru']],
  ['hyderabad',[17.4,78.5,'Hyderabad']],['chennai',[13.1,80.3,'Chennai']],['kolkata',[22.6,88.4,'Kolkata']],
  ['pune',[18.5,73.9,'Pune']],['ahmedabad',[23.0,72.6,'Ahmedabad']],['jaipur',[26.9,75.8,'Jaipur']],
  ['lucknow',[26.8,80.9,'Lucknow']],['surat',[21.2,72.8,'Surat']],['chandigarh',[30.7,76.8,'Chandigarh']],
  ['gujarat',[22.3,71.2,'Gujarat']],['rajasthan',[27.0,74.0,'Rajasthan']],['kerala',[10.0,76.5,'Kerala']],
  ['tamil nadu',[11.0,78.7,'Tamil Nadu']],['maharashtra',[19.8,75.3,'Maharashtra']],
  ['uttar pradesh',[27.0,80.0,'Uttar Pradesh']],['bihar',[25.1,85.3,'Bihar']],
  ['west bengal',[22.6,88.4,'West Bengal']],['karnataka',[15.3,75.7,'Karnataka']],
  ['andhra pradesh',[16.5,79.7,'Andhra Pradesh']],['telangana',[17.4,78.5,'Telangana']],
  ['punjab',[31.1,75.3,'Punjab, India']],['haryana',[29.1,76.1,'Haryana']],
  ['kashmir',[34.1,74.8,'Kashmir']],['jammu',[32.7,74.9,'Jammu & Kashmir']],
  ['manipur',[24.7,93.9,'Manipur']],['assam',[26.2,92.9,'Assam']],['goa',[15.3,74.0,'Goa']],
  ['india',[20.0,78.0,'India']],['modi',[28.6,77.2,'New Delhi']],
  ['bse',[19.0,72.8,'Mumbai']],['nse',[19.0,72.8,'Mumbai']],['sensex',[19.0,72.8,'Mumbai']],
  ['nifty',[19.0,72.8,'Mumbai']],['rbi',[19.0,72.8,'Mumbai']],
  ['myanmar',[17.0,96.0,'Myanmar']],['sudan',[15.0,32.0,'Sudan']],
  ['ethiopia',[8.0,38.0,'Ethiopia']],['nigeria',[10.0,8.0,'Nigeria']],
  ['nairobi',[−1.3,36.8,'Nairobi']],['kenya',[0.0,37.0,'Kenya']],
  ['somalia',[5.0,46.0,'Somalia']],['mogadishu',[2.0,45.3,'Mogadishu']],
  ['libya',[26.0,17.0,'Libya']],['egypt',[26.0,30.0,'Egypt']],['cairo',[30.0,31.2,'Cairo']],
  ['venezuela',[8.0,-65.0,'Venezuela']],['haiti',[18.9,-72.3,'Haiti']],
  ['mexico',[23.0,-102.0,'Mexico']],['brazil',[-10.0,-55.0,'Brazil']],
  ['washington',[38.9,-77.0,'Washington DC']],['new york',[40.7,-74.0,'New York']],
  ['united states',[38.0,-97.0,'United States']],[' us ',[38.0,-97.0,'United States']],
  ['london',[51.5,-0.1,'London']],[' uk ',[54.0,-3.0,'UK']],['britain',[54.0,-3.0,'UK']],
  ['paris',[48.8,2.3,'Paris']],['france',[46.0,2.0,'France']],
  ['berlin',[52.5,13.4,'Berlin']],['germany',[51.0,10.0,'Germany']],
  ['tokyo',[35.7,139.7,'Tokyo']],['japan',[36.0,138.0,'Japan']],
  ['singapore',[1.3,103.8,'Singapore']],['indonesia',[-5.0,120.0,'Indonesia']],
  ['philippines',[13.0,122.0,'Philippines']],['thailand',[13.8,100.5,'Thailand']],
  ['wall street',[40.7,-74.0,'New York']],['nasdaq',[40.7,-74.0,'New York']],
  ['federal reserve',[38.9,-77.0,'Washington DC']],['nato',[50.0,10.0,'Europe']],
  ['middle east',[28.0,40.0,'Middle East']],['europe',[50.0,15.0,'Europe']],
  ['africa',[0.0,20.0,'Africa']],['asia',[30.0,90.0,'Asia']],
];
function geolocate(title) {
  const t = ' ' + (title || '').toLowerCase() + ' ';
  for (const [kw, coord] of GEO) {
    if (t.includes(kw)) return { lat: coord[0], lng: coord[1], loc: coord[2] };
  }
  const fb = [[48.5,31.5,'Ukraine'],[31.4,34.3,'Middle East'],[35,105,'China'],[38,-97,'US'],[50,10,'Europe']];
  const f = fb[Math.floor(Math.random() * fb.length)];
  return { lat: f[0], lng: f[1], loc: f[2] };
}

function categorize(title) {
  const t = (title || '').toLowerCase();
  if (/nuclear|nuke|uranium|warhead|atomic|iaea/.test(t))                return { cat:'nuc', catLabel:'NUCLEAR',     severity:'critical' };
  if (/cyber|hack|ransomware|malware|data.breach|ddos/.test(t))          return { cat:'cyb', catLabel:'CYBER',       severity:'high'     };
  if (/\bai\b|artificial intelligence|chatgpt|openai|semiconductor/.test(t)) return { cat:'tech', catLabel:'TECHNOLOGY', severity:'low'  };
  if (/earthquake|tsunami|hurricane|typhoon|flood|wildfire|volcano/.test(t)) return { cat:'dis', catLabel:'DISASTER',   severity:'high'   };
  if (/climate|carbon|emissions|cop\d+|deforestation/.test(t))           return { cat:'env', catLabel:'ENVIRONMENT', severity:'medium'   };
  if (/disease|virus|pandemic|outbreak|vaccine|who.declares/.test(t))    return { cat:'hlt', catLabel:'HEALTH',      severity:'medium'   };
  if (/\boil\b|\bgas\b|opec|pipeline|petroleum|energy/.test(t))          return { cat:'nrg', catLabel:'ENERGY',      severity:'medium'   };
  if (/crime|murder|arrest|corruption|terrorist|cartel|shooting/.test(t))return { cat:'cri', catLabel:'CRIME',       severity:'medium'   };
  if (/ceasefire|peace.talks|treaty|sanction|summit|diplomat/.test(t))   return { cat:'dip', catLabel:'DIPLOMATIC',  severity:'medium'   };
  if (/economy|inflation|recession|gdp|trade.war|tariff|central.bank/.test(t)) return { cat:'eco', catLabel:'ECONOMIC', severity:'medium' };
  if (/stock market|nasdaq|s&p|dow jones|wall street|hedge fund|bond yield|interest rate|fed |federal reserve|rate cut|rate hike|forex|currency|treasury|ipo|earnings|dividend|market rally|market crash|bitcoin|crypto/.test(t)) return { cat:'fin', catLabel:'FINANCE', severity:'medium' };
  if (/company|merger|acquisition|billion|ceo|startup|layoff|strike/.test(t))  return { cat:'biz', catLabel:'BUSINESS',   severity:'low'      };
  if (/war|attack|bomb|missile|military|army|troops|airstrike/.test(t))  return { cat:'mil', catLabel:'MILITARY',   severity:'high'     };
  if (/election|president|parliament|minister|government|vote|protest/.test(t)) return { cat:'pol', catLabel:'POLITICS', severity:'low' };
  return { cat:'pol', catLabel:'POLITICS', severity:'low' };
}

function parseRss(xml, fallbackSource) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m, i = 0;
  while ((m = itemRe.exec(xml)) !== null && i < 25) {
    const b = m[1];

    // Extract title — handle both CDATA and plain text
    const rawTitle = (
      b.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || []
    )[1] || '';

    // Extract link or guid
    const rawLink = (
      b.match(/<link>([\s\S]*?)<\/link>/)           ||
      b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)      || []
    )[1] || '';

    // Published date
    const rawDate = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';

    // Source name
    const rawSource = (b.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || fallbackSource;

    // Decode HTML entities, strip " - Source" suffix Google/BBC append
    const title = rawTitle
      .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&quot;/g,'"')
      .replace(/<[^>]+>/g, '')   // strip any html tags
      .replace(/\s+-\s+\S{2,30}$/, '') // strip trailing " - BBC News"
      .replace(/\s+/g, ' ')
      .trim();

    if (!title || title.length < 10) { i++; continue; }

    // Parse pubDate — RFC 2822 parses natively in JS
    let pubIso = new Date().toISOString();
    if (rawDate) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) pubIso = d.toISOString();
    }

    const { cat, catLabel, severity } = categorize(title);
    const { lat, lng, loc: geoLoc } = geolocate(title);
    items.push({
      id:        stableId(rawLink.trim(), title),
      isDemo:    false,
      cat, catLabel, severity,
      lat,
      lng,
      loc:       geoLoc || rawSource.replace(/<[^>]+>/g,'').trim() || fallbackSource,
      txt:       title,
      url:       rawLink.trim(),
      source:    rawSource.replace(/<[^>]+>/g,'').trim() || fallbackSource,
      tags:      [],
      time:      pubIso,
      fromRss:   true,
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=480, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (cache && Date.now() - cacheTime < CACHE_TTL) {
    return res.status(200).json(cache);
  }

  try {
    const results = await Promise.allSettled(
      FEEDS.map((feed, i) =>
        fetch(feed.url, {
          headers: {
            'User-Agent': 'OrreryIntelligence/1.0 (https://www.orreryx.io)',
            'Accept':     'application/rss+xml, application/xml, text/xml',
          },
          signal: AbortSignal.timeout(8000),
        })
          .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
          .then(xml => parseRss(xml, feed.source))
          .catch(e => { console.error(`[GNews] ${feed.source} failed:`, e.message); return []; })
      )
    );

    let all = [];
    results.forEach(r => { if (r.status === 'fulfilled') all = all.concat(r.value); });

    // Sort newest first
    all.sort((a, b) => new Date(b.time) - new Date(a.time));
    const final = dedupByTitle(all).slice(0, 80);

    const successFeeds = results.filter(r => r.status === 'fulfilled' && r.value.length > 0).length;
    cache = { articles: final, fetched: Date.now(), count: final.length, source: 'rss', feeds: successFeeds };
    cacheTime = Date.now();

    console.log(`[GNews] ${final.length} articles from ${successFeeds}/${FEEDS.length} feeds. Newest: ${final[0]?.time || 'n/a'}`);
    return res.status(200).json(cache);

  } catch (err) {
    console.error('[GNews] Fatal:', err.message);
    return res.status(200).json({ articles: [], error: err.message, source: 'rss', fetched: Date.now() });
  }
}

export const config = { api: { bodyParser: false } };

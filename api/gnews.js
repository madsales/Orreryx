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
  // World news
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',               source: 'BBC News' },
  { url: 'https://www.theguardian.com/world/rss',                      source: 'The Guardian' },
  { url: 'https://feeds.skynews.com/feeds/rss/world.xml',             source: 'Sky News' },
  { url: 'https://rss.dw.com/rdf/rss-en-all',                         source: 'Deutsche Welle' },
  { url: 'https://www.france24.com/en/rss',                           source: 'France 24' },
  { url: 'https://feeds.npr.org/1004/rss.xml',                        source: 'NPR News' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',                 source: 'Al Jazeera' },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml',            source: 'BBC Business' },
  // Finance & markets
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', source: 'MarketWatch' },
  { url: 'https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best', source: 'Reuters Finance' },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml',          source: 'BBC Technology' },
  { url: 'https://www.france24.com/en/economy/rss',                   source: 'France24 Economy' },
];

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
    items.push({
      id:        stableId(rawLink.trim(), title),
      isDemo:    false,
      cat, catLabel, severity,
      lat:       null,
      lng:       null,
      loc:       rawSource.replace(/<[^>]+>/g,'').trim() || fallbackSource,
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

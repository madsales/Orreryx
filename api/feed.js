// api/feed.js — unified content feed handler
// GET /api/feed?type=quotes&symbols=BTC,ETH,LMT  → market quotes
// GET /api/feed?type=videos&q=ukraine war          → news videos
// GET /api/feed?type=news&q=ukraine&lang=en        → proxies gnews

// ─────────── QUOTES (Yahoo Finance + CoinGecko) ───────────────────────────────
const CACHE_TTL = 30 * 1000;
const qCache = new Map();

const CRYPTO_IDS = {
  BTC:'bitcoin',ETH:'ethereum',XMR:'monero',TON:'the-open-network',
  SOL:'solana',USDT:'tether',USDC:'usd-coin',BNB:'binancecoin',
  AVAX:'avalanche-2',DOT:'polkadot',LINK:'chainlink',UNI:'uniswap',
  XRP:'ripple',ADA:'cardano',NEAR:'near',ATOM:'cosmos',DOGE:'dogecoin',
};
const CRYPTO_SET = new Set(Object.keys(CRYPTO_IDS));
const YF_HDR = {
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept':'application/json,*/*','Accept-Language':'en-US,en;q=0.9',
};

async function fetchOneStock(sym) {
  try {
    const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`,
      { headers: YF_HDR, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const j = await r.json();
    const m = j?.chart?.result?.[0]?.meta;
    if (!m?.regularMarketPrice) return null;
    const p = m.regularMarketPrice, prev = m.chartPreviousClose || p;
    return { symbol:sym, price:p, change:prev?((p-prev)/prev)*100:0 };
  } catch { return null; }
}

async function fetchCrypto(syms) {
  if (!syms.length) return [];
  const ids = syms.map(s=>CRYPTO_IDS[s]).filter(Boolean);
  if (!ids.length) return [];
  const r = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`,
    { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return [];
  const data = await r.json();
  const idToSym = Object.fromEntries(Object.entries(CRYPTO_IDS).map(([s,id])=>[id,s]));
  return ids.map(id=>{ const d=data[id]; return d?{symbol:idToSym[id],price:d.usd,change:d.usd_24h_change||0}:null; }).filter(Boolean);
}

async function handleQuotes(req, res) {
  const raw = ((req.query.symbols)||'').trim();
  const requested = raw ? raw.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean) : [];
  if (!requested.length) return res.status(400).json({ error:'symbols param required' });
  const key = requested.slice().sort().join(',');
  const hit = qCache.get(key);
  if (hit && Date.now()-hit.ts < CACHE_TTL) return res.status(200).json(hit.data);
  const [stocks, crypto] = await Promise.allSettled([
    Promise.all(requested.filter(s=>!CRYPTO_SET.has(s)).map(fetchOneStock)),
    fetchCrypto(requested.filter(s=>CRYPTO_SET.has(s))),
  ]);
  const data = [...(stocks.status==='fulfilled'?stocks.value.filter(Boolean):[]),
                ...(crypto.status==='fulfilled'?crypto.value:[])];
  qCache.set(key,{data,ts:Date.now()});
  if(qCache.size>200) qCache.delete(qCache.keys().next().value);
  res.setHeader('Cache-Control','public, max-age=30');
  return res.status(200).json(data);
}

// ─────────── VIDEOS (YouTube RSS) ────────────────────────────────────────────
const CHANNELS=[
  // Global English
  {name:'CNN',        id:'UCupvZG-5ko_eiXAupbDfxWw'},
  {name:'BBC News',   id:'UCnUYZLuoy1rq1aVMwx4aTzw'},
  {name:'Reuters',    id:'UChqUTb7kYRX8-EiaN3XFrSQ'},
  {name:'Al Jazeera', id:'UCNye-wNBqNL5ZzHSJj3l8Bg'},
  {name:'Sky News',   id:'UCIK31bDqkH8lsYsYMoHcFJQ'},
  {name:'France 24',  id:'UCQfwfsi5VrQ8yKZ-UWmAEFg'},
  {name:'DW News',    id:'UCknLrEdhRCp1aegoMqRaCZg'},
  {name:'NBC News',   id:'UCeY0bbntWzzVIaj2z3QigXg'},
  {name:'ABC News',   id:'UCBi2mrWuNuyYy4gbM6fU18Q'},
  {name:'CGTN',       id:'UCIdxT5oAFTCw8KGsH6PCUSA'},
  {name:'TRT World',  id:'UCg7Bc_rHNf8t-5LAamIDivg'},
  {name:'Euronews',   id:'UCKy1dAqELo0zrOtPkf0aNSg'},
  {name:'NHK World',  id:'UCa-g4n1NsKvHvJlKIFIDSAg'},
  {name:'PBS NewsHour',id:'UCjIsgXPblEE73-ekFAt8tDg'},
  {name:'Bloomberg',  id:'UCIALMKvObZNtJ6Ts-4BLBPQ'},
  {name:'WION',       id:'UCsHBMYP0M2Z8S9Kxmv0exgg'},
  // Regional — South Asia
  {name:'NDTV',       id:'UCZFMm1mMw0F81Z37aaEzTUA'},
  {name:'India Today',id:'UCYPvAwZP8pZhSMW8qs7cVCw'},
  {name:'Geo News',   id:'UCEHsKBHMEeH-5xO9JPVXCJA'},
  // Regional — Middle East
  {name:'Al Arabiya', id:'UCQfwfsi5VrQ8yKZ-UGuJ-TA'},
  {name:'i24 News',   id:'UCFqcDdWEC3GKNKouADkuAqQ'},
  // Regional — Africa
  {name:'Channels TV',id:'UCmqVQJhDjIBT2mFHLbLZ4nQ'},
  // Regional — East Asia
  {name:'Arirang',    id:'UCVGaKt26MkEWnrHFo4pqNaQ'},
  // Investigative
  {name:'Associated Press',id:'UC16niRr50-MSBwiO3He6o8A'},
  {name:'TOLOnews',   id:'UCJuTXHKQ7tD8tF35wR3oPsA'},
];
const SYNONYMS={
  military:  ['military','war','attack','strike','troops','army','airstrike','missile','drone','combat','offensive','forces'],
  conflict:  ['conflict','war','fighting','battle','clash','siege','frontline'],
  oil:       ['oil','crude','opec','petroleum','energy','barrel','brent'],
  nuclear:   ['nuclear','atomic','uranium','iaea','warhead','nuke'],
  economy:   ['economy','economic','gdp','inflation','recession','sanctions','tariff'],
  iran:      ['iran','iranian','tehran','irgc','hormuz'],
  russia:    ['russia','russian','kremlin','putin','moscow'],
  china:     ['china','chinese','beijing','pla','ccp'],
  ukraine:   ['ukraine','ukrainian','kyiv','zelensky','donbas'],
  israel:    ['israel','israeli','gaza','idf','hamas','netanyahu','west bank'],
  india:     ['india','indian','modi','delhi','mumbai','kashmir'],
  pakistan:  ['pakistan','pakistani','islamabad','karachi','imf'],
  korea:     ['korea','korean','pyongyang','kim jong','seoul'],
  taiwan:    ['taiwan','taiwanese','strait','tsai'],
  turkey:    ['turkey','turkish','erdogan','ankara'],
  syria:     ['syria','syrian','damascus','aleppo'],
  yemen:     ['yemen','yemeni','houthi','sanaa'],
  sudan:     ['sudan','sudanese','khartoum','darfur'],
  somalia:   ['somalia','somali','mogadishu','al-shabaab'],
  afghanistan:['afghanistan','afghan','taliban','kabul'],
  myanmar:   ['myanmar','burma','burmese','junta','rangoon'],
};
const chanCache=new Map(); const vidCache=new Map();
const CHAN_TTL=30*60*1000; const VID_TTL=10*60*1000;
const STOP=new Set(['that','this','with','from','they','have','been','will','says','said','their','about','into','news']);
function kwds(q){return [...new Set(q.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w)))]}
function expand(kws){const e=new Set(kws);for(const k of kws){const s=SYNONYMS[k];if(s)s.forEach(x=>e.add(x));}return[...e];}
function score(t,kws,exp){let s=0;const tl=t.toLowerCase();for(const k of kws)if(tl.includes(k))s+=2;for(const k of exp)if(!kws.includes(k)&&tl.includes(k))s+=1;return s;}
function parseYt(xml,ch){const e=[];const re=/<entry>([\s\S]*?)<\/entry>/g;let m;
  while((m=re.exec(xml))!==null){const b=m[1];const id=b.match(/<yt:videoId>([^<]+)/);const ti=b.match(/<media:title>([^<]*)/)||b.match(/<title>([^<]*)/);const dt=b.match(/<published>([^<]+)/);
  if(!id||!ti)continue;const v=id[1].trim();e.push({id:v,title:ti[1].replace(/&amp;/g,'&').trim(),thumb:'https://i.ytimg.com/vi/'+v+'/mqdefault.jpg',url:'https://www.youtube.com/watch?v='+v,date:dt?dt[1].substring(0,10):'',channel:ch});}return e;}
async function fetchChan(ch){const now=Date.now();const hit=chanCache.get(ch.id);if(hit&&now-hit.ts<CHAN_TTL)return hit.items;
  try{const r=await fetch('https://www.youtube.com/feeds/videos.xml?channel_id='+ch.id,{signal:AbortSignal.timeout(5000)});if(!r.ok)return[];const xml=await r.text();const items=parseYt(xml,ch.name);chanCache.set(ch.id,{items,ts:now});return items;}catch{return[];}}
async function handleVideos(req,res){
  const q=((req.query.q)||'').trim().substring(0,150);
  if(!q)return res.status(400).json({error:'q param required'});
  const ck=q.toLowerCase().replace(/\s+/g,' ');const cached=vidCache.get(ck);
  if(cached&&Date.now()-cached.ts<VID_TTL)return res.status(200).json(cached.data);
  const kws=kwds(q);const exp=expand(kws);
  const all=(await Promise.all(CHANNELS.map(fetchChan))).flat();
  const scored=all.map(v=>({...v,score:score(v.title,kws,exp)}));
  scored.sort((a,b)=>b.score!==a.score?b.score-a.score:b.date.localeCompare(a.date));
  const data={clips:scored.filter(v=>v.score>=1).slice(0,3)};
  vidCache.set(ck,{data,ts:Date.now()});if(vidCache.size>400)vidCache.delete(vidCache.keys().next().value);
  res.setHeader('Cache-Control','public, max-age=600');
  return res.status(200).json(data);
}

// ─────────── ROUTER ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (req.method!=='GET') return res.status(405).json({error:'GET only'});
  // Detect videos path — /api/videos routes here without type param
  const isVideosPath = (req.url||'').split('?')[0].endsWith('/videos');
  const type = isVideosPath ? 'videos' : (req.query.type||'quotes').toLowerCase();
  if (type==='videos') return handleVideos(req,res);
  return handleQuotes(req,res); // default: quotes
}

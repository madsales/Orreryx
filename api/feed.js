// api/feed.js — unified content feed handler
// GET /api/feed?type=quotes&symbols=BTC,ETH,LMT  → market quotes
// GET /api/feed?type=videos&q=ukraine war          → news videos
// GET /api/feed?type=news&q=ukraine&lang=en        → proxies gnews
// GET /api/og-image?title=...&source=...           → news card PNG (merged from og-image.js)

import sharp from 'sharp';

// ── OG IMAGE GENERATOR — dramatic photo-backed news cards ────────────────────
const OG_THEMES = {
  military:   { accent:'#f5a623', accent2:'#ffe066', badgeBg:'#b91c1c', badge:'BREAKING',      label:'MILITARY',    dot:'f5a623' },
  nuclear:    { accent:'#f97316', accent2:'#fdba74', badgeBg:'#7c2d00', badge:'NUCLEAR ALERT', label:'NUCLEAR',     dot:'f97316' },
  economic:   { accent:'#10b981', accent2:'#6ee7b7', badgeBg:'#064e3b', badge:'MARKET IMPACT', label:'ECONOMIC',    dot:'10b981' },
  diplomatic: { accent:'#60a5fa', accent2:'#93c5fd', badgeBg:'#1e3a8a', badge:'DIPLOMATIC',    label:'DIPLOMATIC',  dot:'60a5fa' },
  sanctions:  { accent:'#c084fc', accent2:'#e9d5ff', badgeBg:'#4c1d95', badge:'SANCTIONS',     label:'SANCTIONS',   dot:'c084fc' },
  default:    { accent:'#e63946', accent2:'#ff8fa3', badgeBg:'#7f1d1d', badge:'LIVE UPDATE',   label:'INTELLIGENCE',dot:'e63946' },
};

// ── DALL-E 3 prompts per category (safe for content policy — no gore/faces) ──
const DALLE_PROMPTS = {
  military:   (loc) => `Cinematic dramatic aerial war zone photograph, military helicopter flying low over destroyed buildings and rubble, thick smoke plumes rising, dark storm clouds, dust and debris, desolate conflict landscape${loc ? ', ' + loc + ' terrain' : ''}, golden hour light, photorealistic, ultra detailed, no people visible, no text`,
  nuclear:    (loc) => `Dramatic night photograph of massive nuclear power plant cooling towers, orange and red glowing sky, atmospheric fog drifting across the scene, warning lights and flares reflecting in water below, ominous atmosphere, photorealistic, cinematic, no text`,
  economic:   (_)   => `Dramatic close-up photograph of stock market trading screens showing crashing red graphs and numbers, blurred traders in background, blue and red dramatic lighting, financial crisis atmosphere, photorealistic, bokeh background, no text`,
  diplomatic: (loc) => `Dramatic photograph of an empty high-stakes government summit room at night, leather chairs around a long conference table, national flags lining the walls, a single dramatic spotlight, dark wood panelling, tension in the air, photorealistic, no text`,
  sanctions:  (_)   => `Dramatic abstract digital art of global financial sanctions, world map made of glowing red circuits being cut off, dark deep blue background, chains of light breaking, gold and red tones, photorealistic render quality, no text`,
  default:    (loc) => `Dramatic breaking news scene, dark dramatic sky with storm clouds at sunset, destroyed infrastructure, smoke rising on the horizon${loc ? ', ' + loc : ''}, cinematic wide angle, photorealistic, high contrast lighting, no people, no text`,
};

// Pexels fallback queries (used if DALL-E is not set up)
const PEXELS_QUERIES = {
  military:   'military war helicopter explosion soldiers combat',
  nuclear:    'nuclear power plant radiation warning explosion',
  economic:   'stock market trading finance graph wall street',
  diplomatic: 'government politics summit meeting diplomacy',
  sanctions:  'economy politics financial crisis pressure',
  default:    'world crisis conflict breaking news',
};

function ogDetectCategory(title, catParam) {
  if (catParam && OG_THEMES[catParam]) return catParam;
  const t = title.toLowerCase();
  if (/nuclear|uranium|warhead|iaea|atomic/.test(t))               return 'nuclear';
  if (/sanction|embargo|tariff|freeze|export ban/.test(t))         return 'sanctions';
  if (/ceasefire|treaty|diplomat|summit|talks|agreement/.test(t))  return 'diplomatic';
  if (/oil|market|economy|gdp|inflation|stock|currency/.test(t))   return 'economic';
  return 'military';
}

function ogEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function ogWrapTitle(title, maxChars = 19) {
  const words = title.split(' '); const lines = []; let cur = '';
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + ' ' + w).length <= maxChars) { cur += ' ' + w; }
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

// Helper: text with drop shadow using two stacked elements
// Uses fill + fill-opacity (NOT rgba()) for librsvg compatibility
function ogText(x, y, text, { size, weight='bold', fill='white', fillOpacity='1', anchor='start', shadow=true, spacing='-1', family='sans-serif' } = {}) {
  const sh = shadow ? `<text x="${x+3}" y="${y+3}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="#000000" fill-opacity="0.65" text-anchor="${anchor}" letter-spacing="${spacing}">${text}</text>` : '';
  return `${sh}<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" fill-opacity="${fillOpacity}" text-anchor="${anchor}" letter-spacing="${spacing}">${text}</text>`;
}

// Builds the SVG overlay — composited over a photo (hasPhoto=true) or standalone dark card
function ogBuildOverlay({ title, source, cat, loc, date, hasPhoto }) {
  const theme = OG_THEMES[cat] || OG_THEMES.default;
  const W = 1080, H = 1080;
  const lines = ogWrapTitle(title);
  const fontSize  = lines.length <= 2 ? 96 : lines.length === 3 ? 82 : 70;
  const lineH     = fontSize * 1.24;
  const topPad    = 160;
  const barH      = 210;
  const available = H - topPad - barH;
  const locH      = loc ? 110 : 0;
  const textBlockH = lines.length * lineH;
  const textStartY = topPad + Math.max(20, (available - textBlockH - locH) / 2);

  // Headline — shadow + white text (no paint-order, works on all librsvg versions)
  const headlineRows = lines.map((line, i) => {
    const y = textStartY + i * lineH + fontSize;
    return ogText(54, y, ogEsc(line), { size: fontSize, fill: 'white', shadow: true, spacing: '-1' });
  }).join('\n  ');

  const textBottomY = textStartY + lines.length * lineH + fontSize;

  // Location banner — full-width gold strip, no emoji (librsvg can't render emoji)
  const locClean = loc ? loc.toUpperCase().replace(/[^\x00-\x7F]/g, '').trim() : '';
  const locBanner = locClean ? `
  <rect x="0" y="${textBottomY + 22}" width="${W}" height="68" fill="${theme.accent}"/>
  <rect x="0" y="${textBottomY + 22}" width="8" height="68" fill="#000000" fill-opacity="0.25"/>
  <text x="54" y="${textBottomY + 68}" font-family="sans-serif" font-size="30" font-weight="bold" fill="#000000" letter-spacing="3">${ogEsc(locClean)}</text>
  <text x="${W-54}" y="${textBottomY + 68}" font-family="sans-serif" font-size="18" font-weight="bold" fill="rgba(0,0,0,0.5)" text-anchor="end" letter-spacing="2">LIVE COVERAGE</text>` : '';

  // Background — photo overlay OR standalone dark card
  const bgLayer = hasPhoto
    ? `<rect width="${W}" height="${H}" fill="#000000" fill-opacity="0.18"/>
  <rect width="${W}" height="540" fill="url(#tf)"/>
  <rect y="${H-580}" width="${W}" height="580" fill="url(#bf)"/>`
    : `<rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${Array.from({length:18},(_,r)=>Array.from({length:18},(_,c)=>`<circle cx="${c*62+31}" cy="${r*62+31}" r="1.3" fill="#${theme.dot}" fill-opacity="0.13"/>`).join('')).join('')}
  <rect width="${W}" height="${H}" fill="url(#gl)"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="tf" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#000000" stop-opacity="0.88"/>
    <stop offset="35%"  stop-color="#000000" stop-opacity="0.45"/>
    <stop offset="60%"  stop-color="#000000" stop-opacity="0.08"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="bf" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#000000" stop-opacity="0"/>
    <stop offset="42%"  stop-color="#000000" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="0.97"/>
  </linearGradient>
  <linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">
    <stop offset="0%"   stop-color="#04060d"/>
    <stop offset="100%" stop-color="#081422"/>
  </linearGradient>
  <radialGradient id="gl" cx="80%" cy="78%" r="55%">
    <stop offset="0%"   stop-color="#${theme.dot}" stop-opacity="0.20"/>
    <stop offset="100%" stop-color="#${theme.dot}" stop-opacity="0"/>
  </radialGradient>
</defs>

  ${bgLayer}

  <!-- Top accent bar -->
  <rect width="${W}" height="8" fill="${theme.accent}"/>
  <rect y="8" width="${W}" height="2" fill="#ffffff" fill-opacity="0.15"/>

  <!-- BREAKING badge -->
  <rect x="40" y="24" width="320" height="58" rx="6" fill="${theme.badgeBg}"/>
  <circle cx="66" cy="53" r="9" fill="${theme.accent}"/>
  <circle cx="66" cy="53" r="4" fill="white"/>
  ${ogText(84, 62, ogEsc(theme.badge), { size: 22, fill: 'white', shadow: false, spacing: '2.5' })}

  <!-- Date -->
  ${ogText(W-44, 62, ogEsc(date), { size: 19, fill: '#ffffff', fillOpacity: '0.45', anchor: 'end', shadow: false, spacing: '0.5' })}

  <!-- Accent underline -->
  <rect x="40" y="100" width="240" height="5" rx="2" fill="${theme.accent}"/>

  <!-- HEADLINE -->
  ${headlineRows}

  <!-- LOCATION BANNER -->
  ${locBanner}

  <!-- BOTTOM BAR -->
  <rect x="0" y="${H-barH}" width="${W}" height="${barH}" fill="#000000" fill-opacity="0.92"/>
  <rect x="0" y="${H-barH}" width="${W}" height="4"       fill="${theme.accent}"/>
  <rect x="360" y="${H-barH+18}" width="1" height="${barH-36}" fill="#ffffff" fill-opacity="0.09"/>
  <rect x="720" y="${H-barH+18}" width="1" height="${barH-36}" fill="#ffffff" fill-opacity="0.09"/>

  <!-- SOURCE -->
  ${ogText(54, H-148, 'SOURCE',  { size:13, fill:theme.accent, shadow:false, spacing:'3', weight:'bold' })}
  ${ogText(54, H-104, ogEsc(source.substring(0,16)), { size:30, fill:'white', shadow:false, spacing:'0' })}
  ${ogText(54, H-68,  'VERIFIED REPORT', { size:13, fill:'#ffffff', fillOpacity:'0.35', shadow:false, spacing:'1', weight:'normal' })}

  <!-- CATEGORY -->
  ${ogText(380, H-148, 'CATEGORY',  { size:13, fill:theme.accent, shadow:false, spacing:'3', weight:'bold' })}
  ${ogText(380, H-104, ogEsc(theme.label), { size:30, fill:'white', shadow:false, spacing:'0' })}
  ${ogText(380, H-68,  'LIVE ALERT', { size:13, fill:'#ffffff', fillOpacity:'0.35', shadow:false, spacing:'1', weight:'normal' })}

  <!-- ORRERYX -->
  ${ogText(W-44, H-148, 'PLATFORM',    { size:13, fill:theme.accent, anchor:'end', shadow:false, spacing:'3', weight:'bold' })}
  ${ogText(W-44, H-100, 'ORRERYX',     { size:36, fill:'white', anchor:'end', shadow:false, spacing:'5' })}
  ${ogText(W-44, H-62,  'orreryx.io',  { size:14, fill:theme.accent, anchor:'end', shadow:false, spacing:'1.5', weight:'normal' })}

</svg>`;
}

// ── DALL-E 3: generate a photorealistic background for this news story ────────
async function generateDalleBackground(cat, loc) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;
  try {
    const promptFn = DALLE_PROMPTS[cat] || DALLE_PROMPTS.default;
    const prompt   = promptFn(loc || '');
    console.log('[OgImage] DALL-E prompt:', prompt.substring(0, 80));

    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method:  'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:           'dall-e-3',
        prompt,
        n:               1,
        size:            '1024x1024',
        quality:         'standard',
        response_format: 'url',
      }),
      signal: AbortSignal.timeout(28000), // DALL-E can take up to 20s
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      console.error('[OgImage] DALL-E API error:', err?.error?.message || r.status);
      return null;
    }

    const j      = await r.json();
    const imgUrl = j.data?.[0]?.url;
    if (!imgUrl) return null;

    // Download the generated image
    const ir = await fetch(imgUrl, { signal: AbortSignal.timeout(15000) });
    if (!ir.ok) return null;
    console.log('[OgImage] DALL-E image downloaded');
    return Buffer.from(await ir.arrayBuffer());
  } catch (e) {
    console.error('[OgImage] DALL-E failed:', e.message);
    return null;
  }
}

// ── Pexels fallback: curated photo by category ────────────────────────────────
async function fetchPexelsBackground(cat) {
  const pexelsKey = process.env.PEXELS_API_KEY;
  if (!pexelsKey) return null;
  try {
    const query = PEXELS_QUERIES[cat] || PEXELS_QUERIES.default;
    const pr    = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=square`,
      { headers: { Authorization: pexelsKey }, signal: AbortSignal.timeout(6000) }
    );
    if (!pr.ok) return null;
    const pj     = await pr.json();
    const photos = pj.photos || [];
    if (!photos.length) return null;
    const photo  = photos[Math.floor(Math.random() * Math.min(photos.length, 10))];
    const imgUrl = photo.src?.large2x || photo.src?.large || photo.src?.original;
    if (!imgUrl) return null;
    const ir = await fetch(imgUrl, { signal: AbortSignal.timeout(8000) });
    if (!ir.ok) return null;
    console.log('[OgImage] Pexels image downloaded');
    return Buffer.from(await ir.arrayBuffer());
  } catch (e) {
    console.error('[OgImage] Pexels failed:', e.message);
    return null;
  }
}

async function handleOgImage(req, res) {
  try {
    const q      = req.query || {};
    const title  = (q.title  || 'Breaking News').substring(0, 200).toUpperCase();
    const source = (q.source || 'Reuters').substring(0, 60);
    const cat    = ogDetectCategory(title, (q.cat || '').toLowerCase());
    const loc    = (q.loc   || '').substring(0, 50);
    const date   = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }).toUpperCase();

    // ── Priority 1: DALL-E 3 AI-generated photo (set OPENAI_API_KEY in Vercel) ─
    // ── Priority 2: Pexels curated photo       (set PEXELS_API_KEY in Vercel)  ─
    // ── Priority 3: Standalone dark SVG card   (always works, no API needed)   ─
    let bgBuffer = await generateDalleBackground(cat, loc);
    if (!bgBuffer) bgBuffer = await fetchPexelsBackground(cat);

    // Build SVG overlay (emoji-free — librsvg cannot render emoji glyphs)
    const svgStr = ogBuildOverlay({ title, source, cat, loc, date, hasPhoto: !!bgBuffer });
    const svgBuf = Buffer.from(svgStr);

    let pipeline;
    if (bgBuffer) {
      pipeline = sharp(bgBuffer)
        .resize(1080, 1080, { fit: 'cover', position: 'centre' })
        .composite([{ input: svgBuf }]);
    } else {
      pipeline = sharp(svgBuf).resize(1080, 1080);
    }

    const buffer = await pipeline.png({ compressionLevel: 8 }).toBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end(buffer);
  } catch (err) {
    console.error('[OgImage] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

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
  // Route og-image requests (merged from og-image.js)
  if ((req.url||'').split('?')[0].includes('og-image')) return handleOgImage(req, res);
  // Detect videos path — /api/videos routes here without type param
  const isVideosPath = (req.url||'').split('?')[0].endsWith('/videos');
  const type = isVideosPath ? 'videos' : (req.query.type||'quotes').toLowerCase();
  if (type==='videos') return handleVideos(req,res);
  return handleQuotes(req,res); // default: quotes
}

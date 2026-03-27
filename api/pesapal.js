// api/pesapal.js — Multi-currency Orrery payment handler
// Strategy: always charge USD (Pesapal auto-converts for mobile money).
// Expose ?action=rates to return live USD prices in any currency for display.

import Redis from 'ioredis';

const IS_LIVE = String(process.env.PESAPAL_ENV || '').toLowerCase() === 'live';
const BASE    = IS_LIVE ? 'https://pay.pesapal.com/v3' : 'https://cybqa.pesapal.com/pesapalv3';
const KEY     = process.env.PESAPAL_CONSUMER_KEY;
const SECRET  = process.env.PESAPAL_CONSUMER_SECRET;
const HOST    = (process.env.PESAPAL_HOST || 'https://www.orreryx.io').replace(/\/$/, '');
const SUCCESS_PATH   = process.env.PESAPAL_SUCCESS_PATH  || '/callback.html';
const SESSION_SECRET = process.env.SESSION_SECRET || 'orrery-change-me';

// Always charge USD — Pesapal converts to local currency automatically.
const PLAN_PRICES_USD = { s: 0.99, a: 14.99, c: 34.99 };
const PLAN_NAMES      = { s: 'Starter', a: 'Analyst', c: 'Command' };

// Fallback rates (1 USD = X currency) — used if live fetch fails
const FALLBACK_RATES = {
  USD:1, EUR:0.92, GBP:0.79, JPY:149.5, CAD:1.36, AUD:1.53, CHF:0.90,
  CNY:7.24, INR:83.1, MXN:17.2, BRL:4.97, KRW:1325, SGD:1.34, HKD:7.82,
  NOK:10.5, SEK:10.4, DKK:6.89, NZD:1.63, ZAR:18.6, AED:3.67, SAR:3.75,
  THB:35.1, MYR:4.72, IDR:15600, PHP:56.5, TRY:32.1, PLN:3.99, CZK:23.3,
  HUF:357, RON:4.59, UGX:3700, KES:128, TZS:2500, GHS:12.4, NGN:1580,
  ETB:56.7, RWF:1280, ZMW:26.3, MAD:10.0, EGP:30.9, DZD:134, QAR:3.64,
  KWD:0.307, BHD:0.377, OMR:0.385, JOD:0.709, ILS:3.70, PKR:278,
  BDT:110, LKR:305, NPR:133, ARS:875, CLP:950, COP:3960, PEN:3.72,
  XOF:603, XAF:603, MZN:63.8, BWP:13.6
};

// Symbol, name, decimal places per currency
const CURRENCY_META = {
  USD:{sym:'$',   name:'US Dollar',            dec:2}, EUR:{sym:'€',   name:'Euro',                 dec:2},
  GBP:{sym:'£',   name:'British Pound',         dec:2}, JPY:{sym:'¥',   name:'Japanese Yen',         dec:0},
  CAD:{sym:'CA$', name:'Canadian Dollar',       dec:2}, AUD:{sym:'A$',  name:'Australian Dollar',    dec:2},
  CHF:{sym:'Fr',  name:'Swiss Franc',           dec:2}, CNY:{sym:'¥',   name:'Chinese Yuan',         dec:2},
  INR:{sym:'₹',   name:'Indian Rupee',          dec:2}, MXN:{sym:'$',   name:'Mexican Peso',         dec:2},
  BRL:{sym:'R$',  name:'Brazilian Real',        dec:2}, KRW:{sym:'₩',   name:'South Korean Won',     dec:0},
  SGD:{sym:'S$',  name:'Singapore Dollar',      dec:2}, HKD:{sym:'HK$', name:'Hong Kong Dollar',     dec:2},
  NOK:{sym:'kr',  name:'Norwegian Krone',       dec:2}, SEK:{sym:'kr',  name:'Swedish Krona',        dec:2},
  DKK:{sym:'kr',  name:'Danish Krone',          dec:2}, NZD:{sym:'NZ$', name:'New Zealand Dollar',   dec:2},
  ZAR:{sym:'R',   name:'South African Rand',    dec:2}, AED:{sym:'د.إ', name:'UAE Dirham',           dec:2},
  SAR:{sym:'﷼',   name:'Saudi Riyal',           dec:2}, THB:{sym:'฿',   name:'Thai Baht',            dec:2},
  MYR:{sym:'RM',  name:'Malaysian Ringgit',     dec:2}, IDR:{sym:'Rp',  name:'Indonesian Rupiah',    dec:0},
  PHP:{sym:'₱',   name:'Philippine Peso',       dec:2}, TRY:{sym:'₺',   name:'Turkish Lira',         dec:2},
  PLN:{sym:'zł',  name:'Polish Zloty',          dec:2}, CZK:{sym:'Kč',  name:'Czech Koruna',         dec:2},
  HUF:{sym:'Ft',  name:'Hungarian Forint',      dec:0}, RON:{sym:'lei', name:'Romanian Leu',         dec:2},
  UGX:{sym:'USh', name:'Ugandan Shilling',      dec:0}, KES:{sym:'KSh', name:'Kenyan Shilling',      dec:2},
  TZS:{sym:'TSh', name:'Tanzanian Shilling',    dec:0}, GHS:{sym:'₵',   name:'Ghanaian Cedi',        dec:2},
  NGN:{sym:'₦',   name:'Nigerian Naira',        dec:2}, ETB:{sym:'Br',  name:'Ethiopian Birr',       dec:2},
  RWF:{sym:'Fr',  name:'Rwandan Franc',         dec:0}, ZMW:{sym:'ZK',  name:'Zambian Kwacha',       dec:2},
  MAD:{sym:'د.م.',name:'Moroccan Dirham',       dec:2}, EGP:{sym:'E£',  name:'Egyptian Pound',       dec:2},
  DZD:{sym:'دج',  name:'Algerian Dinar',        dec:2}, QAR:{sym:'ر.ق', name:'Qatari Riyal',         dec:2},
  KWD:{sym:'د.ك', name:'Kuwaiti Dinar',         dec:3}, BHD:{sym:'BD',  name:'Bahraini Dinar',       dec:3},
  OMR:{sym:'﷼',   name:'Omani Rial',            dec:3}, JOD:{sym:'JD',  name:'Jordanian Dinar',      dec:3},
  ILS:{sym:'₪',   name:'Israeli Shekel',        dec:2}, PKR:{sym:'₨',   name:'Pakistani Rupee',      dec:2},
  BDT:{sym:'৳',   name:'Bangladeshi Taka',      dec:2}, LKR:{sym:'₨',   name:'Sri Lankan Rupee',     dec:2},
  NPR:{sym:'₨',   name:'Nepalese Rupee',        dec:2}, ARS:{sym:'$',   name:'Argentine Peso',       dec:2},
  CLP:{sym:'$',   name:'Chilean Peso',          dec:0}, COP:{sym:'$',   name:'Colombian Peso',       dec:0},
  PEN:{sym:'S/',  name:'Peruvian Sol',          dec:2}, XOF:{sym:'Fr',  name:'West African CFA',     dec:0},
  XAF:{sym:'Fr',  name:'Central African CFA',   dec:0}, MZN:{sym:'MT',  name:'Mozambican Metical',   dec:2},
  BWP:{sym:'P',   name:'Botswanan Pula',        dec:2},
};

// ── REDIS ──
function getRedis() {
  const url = process.env.REDIS_URL || '';
  if (!url) return null;
  const opts = { maxRetriesPerRequest:2, connectTimeout:5000, enableReadyCheck:false, lazyConnect:true };
  if (url.startsWith('rediss://')) opts.tls = {};
  return new Redis(url, opts);
}
async function closeRedis(r) {
  if (!r) return;
  try { await Promise.race([r.quit(), new Promise(res => setTimeout(res, 1000))]); } catch (_) {}
}
async function saveOrder(redis, orderId, patch) {
  if (!redis) return;
  const key = `order:${orderId}`;
  let cur = {};
  try { const raw = await redis.get(key); if (raw) cur = JSON.parse(raw); } catch (_) {}
  await redis.set(key, JSON.stringify({ ...cur, ...patch, updatedAt: Date.now() }), 'EX', 60*60*24*400);
}

// ── PESAPAL TOKEN ──
let _token = null, _tokenExp = 0;
async function getToken() {
  if (_token && Date.now() < _tokenExp) return _token;
  const r = await fetch(`${BASE}/api/Auth/RequestToken`, {
    method:'POST', headers:{'Content-Type':'application/json', Accept:'application/json'},
    body: JSON.stringify({ consumer_key:KEY, consumer_secret:SECRET })
  });
  const d = await r.json();
  if (!r.ok || !d.token) throw new Error('Pesapal auth failed: ' + JSON.stringify(d));
  _token = d.token; _tokenExp = Date.now() + 4*60*60*1000;
  return _token;
}

// ── LIVE RATES ── (open.er-api.com — free, no key needed)
let _rates = null, _ratesExp = 0;
async function getLiveRates() {
  if (_rates && Date.now() < _ratesExp) return _rates;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const d = await r.json();
      if (d.rates) { _rates = d.rates; _ratesExp = Date.now() + 6*60*60*1000; return _rates; }
    }
  } catch (_) {}
  _rates = FALLBACK_RATES; _ratesExp = Date.now() + 30*60*1000;
  return _rates;
}

function convertAmount(usd, currency, rates) {
  const rate = rates[currency] || 1;
  const meta = CURRENCY_META[currency] || {dec:2};
  const val  = usd * rate;
  return meta.dec === 0 ? Math.round(val) : Number(val.toFixed(meta.dec));
}
function formatPrice(amount, currency) {
  const meta = CURRENCY_META[currency] || {sym:currency, dec:2};
  const s = meta.dec === 0
    ? amount.toLocaleString('en-US', {maximumFractionDigits:0})
    : amount.toFixed(meta.dec);
  return meta.sym + s;
}

// ── SANITIZERS ──
function normalizePlan(p) {
  const v = String(p||'').toLowerCase().trim();
  return v==='c'||v==='command' ? 'c' : v==='a'||v==='analyst' ? 'a' : 's';
}
function sanitizeOrderId(id, plan) {
  const c = String(id||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,50);
  return c || `orrery_${plan}_${Date.now()}`;
}
function sanitizePhone(p) {
  let s = String(p||'').replace(/[^\d+]/g,'');
  if (s && !s.startsWith('+')) s = '+'+s;
  return s || '+256700000000';
}
function sanitizeName(v, fallback) {
  return String(v||fallback).replace(/[^a-zA-Z\s'-]/g,'').trim() || fallback;
}
function sanitizeEmail(e) {
  return String(e||'').trim().toLowerCase() || 'customer@example.com';
}
function buildSuccessUrl(orderId, planCode) {
  return `${HOST}${SUCCESS_PATH}?orderId=${encodeURIComponent(orderId)}&plan=${encodeURIComponent(planCode)}&mode=${IS_LIVE?'live':'sandbox'}`;
}
function generateSessionToken(orderId, plan, email) {
  const s = [orderId,plan,email||'',SESSION_SECRET].join(':');
  let h = 0x811c9dc5;
  for (let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193);h>>>=0;}
  return h.toString(36)+Date.now().toString(36)+Math.random().toString(36).slice(2,9);
}
async function getOrRegisterIPN(token) {
  if (process.env.PESAPAL_IPN_ID) return process.env.PESAPAL_IPN_ID;
  const r = await fetch(`${BASE}/api/URLSetup/RegisterIPN`, {
    method:'POST',
    headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${token}`},
    body: JSON.stringify({ url:`${HOST}/api/ipn`, ipn_notification_type:'GET' })
  });
  const d = await r.json();
  if (!r.ok || !d.ipn_id) throw new Error('IPN registration failed: '+JSON.stringify(d));
  return d.ipn_id;
}

// ── HANDLER ──
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  res.setHeader('Cache-Control','no-store');
  if (req.method==='OPTIONS') return res.status(200).end();
  if (!KEY||!SECRET) return res.status(500).json({error:'Pesapal keys not configured'});

  const {action} = req.query;
  let redis;

  try {
    redis = getRedis();

    // ── rates: return prices in any currency ──
    if (action==='rates') {
      const currency = String(req.query.currency||'USD').toUpperCase();
      const rates    = await getLiveRates();
      const meta     = CURRENCY_META[currency] || {sym:currency,name:currency,dec:2};
      const prices   = {};
      for (const [plan, usd] of Object.entries(PLAN_PRICES_USD)) {
        const amount = convertAmount(usd, currency, rates);
        prices[plan] = { usd, amount, currency, formatted: formatPrice(amount,currency), symbol:meta.sym, name:meta.name };
      }
      return res.status(200).json({
        currency, symbol:meta.sym, name:meta.name, prices,
        note:'Charged in USD. Pesapal converts to local currency automatically.',
        source: _rates===FALLBACK_RATES ? 'fallback' : 'live'
      });
    }

    // ── currencies: list all supported display currencies ──
    if (action==='currencies') {
      const list = Object.entries(CURRENCY_META)
        .map(([code,m])=>({code,symbol:m.sym,name:m.name}))
        .sort((a,b)=>a.name.localeCompare(b.name));
      return res.status(200).json({currencies:list});
    }

    const token = await getToken();

    // ── create: submit order ──
    if (req.method==='POST' && action==='create') {
      const body      = req.body || {};
      const planCode  = normalizePlan(body.plan);
      const orderId   = sanitizeOrderId(body.orderId, planCode);
      const amount    = PLAN_PRICES_USD[planCode]; // always USD
      const firstName = sanitizeName(body.firstName,'Customer');
      const lastName  = sanitizeName(body.lastName, firstName);
      const ipnId     = await getOrRegisterIPN(token);

      const orderPayload = {
        id: orderId, currency:'USD', amount,
        description:`Orrery ${PLAN_NAMES[planCode]} Plan`,
        callback_url: buildSuccessUrl(orderId, planCode),
        notification_id: ipnId,
        billing_address:{
          email_address: sanitizeEmail(body.email),
          phone_number:  sanitizePhone(body.phone),
          first_name:    firstName,
          last_name:     lastName,
          country_code:  body.countryCode || 'UG'
        }
      };

      console.log('[Pesapal] Creating order:', JSON.stringify(orderPayload));
      const r = await fetch(`${BASE}/api/Transactions/SubmitOrderRequest`, {
        method:'POST',
        headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:`Bearer ${token}`},
        body: JSON.stringify(orderPayload)
      });
      const result = await r.json();
      console.log('[Pesapal] Response:', JSON.stringify(result));

      if (!r.ok || !result.redirect_url) {
        return res.status(400).json({error:result.error?.message||result.message||'Order creation failed', detail:result});
      }

      await saveOrder(redis, orderId, {
        orderId, plan:planCode, amount, currency:'USD',
        email:sanitizeEmail(body.email), phone:sanitizePhone(body.phone),
        env:IS_LIVE?'live':'sandbox', status:'pending', paid:false,
        merchantReference:result.merchant_reference||orderId,
        orderTrackingId:result.order_tracking_id||null,
        redirect_url:result.redirect_url, createdAt:Date.now()
      });

      return res.status(200).json({
        redirect_url:result.redirect_url,
        order_tracking_id:result.order_tracking_id||null,
        merchant_reference:result.merchant_reference||orderId,
        orderId, plan:planCode, env:IS_LIVE?'live':'sandbox'
      });
    }

    // ── status: check order ──
    if (req.method==='GET' && action==='status') {
      const trackingId = String(req.query.trackingId||'').trim();
      const orderId    = String(req.query.orderId||'').trim();
      if (!trackingId && !orderId) return res.status(400).json({error:'trackingId or orderId required'});

      let resolvedId = trackingId;
      if (!resolvedId && redis && orderId) {
        try { const raw=await redis.get(`order:${orderId}`); if(raw) resolvedId=JSON.parse(raw).orderTrackingId||''; } catch(_){}
      }
      if (!resolvedId) return res.status(404).json({error:'Tracking ID not found'});

      const r = await fetch(`${BASE}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(resolvedId)}`,
        {headers:{Accept:'application/json',Authorization:`Bearer ${token}`}});
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message||'Status lookup failed');

      const raw    = String(d.payment_status_description||d.status||'').toLowerCase();
      const paid   = /(completed|paid|captured|success)/.test(raw)||d.status_code===1;
      const failed = /(failed|invalid|declined|cancelled|reversed)/.test(raw);
      const status = paid?'paid':failed?'failed':'pending';

      if (redis && orderId) await saveOrder(redis, orderId, {status, paid, pesapalStatus:d});

      if (paid) {
        let stored = {};
        try { const raw2=await redis?.get(`order:${orderId}`); if(raw2) stored=JSON.parse(raw2); } catch(_){}
        const plan  = stored.plan || normalizePlan(orderId.split('_')[1]);
        const email = stored.email || '';
        const tok   = generateSessionToken(orderId, plan, email);
        return res.status(200).json({paid:true,status:'paid',plan,email,token:tok,expires:Date.now()+365*24*60*60*1000});
      }

      return res.status(200).json({paid:false, status, orderId});
    }

    return res.status(400).json({error:'Unknown action. Use: create, status, rates, currencies'});

  } catch (err) {
    console.error('[Pesapal] Error:', err.message);
    return res.status(500).json({error:err.message});
  } finally {
    await closeRedis(redis);
  }
}

export const config = { api: { bodyParser:true } };

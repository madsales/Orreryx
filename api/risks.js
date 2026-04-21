/**
 * api/risks.js — Orreryx Public Geopolitical Risk API
 * =====================================================
 * Free public API. No auth required. Static data, 1-hour cache.
 *
 * ENDPOINTS
 * ---------
 * GET /api/v1/risks
 *   Returns all conflict records.
 *   Query params:
 *     ?country=ukraine   — filter by country name (case-insensitive)
 *     ?type=nuclear      — filter by type: conflict | nuclear | economic | energy
 *
 * GET /api/v1/risks/summary
 *   Returns aggregate stats: total_conflicts, critical_count, avg_score, last_updated, countries
 *
 * RESPONSE HEADERS
 * ----------------
 *   Access-Control-Allow-Origin: *
 *   Cache-Control: public, max-age=3600
 *   X-Orreryx-Attribution: orreryx.io — Free Geopolitical Risk API
 *
 * ATTRIBUTION
 * -----------
 *   Orreryx Intelligence — https://www.orreryx.io
 *   Data is curated and updated by the Orreryx editorial team.
 */

const LAST_UPDATED = '2026-04-21';
const LAST_UPDATED_ISO = '2026-04-21T00:00:00Z';

// ── CONFLICT DATA ─────────────────────────────────────────────────────────────

const CONFLICTS = [
  { id:'ukraine-russia', name:'Russia-Ukraine War', type:'conflict', status:'deteriorating', risk_score:94, trend:'up', countries:['Ukraine','Russia'], region:'Europe', casualties_estimate:'500000+', started:'2022-02-24', last_updated:LAST_UPDATED, market_impact:{natural_gas:'high',wheat:'high',gold:'moderate',defence_stocks:'high'}, summary:'Full-scale invasion ongoing. Spring offensive underway. NATO logistics active.', orreryx_url:'https://www.orreryx.io/russia-ukraine-war' },
  { id:'israel-gaza', name:'Israel-Gaza War', type:'conflict', status:'deteriorating', risk_score:91, trend:'stable', countries:['Israel','Palestine'], region:'Middle East', casualties_estimate:'40000+', started:'2023-10-07', last_updated:LAST_UPDATED, market_impact:{oil:'moderate',gold:'high',defence_stocks:'moderate'}, summary:'Ground operations ongoing in Rafah. Humanitarian corridors contested.', orreryx_url:'https://www.orreryx.io/israel-gaza' },
  { id:'india-pakistan', name:'India-Pakistan Tensions', type:'conflict', status:'volatile', risk_score:88, trend:'up', countries:['India','Pakistan'], region:'South Asia', casualties_estimate:'disputed', started:'1947-08-14', last_updated:LAST_UPDATED, market_impact:{gold:'high',oil:'moderate',emerging_markets:'high'}, summary:'LoC violations at 2-year high. Both sides mobilising reserves.', orreryx_url:'https://www.orreryx.io/india-pakistan' },
  { id:'iran-nuclear', name:'Iran Nuclear Crisis', type:'nuclear', status:'volatile', risk_score:84, trend:'stable', countries:['Iran','Israel','USA'], region:'Middle East', casualties_estimate:'N/A', started:'2002-01-01', last_updated:LAST_UPDATED, market_impact:{oil:'critical',gold:'high',defence_stocks:'high'}, summary:'Enrichment at 60%. IAEA access restricted. Strike window analysis active.', orreryx_url:'https://www.orreryx.io/iran-nuclear' },
  { id:'middle-east-regional', name:'Middle East Regional War Risk', type:'conflict', status:'deteriorating', risk_score:82, trend:'up', countries:['Iran','Israel','Lebanon','Yemen','Syria'], region:'Middle East', casualties_estimate:'100000+', started:'2023-10-07', last_updated:LAST_UPDATED, market_impact:{oil:'critical',gold:'high',shipping:'high'}, summary:'Multi-front escalation risk. Hezbollah, Houthi, IRGC proxy coordination increasing.', orreryx_url:'https://www.orreryx.io/middle-east-war' },
  { id:'iran-country', name:'Iran Political Risk', type:'economic', status:'volatile', risk_score:84, trend:'stable', countries:['Iran'], region:'Middle East', casualties_estimate:'N/A', started:'1979-02-11', last_updated:LAST_UPDATED, market_impact:{oil:'high',gold:'moderate'}, summary:'Sanctions pressure, IRGC dominance, succession uncertainty.', orreryx_url:'https://www.orreryx.io/iran-nuclear' },
  { id:'russia-nato', name:'Russia-NATO Escalation Risk', type:'nuclear', status:'volatile', risk_score:79, trend:'up', countries:['Russia','NATO'], region:'Europe', casualties_estimate:'N/A', started:'2022-02-24', last_updated:LAST_UPDATED, market_impact:{natural_gas:'high',defence_stocks:'high',gold:'high'}, summary:'Nuclear signalling intensifying. Article 5 red lines being tested.', orreryx_url:'https://www.orreryx.io/nuclear-war-risk' },
  { id:'china-taiwan', name:'China-Taiwan Strait Crisis', type:'conflict', status:'volatile', risk_score:74, trend:'up', countries:['China','Taiwan','USA'], region:'Asia-Pacific', casualties_estimate:'N/A', started:'1949-12-07', last_updated:LAST_UPDATED, market_impact:{semiconductors:'critical',gold:'high',shipping:'high'}, summary:'PLA air incursions increasing. Naval exercises near ADIZ monthly.', orreryx_url:'https://www.orreryx.io/china-taiwan-war' },
  { id:'south-china-sea', name:'South China Sea Dispute', type:'conflict', status:'volatile', risk_score:76, trend:'up', countries:['China','Philippines','Vietnam','USA'], region:'Asia-Pacific', casualties_estimate:'disputed', started:'1974-01-19', last_updated:LAST_UPDATED, market_impact:{shipping:'high',oil:'moderate',semiconductors:'moderate'}, summary:'Philippines confrontations at Second Thomas Shoal escalating. US treaty obligations tested.', orreryx_url:'https://www.orreryx.io/south-china-sea' },
  { id:'north-korea', name:'North Korea Missile Crisis', type:'nuclear', status:'volatile', risk_score:76, trend:'stable', countries:['North Korea','South Korea','USA','Japan'], region:'Asia-Pacific', casualties_estimate:'N/A', started:'2006-10-09', last_updated:LAST_UPDATED, market_impact:{jpy:'high',south_korea_equities:'moderate',defence_stocks:'high'}, summary:'ICBM tests continuing. Russia arms deal providing revenue and tech exchange.', orreryx_url:'https://www.orreryx.io/north-korea' },
  { id:'sudan-war', name:'Sudan Civil War', type:'conflict', status:'deteriorating', risk_score:68, trend:'stable', countries:['Sudan'], region:'Africa', casualties_estimate:'150000+', started:'2023-04-15', last_updated:LAST_UPDATED, market_impact:{wheat:'moderate',gold:'low',emerging_markets:'low'}, summary:"RSF vs SAF conflict. World's largest displacement crisis. Aid access blocked.", orreryx_url:'https://www.orreryx.io/sudan-war' },
  { id:'europe-energy', name:'Europe Energy Crisis', type:'energy', status:'volatile', risk_score:65, trend:'stable', countries:['EU','Russia','Norway'], region:'Europe', casualties_estimate:'N/A', started:'2022-02-24', last_updated:LAST_UPDATED, market_impact:{natural_gas:'critical',eur:'high',inflation:'high'}, summary:'LNG import dependency. Storage below 5-year average. Winter risk window returning.', orreryx_url:'https://www.orreryx.io/europe-energy-crisis' },
  { id:'myanmar', name:'Myanmar Civil War', type:'conflict', status:'deteriorating', risk_score:65, trend:'up', countries:['Myanmar'], region:'Asia-Pacific', casualties_estimate:'50000+', started:'2021-02-01', last_updated:LAST_UPDATED, market_impact:{emerging_markets:'low',gold:'low'}, summary:'Resistance forces controlling 60% of territory. Junta supply lines disrupted.', orreryx_url:'https://www.orreryx.io/global-conflicts-2025' },
  { id:'ww3-risk', name:'World War III Risk Index', type:'nuclear', status:'elevated', risk_score:61, trend:'up', countries:['Global'], region:'Global', casualties_estimate:'N/A', started:'2024-01-01', last_updated:LAST_UPDATED, market_impact:{gold:'critical',oil:'high',defence_stocks:'critical'}, summary:'Doomsday Clock at 89 seconds. Multiple nuclear-armed states in active conflict adjacency.', orreryx_url:'https://www.orreryx.io/ww3-news' },
  { id:'doomsday-clock', name:'Doomsday Clock', type:'nuclear', status:'critical', risk_score:89, trend:'stable', countries:['Global'], region:'Global', casualties_estimate:'N/A', started:'1947-01-01', last_updated:LAST_UPDATED, market_impact:{gold:'high',defence_stocks:'moderate'}, summary:'At 89 seconds to midnight — closest to midnight in 77-year history. Set January 2025.', orreryx_url:'https://www.orreryx.io/doomsday-clock' },
];

// ── COUNTRY RISK DATA ─────────────────────────────────────────────────────────

const COUNTRIES = [
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

// ── HELPERS ───────────────────────────────────────────────────────────────────

function setCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('X-Orreryx-Attribution', 'orreryx.io — Free Geopolitical Risk API');
}

function wrapResponse(data) {
  return {
    version: '1.0',
    updated: LAST_UPDATED_ISO,
    attribution: 'Orreryx Intelligence — orreryx.io',
    data,
  };
}

function buildSummary() {
  const scores = CONFLICTS.map(c => c.risk_score);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const critical = CONFLICTS.filter(c => c.risk_score >= 80).length;
  return {
    total_conflicts: CONFLICTS.length,
    critical_count: critical,
    avg_score: avg,
    last_updated: LAST_UPDATED_ISO,
    countries: COUNTRIES.length,
  };
}

// ── MAIN HANDLER ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  setCORSHeaders(res);

  // Handle preflight
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Only GET is supported
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' });
  }

  const { url } = req;
  const { country, type } = req.query || {};

  // /api/v1/risks/summary
  if (url && url.includes('/summary')) {
    return res.status(200).json({
      version: '1.0',
      updated: LAST_UPDATED_ISO,
      attribution: 'Orreryx Intelligence — orreryx.io',
      ...buildSummary(),
    });
  }

  // /api/v1/risks — with optional filters
  let results = [...CONFLICTS];

  if (country) {
    const q = country.toLowerCase();
    results = results.filter(c =>
      c.countries.some(name => name.toLowerCase().includes(q))
    );
  }

  if (type) {
    const q = type.toLowerCase();
    results = results.filter(c => c.type.toLowerCase() === q);
  }

  return res.status(200).json(wrapResponse(results));
}

export const config = { api: { bodyParser: false } };

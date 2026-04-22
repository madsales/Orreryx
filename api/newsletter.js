// api/newsletter.js — Email capture + drip sequence + daily digest + push broadcast
// POST { email, source }                  → subscribe + schedule drip sequence
// POST { action:'process_drip', token }   → cron: send due drip emails
// POST { action:'daily_digest', token }   → cron: broadcast daily digest to all subscribers
// POST { action:'push_broadcast', token } → cron: send push notification to all subscribers
// POST { action:'stats', token }          → return subscriber stats

const R_URL   = process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const RESEND_KEY = process.env.RESEND_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET || 'orrery-cron-2026';
const FROM    = process.env.EMAIL_FROM || 'Orrery Intel <onboarding@resend.dev>';
const HOST    = (process.env.APP_HOST || process.env.PESAPAL_HOST || 'https://www.orreryx.io').replace(/\/$/, '');

async function redis(...cmd) {
  if (!R_URL || !R_TOKEN) return null;
  const r = await fetch(R_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  return (await r.json()).result;
}

async function sendEmail(to, subject, html) {
  if (!RESEND_KEY) return false;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  }).catch(e => { console.error('[NL] email err:', e.message); return null; });
  return res?.ok;
}

// ── DRIP EMAIL TEMPLATES ─────────────────────────────────────────────────────
function emailTemplates(email) {
  const unsub = `${HOST}/unsubscribe?email=${encodeURIComponent(email)}`;
  const footer = `<div style="margin-top:32px;padding-top:20px;border-top:1px solid rgba(255,255,255,.08);font-size:11px;color:#484844">© 2026 Orrery · <a href="${HOST}" style="color:#484844">orreryx.io</a> · <a href="${unsub}" style="color:#484844">Unsubscribe</a></div>`;
  const wrap = (content) => `<div style="background:#09090b;color:#f0f0ec;padding:40px;max-width:520px;margin:0 auto;border:1px solid rgba(255,255,255,.1);border-radius:8px;font-family:'Helvetica Neue',sans-serif"><div style="margin-bottom:24px;font-size:16px;font-weight:800">⊕ Orrery</div>${content}${footer}</div>`;

  return {
    // Day 0 — Welcome (sent immediately on signup)
    welcome: {
      subject: 'Welcome to Orrery Intel — Your geopolitical edge starts now',
      html: wrap(`
        <div style="font-size:22px;font-weight:800;margin-bottom:12px">Your briefings start now.</div>
        <div style="font-size:14px;color:#a0a09a;line-height:1.8;margin-bottom:24px">
          You're now tracking what <strong style="color:#f0f0ec">hedge funds, diplomats, and journalists</strong> watch every morning:<br><br>
          🔴 <strong style="color:#f0f0ec">56 active conflicts</strong> — updated every 5 minutes<br>
          📊 <strong style="color:#f0f0ec">Geopolitical risk scores</strong> — for 180+ countries<br>
          💰 <strong style="color:#f0f0ec">Market impact</strong> — gold, oil, and defence stocks vs. risk events<br>
          ☢️ <strong style="color:#f0f0ec">Doomsday Clock</strong> — at 89 seconds, the most dangerous reading ever
        </div>
        <a href="${HOST}/login?plan=f" style="display:block;background:#e03836;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:4px;font-weight:700;font-size:14px;margin-bottom:16px">ACTIVATE FREE 3-DAY TRIAL →</a>
        <div style="font-size:12px;color:#484844;text-align:center">No credit card. Cancel anytime. Access everything.</div>
      `)
    },

    // Day 1 — Value delivery
    day1: {
      subject: 'The 3 conflicts moving markets right now (and what to watch)',
      html: wrap(`
        <div style="font-size:20px;font-weight:800;margin-bottom:12px">3 Conflicts Moving Markets This Week</div>
        <div style="font-size:13px;color:#a0a09a;margin-bottom:24px">You subscribed to Orrery yesterday. Here's the intelligence briefing you asked for.</div>
        <div style="background:rgba(244,67,54,.08);border-left:3px solid #e03836;padding:16px;margin-bottom:16px;border-radius:0 8px 8px 0">
          <div style="font-size:12px;color:#e03836;font-weight:700;margin-bottom:6px">🔴 UKRAINE — RISK 94/100</div>
          <div style="font-size:13px;color:#c0c0b8;line-height:1.7">Spring offensive underway. NATO supplies crossing into Poland. <strong style="color:#f0f0ec">Watch: Natural gas prices, European defence stocks (Rheinmetall, Leonardo).</strong></div>
        </div>
        <div style="background:rgba(244,67,54,.08);border-left:3px solid #e03836;padding:16px;margin-bottom:16px;border-radius:0 8px 8px 0">
          <div style="font-size:12px;color:#e03836;font-weight:700;margin-bottom:6px">🔴 INDIA-PAKISTAN — RISK 88/100</div>
          <div style="font-size:13px;color:#c0c0b8;line-height:1.7">LoC violations at 2-year high. Both sides mobilising. <strong style="color:#f0f0ec">Watch: Gold (+8% in similar past escalations), oil (regional supply risk), Indian equities (NIFTY).</strong></div>
        </div>
        <div style="background:rgba(244,67,54,.08);border-left:3px solid #ff9800;padding:16px;margin-bottom:24px;border-radius:0 8px 8px 0">
          <div style="font-size:12px;color:#ff9800;font-weight:700;margin-bottom:6px">🟠 SOUTH CHINA SEA — RISK 76/100</div>
          <div style="font-size:13px;color:#c0c0b8;line-height:1.7">China-Philippines standoff intensifying near Second Thomas Shoal. <strong style="color:#f0f0ec">Watch: Taiwan ETF (EWT), semiconductor stocks (TSMC), shipping indices.</strong></div>
        </div>
        <div style="background:rgba(58,184,96,.07);border:1px solid rgba(58,184,96,.2);border-radius:8px;padding:16px;margin-bottom:16px">
          <div style="font-size:11px;font-weight:700;color:#3ab860;margin-bottom:8px">⚡ COMMAND EXCLUSIVE — Interactive Risk Map</div>
          <div style="font-size:12px;color:#c0c0b8;line-height:1.65;margin-bottom:12px">13 live conflict zones on an interactive world map. Click any hotspot → see risk score, market impact (oil, gold, defence, FX), and full country analysis. The kind of tool Bloomberg charges $2,400/mo for.</div>
          <a href="${HOST}/map" style="display:block;background:#3ab860;color:#000;text-decoration:none;text-align:center;padding:11px;border-radius:4px;font-weight:800;font-size:12px">🗺️ See the Risk Map — Command $34.99/mo →</a>
        </div>
        <a href="${HOST}/login?plan=f" style="display:block;background:#e03836;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:4px;font-weight:700;font-size:14px">Track These Live — Free Trial →</a>
      `)
    },

    // Day 3 — Social proof + use case
    day3: {
      subject: 'How a London macro fund uses Orrery (3-minute read)',
      html: wrap(`
        <div style="font-size:20px;font-weight:800;margin-bottom:12px">How Professional Traders Use Geopolitical Intelligence</div>
        <div style="font-size:13px;color:#a0a09a;margin-bottom:20px">You signed up to Orrery Intel 3 days ago. Here's how our most active users make money with it.</div>
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:20px;margin-bottom:20px">
          <div style="font-size:12px;color:#9e9e9e;margin-bottom:8px">TYPICAL USE CASE — MACRO FUND</div>
          <div style="font-size:13px;color:#c0c0b8;line-height:1.8">
            <strong style="color:#f0f0ec">6:45am:</strong> Check Orrery dashboard. Iran risk score jumped from 72 → 87 overnight.<br>
            <strong style="color:#f0f0ec">6:50am:</strong> Cross-reference oil price. Brent hasn't moved yet — still pricing old risk.<br>
            <strong style="color:#f0f0ec">7:00am:</strong> Buy WTI crude calls before London open.<br>
            <strong style="color:#f0f0ec">10:30am:</strong> Iran escalation confirmed. Oil +$4.80/barrel. Position up 340%.
          </div>
        </div>
        <div style="font-size:13px;color:#a0a09a;line-height:1.7;margin-bottom:24px">
          <strong style="color:#f0f0ec">The edge is simple:</strong> markets price geopolitical risk slowly. Events happen, then analysts write about them, then traders react. Orrery puts the events in your hands at 6:45am, not 9am.<br><br>
          The same applies to gold, defence stocks, emerging market currencies, and shipping rates. Every active conflict we track is a potential market signal.
        </div>
        <a href="${HOST}/login?plan=f" style="display:block;background:#e03836;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:4px;font-weight:700;font-size:14px">Get the Same Edge — Start Free Trial →</a>
      `)
    },

    // Day 7 — Deep value + upgrade push
    day7: {
      subject: 'One week of Orrery Intel — here\'s what you\'ve been missing',
      html: wrap(`
        <div style="font-size:20px;font-weight:800;margin-bottom:12px">A Week of Intelligence You Could Have Had</div>
        <div style="font-size:13px;color:#a0a09a;margin-bottom:20px">It's been 7 days since you joined Orrery Intel. Here's what paid subscribers tracked this week:</div>
        <div style="margin-bottom:20px">
          ${['India-Pakistan LoC escalation → GOLD +2.3%, NIFTY -1.8%','South China Sea incident → TSMC -3.1%, EWT hedge fund outflows','EU energy storage below 5-year average → TTF gas spike (+18%)','North Korea ICBM test → JPY surge (safe-haven flow)','DRC copper mine shutdown → LME copper +4.2%'].map(item=>`<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)"><span style="color:#e03836;font-size:11px;margin-top:2px">▶</span><span style="font-size:13px;color:#c0c0b8">${item}</span></div>`).join('')}
        </div>
        <div style="background:rgba(56,188,120,.08);border:1px solid rgba(56,188,120,.2);border-radius:8px;padding:20px;margin-bottom:20px;text-align:center">
          <div style="font-size:14px;font-weight:700;color:#38bc78;margin-bottom:8px">🎁 Special offer — expires in 48 hours</div>
          <div style="font-size:13px;color:#a0a09a;margin-bottom:16px">Start your free 3-day trial. No card required. Access everything.</div>
          <a href="${HOST}/login?plan=f" style="display:inline-block;background:#38bc78;color:#000;text-decoration:none;padding:14px 32px;border-radius:4px;font-weight:700;font-size:14px">CLAIM FREE TRIAL →</a>
        </div>
        <div style="font-size:12px;color:#484844;text-align:center">3 days free · Full access · Cancel anytime · No card needed</div>
      `)
    },

    // Day 14 — Enterprise offer for high-value leads
    day14: {
      subject: 'Are you a professional? Orrery has a different offer for you.',
      html: wrap(`
        <div style="font-size:20px;font-weight:800;margin-bottom:12px">Orrery for Professionals & Teams</div>
        <div style="font-size:13px;color:#a0a09a;margin-bottom:20px">You've been reading Orrery Intel for 2 weeks. If you're a professional, there's a version built specifically for you.</div>
        <div style="margin-bottom:20px">
          <div style="font-size:12px;color:#9e9e9e;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">Who uses Orrery Enterprise</div>
          ${[['🏦','Hedge Funds & Asset Managers','Systematic geopolitical risk overlays for quant strategies'],['🏢','Corporations & Multinationals','Country risk monitoring for operational and supply chain decisions'],['🏛️','Government & Think Tanks','Real-time conflict intelligence for policy and strategic analysis'],['📰','Media & Research','Background intelligence database for journalists and analysts']].map(([icon,title,desc])=>`<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.06)"><span style="font-size:20px">${icon}</span><div><div style="font-size:13px;font-weight:600;color:#f0f0ec">${title}</div><div style="font-size:12px;color:#9e9e9e">${desc}</div></div></div>`).join('')}
        </div>
        <div style="background:rgba(244,67,54,.08);border:1px solid rgba(244,67,54,.2);border-radius:8px;padding:20px;margin-bottom:20px">
          <div style="font-size:13px;color:#c0c0b8;line-height:1.7"><strong style="color:#f0f0ec">Enterprise includes:</strong> API access, custom country watchlists, team seats (up to 25 users), Slack/Teams integration, weekly briefing calls, and custom risk modeling. Starting at $499/month.</div>
        </div>
        <a href="${HOST}/enterprise" style="display:block;background:#e03836;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:4px;font-weight:700;font-size:14px;margin-bottom:12px">Request Enterprise Demo →</a>
        <a href="${HOST}/login?plan=f" style="display:block;background:rgba(255,255,255,.06);color:#f0f0ec;text-decoration:none;text-align:center;padding:12px;border-radius:4px;font-size:13px;border:1px solid rgba(255,255,255,.1)">Or start with a free individual trial →</a>
      `)
    },

    // Day 30 — Re-engagement
    day30: {
      subject: 'The world got more dangerous since you joined. Here\'s what changed.',
      html: wrap(`
        <div style="font-size:20px;font-weight:800;margin-bottom:12px">30 Days of Escalation</div>
        <div style="font-size:13px;color:#a0a09a;margin-bottom:20px">You joined Orrery Intel a month ago. The geopolitical landscape has shifted significantly. Here's what's changed:</div>
        <div style="background:rgba(244,67,54,.08);border-radius:8px;padding:20px;margin-bottom:20px">
          <div style="font-size:13px;color:#c0c0b8;line-height:1.9">
            📈 <strong style="color:#f0f0ec">Gold:</strong> Up 12% as safe-haven demand surges<br>
            📈 <strong style="color:#f0f0ec">Defense stocks:</strong> LMT +18%, RTX +14%, Rheinmetall +31%<br>
            📉 <strong style="color:#f0f0ec">Risk assets:</strong> EM equities -8% on geopolitical premium expansion<br>
            🔴 <strong style="color:#f0f0ec">New conflicts:</strong> 3 new flashpoints added to Orrery tracker<br>
            ⬆️ <strong style="color:#f0f0ec">Average risk score:</strong> +6 points across all 56 active conflicts
          </div>
        </div>
        <div style="font-size:13px;color:#a0a09a;margin-bottom:24px">If you're not tracking this in real time, you're navigating with old maps. The world doesn't wait.</div>
        <a href="${HOST}/login?plan=f" style="display:block;background:#e03836;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:4px;font-weight:700;font-size:14px;margin-bottom:12px">Start Tracking Now — Still Free →</a>
        <div style="font-size:12px;color:#484844;text-align:center">3-day free trial · No card · Full access</div>
      `)
    },
  };
}

// ── SCHEDULE DRIP EMAILS IN REDIS ────────────────────────────────────────────
async function scheduleDrip(email, signupTs) {
  const DAY = 24 * 60 * 60 * 1000;
  const schedule = [
    { day: 1,  ts: signupTs + 1  * DAY },
    { day: 3,  ts: signupTs + 3  * DAY },
    { day: 7,  ts: signupTs + 7  * DAY },
    { day: 14, ts: signupTs + 14 * DAY },
    { day: 30, ts: signupTs + 30 * DAY },
  ];
  for (const { day, ts } of schedule) {
    const member = JSON.stringify({ email, day });
    await redis('ZADD', 'drip:queue', ts, member);
  }
}

// ── PROCESS DUE DRIP EMAILS ───────────────────────────────────────────────────
async function processDrip() {
  const now = Date.now();
  const due = await redis('ZRANGEBYSCORE', 'drip:queue', 0, now, 'LIMIT', 0, 50);
  if (!due || !due.length) return { processed: 0, sent: 0 };

  const templates_map = { 1:'day1', 3:'day3', 7:'day7', 14:'day14', 30:'day30' };
  let sent = 0;

  for (const member of due) {
    try {
      const { email, day } = JSON.parse(member);
      // Get subscriber data to make sure still subscribed
      const subData = await redis('GET', `newsletter:${email.toLowerCase().trim()}`);
      if (!subData) {
        await redis('ZREM', 'drip:queue', member);
        continue;
      }
      const sub = JSON.parse(subData);
      if (sub.unsubscribed) {
        await redis('ZREM', 'drip:queue', member);
        continue;
      }
      // Get email template
      const templateKey = templates_map[day];
      if (!templateKey) { await redis('ZREM', 'drip:queue', member); continue; }
      const tpl = emailTemplates(email)[templateKey];
      // Send email
      const ok = await sendEmail(email, tpl.subject, tpl.html);
      if (ok) {
        sent++;
        // Mark as sent in subscriber record
        const updated = { ...sub, [`drip_day${day}_sent`]: Date.now() };
        await redis('SET', `newsletter:${email.toLowerCase().trim()}`, JSON.stringify(updated));
      }
      // Remove from queue regardless (don't retry on fail to avoid spam)
      await redis('ZREM', 'drip:queue', member);
    } catch (e) {
      console.error('[Drip] error processing member:', e.message);
      await redis('ZREM', 'drip:queue', member);
    }
  }
  return { processed: due.length, sent };
}

// ── DAILY DIGEST — top 5 risk signals, broadcast to all active subscribers ────
const DAILY_RISKS = [
  { score:94, flag:'🇺🇦', label:'Ukraine–Russia', note:'Spring offensive. NATO corridor activity elevated.' },
  { score:88, flag:'🇮🇳', label:'India–Pakistan', note:'LoC violations at 2-year high. Mobilisation confirmed.' },
  { score:84, flag:'🇮🇷', label:'Iran Nuclear', note:'Enrichment at 60%. IAEA access restricted.' },
  { score:82, flag:'🌍', label:'Middle East Multi-Front', note:'Hezbollah, Houthis, IRGC coordination increasing.' },
  { score:76, flag:'🇰🇵', label:'North Korea', note:'ICBM test cycle ongoing. Russia arms deal active.' },
];

function dailyDigestHtml(date) {
  const unsub = `${HOST}/unsubscribe`;
  const dateStr = new Date(date).toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const rows = DAILY_RISKS.map(r => {
    const color = r.score >= 85 ? '#e03836' : r.score >= 70 ? '#f59e0b' : '#10b981';
    return `<tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:20px">${r.flag}</td><td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.06)"><div style="font-size:13px;font-weight:700;color:#f0f0ec">${r.label}</div><div style="font-size:12px;color:#9e9e9e">${r.note}</div></td><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06);text-align:right"><span style="background:${color}20;color:${color};border:1px solid ${color}40;border-radius:4px;padding:3px 8px;font-size:12px;font-weight:700">${r.score}</span></td></tr>`;
  }).join('');
  return `<div style="background:#09090b;color:#f0f0ec;padding:40px;max-width:520px;margin:0 auto;border:1px solid rgba(255,255,255,.1);border-radius:8px;font-family:'Helvetica Neue',sans-serif">
    <div style="margin-bottom:20px;font-size:16px;font-weight:800">⊕ Orrery</div>
    <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Daily Risk Briefing · ${dateStr}</div>
    <div style="font-size:20px;font-weight:800;margin-bottom:20px">Top 5 Risk Signals Today</div>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <div style="margin-top:24px">
      <a href="${HOST}/risk-dashboard" style="display:block;background:#e03836;color:#fff;text-decoration:none;text-align:center;padding:13px;border-radius:4px;font-weight:700;font-size:14px;margin-bottom:12px">View Full Risk Dashboard →</a>
      <a href="${HOST}/gold-price" style="display:inline-block;background:rgba(245,158,11,.1);color:#f59e0b;text-decoration:none;padding:8px 14px;border-radius:4px;font-size:12px;margin-right:8px">Gold Price</a>
      <a href="${HOST}/oil-price" style="display:inline-block;background:rgba(245,158,11,.1);color:#f59e0b;text-decoration:none;padding:8px 14px;border-radius:4px;font-size:12px;margin-right:8px">Oil Price</a>
      <a href="${HOST}/geopolitics-news" style="display:inline-block;background:rgba(245,158,11,.1);color:#f59e0b;text-decoration:none;padding:8px 14px;border-radius:4px;font-size:12px">Latest News</a>
    </div>
    <div style="margin-top:28px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);font-size:11px;color:#484844">© 2026 Orrery Intelligence · <a href="${HOST}" style="color:#484844">orreryx.io</a> · <a href="${unsub}" style="color:#484844">Unsubscribe</a></div>
  </div>`;
}

async function broadcastDailyDigest() {
  // Scan all newsletter:* keys and send to active subscribers (batch of 100)
  let cursor = 0, sent = 0, skipped = 0;
  const today = new Date().toISOString().split('T')[0];
  const digestHtml = dailyDigestHtml(Date.now());
  const subject = `☢ Daily Risk Brief — ${new Date().toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })}`;

  do {
    const result = await redis('SCAN', cursor, 'MATCH', 'newsletter:*@*', 'COUNT', 100);
    if (!result) break;
    [cursor, ...[]]; // satisfy linter
    const [nextCursor, keys] = result;
    cursor = parseInt(nextCursor) || 0;
    if (!keys || !keys.length) break;

    for (const key of keys) {
      try {
        const raw = await redis('GET', key);
        if (!raw) continue;
        const sub = JSON.parse(raw);
        if (sub.unsubscribed) { skipped++; continue; }
        // Avoid re-sending same day
        if (sub.last_digest === today) { skipped++; continue; }
        const ok = await sendEmail(sub.email, subject, digestHtml);
        if (ok) {
          sent++;
          await redis('SET', key, JSON.stringify({ ...sub, last_digest: today }));
        }
      } catch (e) { /* skip bad records */ }
    }
  } while (cursor !== 0);

  return { sent, skipped };
}

// ── PUSH NOTIFICATION BROADCAST ───────────────────────────────────────────────
async function broadcastPush() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return { ok: false, reason: 'VAPID keys not configured' };
  }

  // Dynamic import — web-push is CJS, works fine in ESM context
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails(
    'mailto:alerts@orreryx.io',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const today   = new Date().toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
  const payload = JSON.stringify({
    title: `☢ Orrery Risk Brief — ${today}`,
    body:  'Top geopolitical risk signals updated. Tap to view.',
    icon:  '/icon-192.png',
    badge: '/badge-72.png',
    url:   `${HOST}/risk-dashboard`,
  });

  let cursor = 0, sent = 0, removed = 0;
  do {
    const result = await redis('SCAN', cursor, 'MATCH', 'push:*', 'COUNT', 100);
    if (!result) break;
    const [nextCursor, keys] = result;
    cursor = parseInt(nextCursor) || 0;
    if (!keys || !keys.length) break;

    for (const key of keys) {
      try {
        const raw = await redis('GET', key);
        if (!raw) continue;
        const sub = JSON.parse(raw);
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (e) {
        // 410 Gone / 404 Not Found = subscription expired, clean up
        if (e.statusCode === 410 || e.statusCode === 404) {
          await redis('DEL', key);
          removed++;
        }
        // Other errors: skip silently (don't remove — could be transient)
      }
    }
  } while (cursor !== 0);

  return { sent, removed };
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: unsubscribe via magic link ─────────────────────────────────────
  if (req.method === 'GET') {
    const { action, email } = req.query || {};
    if (action === 'unsubscribe' && email) {
      try {
        const key = `newsletter:${email.toLowerCase().trim()}`;
        const existing = await redis('GET', key);
        if (existing) {
          const sub = JSON.parse(existing);
          await redis('SET', key, JSON.stringify({ ...sub, unsubscribed: true, unsubscribed_at: Date.now() }));
          await redis('DECR', 'newsletter:count');
        }
        // Redirect to unsubscribe confirmation page
        res.setHeader('Location', '/unsubscribe?done=1');
        return res.status(302).end();
      } catch (e) {
        res.setHeader('Location', '/unsubscribe?done=1');
        return res.status(302).end();
      }
    }
    return res.status(405).end();
  }

  if (req.method !== 'POST') return res.status(405).end();

  const body = req.body || {};

  // ── Cron actions (requires CRON_SECRET) ─────────────────────────────────
  if (body.action === 'process_drip') {
    if (body.token !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    const result = await processDrip();
    return res.status(200).json({ ok: true, ...result });
  }

  if (body.action === 'daily_digest') {
    if (body.token !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    const result = await broadcastDailyDigest();
    return res.status(200).json({ ok: true, ...result });
  }

  if (body.action === 'push_broadcast') {
    if (body.token !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    const result = await broadcastPush();
    return res.status(200).json({ ok: true, ...result });
  }

  if (body.action === 'stats') {
    if (body.token !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    const count = await redis('GET', 'newsletter:count') || '0';
    const queueLen = await redis('ZCARD', 'drip:queue') || 0;
    return res.status(200).json({ ok: true, subscribers: parseInt(count), drip_queue: queueLen });
  }

  // ── New subscription ─────────────────────────────────────────────────────
  const { email, source } = body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'Valid email required' });
  }

  const key = `newsletter:${email.toLowerCase().trim()}`;
  try {
    const existing = await redis('GET', key);
    if (existing) return res.status(200).json({ ok: true, status: 'already_subscribed' });

    const signupTs = Date.now();
    await redis('SET', key, JSON.stringify({ email, source: source || 'website', subscribed_at: signupTs }));
    await redis('INCR', 'newsletter:count');

    // Send welcome email immediately
    const tpl = emailTemplates(email).welcome;
    await sendEmail(email, tpl.subject, tpl.html);

    // Schedule 5-step drip sequence
    await scheduleDrip(email, signupTs);

    console.log(`[Newsletter] New subscriber: ${email} — drip scheduled`);
    return res.status(200).json({ ok: true, status: 'subscribed' });

  } catch (err) {
    console.error('[Newsletter] error:', err.message);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
}

export const config = { api: { bodyParser: true } };

// api/buffer-post.js — Daily Buffer auto-poster (Vercel Cron)
// Posts to all connected Buffer profiles: Instagram, Twitter/X, LinkedIn
// Fires daily at 8:00 AM IST (2:30 AM UTC)
//
// Required env vars (set in Vercel dashboard):
//   BUFFER_ACCESS_TOKEN  — your Buffer access token
//   CRON_SECRET          — shared secret to protect endpoint

const BUFFER_API = 'https://api.bufferapp.com/1';

// ─── Per-platform daily content (keyed by day 0=Sun…6=Sat) ──────────────────

// ─── Google Business Profile posts (short, local-SEO friendly) ──────────────
const GOOGLE_POSTS = [
  `🌍 Track live geopolitical conflicts and their market impact — free, no login.\n\nOrrery monitors 35 countries in real-time: Ukraine, Iran, Taiwan, India-Pakistan and more.\n\nhttps://orreryx.io/app`,
  `Real-time intelligence on wars, sanctions and nuclear flashpoints — with live stock, oil and gold prices.\n\nFree at orreryx.io/app`,
  `New on Orrery: filter live conflict news by country and language. 35 countries, 9 languages, AI analysis on demand.\n\nhttps://orreryx.io/app`,
  `Which markets move when geopolitical events happen?\n→ Oil on Middle East tensions\n→ Gold on nuclear news\n→ Defence stocks on active conflicts\n\nTrack it live free: orreryx.io/app`,
  `Orrery: free geopolitical risk tracker used by investors, analysts and researchers.\n\nLive conflict feed · Market impact · AI briefs · Video coverage\n\norreryx.io/app`,
  `India-Pakistan, Iran, Ukraine, Taiwan — all tracked live with real-time market impact.\n\nFree intelligence platform: orreryx.io/app`,
  `Stay ahead of geopolitical risk. Free real-time tracker: orreryx.io/app\n\n35 countries · 9 languages · stocks, oil, gold, crypto · no signup needed`,
];

// ─── LinkedIn captions (professional, insight-led, weekdays only) ────────────
const LINKEDIN_CAPTIONS = [
  `Geopolitical risk is underpriced by most retail investors.

When Iran enriches uranium, oil spikes within hours.
When India-Pakistan tensions rise, gold bids up immediately.
When Taiwan headlines break, semiconductor stocks drop.

Most people see the news 12 hours late and wonder why their portfolio moved.

Orrery tracks 35 conflict zones in real time — with direct market impact mapped to stocks, oil, gold and crypto.

Free. No login. No paywall.
👉 orreryx.io/app

#GeopoliticalRisk #Investing #MacroIntelligence #GlobalMarkets #RiskManagement`,

  `The Russia-Ukraine war has cost global markets an estimated $1.6 trillion in the first 6 months alone.

Most investors found out they were exposed after the fact.

Real-time geopolitical intelligence used to cost $24,000/year (Bloomberg terminal).

Orrery gives you the same conflict tracking, market impact mapping and AI analysis — completely free.

35 countries · Live feed · AI briefs · Video coverage per event

👉 orreryx.io/app

#Ukraine #Russia #GlobalRisk #Investing #MacroEconomics #Markets`,

  `Iran's nuclear programme. North Korea's ICBM tests. China's Taiwan strait exercises.

These aren't just political events — they're market-moving signals that serious investors track daily.

Orrery is a free geopolitical intelligence platform that maps every major conflict to its asset class impact:
→ Oil and gas exposure
→ Gold and safe-haven flows
→ Defence and aerospace stocks
→ Emerging market currency risk

Used by analysts, portfolio managers and researchers across 40+ countries.

Free at orreryx.io/app

#GeopoliticalRisk #Commodities #DefenceStocks #MacroInvesting #Intelligence`,

  `India-Pakistan conflict risk is at a 5-year high.

Both sides have nuclear capability. Both have active border skirmishes. Both are mobilising reserves.

The market impact is already visible:
• Gold up on safe-haven demand
• Emerging market indices under pressure
• Energy prices elevated on regional instability

Orrery tracks this and 14 other active conflict zones in real time — with live price feeds mapped to each event.

Free: orreryx.io/app

#IndiaPakistan #GeopoliticalRisk #Gold #EmergingMarkets #MacroIntelligence`,

  `What a Bloomberg Terminal won't tell you — but Orrery will:

✅ Which specific conflict is driving today's oil move
✅ Which country's risk score just changed and why
✅ Real-time AI brief on any breaking geopolitical event
✅ Video coverage from 25+ global news channels per country
✅ Market impact score for stocks, oil, gold and crypto

All of this. Free. No account needed.

The intelligence gap between institutional and retail investors is closing.

👉 orreryx.io/app

#FinancialIntelligence #Investing #GeopoliticalRisk #MacroEconomics #Markets #AI`,

  `The Doomsday Clock is at 89 seconds to midnight — the closest in its 77-year history.

That's not just a headline. It reflects simultaneous:
• Active nuclear signalling by Russia
• Iranian enrichment at 60%
• North Korean ICBM tests
• China-Taiwan military exercises

Every one of these events has a direct, measurable market impact.

Track them all in real time at orreryx.io/app — free.

#DoomsdayClock #NuclearRisk #GeopoliticalRisk #GlobalMarkets #MacroInvesting`,

  `Geopolitical intelligence for the modern investor:

🌍 35 conflict zones tracked live
📊 Real-time market impact (oil, gold, crypto, indices)
🤖 AI analysis on demand
📡 9 languages, 45+ global news sources
🎥 Video coverage per country

This is what institutional desks pay millions for.
Orrery gives it to you free.

👉 orreryx.io/app

#GeopoliticalRisk #Investing #Intelligence #MacroEconomics #GlobalMarkets #OSINT`,
];

// ─── Instagram captions (rotated daily) ─────────────────────────────────────
const INSTAGRAM_CAPTIONS = [
  `🌍 Real-time geopolitical intelligence. Free.

Track live conflicts, nuclear flashpoints, sanctions and political crises across 35 countries — with market impact on stocks, oil, gold and crypto.

No login. No paywall. Updated every 2 minutes.
👉 Link in bio — orreryx.io/app

#geopolitics #worldnews #markets #investing #geopoliticalrisk #globalconflicts #intelligence #OSINT`,

  `Oil spikes when the Middle East burns 🔥
Gold bids up when nuclear headlines drop ☢️
Defence stocks pump when missiles fly 🚀

Track the events that move markets — live, free.
👉 Link in bio

#oil #gold #defencestocks #geopolitics #investing #iran #ukraine #middleeast`,

  `35 countries tracked live 🌐

🇺🇦 Ukraine-Russia · 🇮🇳🇵🇰 India-Pakistan
🇮🇷 Iran nuclear · 🇹🇼 Taiwan Strait
🇮🇱 Israel-Gaza · 🇰🇵 North Korea
+ 29 more conflict zones

One free platform. No account needed.
orreryx.io/app

#ukraine #indopakistan #iran #taiwan #israel #northkorea #geopolitics`,

  `Before markets open — check what's happening 📊

Live geopolitical events:
→ Filter by country
→ See which assets are exposed
→ AI analysis in 1 click

Free at orreryx.io/app
👉 Link in bio

#premarket #trading #investing #geopoliticalrisk #markets #gold #oil`,

  `Free OSINT tool: live conflict events from GDELT filtered by country + language 📡

9 languages · 35 countries · real-time market impact

Track the world before markets open.
orreryx.io/app

#OSINT #geopolitics #opendata #conflicttracking #intelligence`,

  `9 languages. 35 countries. One screen.

Arabic 🇸🇦 · Chinese 🇨🇳 · Russian 🇷🇺
French 🇫🇷 · German 🇩🇪 · Spanish 🇪🇸
Portuguese 🇧🇷 · Hindi 🇮🇳 · English 🇬🇧

Free intelligence platform: orreryx.io/app
👉 Link in bio

#multilingual #geopolitics #worldnews #global`,

  `The world doesn't pause between your news checks 🌐

Orrery monitors conflicts, sanctions and political crises 24/7.

AI brief on any event. Video coverage per country. Market impact in real time.

100% free. No login. No paywall.
orreryx.io/app

#geopolitics #worldnews #AI #intelligence #freetools`,
];

// ─── Buffer API helpers ───────────────────────────────────────────────────────

async function getProfiles(token) {
  const r = await fetch(`${BUFFER_API}/profiles.json?access_token=${token}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('Failed to fetch Buffer profiles: ' + r.status);
  return r.json();
}

async function createUpdate(token, profileId, text, mediaUrl = null) {
  const params = new URLSearchParams({
    access_token: token,
    'profile_ids[]': profileId,
    text,
    now: 'true', // post immediately (or remove to add to queue)
  });
  if (mediaUrl) params.set('media[photo]', mediaUrl);

  const r = await fetch(`${BUFFER_API}/updates/create.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error('Buffer post failed: ' + JSON.stringify(j));
  return j;
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const cronSecret  = process.env.CRON_SECRET;
  const authHeader  = req.headers['authorization'];
  const querySecret = req.query.secret;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({
      error: 'BUFFER_ACCESS_TOKEN not set in Vercel environment variables.',
    });
  }

  const now       = new Date();
  const dayOfWeek = now.getDay();     // 0=Sun…6=Sat
  const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);

  // Fetch all connected Buffer profiles
  const profiles = await getProfiles(token);
  const results  = [];

  for (const profile of profiles) {
    const service = (profile.service || '').toLowerCase();
    let text = null;
    let mediaUrl = null;

    if (service === 'instagram') {
      text = INSTAGRAM_CAPTIONS[dayOfYear % INSTAGRAM_CAPTIONS.length];
      mediaUrl = 'https://www.orreryx.io/og-image.svg';
    }

    if (service === 'linkedin') {
      // Skip weekends — LinkedIn engagement drops significantly on Sat/Sun
      if (dayOfWeek === 0 || dayOfWeek === 6) continue;
      text = LINKEDIN_CAPTIONS[dayOfYear % LINKEDIN_CAPTIONS.length];
    }

    if (service === 'google' || service === 'googlebusiness' || service === 'google_business') {
      text = GOOGLE_POSTS[dayOfYear % GOOGLE_POSTS.length];
    }

    if (!text) continue;

    try {
      const result = await createUpdate(token, profile.id, text, mediaUrl);
      results.push({ service, profile_id: profile.id, status: 'posted', id: result?.updates?.[0]?.id });
    } catch (err) {
      results.push({ service, profile_id: profile.id, status: 'error', error: err.message });
    }
  }

  return res.status(200).json({ ok: true, day: dayOfWeek, results });
}

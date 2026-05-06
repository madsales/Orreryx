// api/social-post.js — CMO Content Brief Agent
// Runs every 3 hours, finds top geopolitical stories, generates ready-to-use
// social media content briefs and delivers them via email + saves to Redis.
//
// Flow per run:
//   1. Check CEO approval
//   2. Check daily limits (max 5 briefs/day, 1 breaking/day)
//   3. Fetch top geopolitical stories from GNews
//   4. Claude scores + generates full content brief per story
//   5. Save brief to Redis (cmo:briefs:{date})
//   6. Send email to admin with ready-to-copy captions
//
// Redis keys:
//   cmo:briefs:{date}       → JSON array of all briefs today
//   cmo:posted:{date}       → JSON array of story URLs already briefed
//   cmo:count:{date}        → number of briefs sent today (max 5)
//   cmo:breaking:{date}     → "1" if breaking slot used today
//
// Required env vars:
//   ANTHROPIC_API_KEY, GNEWS_API_KEY, RESEND_API_KEY
//   ADMIN_EMAIL (where to send daily briefs)
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, CRON_SECRET

// ── Redis helpers ─────────────────────────────────────────────────────────────

async function redisGet(key) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal:  AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.result ?? null;
}

async function redisSet(key, value, exSeconds = null) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  const cmd = exSeconds
    ? ['SET', key, typeof value === 'string' ? value : JSON.stringify(value), 'EX', exSeconds]
    : ['SET', key, typeof value === 'string' ? value : JSON.stringify(value)];
  await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(cmd),
    signal:  AbortSignal.timeout(5000),
  }).catch(() => {});
}

// ── Fetch geopolitical stories from GNews ─────────────────────────────────────

async function fetchStories() {
  const apiKey = process.env.GNEWS_API_KEY;
  if (!apiKey) return [];

  // Fetch from multiple queries and merge for best coverage
  const queries = [
    'war OR conflict OR military OR airstrike OR invasion',
    'nuclear OR missile OR sanctions OR ceasefire OR troops',
    'geopolitical OR crisis OR coup OR escalation OR Iran OR Ukraine OR Gaza OR Taiwan',
  ];

  const allArticles = [];
  const seenUrls    = new Set();

  for (const q of queries) {
    try {
      const r = await fetch(
        `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&max=5&sortby=publishedAt&apikey=${apiKey}`,
        { signal: AbortSignal.timeout(8000) }
      ).catch(() => null);
      if (!r?.ok) continue;
      const d = await r.json().catch(() => null);
      for (const article of (d?.articles || [])) {
        if (!seenUrls.has(article.url)) {
          seenUrls.add(article.url);
          allArticles.push(article);
        }
      }
    } catch (_) { continue; }
  }

  return allArticles.slice(0, 15);
}

// ── Claude: score + generate full content brief ───────────────────────────────

async function generateBrief(stories, anthropicKey) {
  if (!anthropicKey || !stories.length) return [];

  const summaries = stories.map((s, i) =>
    `${i + 1}. TITLE: ${s.title}\n   SOURCE: ${s.source?.name || 'Unknown'}\n   PUBLISHED: ${s.publishedAt}\n   DESCRIPTION: ${s.description || ''}`
  ).join('\n\n');

  const prompt = `You are the CMO of Orrery — a live geopolitical intelligence platform tracking wars, nuclear risks, sanctions, and market-moving global conflicts.

Analyze these ${stories.length} stories and score each for GLOBAL GEOPOLITICAL IMPORTANCE:

${summaries}

Scoring:
- 9-10: BREAKING — Active military strike, nuclear escalation, war declaration, mass casualty event
- 6-8: IMPORTANT — Sanctions, ceasefire updates, troop movements, major diplomatic development
- 1-5: NOT RELEVANT — Domestic politics, business earnings, sports, minor local news

For stories scoring >= 6, return a detailed content brief. Return a JSON array (no markdown, no code fences):
[
  {
    "index": 1,
    "score": 9,
    "type": "breaking",
    "headline": "Story headline as written",
    "source": "Source name",
    "url": "story URL if available",
    "summary": "2-3 sentence factual summary of the story and why it matters geopolitically",
    "marketImpact": "Which assets move and how — e.g. Oil +3%, Gold up, Defence stocks rally",
    "region": "Geographic region — e.g. Middle East, Eastern Europe, Asia-Pacific",
    "imageBrief": "Detailed description of the ideal image for this post — scene, mood, colors, composition. Be specific so a designer knows exactly what to create.",
    "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
    "hashtags": ["#Hashtag1", "#Hashtag2", "#Hashtag3", "#Hashtag4", "#Hashtag5", "#Hashtag6"],
    "twitter": "Ready-to-post tweet. Max 240 chars. Sharp geopolitical angle. Link: orreryx.io/app. 2-3 hashtags inline.",
    "linkedin": "Full LinkedIn post. 200-300 words. Professional analysis tone. What it means for investors/markets. orreryx.io/app link. Hashtags at end.",
    "instagram": "Instagram caption. Punchy opener. Emojis. Geopolitical context. CTA: Link in bio → orreryx.io/app. 6-7 hashtags at end.",
    "redditTitle": "Reddit post title. Compelling, factual, no clickbait. Max 15 words. Suits r/geopolitics or r/worldnews style.",
    "redditBody": "Reddit post body. 150-250 words. Informative, analytical tone. No promotional language — Reddit hates ads. Present as genuine analysis. Mention orreryx.io/app naturally at the end as a free resource, not a plug. Include suggested subreddits at the end.",
    "redditSubreddits": ["r/geopolitics", "r/worldnews", "r/investing"]
  }
]

Only include stories with score >= 6. If none qualify, return [].`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5',
        max_tokens: 4000,
        messages:   [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(30000),
    }).catch(() => null);

    if (!r?.ok) return [];
    const d   = await r.json().catch(() => null);
    const raw = d?.content?.[0]?.text?.trim() || '[]';
    const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}

// ── Send email brief via Resend ───────────────────────────────────────────────

async function sendBriefEmail(brief, adminEmail) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !adminEmail) return false;

  const isBreaking = brief.type === 'breaking';
  const typeLabel  = isBreaking ? '🔴 BREAKING NEWS' : '📰 Regular News';
  const typeBg     = isBreaking ? '#cc0000' : '#1a1a2e';

  const html = `
<div style="font-family:sans-serif;max-width:680px;margin:0 auto;background:#0a0f1e;color:#ffffff;border-radius:8px;overflow:hidden">

  <!-- Header -->
  <div style="background:${typeBg};padding:20px 24px">
    <div style="font-size:11px;letter-spacing:3px;color:rgba(255,255,255,0.7);margin-bottom:4px">ORRERY CMO BRIEF</div>
    <div style="font-size:22px;font-weight:900;color:#ffffff">${typeLabel} — Score ${brief.score}/10</div>
  </div>

  <!-- Headline -->
  <div style="padding:20px 24px;background:#111827;border-left:4px solid ${isBreaking ? '#cc0000' : '#f59e0b'}">
    <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:8px">HEADLINE</div>
    <div style="font-size:20px;font-weight:700;line-height:1.4;color:#ffffff">${brief.headline}</div>
    <div style="margin-top:8px;font-size:13px;color:#6b7280">Source: ${brief.source} &nbsp;|&nbsp; Region: ${brief.region}</div>
  </div>

  <!-- Summary + Market Impact -->
  <div style="padding:20px 24px;display:flex;gap:16px">
    <div style="flex:2;background:#1f2937;border-radius:6px;padding:16px">
      <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:8px">SUMMARY</div>
      <div style="font-size:14px;line-height:1.7;color:#d1d5db">${brief.summary}</div>
    </div>
  </div>

  <div style="padding:0 24px 20px">
    <div style="background:#1f2937;border-radius:6px;padding:16px;border-left:3px solid #f59e0b">
      <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:8px">MARKET IMPACT</div>
      <div style="font-size:16px;font-weight:700;color:#f59e0b">${brief.marketImpact}</div>
    </div>
  </div>

  <!-- Image Brief -->
  <div style="padding:0 24px 20px">
    <div style="background:#1f2937;border-radius:6px;padding:16px;border-left:3px solid #3b82f6">
      <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:8px">🎨 IMAGE BRIEF</div>
      <div style="font-size:14px;line-height:1.7;color:#d1d5db">${brief.imageBrief}</div>
    </div>
  </div>

  <!-- Keywords & Hashtags -->
  <div style="padding:0 24px 20px;display:flex;gap:12px">
    <div style="flex:1;background:#1f2937;border-radius:6px;padding:16px">
      <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:10px">KEYWORDS</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${(brief.keywords || []).map(k => `<span style="background:#374151;color:#e5e7eb;padding:3px 10px;border-radius:12px;font-size:12px">${k}</span>`).join('')}
      </div>
    </div>
  </div>
  <div style="padding:0 24px 20px">
    <div style="background:#1f2937;border-radius:6px;padding:16px">
      <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:10px">HASHTAGS</div>
      <div style="font-size:13px;color:#60a5fa;line-height:1.8">${(brief.hashtags || []).join(' ')}</div>
    </div>
  </div>

  <!-- Captions -->
  <!-- Twitter -->
  <div style="padding:0 24px 16px">
    <div style="background:#1f2937;border-radius:6px;overflow:hidden">
      <div style="background:#1d9bf0;padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:1px;color:white">𝕏 TWITTER / X — COPY & PASTE</div>
      <div style="padding:16px;font-size:14px;line-height:1.7;color:#e5e7eb;white-space:pre-wrap">${brief.twitter}</div>
    </div>
  </div>

  <!-- LinkedIn -->
  <div style="padding:0 24px 16px">
    <div style="background:#1f2937;border-radius:6px;overflow:hidden">
      <div style="background:#0a66c2;padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:1px;color:white">💼 LINKEDIN — COPY & PASTE</div>
      <div style="padding:16px;font-size:14px;line-height:1.7;color:#e5e7eb;white-space:pre-wrap">${brief.linkedin}</div>
    </div>
  </div>

  <!-- Instagram -->
  <div style="padding:0 24px 16px">
    <div style="background:#1f2937;border-radius:6px;overflow:hidden">
      <div style="background:linear-gradient(90deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888);padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:1px;color:white">📸 INSTAGRAM — COPY & PASTE</div>
      <div style="padding:16px;font-size:14px;line-height:1.7;color:#e5e7eb;white-space:pre-wrap">${brief.instagram}</div>
    </div>
  </div>

  <!-- Reddit -->
  <div style="padding:0 24px 20px">
    <div style="background:#1f2937;border-radius:6px;overflow:hidden">
      <div style="background:#ff4500;padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:1px;color:white">🤖 REDDIT — COPY & PASTE</div>
      <div style="padding:16px">
        <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:6px">TITLE</div>
        <div style="font-size:15px;font-weight:700;color:#ffffff;margin-bottom:16px">${brief.redditTitle || ''}</div>
        <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:6px">BODY</div>
        <div style="font-size:14px;line-height:1.7;color:#e5e7eb;white-space:pre-wrap;margin-bottom:16px">${brief.redditBody || ''}</div>
        <div style="font-size:11px;letter-spacing:2px;color:#9ca3af;margin-bottom:8px">POST TO</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${(brief.redditSubreddits || ['r/geopolitics','r/worldnews']).map(s => `<span style="background:#ff4500;color:white;padding:3px 12px;border-radius:12px;font-size:12px;font-weight:600">${s}</span>`).join('')}
        </div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div style="padding:16px 24px;background:#060b14;text-align:center;font-size:12px;color:#4b5563">
    Orrery CMO Agent &nbsp;·&nbsp; orreryx.io &nbsp;·&nbsp; Auto-generated content brief
  </div>
</div>`;

  const subject = isBreaking
    ? `🔴 BREAKING: ${brief.headline.slice(0, 60)}${brief.headline.length > 60 ? '...' : ''}`
    : `📰 Post Brief: ${brief.headline.slice(0, 60)}${brief.headline.length > 60 ? '...' : ''}`;

  const r = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      from:    'Orrery CMO <hello@orreryx.io>',
      to:      [adminEmail],
      subject,
      html,
    }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);

  return r?.ok ?? false;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const cronSecret  = process.env.CRON_SECRET;
  const authHeader  = req.headers['authorization'];
  const querySecret = req.query.secret;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const today        = new Date().toISOString().split('T')[0];
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const adminEmail   = process.env.ADMIN_EMAIL;

  // ── CEO Approval check ────────────────────────────────────────────────────────
  if (req.query.admin !== '1') {
    const approved = await redisGet(`ceo:approved:${today}`);
    if (!approved) {
      return res.status(200).json({ ok: false, reason: `Awaiting CEO approval for ${today}` });
    }
  }

  // ── Debug: show raw stories + scores ─────────────────────────────────────────
  if (req.query.debug === 'stories') {
    const stories = await fetchStories();
    const scored  = await generateBrief(stories, anthropicKey);
    return res.status(200).json({ ok: true, fetched: stories.length, scored, stories: stories.map(s => ({ title: s.title, source: s.source?.name, url: s.url })) });
  }

  // ── View today's briefs ───────────────────────────────────────────────────────
  if (req.query.view === '1') {
    const briefs = JSON.parse((await redisGet(`cmo:briefs:${today}`)) || '[]');
    return res.status(200).json({ ok: true, today, count: briefs.length, briefs });
  }

  // ── Daily limits ──────────────────────────────────────────────────────────────
  const countRaw     = await redisGet(`cmo:count:${today}`);
  const countToday   = parseInt(countRaw || '0', 10);
  const breakingUsed = !!(await redisGet(`cmo:breaking:${today}`));
  const postedRaw    = await redisGet(`cmo:posted:${today}`);
  const postedUrls   = JSON.parse(postedRaw || '[]');

  if (countToday >= 5) {
    return res.status(200).json({ ok: false, reason: `Daily limit reached — ${countToday}/5 briefs sent today`, today });
  }

  // ── Fetch & score stories ─────────────────────────────────────────────────────
  const stories = await fetchStories();
  if (!stories.length) {
    return res.status(200).json({ ok: false, reason: 'No stories from GNews', today });
  }

  const freshStories = stories.filter(s => !postedUrls.includes(s.url));
  if (!freshStories.length) {
    return res.status(200).json({ ok: false, reason: 'All fetched stories already briefed today', today });
  }

  const scored = await generateBrief(freshStories, anthropicKey);
  if (!scored.length) {
    return res.status(200).json({ ok: false, reason: 'No stories cleared importance threshold (score < 6)', today });
  }

  scored.sort((a, b) => b.score - a.score);

  // Pick best story — skip breaking if slot used
  let chosen = null;
  for (const s of scored) {
    if (s.type === 'breaking' && breakingUsed) continue;
    chosen = s;
    break;
  }

  if (!chosen) {
    return res.status(200).json({ ok: false, reason: 'Breaking slot used — no regular stories qualified', today });
  }

  const story     = freshStories[chosen.index - 1];
  const isBreaking = chosen.type === 'breaking';

  // Attach source URL from original story
  chosen.url = story?.url || chosen.url || '';

  // ── Save to Redis ─────────────────────────────────────────────────────────────
  const existingBriefs = JSON.parse((await redisGet(`cmo:briefs:${today}`)) || '[]');
  existingBriefs.push({ ...chosen, briefedAt: new Date().toISOString() });
  await redisSet(`cmo:briefs:${today}`,  JSON.stringify(existingBriefs),       90000);
  await redisSet(`cmo:count:${today}`,   String(countToday + 1),               90000);
  await redisSet(`cmo:posted:${today}`,  JSON.stringify([...postedUrls, story?.url || chosen.headline]), 90000);
  if (isBreaking) await redisSet(`cmo:breaking:${today}`, '1', 90000);

  await redisSet('cmo:last_brief', {
    ts:        Date.now(),
    today,
    count:     countToday + 1,
    headline:  chosen.headline,
    type:      isBreaking ? 'breaking' : 'regular',
    score:     chosen.score,
  });

  // ── Send email ────────────────────────────────────────────────────────────────
  const emailSent = await sendBriefEmail(chosen, adminEmail);

  return res.status(200).json({
    ok:          true,
    today,
    type:        isBreaking ? '🔴 BREAKING' : '📰 Regular',
    score:       chosen.score,
    headline:    chosen.headline,
    source:      chosen.source,
    region:      chosen.region,
    marketImpact: chosen.marketImpact,
    briefsToday: countToday + 1,
    remaining:   4 - countToday,
    emailSent,
    brief:       chosen,
  });
}

export const config = { api: { bodyParser: false } };

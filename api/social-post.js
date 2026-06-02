// api/social-post.js — CMO Content Brief Agent

import { opsError, opsSuccess, opsWarn } from './_ops-alert.js';

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
        `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&lang=en&max=10&sortby=publishedAt&apikey=${apiKey}`,
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

// ── Claude: score + generate full content brief (two-pass) ───────────────────

async function claudeCall(anthropicKey, prompt, maxTokens, timeout = 30000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal:  AbortSignal.timeout(timeout),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  const raw = d?.content?.[0]?.text?.trim() || '';
  return raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
}

async function generateBrief(stories, anthropicKey) {
  if (!anthropicKey || !stories.length) return [];

  // ── Pass 1: Score all stories (cheap, small output) ──────────────────────
  const scoringList = stories.map((s, i) =>
    `${i + 1}. ${s.title} — ${s.description || ''}`
  ).join('\n');

  const scorePrompt = `Score these ${stories.length} news stories for GLOBAL GEOPOLITICAL IMPORTANCE (1-10).
9-10: BREAKING — Active military strike, nuclear escalation, war declaration, mass casualty event
6-8: IMPORTANT — Sanctions, ceasefire, troop movements, nuclear deal, major diplomatic shift
1-5: NOT RELEVANT — Domestic politics, business, sports, local news

Return ONLY a compact JSON array, no markdown, no explanation:
[{"i":1,"s":7},{"i":2,"s":3}]

Stories:
${scoringList}`;

  try {
    const scoreRaw = await claudeCall(anthropicKey, scorePrompt, 600);
    if (!scoreRaw) return [];
    const scores = JSON.parse(scoreRaw);
    if (!Array.isArray(scores)) return [];

    // Pick top 3 qualifying stories (score >= 6), highest score first
    const top3 = scores
      .filter(x => x.s >= 6)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3)
      .map(x => ({ ...stories[x.i - 1], score: x.s }))
      .filter(Boolean);

    if (!top3.length) return [];

    // ── Pass 2: Generate full brief for each top story individually ───────
    const briefs = [];
    for (const story of top3) {
      const briefPrompt = `You are the CMO of OrreryX — a live geopolitical intelligence platform that translates global conflict events into market signals. OrreryX voice: direct, intelligent, calm. Not hype-heavy. Factual observation → why it matters → what moves.

Generate a complete social media content brief for this story. Return a single JSON object (no markdown, no code fences):
{
  "score": ${story.score},
  "type": "${story.score >= 9 ? 'breaking' : 'important'}",
  "headline": "${(story.title || '').replace(/"/g, "'")}",
  "source": "${(story.source?.name || 'Unknown').replace(/"/g, "'")}",
  "url": "${story.url || ''}",
  "summary": "2-3 sentence factual summary and why it matters geopolitically",
  "marketImpact": "Which assets move and how — e.g. Oil +3%, Gold up, Defence stocks rally",
  "region": "Geographic region",
  "imageBrief": "Detailed visual description for a designer",
  "keywords": ["kw1","kw2","kw3","kw4","kw5"],
  "hashtags": ["#Tag1","#Tag2","#Tag3","#Tag4","#Tag5","#Tag6"],
  "twitter": "HOOK-FIRST tweet. Open with a sharp single-line insight that stops the scroll — a surprising number, a consequence, or a contrarian angle. NOT just a headline recap. Max 240 chars. Market impact in second line. orreryx.io/app link. 2 hashtags only. Example format: 'Iran closed the Strait of Hormuz for 6 hours today.\\n\\n📊 Oil +4.2%. Gold up. Here is what else moves → orreryx.io/app\\n\\n#Oil #Geopolitics'",
  "linkedin": "HOOK-FIRST LinkedIn post. Start with a bold insight or counterintuitive fact (not the headline). 3-4 short paragraphs. First paragraph: the surprising angle. Second: context for investors. Third: specific assets affected and why. Fourth: one clear CTA. Professional but human — no corporate speak. End with 4-5 focused hashtags. orreryx.io/app link in the post. 200-280 words total.",
  "instagram": "SCROLL-STOPPING Instagram caption. First line must make someone stop mid-scroll — use a dramatic number, a consequence, or a question. Then 3-4 short punchy paragraphs with emojis. Source credit one line before hashtags. CTA: 'Track live → link in bio'. 6-7 hashtags at end — mix broad (#investing) and specific (#Iran #OilPrice).",
  "redditTitle": "Reddit title max 15 words, factual, no clickbait, suits r/geopolitics",
  "redditBody": "Reddit body 150-250 words. Analytical. Lead with source URL. No promotional language. Explain the geopolitical context, then the market implications. Mention orreryx.io/app once naturally at the end as a resource. Suggest 2-3 subreddits.",
  "redditSubreddits": ["r/geopolitics","r/worldnews","r/investing"],
  "discord": "Discord message 3-5 lines. Bold headline with **text**. One line market impact. One line source credit. orreryx.io/app link. 2-3 relevant emojis. No hashtags."
}

Story:
TITLE: ${story.title}
SOURCE: ${story.source?.name || 'Unknown'}
DESCRIPTION: ${story.description || ''}
URL: ${story.url || ''}`;

      try {
        const raw = await claudeCall(anthropicKey, briefPrompt, 2000, 30000);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') briefs.push(parsed);
      } catch (_) { continue; }
    }

    return briefs;
  } catch (_) { return []; }
}

// ── Send email via Resend (with Gmail SMTP fallback) ─────────────────────────

async function gmailSend(to, subject, html) {
  // Try Resend first (primary)
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'OrreryX CMO <noreply@orreryx.io>';
  if (resendKey) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: to.trim(), subject, html }),
      });
      if (r.ok) return true;
    } catch (_) {}
  }
  // Fallback: Gmail SMTP
  try {
    const { default: nodemailer } = await import('nodemailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
    await transporter.sendMail({ from: `OrreryX CMO <${user}>`, to, subject, html });
    return true;
  } catch (err) {
    console.error('[gmailSend] failed:', err?.message || err);
    return false;
  }
}

// ── Send email brief ──────────────────────────────────────────────────────────

async function sendBriefEmail(brief, adminEmail) {
  if (!adminEmail) return false;

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

  <!-- Discord -->
  <div style="padding:0 24px 20px">
    <div style="background:#1f2937;border-radius:6px;overflow:hidden">
      <div style="background:#5865f2;padding:10px 16px;font-size:12px;font-weight:700;letter-spacing:1px;color:white">🎮 DISCORD — COPY & PASTE</div>
      <div style="padding:16px;font-size:14px;line-height:1.7;color:#e5e7eb;white-space:pre-wrap">${brief.discord || ''}</div>
    </div>
  </div>

  <!-- Footer -->
  <div style="padding:16px 24px;background:#060b14;text-align:center;font-size:12px;color:#4b5563">
    OrreryX CMO Agent &nbsp;·&nbsp; orreryx.io &nbsp;·&nbsp; Auto-generated content brief
  </div>
</div>`;

  const subject = isBreaking
    ? `🔴 BREAKING: ${brief.headline.slice(0, 60)}${brief.headline.length > 60 ? '...' : ''}`
    : `📰 Post Brief: ${brief.headline.slice(0, 60)}${brief.headline.length > 60 ? '...' : ''}`;

  try {
    return await gmailSend(adminEmail, subject, html);
  } catch (err) { console.error('[CMO gmailSend]', err?.message||err); return false; }
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

  // ── Gate: only manual pause (set via ops-agent) can block posting ─────────────
  // CEO approval is fully automatic — no manual sign-off required
  if (req.query.admin !== '1') {
    const paused = await redisGet('ops:social:paused');
    if (paused === '1') {
      return res.status(200).json({ ok: false, reason: 'Social posting paused by ops agent' });
    }
  }

  // ── Debug: show raw stories + scores ─────────────────────────────────────────
  if (req.query.debug === 'stories') {
    const stories = await fetchStories();
    // Raw Claude call for full visibility
    let claudeRaw = null, claudeStatus = null, claudeError = null;
    if (anthropicKey && stories.length) {
      try {
        const summaries = stories.map((s, i) =>
          `${i + 1}. TITLE: ${s.title}\n   SOURCE: ${s.source?.name || 'Unknown'}\n   DESCRIPTION: ${s.description || ''}`
        ).join('\n\n');
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content: `Score these geopolitical stories 1-10. Return JSON array [{index,score,headline}]. No markdown.\n\n${summaries}` }] }),
          signal: AbortSignal.timeout(15000),
        }).catch(e => { claudeError = e?.message; return null; });
        claudeStatus = r?.status;
        claudeRaw = await r?.json().catch(() => null);
      } catch (e) { claudeError = e?.message; }
    }
    return res.status(200).json({
      ok: true,
      fetched: stories.length,
      hasAnthropicKey: !!anthropicKey,
      hasGnewsKey: !!process.env.GNEWS_API_KEY,
      claudeStatus, claudeError, claudeRaw,
      stories: stories.map(s => ({ title: s.title, source: s.source?.name, url: s.url })),
    });
  }

  // ── View today's briefs ───────────────────────────────────────────────────────
  if (req.query.view === '1') {
    const briefs = JSON.parse((await redisGet(`cmo:briefs:${today}`)) || '[]');
    return res.status(200).json({ ok: true, today, count: briefs.length, briefs });
  }

  // ── Daily limits (skip when force=1 from admin panel) ────────────────────────
  const forceRun   = req.query.admin === '1' && req.query.force === '1';
  const countRaw   = await redisGet(`cmo:count:${today}`);
  const countToday = parseInt(countRaw || '0', 10);
  const breakingUsed = !!(await redisGet(`cmo:breaking:${today}`));
  const postedRaw  = await redisGet(`cmo:posted:${today}`);
  const postedUrls = JSON.parse(typeof postedRaw === 'string' ? postedRaw : JSON.stringify(postedRaw || []));

  if (!forceRun && countToday >= 5) {
    return res.status(200).json({ ok: false, reason: `Daily limit reached — ${countToday}/5 briefs sent today`, today, tip: 'Use FORCE button in admin to bypass limit' });
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
  let chosenStoryUrl = '';
  for (const s of scored) {
    if (s.type === 'breaking' && breakingUsed) continue;
    chosen = s;
    // Find the original story URL by matching headline (brief was generated from freshStories)
    const matched = freshStories.find(fs =>
      (fs.title || '').toLowerCase().includes((s.headline || '').slice(0, 40).toLowerCase()) ||
      (s.url && fs.url === s.url)
    );
    chosenStoryUrl = matched?.url || s.url || s.headline || '';
    break;
  }

  if (!chosen) {
    return res.status(200).json({ ok: false, reason: 'Breaking slot used — no regular stories qualified', today });
  }

  const isBreaking = chosen.type === 'breaking';

  // Ensure URL is set on chosen brief
  chosen.url = chosenStoryUrl || chosen.url || '';

  // ── Save to Redis ─────────────────────────────────────────────────────────────
  const existingBriefs = JSON.parse((await redisGet(`cmo:briefs:${today}`)) || '[]');
  existingBriefs.push({ ...chosen, briefedAt: new Date().toISOString() });
  await redisSet(`cmo:briefs:${today}`,  JSON.stringify(existingBriefs),       90000);
  await redisSet(`cmo:count:${today}`,   String(countToday + 1),               90000);
  await redisSet(`cmo:posted:${today}`,  JSON.stringify([...postedUrls, chosenStoryUrl || chosen.headline]), 90000);
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

  // ── Post to Discord webhook (if configured) ───────────────────────────────────
  let discordSent = false;
  const discordWebhook = process.env.DISCORD_WEBHOOK_URL;
  if (discordWebhook && chosen.discord) {
    try {
      const dr = await fetch(discordWebhook, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: chosen.discord }),
        signal:  AbortSignal.timeout(8000),
      }).catch(() => null);
      discordSent = dr?.ok ?? false;
    } catch (_) {}
  }

  // ── Ops alert ─────────────────────────────────────────────────────────────────
  if (emailSent) {
    await opsSuccess('social-post', `Brief sent: ${chosen.headline?.slice(0, 80)}`, {
      type: isBreaking ? 'breaking' : 'regular',
      score: chosen.score, region: chosen.region,
    });
  } else {
    await opsError('social-post', 'Brief email failed to send', {
      headline: chosen.headline,
      adminEmail: process.env.ADMIN_EMAIL || '(not set)',
      hasResend: !!process.env.RESEND_API_KEY,
      hasGmail:  !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
    });
  }

  return res.status(200).json({
    ok:           emailSent,
    today,
    type:         isBreaking ? '🔴 BREAKING' : '📰 Regular',
    score:        chosen.score,
    headline:     chosen.headline,
    source:       chosen.source,
    region:       chosen.region,
    marketImpact: chosen.marketImpact,
    briefsToday:  countToday + 1,
    remaining:    4 - countToday,
    emailSent,
    emailTarget:  process.env.ADMIN_EMAIL || '(ADMIN_EMAIL not set)',
    discordSent,
    emailError:   !emailSent ? 'Email not sent — check RESEND_API_KEY or GMAIL_USER+GMAIL_APP_PASSWORD in Vercel env vars' : undefined,
    brief:        chosen,
  });
}

export const config = { api: { bodyParser: false } };

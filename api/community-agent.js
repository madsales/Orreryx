// api/community-agent.js — OrreryX Community Content Agent
// Runs daily via cron. Reads today's breaking news + CMO briefs from Redis,
// then uses Claude Haiku to generate:
//   - 2 Reddit post suggestions (titles + bodies)
//   - 1 Discord announcement template
//   - 2 Twitter thread ideas (hook + 3 follow-up tweets + CTA)
// Saves suggestions to Redis (24h TTL), emails results to ADMIN_EMAIL.
// Optionally posts Discord webhook if DISCORD_WEBHOOK_URL is set and ?post=1.
//
// Required env vars:
//   ANTHROPIC_API_KEY
//   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//   RESEND_API_KEY (or GMAIL_USER + GMAIL_APP_PASSWORD)
//   ADMIN_EMAIL
//   CRON_SECRET
//   DISCORD_WEBHOOK_URL (optional — only used when ?post=1)
//   EMAIL_FROM (optional, defaults to OrreryX <noreply@orreryx.io>)

// ── Redis helpers ─────────────────────────────────────────────────────────────

async function upstashGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  if (!r?.ok) return null;
  return (await r.json().catch(() => null))?.result ?? null;
}

async function upstashSet(key, value, exSeconds = null) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  const cmd = exSeconds
    ? ['SET', key, JSON.stringify(value), 'EX', exSeconds]
    : ['SET', key, JSON.stringify(value)];
  await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(5000) }).catch(() => {});
}

// ── Claude API helper ─────────────────────────────────────────────────────────

async function claudeCall(prompt, maxTokens = 1000) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(30000),
  }).catch(() => null);
  if (!r?.ok) return null;
  const d = await r.json().catch(() => null);
  return d?.content?.[0]?.text?.trim() || null;
}

// ── Email helper ──────────────────────────────────────────────────────────────

async function sendEmail(to, subject, html) {
  if (!to) return false;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'OrreryX <noreply@orreryx.io>';
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
  try {
    const { default: nodemailer } = await import('nodemailer');
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !pass) return false;
    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.sendMail({ from: `OrreryX <${user}>`, to: to.trim(), subject, html });
    return true;
  } catch (_) { return false; }
}

// ── Read today's news context from Redis ─────────────────────────────────────

async function readNewsContext(today) {
  // Breaking news story (set by breaking-news.js)
  const storyRaw = await upstashGet('breaking:last_story');
  let story = null;
  if (storyRaw) {
    try { story = JSON.parse(storyRaw); } catch (_) {}
  }

  // CMO briefs for today (set by social-post.js)
  const briefsRaw = await upstashGet(`cmo:briefs:${today}`);
  let briefs = null;
  if (briefsRaw) {
    try { briefs = JSON.parse(briefsRaw); } catch (_) {}
  }

  return { story, briefs };
}

// ── Build news summary string for Claude prompts ─────────────────────────────

function buildNewsContext(story, briefs) {
  const parts = [];

  if (story) {
    parts.push(`TOP BREAKING STORY:
Title: ${story.title || 'N/A'}
Country/Region: ${story.country || 'Global'}
Market Impact: ${story.marketImpact || 'Global markets'}
Published: ${story.ts ? new Date(story.ts).toUTCString() : 'Recently'}`);
  }

  if (briefs) {
    const briefList = Array.isArray(briefs) ? briefs : (briefs.briefs || briefs.posts || []);
    if (briefList.length) {
      const summary = briefList.slice(0, 3).map((b, i) =>
        `${i + 1}. ${b.headline || b.title || b.content || JSON.stringify(b).slice(0, 120)}`
      ).join('\n');
      parts.push(`TODAY'S MARKET BRIEFS:\n${summary}`);
    }
  }

  if (!parts.length) {
    return `No specific news available today. Use general geopolitical market intelligence context: conflicts in Middle East, Ukraine, Taiwan Strait tensions affecting oil, gold, defence stocks, and crypto markets.`;
  }

  return parts.join('\n\n');
}

// ── Generate Reddit posts ─────────────────────────────────────────────────────

async function generateRedditPosts(newsContext) {
  const prompt = `You are a community manager for OrreryX — a live geopolitical intelligence platform at orreryx.io/app.

TODAY'S NEWS CONTEXT:
${newsContext}

Generate 2 Reddit post suggestions. One for r/geopolitics or r/worldnews (analytical angle), one for r/investing or r/SecurityAnalysis (market impact angle).

REDDIT RULES:
- Analytical, informative tone — no hype, no sales pitch
- Factual and well-reasoned
- The post should stand on its own value
- Mention orreryx.io/app only ONCE, naturally at the end, as "I've been tracking this via orreryx.io/app" or similar organic mention
- No promotional language like "Check out" or "Try"
- Titles should be specific and analytical, not clickbait

Return ONLY valid JSON, no extra text:
{
  "posts": [
    {
      "subreddit": "r/geopolitics",
      "title": "...",
      "body": "...",
      "angle": "geopolitical analysis"
    },
    {
      "subreddit": "r/investing",
      "title": "...",
      "body": "...",
      "angle": "market impact"
    }
  ]
}`;

  const raw = await claudeCall(prompt, 1500);
  if (!raw) return null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (_) { return null; }
}

// ── Generate Discord announcement ─────────────────────────────────────────────

async function generateDiscordAnnouncement(newsContext) {
  const prompt = `You are a community manager for OrreryX — a live geopolitical intelligence platform at orreryx.io/app.

TODAY'S NEWS CONTEXT:
${newsContext}

Write 1 Discord server announcement for the OrreryX community channel.

DISCORD RULES:
- Bold the headline with **text**
- Include market impact clearly
- Clean formatting, 2-3 emojis MAXIMUM total
- Professional but engaging community tone
- End with a link to orreryx.io/app
- Max 400 characters total
- No more than 3 bullet points if using bullets

Return ONLY valid JSON, no extra text:
{
  "announcement": {
    "content": "...",
    "channel": "#market-intelligence"
  }
}`;

  const raw = await claudeCall(prompt, 600);
  if (!raw) return null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (_) { return null; }
}

// ── Generate Twitter threads ──────────────────────────────────────────────────

async function generateTwitterThreads(newsContext) {
  const prompt = `You are a social media strategist for OrreryX — a live geopolitical intelligence platform at orreryx.io/app.

TODAY'S NEWS CONTEXT:
${newsContext}

Generate 2 Twitter/X thread ideas, each with 5 tweets: 1 hook tweet + 3 analysis tweets + 1 CTA tweet.

TWITTER RULES:
- Hook tweet: provocative question or surprising fact, max 240 chars
- Analysis tweets: each max 240 chars, numbered (2/, 3/, 4/)
- CTA tweet: ends with orreryx.io/app, max 240 chars
- No hashtag spam — max 2 relevant hashtags in the entire thread
- Each tweet must stand alone as readable
- Thread 1: geopolitical angle; Thread 2: market/trading angle

Return ONLY valid JSON, no extra text:
{
  "threads": [
    {
      "angle": "geopolitical",
      "tweets": [
        {"number": 1, "text": "..."},
        {"number": 2, "text": "2/ ..."},
        {"number": 3, "text": "3/ ..."},
        {"number": 4, "text": "4/ ..."},
        {"number": 5, "text": "...orreryx.io/app"}
      ]
    },
    {
      "angle": "market_trading",
      "tweets": [
        {"number": 1, "text": "..."},
        {"number": 2, "text": "2/ ..."},
        {"number": 3, "text": "3/ ..."},
        {"number": 4, "text": "4/ ..."},
        {"number": 5, "text": "...orreryx.io/app"}
      ]
    }
  ]
}`;

  const raw = await claudeCall(prompt, 1800);
  if (!raw) return null;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (_) { return null; }
}

// ── Post to Discord webhook ───────────────────────────────────────────────────

async function postToDiscord(content) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return { ok: false, reason: 'DISCORD_WEBHOOK_URL not set' };

  const r = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
    signal: AbortSignal.timeout(10000),
  }).catch((e) => null);

  if (!r) return { ok: false, reason: 'Network error posting to Discord' };
  if (!r.ok) {
    const errText = await r.text().catch(() => r.status.toString());
    return { ok: false, reason: `Discord webhook error: ${errText}` };
  }
  return { ok: true };
}

// ── Build HTML email ──────────────────────────────────────────────────────────

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function contentBlock(label, content, accentColor = '#1e3a5f') {
  return `
    <div style="background:#111827;border-radius:6px;padding:16px 18px;margin-bottom:10px;border-left:3px solid ${accentColor}">
      <div style="font-size:10px;letter-spacing:2px;color:#9ca3af;margin-bottom:8px;text-transform:uppercase">${label}</div>
      <div style="font-size:13px;color:#e5e7eb;line-height:1.65;white-space:pre-wrap">${escHtml(content)}</div>
    </div>`;
}

function buildHtmlEmail(reddit, discord, twitter, newsContext, today) {
  // Reddit section
  let redditSection = '';
  if (reddit?.posts?.length) {
    redditSection = reddit.posts.map((post, i) => `
      <div style="margin-bottom:20px">
        <div style="display:inline-block;padding:2px 10px;border-radius:12px;background:#ff4500;color:#fff;font-size:10px;font-weight:700;letter-spacing:1px;margin-bottom:8px">${escHtml(post.subreddit)}</div>
        <div style="font-size:11px;color:#9ca3af;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">Angle: ${escHtml(post.angle || '')}</div>
        ${contentBlock('POST TITLE', post.title || '', '#ff4500')}
        ${contentBlock('POST BODY', post.body || '', '#c2410c')}
      </div>`).join('');
  } else {
    redditSection = '<div style="color:#f87171;padding:12px">Reddit generation failed — check ANTHROPIC_API_KEY</div>';
  }

  // Discord section
  let discordSection = '';
  if (discord?.announcement) {
    const a = discord.announcement;
    discordSection = `
      <div style="font-size:11px;color:#9ca3af;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px">Channel: ${escHtml(a.channel || '#market-intelligence')}</div>
      ${contentBlock('ANNOUNCEMENT', a.content || '', '#5865f2')}`;
  } else {
    discordSection = '<div style="color:#f87171;padding:12px">Discord generation failed</div>';
  }

  // Twitter section
  let twitterSection = '';
  if (twitter?.threads?.length) {
    twitterSection = twitter.threads.map(thread => `
      <div style="margin-bottom:24px">
        <div style="font-size:11px;color:#9ca3af;margin-bottom:10px;text-transform:uppercase;letter-spacing:1px">Angle: ${escHtml(thread.angle || '')}</div>
        ${(thread.tweets || []).map(t => contentBlock(`Tweet ${t.number}/5`, t.text || '', '#1d9bf0')).join('')}
      </div>`).join('');
  } else {
    twitterSection = '<div style="color:#f87171;padding:12px">Twitter thread generation failed</div>';
  }

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;background:#0a0f1e;color:#fff;border-radius:8px;overflow:hidden">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#0d3b5e,#0f4c2a);padding:28px 28px 24px">
    <div style="font-size:11px;letter-spacing:3px;color:rgba(255,255,255,0.65);margin-bottom:6px">ORRERY COMMUNITY AGENT</div>
    <div style="font-size:26px;font-weight:900">Daily Community Content</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:6px">${today} · Claude Haiku · Ready to post</div>
  </div>

  <!-- News context used -->
  <div style="padding:14px 28px;background:#1a2744;border-bottom:1px solid #1f2937;font-size:12px;color:#93c5fd">
    📰 <strong>News context used:</strong> ${escHtml((newsContext || '').split('\n')[0].slice(0, 120))}...
  </div>

  <!-- Platform counts -->
  <div style="display:flex;gap:1px;background:#1f2937">
    <div style="flex:1;background:#111827;padding:14px 16px;text-align:center">
      <div style="font-size:22px;font-weight:900;color:#ff4500">2</div>
      <div style="font-size:10px;color:#9ca3af;letter-spacing:1px">REDDIT POSTS</div>
    </div>
    <div style="flex:1;background:#111827;padding:14px 16px;text-align:center">
      <div style="font-size:22px;font-weight:900;color:#5865f2">1</div>
      <div style="font-size:10px;color:#9ca3af;letter-spacing:1px">DISCORD MSG</div>
    </div>
    <div style="flex:1;background:#111827;padding:14px 16px;text-align:center">
      <div style="font-size:22px;font-weight:900;color:#1d9bf0">2</div>
      <div style="font-size:10px;color:#9ca3af;letter-spacing:1px">TWITTER THREADS</div>
    </div>
  </div>

  <!-- Reddit section -->
  <div style="padding:24px 28px 16px">
    <div style="font-size:11px;letter-spacing:3px;color:#9ca3af;margin-bottom:4px">PLATFORM</div>
    <div style="font-size:18px;font-weight:900;color:#ff4500;margin-bottom:16px">Reddit Posts</div>
    ${redditSection}
  </div>

  <div style="height:1px;background:#1f2937;margin:0 28px"></div>

  <!-- Discord section -->
  <div style="padding:24px 28px 16px">
    <div style="font-size:11px;letter-spacing:3px;color:#9ca3af;margin-bottom:4px">PLATFORM</div>
    <div style="font-size:18px;font-weight:900;color:#5865f2;margin-bottom:16px">Discord Announcement</div>
    ${discordSection}
  </div>

  <div style="height:1px;background:#1f2937;margin:0 28px"></div>

  <!-- Twitter section -->
  <div style="padding:24px 28px 16px">
    <div style="font-size:11px;letter-spacing:3px;color:#9ca3af;margin-bottom:4px">PLATFORM</div>
    <div style="font-size:18px;font-weight:900;color:#1d9bf0;margin-bottom:16px">Twitter / X Threads</div>
    ${twitterSection}
  </div>

  <!-- Footer -->
  <div style="padding:20px 28px;background:#060b14;border-top:1px solid #1f2937;font-size:12px;color:#4b5563">
    OrreryX Community Agent · orreryx.io · Auto-generated daily · Post to Discord via ?post=1
  </div>

</div>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Auth: CRON_SECRET via Authorization header or ?secret= query
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'] || '';
  const querySecret = req.query.secret;
  const isAuthed = !cronSecret ||
    authHeader === `Bearer ${cronSecret}` ||
    querySecret === cronSecret;

  if (!isAuthed) return res.status(401).json({ error: 'Unauthorized' });

  const today = new Date().toISOString().split('T')[0];
  const adminEmail = process.env.ADMIN_EMAIL;
  const startMs = Date.now();

  // ?view=1 — return today's suggestions from Redis
  if (req.query.view === '1') {
    const raw = await upstashGet(`community:suggestions:${today}`);
    if (!raw) return res.status(200).json({ ok: false, message: 'No suggestions generated yet for today. Run without ?view=1 to generate.' });
    try {
      const data = JSON.parse(raw);
      return res.status(200).json({ ok: true, today, ...data });
    } catch (_) {
      return res.status(200).json({ ok: false, message: 'Stored data is corrupted' });
    }
  }

  // Read news context from Redis
  const { story, briefs } = await readNewsContext(today);
  const newsContext = buildNewsContext(story, briefs);

  // Generate all content in parallel
  const [reddit, discord, twitter] = await Promise.all([
    generateRedditPosts(newsContext),
    generateDiscordAnnouncement(newsContext),
    generateTwitterThreads(newsContext),
  ]);

  const suggestions = {
    date: today,
    generatedAt: new Date().toISOString(),
    newsContextUsed: newsContext.slice(0, 300),
    reddit,
    discord,
    twitter,
    durationMs: Date.now() - startMs,
  };

  // Save to Redis with 24h TTL
  await upstashSet(`community:suggestions:${today}`, suggestions, 86400);

  // Update last_run key
  await upstashSet('community:last_run', JSON.stringify({
    date: today,
    ts: Date.now(),
    summary: `Generated Reddit(${reddit?.posts?.length || 0}), Discord(${discord?.announcement ? 1 : 0}), Twitter threads(${twitter?.threads?.length || 0})`,
  }));

  // Send email to admin
  let emailSent = false;
  if (adminEmail) {
    const html = buildHtmlEmail(reddit, discord, twitter, newsContext, today);
    const subject = `OrreryX Community Content — ${today}`;
    emailSent = await sendEmail(adminEmail, subject, html);
  }

  // ?post=1 — also post Discord webhook if configured
  let discordPosted = null;
  if (req.query.post === '1' && discord?.announcement?.content) {
    discordPosted = await postToDiscord(discord.announcement.content);
  }

  return res.status(200).json({
    ok: true,
    today,
    generated: {
      redditPosts: reddit?.posts?.length || 0,
      discordAnnouncement: discord?.announcement ? 1 : 0,
      twitterThreads: twitter?.threads?.length || 0,
    },
    emailSent,
    discordPosted: discordPosted || (req.query.post === '1' ? { ok: false, reason: 'No Discord content generated' } : 'not_requested'),
    durationMs: Date.now() - startMs,
  });
}

export const config = { api: { bodyParser: false } };

// api/ideas-agent.js — Orrery Ideas Agent
// Generates daily: 3 social post ideas + 1 product idea + 1 growth experiment
// Runs daily 5:30 AM IST (0:00 UTC) via cron-job.org: 0 0 * * *
// Redis key: ideas:latest (JSON, 48h TTL)
// Required env vars: ANTHROPIC_API_KEY, UPSTASH_REDIS_REST_URL, CRON_SECRET

// ── Redis helper ──────────────────────────────────────────────────────────────
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

export default async function handler(req, res) {
  const cronSecret  = process.env.CRON_SECRET;
  const authHeader  = req.headers['authorization'];
  const querySecret = req.query.secret;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}` && querySecret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const upstashUrl   = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const today        = new Date().toISOString().split('T')[0];

  // ── Read sibling agent data for smarter context ───────────────────────────────
  let seoContext = '';
  let breakingContext = '';
  let cfoContext = '';
  try {
    const [seoRaw, breakingRaw, cfoRaw] = await Promise.all([
      redisGet('seo:last_audit'),
      redisGet('breaking:last_story'),
      redisGet('cfo:last_week'),
    ]);
    if (seoRaw) {
      const seo = JSON.parse(seoRaw);
      seoContext = `SEO score: ${seo.score}/100. Top issues: ${(seo.topIssues || []).slice(0,2).join('; ') || 'none'}. Slow pages: ${(seo.slowPages || []).join(', ') || 'none'}.`;
    }
    if (breakingRaw) {
      const b = JSON.parse(breakingRaw);
      breakingContext = `Last breaking story posted ${Math.round((Date.now() - b.ts) / 3600000)}h ago: "${b.title}" (${b.country}) — market impact: ${b.marketImpact}.`;
    }
    if (cfoRaw) {
      const cfo = JSON.parse(cfoRaw);
      cfoContext = `MRR: $${cfo.mrr || 0}. Signups this week: ${cfo.weeklySignups || 0}. Visitor→Signup: ${cfo.pageViews ? ((cfo.signups/cfo.pageViews)*100).toFixed(2) : 0}%.`;
    }
  } catch (_) {}

  // ── Fetch latest geopolitical events for context ──────────────────────────────
  let eventsContext = '- India-Pakistan ceasefire tensions remain fragile\n- Gold hits new ATH above $3,400\n- Iran nuclear talks stalled\n- US-China tariff war escalating';
  try {
    const host  = req.headers.host || 'www.orreryx.io';
    const proto = host.includes('localhost') ? 'http' : 'https';
    const r = await fetch(`${proto}://${host}/api/events?timespan=6h&maxrecords=10`, {
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) {
      const d   = await r.json().catch(() => null);
      const evs = (d?.events || d?.articles || []).slice(0, 6);
      if (evs.length) {
        eventsContext = evs
          .map(e => `- ${e.title || e.headline || e.summary || ''}`)
          .filter(s => s.length > 3)
          .join('\n');
      }
    }
  } catch (_) {}

  // ── Generate ideas via Claude Haiku ──────────────────────────────────────────
  let ideas = null;
  if (anthropicKey) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:  'POST',
        headers: {
          'x-api-key':         anthropicKey,
          'anthropic-version': '2023-06-01',
          'Content-Type':      'application/json',
        },
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 900,
          messages: [{
            role: 'user',
            content: `You are the Ideas Agent for Orrery (orreryx.io), a real-time geopolitical market intelligence SaaS targeting a $1B company valuation.

Today's top geopolitical events:
${eventsContext}

Intelligence from sibling agents:
${seoContext ? `• SEO Agent: ${seoContext}` : ''}
${breakingContext ? `• Breaking News Agent: ${breakingContext}` : ''}
${cfoContext ? `• CFO Agent: ${cfoContext}` : ''}

Use this intelligence to generate ideas that directly address the SEO gaps, build on the breaking story, or improve conversion. Generate fresh, specific, high-quality ideas as raw JSON only (no markdown, no explanation):
{
  "social_posts": [
    {
      "platform": "LinkedIn",
      "hook": "one compelling opening line that stops the scroll",
      "angle": "unique insight connecting geopolitics to markets",
      "cta": "short call-to-action"
    },
    {
      "platform": "Twitter",
      "hook": "full tweet text under 240 chars including hashtags and orreryx.io link",
      "angle": "punchy market angle"
    },
    {
      "platform": "LinkedIn",
      "hook": "different compelling opening — must be different topic from first",
      "angle": "different market angle from first LinkedIn post",
      "cta": "short call-to-action"
    }
  ],
  "product_idea": {
    "title": "Feature or product name",
    "description": "One sentence on what it does",
    "user_value": "Why would users pay for this specifically",
    "effort": "low"
  },
  "growth_experiment": {
    "title": "Experiment name",
    "hypothesis": "If we do X, then Y will happen because Z",
    "metric": "Exact KPI to measure success",
    "effort": "low"
  }
}`,
          }],
        }),
        signal: AbortSignal.timeout(25000),
      }).catch(() => null);

      if (r && r.ok) {
        const d    = await r.json().catch(() => null);
        const text = (d?.content?.[0]?.text || '').trim();
        // Strip markdown code fences if present
        const clean = text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
        ideas = JSON.parse(clean);
      }
    } catch (_) {}
  }

  // ── Fallback ideas (if Claude fails or API key missing) ───────────────────────
  if (!ideas) {
    ideas = {
      social_posts: [
        {
          platform: 'LinkedIn',
          hook: 'Gold just broke another record. Here\'s what the geopolitical risk model says happens next.',
          angle: 'Geopolitical risk premium driving safe-haven buying — investors need this data',
          cta: 'Track live risk scores free → orreryx.io',
        },
        {
          platform: 'Twitter',
          hook: `🚨 India-Pakistan risk score: 72/100. Gold +40% YTD. INR under pressure. Real-time geopolitical intelligence → orreryx.io #geopolitics #gold #investing #markets`,
          angle: 'Urgency + live risk score as social proof',
        },
        {
          platform: 'LinkedIn',
          hook: 'Most investors don\'t see geopolitical risk coming. Here\'s the data that changes that.',
          angle: 'Positioning Orrery as the unfair advantage for macro investors',
          cta: 'Start free trial → orreryx.io',
        },
      ],
      product_idea: {
        title: 'Conflict Correlation Matrix',
        description: 'Interactive heatmap showing how each active conflict correlates with key commodity and equity price movements',
        user_value: 'Analysts instantly see which conflicts are actually moving their portfolio — no more guessing',
        effort: 'medium',
      },
      growth_experiment: {
        title: '"Google Alerts for Geopolitics" SEO Play',
        hypothesis: 'If we rank for "google alerts geopolitics" and "geopolitical risk alerts", we capture users who want real-time monitoring but are using inferior tools',
        metric: 'Organic signups from geopolitical-alerts landing page in 30 days',
        effort: 'low',
      },
    };
  }

  // ── Save to Redis (48h TTL) ───────────────────────────────────────────────────
  const payload = { ...ideas, generatedAt: Date.now(), date: today };
  if (upstashUrl && upstashToken) {
    await fetch(upstashUrl, {
      method:  'POST',
      headers: { Authorization: `Bearer ${upstashToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(['SET', 'ideas:latest', JSON.stringify(payload), 'EX', 172800]),
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, date: today, ideas });
}

export const config = { api: { bodyParser: false } };

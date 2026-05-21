async function upstashRaw(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!r?.ok) return null;
  return (await r.json().catch(() => null))?.result ?? null;
}
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
  const cmd = exSeconds
    ? ['SET', key, typeof value === 'string' ? value : JSON.stringify(value), 'EX', exSeconds]
    : ['SET', key, typeof value === 'string' ? value : JSON.stringify(value)];
  return upstashRaw(cmd);
}

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
  return false;
}

const DIRECTORIES = [
  // Tier 1 — launch week
  {
    slug: 'product-hunt',
    name: 'Product Hunt',
    url: 'producthunt.com',
    tier: 1,
    priority: 'critical',
    notes: 'Pre-warm account 3 weeks before. Launch Tuesday-Thursday 12:01 AM PT.',
  },
  {
    slug: 'betalist',
    name: 'BetaList',
    url: 'betalist.com',
    tier: 1,
    priority: 'high',
    notes: '',
  },
  {
    slug: 'hacker-news-show-hn',
    name: 'Hacker News Show HN',
    url: 'news.ycombinator.com',
    tier: 1,
    priority: 'high',
    notes: "Post on weekday morning US time. Title: 'Show HN: OrreryX – Real-time geopolitical risk mapped to market impact'",
  },
  // Tier 2 — month 1
  {
    slug: 'g2',
    name: 'G2',
    url: 'g2.com',
    tier: 2,
    priority: 'high',
    notes: 'Run 10-in-30 review protocol: contact 20 power users, ask for reviews',
  },
  {
    slug: 'capterra',
    name: 'Capterra',
    url: 'capterra.com',
    tier: 2,
    priority: 'high',
    notes: '',
  },
  {
    slug: 'alternativeto',
    name: 'AlternativeTo',
    url: 'alternativeto.net',
    tier: 2,
    priority: 'medium',
    notes: '',
  },
  {
    slug: 'saashub',
    name: 'SaaSHub',
    url: 'saashub.com',
    tier: 2,
    priority: 'medium',
    notes: '',
  },
  {
    slug: 'getapp',
    name: 'GetApp',
    url: 'getapp.com',
    tier: 2,
    priority: 'medium',
    notes: '',
  },
  // Tier 3 — AI-focused
  {
    slug: 'taaft',
    name: "There's An AI For That / TAAFT",
    url: 'theresanaiforthat.com',
    tier: 3,
    priority: 'medium',
    notes: '',
  },
  {
    slug: 'futurepedia',
    name: 'Futurepedia',
    url: 'futurepedia.io',
    tier: 3,
    priority: 'medium',
    notes: '',
  },
  {
    slug: 'ai-tools-directory',
    name: 'AI Tools Directory',
    url: 'aitoolsdirectory.com',
    tier: 3,
    priority: 'low',
    notes: '',
  },
  {
    slug: 'tool-finder',
    name: 'Tool Finder',
    url: 'toolfinder.co',
    tier: 3,
    priority: 'low',
    notes: '',
  },
];

const PRODUCT_HUNT_CHECKLIST = [
  'Create Product Hunt account 3 weeks before launch',
  'Post 5+ comments on other launches to warm the account',
  'Prepare hunter: find a hunter with 500+ followers or hunt yourself',
  'Prepare all assets: tagline (60 chars), description (260 chars), thumbnail (240x240), gallery (1270x760)',
  'Schedule for Tuesday-Thursday at 12:01 AM Pacific Time',
  'On launch day: post in relevant Slack/Discord communities',
  'Reply to every comment within 30 minutes',
  "Never ask for upvotes directly — ask 'check out our launch'",
];

async function getDirectoryStatus(slug) {
  const raw = await upstashGet(`directory:status:${slug}`);
  if (!raw) return { status: 'pending', submittedAt: null, liveAt: null, notes: '' };
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function getAllStatuses() {
  const results = await Promise.all(
    DIRECTORIES.map(async (dir) => {
      const stored = await getDirectoryStatus(dir.slug);
      return { ...dir, ...stored, storedNotes: stored.notes, notes: dir.notes };
    })
  );
  return results;
}

function reminderEmailHtml(overdue) {
  const rows = overdue.map(dir => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${dir.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${dir.url}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">Tier ${dir.tier}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#c0392b">${dir.priority}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#888;font-size:13px">${dir.notes || '—'}</td>
    </tr>
  `).join('');

  return `
    <div style="font-family:sans-serif;max-width:700px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
      <h2 style="margin:0 0 8px">Directory submission reminder</h2>
      <p style="color:#555;margin:0 0 24px">The following directories are overdue for submission. Take action this week.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#f5f5f5;text-align:left">
            <th style="padding:8px 12px">Directory</th>
            <th style="padding:8px 12px">URL</th>
            <th style="padding:8px 12px">Tier</th>
            <th style="padding:8px 12px">Priority</th>
            <th style="padding:8px 12px">Notes</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:32px;color:#888;font-size:13px">— OrreryX ops</p>
    </div>
  `;
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}` && req.query.secret !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { action } = req.query;

  // GET ?action=list
  if (req.method === 'GET' && action === 'list') {
    const all = await getAllStatuses();
    const byTier = { tier1: [], tier2: [], tier3: [] };
    for (const dir of all) {
      if (dir.tier === 1) byTier.tier1.push(dir);
      else if (dir.tier === 2) byTier.tier2.push(dir);
      else byTier.tier3.push(dir);
    }
    return res.status(200).json({ directories: all, byTier });
  }

  // POST ?action=update { directory, status, notes }
  if (req.method === 'POST' && action === 'update') {
    const { directory, status, notes } = req.body || {};
    if (!directory || !status) return res.status(400).json({ error: 'directory (slug) and status required' });

    const validStatuses = ['pending', 'submitted', 'live', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
    }

    const dir = DIRECTORIES.find(d => d.slug === directory || d.name.toLowerCase() === directory.toLowerCase());
    if (!dir) return res.status(404).json({ error: 'Directory not found. Use slug (e.g. product-hunt)' });

    const existing = await getDirectoryStatus(dir.slug);
    const updated = {
      ...existing,
      status,
      notes: notes !== undefined ? notes : existing.notes,
      updatedAt: new Date().toISOString(),
    };

    if (status === 'submitted' && !existing.submittedAt) {
      updated.submittedAt = new Date().toISOString();
    }
    if (status === 'live' && !existing.liveAt) {
      updated.liveAt = new Date().toISOString();
    }

    await upstashSet(`directory:status:${dir.slug}`, updated);

    return res.status(200).json({ ok: true, slug: dir.slug, name: dir.name, ...updated });
  }

  // GET ?action=checklist
  if (req.method === 'GET' && action === 'checklist') {
    const all = await getAllStatuses();

    // Pending Tier 1 first, then Tier 2, then Tier 3
    const pending = all
      .filter(d => d.status === 'pending')
      .sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99);
      });

    const submitted = all.filter(d => d.status === 'submitted');
    const live = all.filter(d => d.status === 'live');
    const rejected = all.filter(d => d.status === 'rejected');

    const nextSteps = pending.slice(0, 5).map(dir => ({
      action: `Submit to ${dir.name}`,
      url: dir.url,
      tier: dir.tier,
      priority: dir.priority,
      notes: dir.notes || null,
    }));

    return res.status(200).json({
      summary: {
        total: all.length,
        pending: pending.length,
        submitted: submitted.length,
        live: live.length,
        rejected: rejected.length,
      },
      nextSteps,
      productHuntChecklist: PRODUCT_HUNT_CHECKLIST,
      allPending: pending,
    });
  }

  // Default cron run: check for overdue, email ADMIN_EMAIL
  if (req.method === 'GET' && !action) {
    const adminEmail = process.env.ADMIN_EMAIL;
    const all = await getAllStatuses();
    const now = Date.now();

    // Determine "launch date" — stored in Redis, fallback to now
    const launchRaw = await upstashGet('directory:launch_date');
    const launchDate = launchRaw ? new Date(launchRaw).getTime() : now;

    const tier1OverdueMs = 7 * 24 * 60 * 60 * 1000;   // 7 days
    const tier2OverdueMs = 30 * 24 * 60 * 60 * 1000;  // 30 days

    const overdue = all.filter(dir => {
      if (dir.status !== 'pending') return false;
      const age = now - launchDate;
      if (dir.tier === 1) return age > tier1OverdueMs;
      if (dir.tier === 2) return age > tier2OverdueMs;
      return false;
    });

    let emailSent = false;
    if (overdue.length > 0 && adminEmail) {
      emailSent = await sendEmail(
        adminEmail,
        `Action required: ${overdue.length} directory submission${overdue.length > 1 ? 's' : ''} overdue`,
        reminderEmailHtml(overdue)
      );
    }

    const summary = {
      runAt: new Date().toISOString(),
      totalDirectories: all.length,
      overdueCount: overdue.length,
      overdue: overdue.map(d => ({ name: d.name, tier: d.tier, priority: d.priority })),
      emailSent,
    };
    await upstashSet('directory:last_run', summary);

    return res.status(200).json(summary);
  }

  return res.status(400).json({ error: 'Invalid action or method' });
}

export const config = { api: { bodyParser: true } };

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

// Simple deterministic hash for variant assignment
function hashUserId(userId, expName) {
  const str = `${userId}:${expName}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // convert to 32-bit int
  }
  return Math.abs(hash);
}

async function scanKeys(pattern) {
  let cursor = '0';
  const keys = [];
  do {
    const result = await upstashRaw(['SCAN', cursor, 'MATCH', pattern, 'COUNT', '100']);
    if (!result || !Array.isArray(result)) break;
    cursor = result[0];
    if (Array.isArray(result[1])) keys.push(...result[1]);
  } while (cursor !== '0');
  return keys;
}

// Two-proportion z-test for statistical significance
function calculateSignificance(conv_a, imp_a, conv_b, imp_b) {
  if (imp_a < 30 || imp_b < 30) return { significant: false, pValue: null, reason: 'Insufficient sample size' };

  const p_a = conv_a / imp_a;
  const p_b = conv_b / imp_b;
  const p_pool = (conv_a + conv_b) / (imp_a + imp_b);

  if (p_pool === 0 || p_pool === 1) return { significant: false, pValue: null, reason: 'No variation in conversion' };

  const se = Math.sqrt(p_pool * (1 - p_pool) * (1 / imp_a + 1 / imp_b));
  if (se === 0) return { significant: false, pValue: null, reason: 'Zero standard error' };

  const z = Math.abs(p_a - p_b) / se;
  // Approximate p-value from z-score (two-tailed)
  const pValue = 2 * (1 - normalCDF(z));
  return { significant: pValue < 0.05, pValue: Math.round(pValue * 10000) / 10000, zScore: Math.round(z * 100) / 100 };
}

function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const approx = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * z * z) * poly;
  return z >= 0 ? approx : 1 - approx;
}

function resultsEmailHtml(experiments) {
  const rows = experiments.map(exp => {
    const variantRows = Object.entries(exp.results || {})
      .map(([v, d]) => `<tr><td style="padding:4px 8px">${v}</td><td style="padding:4px 8px">${d.impressions}</td><td style="padding:4px 8px">${d.conversions}</td><td style="padding:4px 8px">${d.conversionRate}%</td></tr>`)
      .join('');
    return `
      <h3 style="margin:24px 0 8px">${exp.name}</h3>
      <p style="margin:0 0 8px;color:#555">${exp.hypothesis}</p>
      <table style="border-collapse:collapse;font-size:14px">
        <thead><tr style="background:#f5f5f5"><th style="padding:4px 8px">Variant</th><th style="padding:4px 8px">Impressions</th><th style="padding:4px 8px">Conversions</th><th style="padding:4px 8px">CVR</th></tr></thead>
        <tbody>${variantRows}</tbody>
      </table>
      ${exp.winner ? `<p style="margin:8px 0 0;color:#2a7d4f"><strong>Winner: ${exp.winner}</strong> ${exp.significance?.significant ? '(statistically significant)' : '(not yet significant)'}</p>` : ''}
    `;
  }).join('<hr style="margin:24px 0;border:none;border-top:1px solid #eee">');

  return `
    <div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:32px 24px;color:#1a1a1a">
      <h2 style="margin:0 0 16px">A/B Experiment Results — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</h2>
      <p>Here are the results for experiments that have been running for 14+ days:</p>
      ${rows}
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

  // POST ?action=create
  if (req.method === 'POST' && action === 'create') {
    const { name, hypothesis, variants, metric, owner, impact, confidence, ease } = req.body || {};
    if (!name || !hypothesis || !Array.isArray(variants) || variants.length < 2) {
      return res.status(400).json({ error: 'name, hypothesis, and at least 2 variants required' });
    }

    let iceScore = null;
    if (impact != null && confidence != null && ease != null) {
      iceScore = Math.round((Number(impact) * Number(confidence) * Number(ease)) / 100 * 100) / 100;
    }

    const experiment = {
      name,
      hypothesis,
      variants,
      metric: metric || 'conversion',
      owner: owner || null,
      status: 'running',
      createdAt: new Date().toISOString(),
      iceScore,
      results: {},
    };

    await upstashSet(`ab:exp:${name}`, experiment);
    await upstashRaw(['SADD', 'ab:experiments', name]);

    return res.status(200).json({ experimentId: name, variants });
  }

  // GET ?action=assign&exp={name}&userId={id}
  if (req.method === 'GET' && action === 'assign') {
    const { exp, userId } = req.query;
    if (!exp || !userId) return res.status(400).json({ error: 'exp and userId required' });

    const raw = await upstashGet(`ab:exp:${exp}`);
    if (!raw) return res.status(404).json({ error: 'Experiment not found' });

    const experiment = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const variantCount = experiment.variants.length;
    const idx = hashUserId(userId, exp) % variantCount;
    const variant = experiment.variants[idx].name;

    await upstashSet(`ab:assign:${exp}:${userId}`, variant);

    return res.status(200).json({ variant });
  }

  // POST ?action=convert { exp, userId, value }
  if (req.method === 'POST' && action === 'convert') {
    const { exp, userId, value } = req.body || {};
    if (!exp || !userId) return res.status(400).json({ error: 'exp and userId required' });

    const variantRaw = await upstashGet(`ab:assign:${exp}:${userId}`);
    if (!variantRaw) return res.status(404).json({ error: 'No assignment found — call assign first' });

    const variant = typeof variantRaw === 'string' ? variantRaw : String(variantRaw);
    const convValue = Number(value) || 1;

    await upstashRaw(['HINCRBY', `ab:results:${exp}`, `${variant}:conversions`, convValue]);
    // Ensure impressions key exists
    await upstashRaw(['HSETNX', `ab:results:${exp}`, `${variant}:impressions`, '0']);

    return res.status(200).json({ ok: true, variant });
  }

  // POST ?action=impression { exp, userId }
  if (req.method === 'POST' && action === 'impression') {
    const { exp, userId } = req.body || {};
    if (!exp || !userId) return res.status(400).json({ error: 'exp and userId required' });

    const variantRaw = await upstashGet(`ab:assign:${exp}:${userId}`);
    if (!variantRaw) return res.status(404).json({ error: 'No assignment found — call assign first' });

    const variant = typeof variantRaw === 'string' ? variantRaw : String(variantRaw);

    await upstashRaw(['HINCRBY', `ab:results:${exp}`, `${variant}:impressions`, 1]);
    await upstashRaw(['HSETNX', `ab:results:${exp}`, `${variant}:conversions`, '0']);

    return res.status(200).json({ ok: true, variant });
  }

  // GET ?action=results&exp={name}
  if (req.method === 'GET' && action === 'results') {
    const { exp } = req.query;
    if (!exp) return res.status(400).json({ error: 'exp required' });

    const raw = await upstashGet(`ab:exp:${exp}`);
    if (!raw) return res.status(404).json({ error: 'Experiment not found' });

    const experiment = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const resultsHash = await upstashRaw(['HGETALL', `ab:results:${exp}`]);

    const variantData = {};
    if (Array.isArray(resultsHash)) {
      for (let i = 0; i < resultsHash.length; i += 2) {
        const field = resultsHash[i];
        const val = Number(resultsHash[i + 1]) || 0;
        const [variantName, metric] = field.split(':');
        if (!variantData[variantName]) variantData[variantName] = { impressions: 0, conversions: 0 };
        variantData[variantName][metric] = val;
      }
    }

    // Compute conversion rates
    for (const v of Object.keys(variantData)) {
      const d = variantData[v];
      d.conversionRate = d.impressions > 0 ? Math.round((d.conversions / d.impressions) * 10000) / 100 : 0;
    }

    // Determine winner if 2 variants
    let winner = null;
    let significance = null;
    const variantNames = Object.keys(variantData);
    if (variantNames.length === 2) {
      const [va, vb] = variantNames;
      const da = variantData[va];
      const db = variantData[vb];
      significance = calculateSignificance(da.conversions, da.impressions, db.conversions, db.impressions);
      if (significance.significant) {
        winner = da.conversionRate >= db.conversionRate ? va : vb;
      }
    }

    return res.status(200).json({
      experiment: { name: experiment.name, hypothesis: experiment.hypothesis, status: experiment.status, createdAt: experiment.createdAt, metric: experiment.metric, iceScore: experiment.iceScore },
      results: variantData,
      winner,
      significance,
    });
  }

  // GET ?action=list
  if (req.method === 'GET' && action === 'list') {
    const members = await upstashRaw(['SMEMBERS', 'ab:experiments']);
    const names = Array.isArray(members) ? members : [];

    const experiments = await Promise.all(
      names.map(async (name) => {
        const raw = await upstashGet(`ab:exp:${name}`);
        if (!raw) return null;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
      })
    );

    return res.status(200).json({ experiments: experiments.filter(Boolean) });
  }

  // Default cron run: check experiments > 14 days, email results
  if (req.method === 'GET' && !action) {
    const adminEmail = process.env.ADMIN_EMAIL;
    const members = await upstashRaw(['SMEMBERS', 'ab:experiments']);
    const names = Array.isArray(members) ? members : [];

    const now = Date.now();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const staleExperiments = [];

    for (const name of names) {
      const raw = await upstashGet(`ab:exp:${name}`);
      if (!raw) continue;
      const experiment = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (experiment.status !== 'running') continue;

      const age = now - new Date(experiment.createdAt).getTime();
      if (age < fourteenDaysMs) continue;

      // Get results
      const resultsHash = await upstashRaw(['HGETALL', `ab:results:${name}`]);
      const variantData = {};
      if (Array.isArray(resultsHash)) {
        for (let i = 0; i < resultsHash.length; i += 2) {
          const field = resultsHash[i];
          const val = Number(resultsHash[i + 1]) || 0;
          const [variantName, metric] = field.split(':');
          if (!variantData[variantName]) variantData[variantName] = { impressions: 0, conversions: 0 };
          variantData[variantName][metric] = val;
        }
      }
      for (const v of Object.keys(variantData)) {
        const d = variantData[v];
        d.conversionRate = d.impressions > 0 ? Math.round((d.conversions / d.impressions) * 10000) / 100 : 0;
      }

      let winner = null;
      let significance = null;
      const variantNames = Object.keys(variantData);
      if (variantNames.length === 2) {
        const [va, vb] = variantNames;
        const da = variantData[va];
        const db = variantData[vb];
        significance = calculateSignificance(da.conversions, da.impressions, db.conversions, db.impressions);
        if (significance.significant) {
          winner = da.conversionRate >= db.conversionRate ? va : vb;
        }
      }

      staleExperiments.push({ ...experiment, results: variantData, winner, significance });
    }

    let emailSent = false;
    if (staleExperiments.length > 0 && adminEmail) {
      emailSent = await sendEmail(
        adminEmail,
        `A/B Results: ${staleExperiments.length} experiment${staleExperiments.length > 1 ? 's' : ''} ready for review`,
        resultsEmailHtml(staleExperiments)
      );
    }

    const summary = {
      runAt: new Date().toISOString(),
      totalExperiments: names.length,
      staleExperiments: staleExperiments.length,
      emailSent,
    };
    await upstashSet('ab:last_run', summary);

    return res.status(200).json(summary);
  }

  return res.status(400).json({ error: 'Invalid action or method' });
}

export const config = { api: { bodyParser: true } };

// api/seo-orchestrator.js — SEO Team Master Orchestrator
// Runs all 11 SEO agents, collects results, sends one comprehensive weekly report
// Schedule: Every Monday 5:00 AM UTC (10:30 AM IST)
// Required env vars: ANTHROPIC_API_KEY, RESEND_API_KEY, ADMIN_EMAIL, CRON_SECRET
// Optional: GITHUB_TOKEN (for auto-commits), GSC_REFRESH_TOKEN (for real rankings), PERPLEXITY_API_KEY (for GEO)

import { run as runKeyword }     from './seo-keyword.js';
import { run as runContent }     from './seo-content.js';
import { run as runTechnical }   from './seo-technical.js';
import { run as runAEO }         from './seo-aeo.js';
import { run as runGEO }         from './seo-geo.js';
import { run as runLinks }       from './seo-links.js';
import { run as runAnalytics }   from './seo-analytics.js';
import { run as runCompetitive } from './seo-competitive.js';
import { run as runAuditor }     from './seo-auditor.js';
import { run as runGSC }         from './seo-gsc.js';

async function redis(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  return (await r?.json().catch(() => null))?.result ?? null;
}

async function sendEmail(to, subject, html) {
  const key  = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'OrreryX SEO Team <noreply@orreryx.io>';
  if (!key || !to) return false;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: to.trim(), subject, html }),
  }).catch(() => null);
  return r?.ok || false;
}

function section(title, color, content) {
  return `
    <div style="margin-bottom:24px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden">
      <div style="background:${color};padding:12px 18px">
        <h3 style="margin:0;color:#fff;font-size:14px;font-weight:700">${title}</h3>
      </div>
      <div style="padding:16px 18px;background:#fff;font-size:13px;color:#374151;line-height:1.6">
        ${content}
      </div>
    </div>`;
}

function badge(text, color) {
  return `<span style="display:inline-block;background:${color};color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:700;margin-right:4px">${text}</span>`;
}

function buildReport(results, date) {
  const { keyword, content, technical, aeo, geo, links, analytics, competitive, auditor, gsc } = results;

  // ── GSC Rankings Section ──────────────────────────────────────────────────────
  const gscHtml = gsc?.available
    ? `<strong>📊 Real Google Rankings (last 28 days)</strong><br>
       Total Clicks: <strong>${gsc.summary?.totalClicks?.toLocaleString()}</strong> &nbsp;|&nbsp;
       Impressions: <strong>${gsc.summary?.totalImpressions?.toLocaleString()}</strong> &nbsp;|&nbsp;
       Avg Position: <strong>${gsc.summary?.avgPosition}</strong> &nbsp;|&nbsp;
       Top 5 Keywords: <strong>${gsc.summary?.top5Keywords}</strong><br><br>
       <strong>🎯 Near-Miss Keywords (positions 6–15 — push to top 5):</strong><br>
       ${(gsc.nearMissKeywords || []).slice(0,5).map(k =>
         `• <strong>${k.keyword}</strong> — pos ${k.position} (${k.impressions} impressions, ${k.ctr} CTR)`
       ).join('<br>') || 'Connect GSC to see near-miss keywords'}`
    : `<strong>⚠️ Google Search Console not connected</strong><br>
       ${gsc?.reason || 'Set GSC_SERVICE_ACCOUNT_JSON in Vercel to unlock real ranking data.'}<br><br>
       ${gsc?.setup_steps ? '<strong>Setup Steps:</strong><br>' + (gsc.setup_steps || []).map(s => `${s}`).join('<br>') : ''}`;

  // ── Keyword Research Section ──────────────────────────────────────────────────
  const kwHtml = `<strong>${keyword?.summary || 'Keyword research complete'}</strong><br><br>
    <strong>🔥 High Priority Keywords:</strong><br>
    ${(keyword?.high_priority || []).slice(0, 3).map(k =>
      `• <strong>${k.keyword}</strong> — ${k.difficulty} difficulty → ${k.target_page} (${k.monthly_volume_est} searches/mo)`
    ).join('<br>')}<br><br>
    <strong>⚡ Quick Wins this week:</strong><br>
    ${(keyword?.quick_wins || []).slice(0, 2).map(k =>
      `• <strong>${k.keyword}</strong>: ${k.action}`
    ).join('<br>')}`;

  // ── Technical SEO Section ─────────────────────────────────────────────────────
  const techScore = technical?.score || 0;
  const techColor = techScore >= 80 ? '#16a34a' : techScore >= 60 ? '#d97706' : '#dc2626';
  const techHtml = `Score: <strong style="color:${techColor}">${techScore}/100</strong> &nbsp;|&nbsp; Avg TTFB: <strong>${technical?.avgTtfb || 0}ms</strong><br><br>
    <strong>🚨 Issues Found:</strong><br>
    ${(technical?.allIssues || []).slice(0, 5).map(i => `• ${i}`).join('<br>') || '✅ No critical issues'}<br><br>
    <strong>💡 Recommendations:</strong><br>
    ${(technical?.recommendations || []).map(r => `• ${r}`).join('<br>') || '• All good!'}`;

  // ── AEO Section ───────────────────────────────────────────────────────────────
  const aeoHtml = `<strong>Answer Engine Optimization (AEO)</strong><br>
    Pages patched with FAQ/Article/HowTo schema: <strong>${(aeo?.results || []).filter(r => r.committed).length}</strong> / ${(aeo?.results || []).length}<br><br>
    <strong>Schema Recommendations:</strong><br>
    ${(aeo?.geoRecommendations || []).slice(0, 4).map(r => `• ${r}`).join('<br>')}`;

  // ── GEO Section ───────────────────────────────────────────────────────────────
  const geoCited = geo?.citationCheck?.citesOrreryX;
  const geoHtml = `<strong>Generative Engine Optimization (GEO)</strong><br>
    AI Citation Status: <strong>${geoCited ? '✅ OrreryX IS cited by AI engines' : '❌ OrreryX NOT yet cited — entity building needed'}</strong><br>
    Content blocks injected this week: <strong>${(geo?.contentResults || []).filter(r => r.committed).length}</strong> / ${(geo?.contentResults || []).length}<br><br>
    <strong>🎯 Top Immediate GEO Actions:</strong><br>
    ${(geo?.geoStrategy?.immediateActions || []).slice(0, 3).map(a => `• ${a}`).join('<br>')}`;

  // ── Content Optimization Section ──────────────────────────────────────────────
  const contentHtml = `Pages optimized this week: <strong>${(content?.results || []).filter(r => r.committed).length} auto-committed to GitHub</strong><br><br>
    ${(content?.results || []).slice(0, 3).map(r =>
      `• <strong>${r.path}</strong>: ${r.optimized ? `Score ${r.optimized.score_before}→${r.optimized.score_after}` : 'Analyzed'} ${r.committed ? '✅ Auto-committed' : '📋 Pending'}`
    ).join('<br>')}`;

  // ── Link Building Section ─────────────────────────────────────────────────────
  const linksHtml = `<strong>This Week's Link Building Plan:</strong><br><br>
    <strong>📁 Directory Submissions (do these now — 15 min each):</strong><br>
    ${(links?.weeklyPlan?.directorySubmissions || []).map(d => `• <a href="${d.url}" style="color:#6366f1">${d.action}</a> — ${d.angle}`).join('<br>')}<br><br>
    <strong>✉️ Outreach Targets:</strong><br>
    ${(links?.weeklyPlan?.outreachCampaign?.targets || []).map(t => `• ${t}`).join('<br>')}<br><br>
    <strong>🔗 Internal Links to Add:</strong><br>
    • From ${links?.weeklyPlan?.internalLinking?.topPriority?.from} → add link to ${links?.weeklyPlan?.internalLinking?.topPriority?.to} using anchor "${links?.weeklyPlan?.internalLinking?.topPriority?.anchor}"`;

  // ── Analytics Section ─────────────────────────────────────────────────────────
  const analyticsHtml = `<strong>Traffic This Week:</strong><br>
    Page Views: <strong>${analytics?.analytics?.weeklyPV?.toLocaleString() || 0}</strong> &nbsp;|&nbsp;
    Signups: <strong>${analytics?.analytics?.weeklySG || 0}</strong> &nbsp;|&nbsp;
    Conversion Rate: <strong>${analytics?.analytics?.conversionRate || 0}%</strong><br><br>
    ${analytics?.insights ? `<strong>💡 AI Insights:</strong><br>${analytics.insights.replace(/\n/g, '<br>')}` : ''}`;

  // ── Competitive Intel Section ─────────────────────────────────────────────────
  const compHtml = `<strong>🎯 Top Opportunity This Week:</strong><br>
    ${competitive?.analysis?.weekly_action || 'Run competitive analysis'}<br><br>
    <strong>Content Gaps vs Competitors:</strong><br>
    ${(competitive?.analysis?.content_gaps || []).slice(0, 2).map(g =>
      `• <strong>${g.topic}</strong> → Create <a href="https://www.orreryx.io${g.suggested_page}" style="color:#6366f1">${g.suggested_page}</a> — ${g.why_we_can_win}`
    ).join('<br>')}`;

  // ── Content Audit Section ─────────────────────────────────────────────────────
  const auditHtml = `Average Content Score: <strong>${auditor?.avgScore || 0}/100</strong><br><br>
    <strong>🚨 Critical Issues:</strong><br>
    ${(auditor?.criticalIssues || []).slice(0, 4).map(i => `• ${i}`).join('<br>') || '✅ No critical content issues'}<br><br>
    ${(auditor?.auditResults || []).slice(0, 2).map(r =>
      r.aiAudit ? `• <strong>${r.path}</strong>: AI risk <strong>${r.aiAudit.ai_content_risk || 'unknown'}</strong> — ${(r.aiAudit.top_3_improvements || [])[0] || ''}` : ''
    ).filter(Boolean).join('<br>')}`;

  const autoCommits = (content?.results || []).filter(r => r.committed).length +
                      (aeo?.results || []).filter(r => r.committed).length +
                      (geo?.contentResults || []).filter(r => r.committed).length;

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:700px;margin:0 auto;background:#f9fafb">
      <div style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);padding:28px;border-radius:12px 12px 0 0">
        <h1 style="color:#fff;margin:0;font-size:22px">🤖 OrreryX SEO Team — Weekly Report</h1>
        <p style="color:#94a3b8;margin:8px 0 0;font-size:14px">Week ending ${date} &nbsp;|&nbsp; 11 agents ran &nbsp;|&nbsp; ${autoCommits} auto-commits to GitHub</p>
      </div>
      <div style="padding:24px">
        ${section('📊 Google Rankings (GSC)', '#6366f1', gscHtml)}
        ${section('🔍 Keyword Research', '#0891b2', kwHtml)}
        ${section('⚙️ Technical SEO', '#7c3aed', techHtml)}
        ${section('🤖 AEO (Answer Engine)', '#059669', aeoHtml)}
        ${section('🧠 GEO (AI Citation — ChatGPT/Perplexity)', '#0d9488', geoHtml)}
        ${section('✍️ Content Optimization', '#dc2626', contentHtml)}
        ${section('🔗 Link Building', '#d97706', linksHtml)}
        ${section('📈 Analytics', '#2563eb', analyticsHtml)}
        ${section('🎯 Competitive Intelligence', '#7c3aed', compHtml)}
        ${section('🔬 AI Content Audit', '#374151', auditHtml)}
        <div style="text-align:center;padding:20px">
          <a href="https://www.orreryx.io/admin" style="background:#6366f1;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Open Admin Panel →</a>
        </div>
      </div>
    </div>`;
}

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  const qs   = req.query.secret || '';
  if (cronSecret && auth !== `Bearer ${cronSecret}` && qs !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const host  = req.headers.host || 'www.orreryx.io';
  const today = new Date().toISOString().split('T')[0];

  // Run all agents in parallel (GSC + analytics + competitive + auditor) then sequential heavy ones
  const [analytics, gsc, competitive, auditor] = await Promise.all([
    runAnalytics().catch(e => ({ error: e.message })),
    runGSC().catch(e => ({ error: e.message })),
    runCompetitive(host).catch(e => ({ error: e.message })),
    runAuditor().catch(e => ({ error: e.message })),
  ]);

  // Run content-heavy agents
  const [keyword, technical, aeo, geo, links, content] = await Promise.all([
    runKeyword(host).catch(e => ({ error: e.message })),
    runTechnical().catch(e => ({ error: e.message })),
    runAEO().catch(e => ({ error: e.message })),
    runGEO().catch(e => ({ error: e.message })),
    runLinks().catch(e => ({ error: e.message })),
    runContent(host).catch(e => ({ error: e.message })),
  ]);

  const results = { keyword, content, technical, aeo, geo, links, analytics, competitive, auditor, gsc };

  // Save orchestrator summary to Redis
  const summary = {
    date: today,
    agentsRan: 11,
    autoCommits: (content?.results || []).filter(r => r.committed).length + (aeo?.results || []).filter(r => r.committed).length + (geo?.contentResults || []).filter(r => r.committed).length,
    techScore: technical?.score || 0,
    avgContentScore: auditor?.avgScore || 0,
    weeklyPV: analytics?.analytics?.weeklyPV || 0,
    gscConnected: gsc?.available || false,
    generatedAt: Date.now(),
  };
  await redis(['SET', 'seo:orchestrator:latest', JSON.stringify(summary), 'EX', 604800]);

  // Send email report
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  let emailSent = false;
  if (adminEmail) {
    const html = buildReport(results, today);
    emailSent = await sendEmail(adminEmail, `🤖 SEO Team Weekly Report — ${today} — ${summary.techScore}/100 Tech Score`, html);
  }

  return res.status(200).json({ ok: true, summary, emailSent, date: today });
}
export const config = { api: { bodyParser: false } };

// api/_ops-alert.js — Centralized ops alerting
// Used by all agents to send real-time alerts to Slack/Discord webhook.
// Replaces the "email-everything-to-CEO" anti-pattern.
//
// Usage:
//   import { opsAlert } from './_ops-alert.js';
//   await opsAlert('error', 'breaking-news', 'LinkedIn 401: token expired', { url });
//   await opsAlert('info',  'social-post',   'Brief sent: ' + headline);
//   await opsAlert('success', 'ai-council',  '3 AIs convened, verdict ready');
//
// Required env (optional — silently no-op if not set):
//   SLACK_WEBHOOK_URL or DISCORD_WEBHOOK_URL
//   Both can be set — alerts go to both.

const LEVEL_META = {
  error:   { emoji: '🔴', color: '#ef4444', slack: 'danger'  },
  warn:    { emoji: '🟡', color: '#f59e0b', slack: 'warning' },
  info:    { emoji: '🔵', color: '#3b82f6', slack: 'good'    },
  success: { emoji: '🟢', color: '#22c55e', slack: 'good'    },
};

/**
 * Send an ops alert to Slack and/or Discord.
 * @param {'error'|'warn'|'info'|'success'} level
 * @param {string} agent      — agent name (e.g. 'breaking-news')
 * @param {string} message    — short message
 * @param {object} [details]  — optional extra data (will be shown as code block)
 */
export async function opsAlert(level, agent, message, details = null) {
  const meta = LEVEL_META[level] || LEVEL_META.info;
  const ts = new Date().toISOString();
  const env = process.env.VERCEL_ENV || 'production';

  // ── Slack ────────────────────────────────────────────────────────────────────
  const slackUrl = process.env.SLACK_WEBHOOK_URL;
  if (slackUrl) {
    try {
      const slackBody = {
        text: `${meta.emoji} *[${agent}]* ${message}`,
        attachments: [{
          color: meta.color,
          fields: [
            { title: 'Agent',     value: agent, short: true },
            { title: 'Level',     value: level, short: true },
            { title: 'Env',       value: env,   short: true },
            { title: 'Time',      value: ts,    short: true },
          ],
          ...(details ? { text: '```' + JSON.stringify(details, null, 2).slice(0, 1500) + '```' } : {}),
          mrkdwn_in: ['text'],
        }],
      };
      await fetch(slackUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(slackBody),
        signal:  AbortSignal.timeout(5000),
      }).catch(() => {});
    } catch (_) {}
  }

  // ── Discord ──────────────────────────────────────────────────────────────────
  const discordUrl = process.env.DISCORD_OPS_WEBHOOK_URL || process.env.DISCORD_WEBHOOK_URL;
  if (discordUrl) {
    try {
      const detailsBlock = details
        ? '\n```json\n' + JSON.stringify(details, null, 2).slice(0, 1500) + '\n```'
        : '';
      const discordBody = {
        embeds: [{
          title:       `${meta.emoji} ${agent}`,
          description: message + detailsBlock,
          color:       parseInt(meta.color.replace('#', ''), 16),
          timestamp:   ts,
          footer:      { text: `OrreryX Ops · ${env}` },
        }],
      };
      await fetch(discordUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(discordBody),
        signal:  AbortSignal.timeout(5000),
      }).catch(() => {});
    } catch (_) {}
  }
}

// Convenience helpers
export const opsError   = (agent, msg, details) => opsAlert('error',   agent, msg, details);
export const opsWarn    = (agent, msg, details) => opsAlert('warn',    agent, msg, details);
export const opsInfo    = (agent, msg, details) => opsAlert('info',    agent, msg, details);
export const opsSuccess = (agent, msg, details) => opsAlert('success', agent, msg, details);

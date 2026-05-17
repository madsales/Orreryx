// api/push.js — Send web push notifications to all subscribers
// Actions:
//   POST /api/push?action=send  (admin only) — broadcast to all subscribers
//   POST /api/push?action=subscribe — save subscription from browser
//   GET  /api/push?action=count  (admin only) — how many subscribers

import webpush from 'web-push';

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BLsSZHwHWh-s7yupwkgsexSSs9NSEt4aG1bzX1aIY8YxY47jarYUQmeC7hu5g9-NzMGUsE9vLuMdpDPIiACovhg';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL   = process.env.VAPID_EMAIL       || 'mailto:admin@orreryx.io';
const ADMIN_PWD     = process.env.ADMIN_PASSWORD    || '';

// ── Redis helpers ─────────────────────────────────────────────────────────────
const redisUrl   = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmd) {
  if (!redisUrl || !redisToken) return null;
  const r = await fetch(`${redisUrl}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([cmd]),
  });
  const d = await r.json();
  return d?.[0]?.result ?? null;
}

async function redisBatch(cmds) {
  if (!redisUrl || !redisToken) return [];
  const r = await fetch(`${redisUrl}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  const d = await r.json();
  return d?.map(x => x.result) ?? [];
}

// Get all push subscription keys from Redis (stored as push:sub:<hash>)
async function getAllSubscriptions() {
  const keys = await redis(['KEYS', 'push:sub:*']);
  if (!keys || !keys.length) return [];
  const values = await redisBatch(keys.map(k => ['GET', k]));
  return values
    .filter(Boolean)
    .map(v => { try { return JSON.parse(v); } catch { return null; } })
    .filter(Boolean);
}

// Store a subscription
async function saveSubscription(sub) {
  const hash = Buffer.from(sub.endpoint).toString('base64').slice(0, 32);
  await redis(['SET', `push:sub:${hash}`, JSON.stringify(sub), 'EX', 7776000]); // 90 days
  return hash;
}

// Remove a dead subscription
async function removeSubscription(endpoint) {
  const hash = Buffer.from(endpoint).toString('base64').slice(0, 32);
  await redis(['DEL', `push:sub:${hash}`]);
}

// ── FCM helpers ───────────────────────────────────────────────────────────────
async function registerFCMToken(userId, token) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok || !token) return false;
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', `push:fcm:${userId || token.slice(-16)}`, token, 'EX', 7776000]),
  }).catch(() => {});
  return true;
}

export async function sendFCMNotification(token, title, body, data = {}) {
  const fcmKey = process.env.FIREBASE_SERVER_KEY;
  if (!fcmKey || !token) return false;
  const r = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: { Authorization: `key=${fcmKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: token,
      priority: 'high',
      notification: { title, body, icon: 'ic_notification', color: '#e03836' },
      data,
    }),
  }).catch(() => null);
  return r?.ok || false;
}

// ── Auth helper ───────────────────────────────────────────────────────────────
function isAuthed(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  return ADMIN_PWD && token === ADMIN_PWD;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // FCM token registration from mobile app
  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    if (body.platform === 'android' && body.token) {
      await registerFCMToken(body.userId, body.token);
      return Response.json({ ok: true, registered: true });
    }
  }

  const action = req.query.action || 'send';

  // ── SUBSCRIBE (public — any visitor) ───────────────────────────────────────
  if (action === 'subscribe') {
    if (req.method !== 'POST') return res.status(405).end();
    const sub = req.body;
    if (!sub?.endpoint) return res.status(400).json({ error: 'Invalid subscription object' });
    try {
      const hash = await saveSubscription(sub);
      return res.status(200).json({ ok: true, id: hash });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── PUBLIC KEY (used by browser to subscribe) ───────────────────────────────
  if (action === 'vapid-key') {
    return res.status(200).json({ publicKey: VAPID_PUBLIC });
  }

  // ── SUBSCRIBER COUNT (admin) ───────────────────────────────────────────────
  if (action === 'count') {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
    const keys = await redis(['KEYS', 'push:sub:*']);
    return res.status(200).json({ ok: true, count: keys?.length || 0 });
  }

  // ── SEND (admin) ───────────────────────────────────────────────────────────
  if (action === 'send') {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
    if (req.method !== 'POST') return res.status(405).end();
    if (!VAPID_PRIVATE) return res.status(503).json({ error: 'VAPID_PRIVATE_KEY not set in Vercel env vars' });

    const { title, body, url, tag, icon } = req.body || {};
    if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

    webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

    const payload = JSON.stringify({
      title: title || 'OrreryX Alert',
      body:  body  || 'New geopolitical risk update',
      url:   url   || 'https://www.orreryx.io/risk-dashboard',
      tag:   tag   || 'orreryx-alert-' + Date.now(),
      icon:  icon  || '/icon-192.png',
    });

    const subscriptions = await getAllSubscriptions();
    if (!subscriptions.length) return res.status(200).json({ ok: true, sent: 0, failed: 0, message: 'No subscribers yet' });

    let sent = 0, failed = 0, expired = 0;

    await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(sub, payload, { TTL: 86400 });
          sent++;
        } catch (e) {
          if (e.statusCode === 410 || e.statusCode === 404) {
            // Subscription expired — remove it
            await removeSubscription(sub.endpoint);
            expired++;
          } else {
            failed++;
          }
        }
      })
    );

    return res.status(200).json({ ok: true, sent, failed, expired, total: subscriptions.length });
  }

  return res.status(400).json({ error: 'Unknown action. Use: subscribe | send | count | vapid-key' });
}

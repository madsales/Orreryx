import Redis from 'ioredis';

function getRedis() {
  const url = process.env.REDIS_URL || '';
  if (!url) throw new Error('REDIS_URL is not configured');

  const opts = {
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
    enableReadyCheck: false,
    lazyConnect: true
  };

  if (url.startsWith('rediss://')) opts.tls = {};
  return new Redis(url, opts);
}

async function closeRedis(redis) {
  if (!redis) return;
  try {
    await Promise.race([
      redis.quit(),
      new Promise(resolve => setTimeout(resolve, 1000))
    ]);
  } catch (_) {}
}

function normalizePlan(plan, orderId = '') {
  const p = String(plan || '').toLowerCase().trim();

  if (p === 'command' || p === 'c') return 'c';
  if (p === 'analyst' || p === 'a') return 'a';
  if (p === 'starter' || p === 's') return 's';

  const parts = String(orderId).split('_');
  if (parts.length >= 2) {
    const fromOrder = String(parts[1]).toLowerCase();
    if (fromOrder === 'c' || fromOrder === 'a' || fromOrder === 's') return fromOrder;
  }

  return 's';
}

function normalizeStatus(data) {
  const raw = String(
    data?.status ||
    data?.payment_status ||
    data?.paymentStatus ||
    data?.orderStatus ||
    ''
  ).toLowerCase().trim();

  if (data?.paid === true) return 'paid';
  if (['paid', 'captured', 'success', 'completed'].includes(raw)) return 'paid';
  if (['failed', 'cancelled', 'canceled', 'declined', 'expired'].includes(raw)) return 'failed';
  if (['pending', 'processing', 'created', 'authorized', 'initiated'].includes(raw)) return 'pending';

  return 'pending';
}

function isSandbox(req, data) {
  const modeFromQuery = String(req.query.mode || req.query.env || '').toLowerCase();
  const modeFromEnv = String(process.env.PAYMENT_MODE || '').toLowerCase();
  const modeFromData = String(data?.env || data?.mode || '').toLowerCase();

  return (
    modeFromQuery === 'sandbox' ||
    modeFromQuery === 'test' ||
    modeFromEnv === 'sandbox' ||
    modeFromEnv === 'test' ||
    modeFromData === 'sandbox' ||
    modeFromData === 'test'
  );
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const orderId = String(req.query.orderId || '').trim();
  if (!orderId) {
    return res.status(400).json({
      paid: false,
      status: 'failed',
      error: 'orderId required'
    });
  }

  let redis;
  try {
    redis = getRedis();

    const raw = await redis.get(`order:${orderId}`);
    if (!raw) {
      return res.status(404).json({
        paid: false,
        status: 'pending',
        orderId,
        error: 'Order not found'
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(500).json({
        paid: false,
        status: 'failed',
        orderId,
        error: 'Stored order data is invalid JSON'
      });
    }

    const plan = normalizePlan(data.plan, orderId);
    const status = normalizeStatus(data);
    const sandbox = isSandbox(req, data);

    const sandboxForcePaid = sandbox && (
      data.qaPaid === true ||
      String(process.env.SANDBOX_FORCE_PAID || '').toLowerCase() === 'true'
    );

    const paid = sandboxForcePaid ? true : status === 'paid';

    return res.status(200).json({
      orderId,
      plan,
      paid,
      status: paid ? 'paid' : status,
      env: sandbox ? 'sandbox' : 'live'
    });
  } catch (e) {
    console.error('[OrderStatus] Error:', e.message);
    return res.status(500).json({
      paid: false,
      status: 'failed',
      error: e.message
    });
  } finally {
    await closeRedis(redis);
  }
}
import { kv } from '@vercel/kv';
import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, plan } = req.body || {};
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if(!RESEND_KEY) return res.status(500).json({ error: 'Email service not configured. Add RESEND_API_KEY to Vercel env vars.' });

  // Generate secure token
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 15 * 60 * 1000; // 15 minutes

  // Store token in Vercel KV
  await kv.set(`magic:${token}`, JSON.stringify({ email, plan, expires }), { ex: 900 }); // 15min TTL

  // Build magic link
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';
  const magicLink = `${baseUrl}/api/verify-magic?token=${token}`;

  // Send email via Resend
  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'Orrery <onboarding@resend.dev>', // ← change to your domain
      to: [email],
      subject: 'Your Orrery sign-in link',
      html: `
        <div style="background:#09090b;color:#f0f0ec;font-family:'IBM Plex Mono',monospace;padding:40px;max-width:480px;margin:0 auto;border:1px solid rgba(255,255,255,.1);border-radius:8px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:32px">
            <div style="width:32px;height:32px;background:#f0f0ec;border-radius:4px;display:flex;align-items:center;justify-content:center;font-weight:700;color:#09090b;font-size:14px">O</div>
            <span style="font-size:16px;font-weight:700;letter-spacing:.04em">Orrery</span>
          </div>
          <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#666670;margin-bottom:10px">Sign-in link</div>
          <div style="font-size:20px;font-weight:700;margin-bottom:12px">Click to access Orrery</div>
          <div style="font-size:13px;color:#b0b0aa;line-height:1.6;margin-bottom:28px">
            This link expires in <strong style="color:#f0f0ec">15 minutes</strong> and can only be used once.
          </div>
          <a href="${magicLink}" style="display:block;background:#f0f0ec;color:#09090b;text-decoration:none;text-align:center;padding:14px;border-radius:4px;font-weight:700;font-size:11px;letter-spacing:.08em">
            OPEN ORRERY →
          </a>
          <div style="margin-top:24px;font-size:10px;color:#666670;line-height:1.6">
            If you didn't request this, you can safely ignore this email.<br>
            This link will expire automatically.
          </div>
          <div style="margin-top:24px;padding-top:20px;border-top:1px solid rgba(255,255,255,.07);font-size:9px;color:#444450">
            © 2026 Orrery · Geopolitical Market Intelligence
          </div>
        </div>
      `,
    }),
  });

  if(!emailRes.ok) {
    const err = await emailRes.json();
    console.error('Resend error:', err);
    return res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }

  return res.status(200).json({ success: true });
}

export const config = { api: { bodyParser: true } };

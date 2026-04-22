// promo.js — Orreryx upgrade nudge bar
// Include on any free content page: <script src="/promo.js" defer></script>
// Hides automatically for Command (plan=c) subscribers.

(function () {
  'use strict';

  // ── Check if already on Command plan ───────────────────────────────────────
  try {
    const s = JSON.parse(localStorage.getItem('orrery_session') || '{}');
    const p = (s.plan || '').toLowerCase();
    if (p === 'c' || p === 'command') return; // already paying — don't nag
  } catch (_) {}

  // ── Inject styles ───────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #ory-promo-bar {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      z-index: 8888;
      background: #0d0d0f;
      border-top: 1px solid rgba(58,184,96,0.25);
      padding: 0 20px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-family: 'Helvetica Neue', Arial, sans-serif;
      box-shadow: 0 -4px 24px rgba(0,0,0,0.5);
      transform: translateY(100%);
      transition: transform 0.4s cubic-bezier(0.22,1,0.36,1);
    }
    #ory-promo-bar.visible { transform: translateY(0); }
    #ory-promo-left {
      display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;
    }
    #ory-promo-badge {
      background: rgba(58,184,96,0.12);
      border: 1px solid rgba(58,184,96,0.3);
      border-radius: 4px;
      padding: 3px 8px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1px;
      color: #3ab860;
      white-space: nowrap;
      flex-shrink: 0;
    }
    #ory-promo-text {
      font-size: 12px;
      color: #a0a09a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #ory-promo-text strong { color: #f0f0ec; }
    #ory-promo-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    #ory-promo-cta {
      background: #3ab860;
      color: #000;
      border: none;
      border-radius: 4px;
      padding: 8px 16px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.5px;
      cursor: pointer;
      text-decoration: none;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: background 0.15s;
    }
    #ory-promo-cta:hover { background: #2ea050; }
    #ory-promo-trial {
      color: #6b7280;
      font-size: 11px;
      text-decoration: none;
      white-space: nowrap;
      transition: color 0.15s;
    }
    #ory-promo-trial:hover { color: #f0f0ec; }
    #ory-promo-close {
      background: none; border: none; cursor: pointer;
      color: #444; font-size: 16px; padding: 4px 6px;
      transition: color 0.15s; flex-shrink: 0; line-height: 1;
    }
    #ory-promo-close:hover { color: #f0f0ec; }
    @media (max-width: 600px) {
      #ory-promo-trial { display: none; }
      #ory-promo-text { font-size: 11px; }
    }
  `;
  document.head.appendChild(style);

  // ── Build bar HTML ──────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.id = 'ory-promo-bar';
  bar.setAttribute('role', 'banner');
  bar.innerHTML = `
    <div id="ory-promo-left">
      <div id="ory-promo-badge">⚡ COMMAND</div>
      <div id="ory-promo-text">
        <strong>Interactive Risk Map</strong> — live conflict markers, market impact &amp; country risk profiles. Command exclusive.
      </div>
    </div>
    <div id="ory-promo-right">
      <a href="/map" id="ory-promo-cta">🗺️ Unlock Map — $34.99/mo</a>
      <a href="/login?plan=f" id="ory-promo-trial">Free trial</a>
      <button id="ory-promo-close" aria-label="Dismiss">×</button>
    </div>
  `;
  document.body.appendChild(bar);

  // ── Add bottom padding so bar doesn't cover page content ───────────────────
  document.body.style.paddingBottom = '48px';

  // ── Slide in after short delay ──────────────────────────────────────────────
  setTimeout(() => bar.classList.add('visible'), 1200);

  // ── Dismiss ─────────────────────────────────────────────────────────────────
  document.getElementById('ory-promo-close').addEventListener('click', () => {
    bar.style.transform = 'translateY(100%)';
    document.body.style.paddingBottom = '';
    // Remember dismissed for this session
    try { sessionStorage.setItem('ory_promo_dismissed', '1'); } catch (_) {}
  });

  // Don't re-show if dismissed this session
  try {
    if (sessionStorage.getItem('ory_promo_dismissed')) {
      bar.style.display = 'none';
      document.body.style.paddingBottom = '';
    }
  } catch (_) {}

  // ── Track promo impression ──────────────────────────────────────────────────
  try {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'click', target: 'promo_bar_impression' }),
    }).catch(() => {});
  } catch (_) {}

})();

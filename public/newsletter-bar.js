// newsletter-bar.js — Injects a sticky bottom email capture bar
// Include via: <script src="/newsletter-bar.js" defer></script>

(function() {
  // Don't show if already subscribed or dismissed
  if (localStorage.getItem('nl_subscribed') || localStorage.getItem('nl_dismissed')) return;

  // Wait 20 seconds before showing
  setTimeout(inject, 20000);

  function inject() {
    const bar = document.createElement('div');
    bar.id = 'nl-bar';
    bar.innerHTML = `
      <style>
        #nl-bar {
          position: fixed; bottom: 0; left: 0; right: 0; z-index: 9999;
          background: #0e0e12; border-top: 1px solid rgba(224,56,54,.3);
          padding: 14px 24px;
          display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          box-shadow: 0 -4px 24px rgba(0,0,0,.5);
          animation: slideUp .4s ease;
        }
        @keyframes slideUp { from{transform:translateY(100%)} to{transform:translateY(0)} }
        #nl-bar .nl-icon { font-size: 20px; flex-shrink: 0; }
        #nl-bar .nl-text { flex: 1; min-width: 200px; }
        #nl-bar .nl-title { font-size: 14px; font-weight: 700; color: #e8e8e2; }
        #nl-bar .nl-sub { font-size: 12px; color: #888882; }
        #nl-bar .nl-form { display: flex; gap: 8px; flex-shrink: 0; }
        #nl-bar .nl-input {
          background: #07070a; border: 1px solid rgba(255,255,255,.15);
          border-radius: 4px; padding: 9px 14px;
          color: #e8e8e2; font-size: 13px; width: 220px;
          outline: none;
        }
        #nl-bar .nl-input:focus { border-color: rgba(224,56,54,.5); }
        #nl-bar .nl-btn {
          background: #e03836; color: #fff; border: none;
          border-radius: 4px; padding: 9px 18px;
          font-size: 13px; font-weight: 700; cursor: pointer;
          white-space: nowrap;
        }
        #nl-bar .nl-btn:hover { opacity: .9; }
        #nl-bar .nl-close {
          background: none; border: none; color: #585852;
          font-size: 20px; cursor: pointer; padding: 0 4px; flex-shrink: 0;
        }
        #nl-bar .nl-success {
          font-size: 14px; color: #3a9e6e; font-weight: 700;
          display: none; align-items: center; gap: 8px;
        }
      </style>
      <div class="nl-icon">📡</div>
      <div class="nl-text">
        <div class="nl-title">Weekly Geopolitical Briefing — Free</div>
        <div class="nl-sub">3 conflicts moving markets · 1 trade idea · Every Monday</div>
      </div>
      <div class="nl-form">
        <input class="nl-input" type="email" placeholder="your@email.com" id="nl-email">
        <button class="nl-btn" id="nl-submit">GET BRIEFING</button>
      </div>
      <div class="nl-success" id="nl-success">✓ You're in! First briefing coming Monday.</div>
      <button class="nl-close" id="nl-close">×</button>
    `;
    document.body.appendChild(bar);

    document.getElementById('nl-close').onclick = function() {
      bar.remove();
      localStorage.setItem('nl_dismissed', '1');
    };

    document.getElementById('nl-submit').onclick = async function() {
      const email = document.getElementById('nl-email').value.trim();
      if (!email || !email.includes('@')) {
        document.getElementById('nl-email').style.borderColor = '#e03836';
        return;
      }
      this.textContent = '...';
      this.disabled = true;
      try {
        const r = await fetch('/api/newsletter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, source: window.location.pathname }),
        });
        const d = await r.json();
        if (d.ok || d.status === 'already_subscribed') {
          document.querySelector('#nl-bar .nl-form').style.display = 'none';
          document.getElementById('nl-success').style.display = 'flex';
          localStorage.setItem('nl_subscribed', '1');
          setTimeout(() => bar.remove(), 4000);
          // Fire Google Ads conversion
          if (typeof gtag !== 'undefined') {
            gtag('event', 'conversion', { send_to: 'AW-18101684972' });
          }
        }
      } catch(e) {
        this.textContent = 'GET BRIEFING';
        this.disabled = false;
      }
    };

    // Allow Enter key
    document.getElementById('nl-email').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') document.getElementById('nl-submit').click();
    });
  }
})();

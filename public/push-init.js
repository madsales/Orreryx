// OrreryX Web Push — Auto-prompts all visitors after 8 seconds
// Included on every page via <script src="/push-init.js" defer></script>

(function () {
  const VAPID_PUBLIC = 'BLsSZHwHWh-s7yupwkgsexSSs9NSEt4aG1bzX1aIY8YxY47jarYUQmeC7hu5g9-NzMGUsE9vLuMdpDPIiACovhg';
  const STORAGE_KEY  = 'orrx_push_state'; // 'granted' | 'denied' | 'dismissed'

  // Don't show if already handled
  const state = localStorage.getItem(STORAGE_KEY);
  if (state === 'granted' || state === 'denied') return;

  // Don't show if browser doesn't support push
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;

  // Already granted at OS level — just register silently
  if (Notification.permission === 'granted') {
    _registerSilent();
    return;
  }

  // Already denied at OS level — nothing we can do
  if (Notification.permission === 'denied') {
    localStorage.setItem(STORAGE_KEY, 'denied');
    return;
  }

  // Show subtle toast after 8 seconds (non-intrusive)
  setTimeout(_showToast, 8000);

  function _showToast() {
    // Don't re-show if dismissed in this session
    if (sessionStorage.getItem('orrx_push_dismissed')) return;

    const toast = document.createElement('div');
    toast.id = 'push-toast';
    toast.innerHTML = `
      <div style="
        position:fixed;bottom:24px;right:24px;z-index:99999;
        background:#131318;border:1px solid rgba(58,184,96,0.4);
        border-radius:12px;padding:16px 18px;max-width:320px;
        box-shadow:0 8px 32px rgba(0,0,0,0.6);
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        display:flex;align-items:flex-start;gap:12px;
        animation:slideIn 0.3s ease;
      ">
        <span style="font-size:22px;flex-shrink:0;margin-top:2px">🌍</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:700;color:#f0f0f0;margin-bottom:4px">
            Breaking Geopolitical Alerts
          </div>
          <div style="font-size:12px;color:#a0a0a0;line-height:1.5;margin-bottom:12px">
            Get instant alerts when conflicts escalate, sanctions drop, or markets react.
          </div>
          <div style="display:flex;gap:8px">
            <button id="push-allow" style="
              flex:1;padding:8px 0;background:#3ab860;border:none;border-radius:6px;
              color:#000;font-size:12px;font-weight:700;cursor:pointer;
            ">Allow Alerts</button>
            <button id="push-dismiss" style="
              padding:8px 12px;background:transparent;border:1px solid rgba(255,255,255,0.15);
              border-radius:6px;color:#888;font-size:12px;cursor:pointer;
            ">Not now</button>
          </div>
        </div>
        <button id="push-close" style="
          background:none;border:none;color:#666;font-size:18px;cursor:pointer;
          padding:0;line-height:1;margin-top:-2px;flex-shrink:0;
        ">×</button>
      </div>
      <style>
        @keyframes slideIn { from { transform:translateY(20px);opacity:0 } to { transform:translateY(0);opacity:1 } }
      </style>
    `;
    document.body.appendChild(toast);

    const remove = () => { toast.remove(); sessionStorage.setItem('orrx_push_dismissed', '1'); };

    document.getElementById('push-allow').onclick = async () => {
      toast.remove();
      const ok = await _subscribe();
      if (ok) _showSuccessToast();
    };
    document.getElementById('push-dismiss').onclick = remove;
    document.getElementById('push-close').onclick = remove;

    // Auto-hide after 15 seconds
    setTimeout(remove, 15000);
  }

  function _showSuccessToast() {
    const t = document.createElement('div');
    t.innerHTML = `
      <div style="
        position:fixed;bottom:24px;right:24px;z-index:99999;
        background:#131318;border:1px solid rgba(58,184,96,0.5);
        border-radius:10px;padding:12px 16px;
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        font-size:13px;color:#f0f0f0;
        box-shadow:0 8px 32px rgba(0,0,0,0.5);
        display:flex;align-items:center;gap:10px;
        animation:slideIn 0.3s ease;
      ">
        <span style="font-size:18px">✅</span>
        <span>You'll receive breaking geopolitical alerts!</span>
      </div>
    `;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  async function _subscribe() {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        localStorage.setItem(STORAGE_KEY, 'denied');
        return false;
      }
      // Check existing subscription
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC),
        });
      }
      // Save to server
      await fetch('/api/push?action=subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      localStorage.setItem(STORAGE_KEY, 'granted');
      return true;
    } catch (e) {
      console.warn('[OrreryX Push]', e.message);
      return false;
    }
  }

  async function _registerSilent() {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: _urlBase64ToUint8Array(VAPID_PUBLIC),
        });
        await fetch('/api/push?action=subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub.toJSON()),
        });
      }
      localStorage.setItem(STORAGE_KEY, 'granted');
    } catch (_) {}
  }

  function _urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }
})();

// Orreryx Push Notification Initialiser
// Include on any page: <script src="/push-init.js"></script>
// Then call: OrreryxPush.subscribe() on button click

window.OrreryxPush = {
  VAPID_PUBLIC_KEY: 'BN4QZ4_ulkA1JMnpaR8qhDcXbetA3aUG460ZIiBLYn2TmUR-XLfzzJGtL8PQVSynVwOB8KdBIyCR_vM25vXWqEE', // placeholder — replace with real VAPID key

  async subscribe() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.log('[Push] Not supported');
      return false;
    }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return false;
      const existing = await reg.pushManager.getSubscription();
      if (existing) return true;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this._urlBase64ToUint8Array(this.VAPID_PUBLIC_KEY)
      });
      await fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'push_subscribe', subscription: sub.toJSON() })
      });
      return true;
    } catch (e) {
      console.error('[Push] Subscribe error:', e);
      return false;
    }
  },

  _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }
};

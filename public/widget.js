/**
 * Orreryx Conflict Risk Widget — v1.0
 * Embed on any website:
 * <div id="orrery-widget"></div>
 * <script src="https://www.orreryx.io/widget.js"></script>
 *
 * Customise:
 * <div id="orrery-widget" data-theme="dark" data-compact="true" data-conflicts="5"></div>
 */
(function() {
  'use strict';

  const CONFLICTS = [
    { name: 'Ukraine–Russia',    risk: 94, region: 'Europe',        color: '#f44336', trend: '↑' },
    { name: 'Israel–Gaza',       risk: 91, region: 'Middle East',   color: '#f44336', trend: '→' },
    { name: 'India–Pakistan',    risk: 88, region: 'South Asia',    color: '#f44336', trend: '↑' },
    { name: 'South China Sea',   risk: 87, region: 'Asia-Pacific',  color: '#f44336', trend: '↑' },
    { name: 'DRC Congo',         risk: 83, region: 'Africa',        color: '#ff5722', trend: '→' },
    { name: 'Sudan Civil War',   risk: 81, region: 'Africa',        color: '#ff5722', trend: '↑' },
    { name: 'Iran–Nuclear',      risk: 79, region: 'Middle East',   color: '#ff9800', trend: '↑' },
    { name: 'Taiwan Strait',     risk: 76, region: 'Asia-Pacific',  color: '#ff9800', trend: '→' },
    { name: 'Myanmar',           risk: 74, region: 'Southeast Asia',color: '#ff9800', trend: '→' },
    { name: 'North Korea',       risk: 72, region: 'East Asia',     color: '#ff9800', trend: '↑' },
  ];

  function createWidget(container) {
    const theme    = container.getAttribute('data-theme') || 'dark';
    const compact  = container.getAttribute('data-compact') === 'true';
    const maxCount = parseInt(container.getAttribute('data-conflicts') || '5', 10);
    const shown    = CONFLICTS.slice(0, Math.min(maxCount, CONFLICTS.length));

    const BG  = theme === 'light' ? '#f5f5f5' : '#0d0d14';
    const BG2 = theme === 'light' ? '#fff'     : '#15151e';
    const BOR = theme === 'light' ? '#e0e0e0'  : 'rgba(255,255,255,0.1)';
    const TXT = theme === 'light' ? '#1a1a1a'  : '#e8eaf6';
    const MUT = theme === 'light' ? '#666'     : '#9e9e9e';

    const rowsHtml = shown.map(c => `
      <div style="display:flex;align-items:center;gap:10px;padding:${compact?'8px':'10px'} 0;border-bottom:1px solid ${BOR}">
        <div style="font-size:${compact?'0.75rem':'0.8rem'};font-weight:700;color:${c.color};min-width:28px;text-align:center">${c.risk}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:${compact?'0.8rem':'0.85rem'};font-weight:600;color:${TXT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</div>
          <div style="font-size:0.7rem;color:${MUT}">${c.region}</div>
        </div>
        <div style="width:${compact?'60px':'80px'};height:5px;background:rgba(0,0,0,0.2);border-radius:3px;overflow:hidden;flex-shrink:0">
          <div style="width:${c.risk}%;height:100%;background:${c.color};border-radius:3px"></div>
        </div>
        <div style="font-size:0.8rem;color:${c.color};min-width:14px">${c.trend}</div>
      </div>
    `).join('');

    container.innerHTML = `
      <div style="background:${BG};border:1px solid ${BOR};border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:360px;box-shadow:0 4px 24px rgba(0,0,0,0.3)">
        <div style="background:${BG2};padding:12px 16px;border-bottom:1px solid ${BOR};display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="font-size:0.8rem;font-weight:800;color:${TXT}">⊕ ORRERYX</span>
            <span style="font-size:0.7rem;color:${MUT};margin-left:6px">CONFLICT RISK</span>
          </div>
          <div style="display:flex;align-items:center;gap:5px">
            <span style="width:7px;height:7px;border-radius:50%;background:#f44336;animation:orrery-pulse 2s infinite"></span>
            <span style="font-size:0.7rem;color:#f44336;font-weight:600">LIVE</span>
          </div>
        </div>
        <div style="padding:4px 16px 4px">
          <div style="display:flex;padding:6px 0;border-bottom:1px solid ${BOR}">
            <div style="font-size:0.65rem;color:${MUT};text-transform:uppercase;letter-spacing:1px;min-width:28px">Score</div>
            <div style="font-size:0.65rem;color:${MUT};text-transform:uppercase;letter-spacing:1px;flex:1;padding-left:10px">Conflict</div>
          </div>
          ${rowsHtml}
        </div>
        <div style="padding:10px 16px;background:${BG2};border-top:1px solid ${BOR};text-align:center">
          <a href="https://www.orreryx.io?ref=widget" target="_blank" rel="noopener" style="font-size:0.7rem;color:${MUT};text-decoration:none">
            Track all 56 active conflicts → <span style="color:#f44336;font-weight:600">orreryx.io</span>
          </a>
        </div>
      </div>
      <style>@keyframes orrery-pulse{0%,100%{opacity:1}50%{opacity:0.4}}</style>
    `;
  }

  function init() {
    const containers = document.querySelectorAll('#orrery-widget, .orrery-widget');
    containers.forEach(createWidget);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

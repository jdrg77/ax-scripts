// ==UserScript==
// @name         Axiom - Mini Chart
// @namespace    http://tampermonkey.net/
// @version      1.1
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Mini%20Chart%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Mini%20Chart%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') === 'grad') return;

  const W_PX = 85, H_PX = 50;

  // ---- Canvas ----
  const canvas = document.createElement('canvas');
  canvas.width  = W_PX * 2;
  canvas.height = H_PX * 2;
  canvas.style.cssText = `position:fixed;left:0;top:0;width:${W_PX}px;height:${H_PX}px;` +
    `z-index:99999;pointer-events:none;background:rgba(0,0,0,0.65);border-radius:3px;display:none;`;
  document.body.appendChild(canvas);

  const s = {
    canvas,
    bars: [],
    lastCA: null,
    pairAddress: null,
    tFetch: null,
    tFast: null,
    tPos: null,
    _observer: null,
  };

  // ---- Get first New Pairs row ----
  function getFirstNewPairRow() {
    const header = Array.from(document.querySelectorAll('*'))
      .find(el => el.children.length === 0 && el.textContent.trim() === 'New Pairs');
    if (!header) return null;
    const col = header.parentElement?.parentElement?.parentElement;
    if (!col) return null;
    const virtualList = Array.from(col.querySelectorAll('div')).find(div => {
      const s = div.getAttribute('style') || '';
      return s.includes('position: relative') &&
             div.querySelectorAll('[style*="position: absolute"]').length > 3;
    });
    if (!virtualList) return null;
    const rows = Array.from(virtualList.querySelectorAll(':scope > [style*="position: absolute"]'));
    return rows[0] || null;
  }

  // ---- Extract CA from row links ----
  function getCAFromRow(row) {
    if (!row) return null;
    const pump = row.querySelector('a[href*="pump.fun/coin/"]');
    if (pump) { const m = pump.href.match(/\/coin\/([A-Za-z0-9]{32,})/); if (m) return m[1]; }
    const meme = row.querySelector('a[href*="/meme/"]');
    if (meme) { const m = meme.href.match(/\/meme\/([A-Za-z0-9]{32,})/); if (m) return m[1]; }
    return null;
  }

  // ---- Fallback: first visible QBuy button ----
  function getCAFromQBuyBtn() {
    const btns = [...document.querySelectorAll('button')]
      .filter(b => b.style.position === 'fixed' && b._pairAddress && b.style.display !== 'none');
    if (!btns.length) return null;
    btns.sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
    return btns[0]._pairAddress || btns[0]._ca || null;
  }

  // ---- Find the Fee "F" label in the row (for positioning) ----
  function findFeeRect(row) {
    if (!row) return null;
    for (const el of row.querySelectorAll('*')) {
      if (el.children.length === 0 && el.textContent.trim() === 'F') {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.width < 30 && r.height < 30) return r;
      }
    }
    return null;
  }

  // ---- Draw candlesticks ----
  s._draw = function () {
    try {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      const bars = s.bars;
      if (!bars.length) return;
      const N    = Math.min(bars.length, 80);
      const view = bars.slice(0, N);
      let lo = Infinity, hi = -Infinity;
      for (const b of view) { if (b[3] < lo) lo = b[3]; if (b[2] > hi) hi = b[2]; }
      if (!isFinite(lo) || !isFinite(hi)) return;
      const span  = Math.max(hi - lo, hi * 0.0001);
      const pad   = span * 0.05;
      const newLo = lo - pad, newHi = hi + pad;
      const padY  = 2, pxH = H - 2 * padY;
      const cw    = 4, bodyW = Math.max(1.5, cw * 0.7);
      const maxFit = Math.floor(W / cw);
      const draw   = view.slice(0, maxFit);
      for (let i = 0; i < draw.length; i++) {
        const b = draw[i];
        const o = b[1], hi2 = b[2], lo2 = b[3], cl = b[4];
        const xC  = i * cw + cw / 2 + 1;
        const yO  = padY + (1 - (o   - newLo) / (newHi - newLo)) * pxH;
        const yCl = padY + (1 - (cl  - newLo) / (newHi - newLo)) * pxH;
        const yH  = padY + (1 - (hi2 - newLo) / (newHi - newLo)) * pxH;
        const yL  = padY + (1 - (lo2 - newLo) / (newHi - newLo)) * pxH;
        const up  = cl >= o;
        ctx.strokeStyle = ctx.fillStyle = up ? '#22c55e' : '#ef4444';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xC, yH); ctx.lineTo(xC, yL); ctx.stroke();
        const yTop = Math.min(yO, yCl), yBot = Math.max(yO, yCl);
        ctx.fillRect(xC - bodyW / 2, yTop, bodyW, Math.max(1, yBot - yTop));
      }
    } catch (e) {}
  };

  // ---- Resolve pairAddress from CA ----
  async function resolvePair(ca) {
    try {
      const r = await fetch('https://api3.axiom.trade/clipboard-pair-info?address=' + ca, { credentials: 'include' });
      const j = await r.json();
      if (s.lastCA !== ca) return;
      s.pairAddress = j.pairAddress || null;
    } catch (e) {}
  }

  // ---- Fetch bars ----
  async function fetchBars(forCA) {
    if (!s.pairAddress) return;
    const now = Date.now();
    const params = new URLSearchParams({
      pairAddress: s.pairAddress,
      from: String(now - 300000), to: String(now),
      currency: 'USD', interval: '1s', countBars: '300',
      showOutliers: 'false', needData: 'true', v: String(now),
    });
    try {
      const r = await fetch('https://api6.axiom.trade/pair-chart-v2?' + params, { credentials: 'include' });
      const j = await r.json();
      if (forCA && s.lastCA !== forCA) return;
      if (j && Array.isArray(j.bars)) { s.bars = j.bars; s._draw(); }
    } catch (e) {}
  }

  // ---- Check for new top token ----
  let busy = false;
  async function checkToken() {
    if (busy) return;
    busy = true;
    try {
      const row = getFirstNewPairRow();
      const ca  = getCAFromRow(row) || getCAFromQBuyBtn();
      if (!ca) return;
      if (ca !== s.lastCA) {
        s.lastCA = ca;
        s.bars = [];
        s.pairAddress = null;
        s._draw();
        await resolvePair(ca);
        if (s.lastCA === ca) await fetchBars(ca);
      }
    } finally { busy = false; }
  }

  // ---- Reposition canvas next to the Fee label ----
  function reposition() {
    try {
      const row = getFirstNewPairRow();
      if (!row) { canvas.style.display = 'none'; return; }
      const rowRect = row.getBoundingClientRect();
      const fR = findFeeRect(row);
      if (!fR) { canvas.style.display = 'none'; return; }
      canvas.style.display = 'block';
      canvas.style.left = (fR.left - W_PX - 6) + 'px';
      canvas.style.top  = (rowRect.bottom - H_PX - 4) + 'px';
    } catch (e) {}
  }

  // ---- Timers ----
  s.tFetch = setInterval(() => fetchBars(s.lastCA), 1000);
  s.tFast  = setInterval(checkToken, 80);
  s.tPos   = setInterval(reposition, 150);

  // ---- MutationObserver for instant detection ----
  (function attachObserver() {
    const row = getFirstNewPairRow();
    const col = row?.closest('[style*="position: relative"]');
    if (!col) { setTimeout(attachObserver, 500); return; }
    try { s._observer?.disconnect(); } catch (e) {}
    const obs = new MutationObserver(checkToken);
    obs.observe(col, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
    s._observer = obs;
  })();

  checkToken();
  console.log('📈 Axiom Mini Chart v1.0 loaded');
})();

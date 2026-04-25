// ==UserScript==
// @name         Axiom - Trades Popup
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Trades%20Popup%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Trades%20Popup%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') === 'grad') return;

  const SERVERS   = ['https://api2.axiom.trade', 'https://api3.axiom.trade', 'https://api6.axiom.trade'];
  const CACHE_TTL = 8000;
  const cache     = new Map();

  let popup      = null;
  let hideTimer  = null;
  let currentCA  = null;
  let refreshTimer = null;

  // ======= API =======

  function decode(row) {
    return {
      type:         row[2],
      createdAt:    new Date(row[3]),
      liquiditySol: row[4],
      makerAddress: row[6],
      totalSol:     row[10],
      totalUsd:     row[11],
    };
  }

  async function fetchTrades(pairAddress) {
    const cached = cache.get(pairAddress);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.trades;
    const server = SERVERS[Math.floor(Math.random() * SERVERS.length)];
    try {
      const resp = await fetch(`${server}/transactions-feed-v3`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairAddress, orderBy: 'DESC' }),
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      const trades = (Array.isArray(data) ? data : []).map(decode);
      cache.set(pairAddress, { trades, ts: Date.now() });
      return trades;
    } catch (e) { return null; }
  }

  // ======= FORMATTING =======

  function fmtAge(date) {
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60)   return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    return Math.floor(s / 3600) + 'h';
  }

  function fmtMC(liquiditySol, totalSol, totalUsd) {
    if (!totalSol) return '—';
    const solPrice = totalUsd / totalSol;
    const mc = liquiditySol * 2 * solPrice;
    if (mc >= 1e6) return '$' + (mc / 1e6).toFixed(1) + 'M';
    if (mc >= 1e3) return '$' + (mc / 1e3).toFixed(1) + 'K';
    return '$' + mc.toFixed(0);
  }

  function fmtWallet(addr) {
    if (!addr || addr.length < 6) return addr || '?';
    return addr.slice(0, 3) + '…' + addr.slice(-3);
  }

  function fmtSol(n) {
    if (n >= 1)    return n.toFixed(2);
    if (n >= 0.01) return n.toFixed(3);
    return n.toFixed(4);
  }

  // ======= POPUP =======

  function ensurePopup() {
    if (popup) return popup;
    popup = document.createElement('div');
    popup.style.cssText = [
      'position:fixed', 'z-index:2147483646', 'display:none',
      'background:#0d0f14', 'border:1px solid #23263a', 'border-radius:8px',
      'width:290px', 'box-shadow:0 8px 32px rgba(0,0,0,0.7)',
      'font-family:monospace', 'font-size:11px', 'color:#ccc',
      'pointer-events:none', 'overflow:hidden',
    ].join(';');
    document.body.appendChild(popup);
    return popup;
  }

  function renderTrades(trades) {
    const p = ensurePopup();
    if (!trades) {
      p.innerHTML = '<div style="padding:14px;color:#555;text-align:center">Error cargando trades</div>';
      return;
    }
    if (!trades.length) {
      p.innerHTML = '<div style="padding:14px;color:#555;text-align:center">Sin trades</div>';
      return;
    }

    const header = `<div style="display:flex;padding:5px 10px 5px;gap:4px;color:#444;border-bottom:1px solid #1c1f2b;font-size:10px">
      <span style="width:54px">Amount</span>
      <span style="width:62px;text-align:right">MC</span>
      <span style="flex:1;padding-left:8px">Trader</span>
      <span style="width:30px;text-align:right">Age</span>
    </div>`;

    const rows = trades.slice(0, 18).map(t => {
      const isBuy = t.type === 'buy';
      const col   = isBuy ? '#4ade80' : '#f87171';
      const icon  = isBuy ? '▲' : '▼';
      return `<div style="display:flex;align-items:center;padding:2px 10px;gap:4px;border-bottom:1px solid #13151c">
        <span style="color:${col};width:8px;font-size:9px">${icon}</span>
        <span style="color:${col};width:46px">${fmtSol(t.totalSol)}</span>
        <span style="color:#666;width:62px;text-align:right">${fmtMC(t.liquiditySol, t.totalSol, t.totalUsd)}</span>
        <span style="color:#aaa;flex:1;padding-left:8px">${fmtWallet(t.makerAddress)}</span>
        <span style="color:#444;width:30px;text-align:right">${fmtAge(t.createdAt)}</span>
      </div>`;
    }).join('');

    p.innerHTML = header + rows;
  }

  function positionPopup(clientX, clientY) {
    const p = ensurePopup();
    const pw = 290, ph = 350;
    let left = clientX + 16;
    let top  = clientY - 80;
    if (left + pw > window.innerWidth  - 8) left = clientX - pw - 16;
    if (top  + ph > window.innerHeight - 8) top  = window.innerHeight - ph - 8;
    if (top < 8) top = 8;
    p.style.left = left + 'px';
    p.style.top  = top  + 'px';
  }

  function showFor(pairAddress, clientX, clientY) {
    clearTimeout(hideTimer);
    clearInterval(refreshTimer);
    const p = ensurePopup();
    currentCA = pairAddress;
    positionPopup(clientX, clientY);
    p.style.display = 'block';
    p.innerHTML = '<div style="padding:14px;color:#444;text-align:center">Cargando…</div>';

    const load = () => {
      if (currentCA !== pairAddress) return;
      fetchTrades(pairAddress).then(trades => {
        if (currentCA !== pairAddress) return;
        renderTrades(trades);
      });
    };
    load();
    refreshTimer = setInterval(load, CACHE_TTL);
  }

  function hide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      currentCA = null;
      clearInterval(refreshTimer);
      if (popup) popup.style.display = 'none';
    }, 100);
  }

  // ======= HOOKS =======

  function hook(el, getCA) {
    if (el.__tpHooked) return;
    el.__tpHooked = true;
    el.addEventListener('mouseenter', e => {
      const ca = getCA(el);
      if (ca) showFor(ca, e.clientX, e.clientY);
    });
    el.addEventListener('mousemove', e => {
      if (currentCA) positionPopup(e.clientX, e.clientY);
    });
    el.addEventListener('mouseleave', hide);
  }

  function scan() {
    // Best Match mini buttons — data-qbm-mini contiene el rowCA (pair address del meme link)
    document.querySelectorAll('[data-qbm-mini]').forEach(btn => {
      hook(btn, el => el.getAttribute('data-qbm-mini'));
    });

    // QBuy fixed buttons — busca pair address en el row via _original
    document.querySelectorAll('button').forEach(btn => {
      if (btn.style?.position !== 'fixed' || btn.style?.zIndex !== '9999') return;
      if (!btn.querySelector?.('.qb-sim-badge') || btn._isGradProxy) return;
      hook(btn, el => {
        if (el._original) {
          let row = el._original.parentElement;
          for (let i = 0; i < 8; i++) {
            if (row?.className?.includes('max-h-[64px]')) break;
            row = row?.parentElement;
          }
          if (row) {
            const a = row.querySelector('a[href*="/meme/"]');
            if (a) { const m = a.href.match(/\/meme\/([A-Za-z0-9]{32,})/); if (m) return m[1]; }
          }
        }
        return el._ca || null;
      });
    });
  }

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 500);

  console.log('🔍 Axiom Trades Popup v1.0 loaded');
})();

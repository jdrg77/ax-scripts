// ==UserScript==
// @name         Axiom - Trades Popup
// @namespace    http://tampermonkey.net/
// @version      1.3
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
      priceSol:     row[7],
      priceUsd:     row[8],
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

  function fmtMC(liquiditySol, priceSol, priceUsd) {
    if (!priceSol || !priceUsd) return '—';
    const solPrice = priceUsd / priceSol;
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
      'background:#0b0d13', 'border:1px solid #1a1d28', 'border-radius:8px',
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

    const header = `<div style="display:flex;padding:4px 10px;gap:0;color:#3a3d50;border-bottom:1px solid #1a1d28;font-size:10px;letter-spacing:0.02em">
      <span style="width:90px">Amount</span>
      <span style="width:64px;text-align:right">MC</span>
      <span style="flex:1;padding-left:10px">Trader</span>
      <span style="width:28px;text-align:right">Age</span>
    </div>`;

    const rows = trades.slice(0, 18).map(t => {
      const isBuy = t.type === 'buy';
      const col   = isBuy ? '#3dd68c' : '#f75f6e';
      return `<div style="display:flex;align-items:center;padding:2px 10px;gap:0">
        <span style="color:${col};width:90px;font-size:11px">≡ ${fmtSol(t.totalSol)}</span>
        <span style="color:#4a4f6a;width:64px;text-align:right;font-size:11px">${fmtMC(t.liquiditySol, t.priceSol, t.priceUsd)}</span>
        <span style="color:#7a8099;flex:1;padding-left:10px;font-size:11px">${fmtWallet(t.makerAddress)}</span>
        <span style="color:#3a3d50;width:28px;text-align:right;font-size:11px">${fmtAge(t.createdAt)}</span>
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

  function getPairFromRow(row) {
    const a = row.querySelector('a[href*="/meme/"]');
    if (!a) return null;
    const m = a.href.match(/\/meme\/([A-Za-z0-9]{32,})/);
    return m ? m[1] : null;
  }

  function scan() {
    // Best Match mini buttons — preferir data-qbm-pair (pair address) sobre data-qbm-mini (pump CA)
    document.querySelectorAll('[data-qbm-mini]').forEach(btn => {
      hook(btn, el => el.dataset.qbmPair || el.getAttribute('data-qbm-mini'));
    });

    // QBuy fixed buttons
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
          if (row) return getPairFromRow(row);
        }
        return el._ca || null;
      });
    });

    // Filas nativas del feed (Pulse/Discover/Scanner)
    document.querySelectorAll('[class*="group/pulseRow"]').forEach(row => {
      const ca = getPairFromRow(row);
      if (!ca) return;
      hook(row, () => ca);
    });
  }

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 500);

  console.log('🔍 Axiom Trades Popup v1.0 loaded');
})();

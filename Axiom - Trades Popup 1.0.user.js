// ==UserScript==
// @name         Axiom - Trades Popup
// @namespace    http://tampermonkey.net/
// @version      1.9
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Trades%20Popup%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Trades%20Popup%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  const SERVERS   = ['https://api2.axiom.trade', 'https://api3.axiom.trade', 'https://api6.axiom.trade'];
  const CACHE_TTL = 8000;
  const cache     = new Map();

  let popup        = null;
  let hideTimer    = null;
  let currentCA    = null;
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
    if (mc >= 1e6) return '$' + (mc/1e6 % 1 === 0 ? (mc/1e6).toFixed(0) : (mc/1e6).toFixed(1)) + 'M';
    if (mc >= 1e3) return '$' + (mc/1e3 % 1 === 0 ? (mc/1e3).toFixed(0) : (mc/1e3).toFixed(1)) + 'K';
    return '$' + mc.toFixed(0);
  }

  function fmtWallet(addr) {
    if (!addr || addr.length < 3) return addr || '?';
    return addr.slice(-3);
  }

  function fmtSol(n) {
    if (n >= 10)   return n.toFixed(2);
    if (n >= 1)    return n.toFixed(3);
    if (n >= 0.01) return n.toFixed(3);
    return n.toFixed(4);
  }

  // Barra igual a la tabla nativa: solo si >= 1 SOL, escala fija de 33 SOL
  const BAR_MAX_REF = 33;

  function calcBarWidth(amount) {
    if (amount < 1) return 0;
    const pct = Math.pow(amount / BAR_MAX_REF, 2 / 3) * 100;
    return Math.min(100, Math.max(1, pct));
  }

  // ======= POPUP =======

  function ensurePopup() {
    if (popup) return popup;
    popup = document.createElement('div');
    popup.style.cssText = [
      'position:fixed',
      'z-index:2147483646',
      'display:none',
      'background:#0b0d13',
      'border:1px solid #1e2131',
      'border-radius:8px',
      'width:292px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.8)',
      'font-family:GeistMono,ui-monospace,"Cascadia Code","Source Code Pro",Menlo,Consolas,"DejaVu Sans Mono",monospace',
      'font-size:12px',
      'color:#c1c5dc',
      'pointer-events:none',
      'overflow:hidden',
    ].join(';');
    document.body.appendChild(popup);
    return popup;
  }

  function renderTrades(trades) {
    const p = ensurePopup();
    if (!trades) {
      p.innerHTML = '<div style="padding:14px;color:#777a8c;text-align:center;font-size:12px">Error cargando trades</div>';
      return;
    }
    if (!trades.length) {
      p.innerHTML = '<div style="padding:14px;color:#777a8c;text-align:center;font-size:12px">Sin trades</div>';
      return;
    }

    const visible = trades.slice(0, 20);

    const header = '<div style="display:flex;align-items:center;padding:4px 16px;border-bottom:1px solid #1e2131;color:#777a8c;font-size:12px;line-height:16px;min-height:24px;box-sizing:border-box">'
      + '<span style="flex:1">Amount</span>'
      + '<span style="flex:1">MC</span>'
      + '<span style="flex:1">Trader</span>'
      + '<span style="max-width:32px;flex:1;text-align:right">Age ↓</span>'
      + '</div>';

    const SOL_ICON = '<img src="https://axiom-assets.axiom-cdn.io/images/sol-fill.svg" style="width:10px;height:10px;margin-right:2px;vertical-align:middle;display:inline" />';

    const rows = visible.map(t => {
      const isBuy    = t.type === 'buy';
      const amtColor = isBuy ? '#2fe3ac' : '#f20202';
      const gradFrom = isBuy ? '#2FC2E3' : '#D139EC';
      const gradTo   = isBuy ? '#2fe3ac' : '#f20202';

      const barWidth = calcBarWidth(t.totalSol);
      const barDiv   = barWidth > 0
        ? '<div style="position:absolute;left:0;top:0;height:100%;pointer-events:none;background:linear-gradient(to right,' + gradFrom + '00,' + gradTo + ');opacity:0.15;width:' + barWidth.toFixed(3) + '%"></div>'
        : '';

      return '<div style="position:relative;display:flex;align-items:center;height:24px;padding:0 16px;box-sizing:border-box;font-size:12px">'
        + barDiv
        + '<div style="position:relative;z-index:1;display:flex;flex:1;align-items:center">'
        + '<span style="flex:1;display:flex;align-items:center;color:' + amtColor + ';font-size:12px;line-height:16px">' + SOL_ICON + fmtSol(t.totalSol) + '</span>'
        + '<span style="flex:1;color:#c1c5dc;font-size:12px;line-height:16px">' + fmtMC(t.liquiditySol, t.priceSol, t.priceUsd) + '</span>'
        + '<span style="flex:1;color:#c1c5dc;font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + fmtWallet(t.makerAddress) + '</span>'
        + '<span style="max-width:32px;flex:1;text-align:right;color:#777a8c;font-size:12px;line-height:16px">' + fmtAge(t.createdAt) + '</span>'
        + '</div>'
        + '</div>';
    }).join('');

    // font-size:0 en el wrapper elimina el whitespace entre divs
    p.innerHTML = header + '<div style="font-size:0">' + rows + '</div>';
  }

  function positionPopup(clientX, clientY) {
    const p = ensurePopup();
    const pw = 292, ph = 380;
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
    p.innerHTML = '<div style="padding:14px;color:#777a8c;text-align:center;font-size:12px">Cargando…</div>';

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
    document.querySelectorAll('[data-qbm-mini]').forEach(btn => {
      hook(btn, el => el.dataset.qbmPair || el.getAttribute('data-qbm-mini'));
    });

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

    document.querySelectorAll('[class*="group/pulseRow"]').forEach(row => {
      const ca = getPairFromRow(row);
      if (!ca) return;
      hook(row, () => ca);
    });
  }

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 500);

  console.log('🔍 Axiom Trades Popup v1.8 loaded');
})();

// ==UserScript==
// @name         Axiom - Graduated Receiver
// @namespace    http://tampermonkey.net/
// @version      1.82-debug
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Graduated%20Receiver%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Graduated%20Receiver%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  const IS_GRAD = new URLSearchParams(location.search).get('tab') === 'grad';
  if (!IS_GRAD) return;

  const SAMPLE_SIZE  = 16;
  const channel      = new BroadcastChannel('axiom-tabs');
  let   scanId       = 0;
  let   panelObs     = null;
  let   debTimer     = null;
  let   safeTimer    = null;
  let   newPairTimer = null;
  let   pendingBuy   = null;

  // ======= PIXEL UTILS =======

  function getPixels(src, cb) {
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) return cb(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = SAMPLE_SIZE;
        c.getContext('2d').drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        cb(c.getContext('2d').getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
      } catch (e) { cb(null); }
    };
    img.onerror = () => cb(null);
    img.src = src.includes('?') ? src : src + '?gr=1';
  }

  function pixelSimilarity(p1, p2) {
    if (!p1 || !p2) return 0;
    const len = Math.min(p1.length, p2.length), pixels = len / 4;
    let sum = 0;
    for (let i = 0; i < len; i += 4) {
      sum += (Math.abs(p1[i] - p2[i]) / 255 + Math.abs(p1[i+1] - p2[i+1]) / 255 + Math.abs(p1[i+2] - p2[i+2]) / 255) / 3;
    }
    return parseFloat(((1 - sum / pixels) * 100).toFixed(1));
  }

  // ======= PANEL UTILS =======

  function getPanel() {
    return [...document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]')]
      .find(el => el.querySelector('input') || el.querySelector('[class*="group/quickBuyButton"]')) || null;
  }

  function hidePanel() {
    const panel = getPanel();
    if (!panel) return;
    const wrapper = panel.parentElement;
    const overlay = wrapper?.parentElement;
    if (wrapper) {
      wrapper.style.setProperty('z-index',        '-9999',       'important');
      wrapper.style.setProperty('pointer-events', 'none',        'important');
      wrapper.style.setProperty('transition',     'none',        'important');
      wrapper.style.setProperty('animation',      'none',        'important');
    }
    if (overlay) {
      overlay.style.setProperty('z-index',         '-9999',       'important');
      overlay.style.setProperty('pointer-events',  'none',        'important');
      overlay.style.setProperty('background',      'transparent', 'important');
      overlay.style.setProperty('backdrop-filter', 'none',        'important');
      overlay.style.setProperty('transition',      'none',        'important');
      overlay.style.setProperty('animation',       'none',        'important');
    }
  }

  function expandPanel(panel) {
    if (panel.dataset.expanded) return;
    panel.dataset.expanded = 'true';
    panel.style.setProperty('max-height', '90vh', 'important');
    panel.style.setProperty('height',     '90vh', 'important');
    const wrapper = panel.parentElement;
    if (wrapper) {
      const current = wrapper.style.transform;
      const match   = current.match(/translate\((.+)px,\s*(.+)px\)/);
      if (match) {
        wrapper.style.transform = `translate(${parseFloat(match[1])}px, ${parseFloat(match[2]) + 50}px)`;
      } else {
        wrapper.style.marginTop = '50px';
      }
    }
  }

  function typeInPanel(name) {
    const input = getPanel()?.querySelector('input');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function ensurePanelOpen(cb) {
    const existing = getPanel();
    if (existing) { expandPanel(existing); cb(); return; }
    const searchBtn = document.querySelector('[class*="ri-search"]')?.closest('button');
    if (!searchBtn) { console.log('❌ Grad: no search button found'); cb(); return; }
    searchBtn.click();
    const wait = setInterval(() => {
      const panel = getPanel();
      if (panel) { clearInterval(wait); expandPanel(panel); cb(); }
    }, 50);
    setTimeout(() => { clearInterval(wait); if (!getPanel()) console.log('❌ Grad: panel never opened'); }, 2000);
  }

  // ======= GRADUATED TOGGLE =======

  function getGraduatedToggleBtn(panel) {
    return [...panel.querySelectorAll('button')]
      .find(btn => btn.textContent.trim().includes('Graduated')) || null;
  }

  function isGraduatedChipActive(panel) {
    const btn = getGraduatedToggleBtn(panel);
    return btn ? btn.className.includes('primaryGreen') : false;
  }

  function ensureGraduatedView(panel, cb) {
    if (isGraduatedChipActive(panel)) {
      console.log('✅ Grad: chip already active');
      cb(); return;
    }
    const btn = getGraduatedToggleBtn(panel);
    if (!btn) {
      console.log('❌ Grad: Graduated chip not found in panel');
      cb(); return;
    }
    console.log('🔄 Grad: clicking Graduated chip...');
    btn.click();
    const start = Date.now();
    const poll = () => {
      if (isGraduatedChipActive(panel)) {
        console.log('✅ Grad: chip activated in', Date.now() - start, 'ms');
        cb(); return;
      }
      if (Date.now() - start > 500) {
        console.log('⚠️ Grad: chip activation timeout');
        cb(); return;
      }
      setTimeout(poll, 50);
    };
    setTimeout(poll, 50);
  }

  // ======= DATA UTILS =======

  function getRealImage(containerEl) {
    if (!containerEl) return null;
    return Array.from(containerEl.querySelectorAll('img[class*="object-cover"]'))
      .find(img => img.src && !img.src.startsWith('data:')) || null;
  }

  function getRow(btn) {
    let el = btn.parentElement;
    for (let i = 0; i < 6; i++) {
      if (el?.className?.includes('max-h-[64px]')) return el;
      el = el?.parentElement;
    }
    let dbg = btn.parentElement;
    const parents = [];
    for (let i = 0; i < 6; i++) {
      parents.push(`[${i}]:${dbg?.className?.substring(0,50)}`);
      dbg = dbg?.parentElement;
    }
    console.log('❌ getRow failed:', parents.join(' | '));
    return null;
  }

  function extractBtnInfo(btn) {
    const row = getRow(btn);
    if (!row) return null;
    const divs   = row.querySelectorAll('div[class*="min-w-0"][class*="truncate"][class*="whitespace-nowrap"]');
    const ticker = divs[0]?.textContent.trim() || '';
    const name   = divs[1]?.textContent.trim() || divs[0]?.textContent.trim() || '';
    const ageEl  = row.querySelector('span[class*="pointer-events-none"]');
    const age    = ageEl?.textContent?.trim() || '';
    let mc = '';
    for (const c of row.querySelectorAll('div[class*="gap-[4px]"]')) {
      const spans = [...c.querySelectorAll('span')];
      const lbl   = spans.find(s => s.textContent.trim() === 'MC');
      if (lbl) { mc = spans.find(s => s !== lbl && s.textContent.trim())?.textContent.trim() || ''; break; }
    }
    const coinImg = getRealImage(row);
    const isBonk      = !!row.querySelector('img[src*="bonk"]');
    const isRaydium   = !!row.querySelector('img[src*="pump-grad.svg"][alt="Raydium V4"]');
    const isPump      = !isRaydium && !!row.querySelector('img[src*="pump"]');
    const platform    = isBonk ? 'bonk' : isRaydium ? 'raydium' : isPump ? 'pump' : 'other';
    const isMigrated  = !!row.querySelector('img[src*="-grad"]');
    const hasDex      = !!row.querySelector('[class*="icon-dex-paid"]');
    let ca = '';
    for (const a of row.querySelectorAll('a[href]')) {
      const h = a.href;
      if (h.includes('pump.fun')) { const m = h.match(/\/coin\/([A-Za-z0-9]{32,})/); if (m) { ca = m[1]; break; } }
      else if (h.includes('bonk'))  { const m = h.match(/\/([A-Za-z0-9]{32,})/);      if (m) { ca = m[1]; break; } }
      else if (h.includes('/meme/') && !ca) { const m = h.match(/\/meme\/([A-Za-z0-9]{32,})/); if (m) ca = m[1]; }
    }
    return { ticker, name, age, mc, imgSrc: coinImg?.src || '', ca, platform, isMigrated, hasDex };
  }

  function fireClick(el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(ev =>
      el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    );
  }

  // ======= SCAN & BROADCAST =======

  function abortScan() {
    scanId++;
    if (panelObs) { panelObs.disconnect(); panelObs = null; }
    if (debTimer)  { clearTimeout(debTimer);  debTimer  = null; }
    if (safeTimer) { clearTimeout(safeTimer); safeTimer = null; }
  }

  function doScan(id, refPixels, seq) {
    if (id !== scanId) { console.log('🚫 [9] doScan abortado id:', id, 'scanId:', scanId); return; }
    abortScan();

    const panel = getPanel();
    if (!panel) {
      console.log('❌ [9] doScan: panel gone');
      channel.postMessage({ type: 'GRAD_DATA', tokens: [], seq });
      return;
    }

    const inputNow = panel.querySelector('input')?.value || '';
    const btns  = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')];
    console.log('🔍 [9] doScan — input:', inputNow, '| botones:', btns.length, '| chip:', isGraduatedChipActive(panel), '| seq:', seq);
    const rawInfos = btns.map(extractBtnInfo);
    console.log('📋 [10] tickers encontrados:', rawInfos.map((x,i) => `[${i}]:${x ? (x.ticker||'?') : 'NULL'}`).join(' '));
    const infos = rawInfos.filter(Boolean);
    if (!infos.length) {
      console.log('⚠️ Grad: 0 tokens found in panel');
      channel.postMessage({ type: 'GRAD_DATA', tokens: [], seq });
      return;
    }

    let pending = infos.length;
    const results = [];

    infos.forEach(info => {
      if (!info.imgSrc || !refPixels) {
        results.push({ ticker: info.ticker, name: info.name, age: info.age, mc: info.mc, imgSrc: info.imgSrc, ca: info.ca, platform: info.platform, isMigrated: info.isMigrated, hasDex: info.hasDex, match: 0 });
        if (--pending === 0) broadcastResults(results, seq);
        return;
      }
      getPixels(info.imgSrc, pixels => {
        results.push({
          ticker: info.ticker, name: info.name, age: info.age, mc: info.mc, imgSrc: info.imgSrc, ca: info.ca, platform: info.platform,
          match: pixels ? pixelSimilarity(refPixels, pixels) : 0,
          isMigrated: info.isMigrated, hasDex: info.hasDex
        });
        if (--pending === 0) broadcastResults(results, seq);
      });
    });
  }

  function broadcastResults(tokens, seq) {
    tokens.sort((a, b) => b.match - a.match);
    console.log('📡 [11] BROADCAST', tokens.length, 'tokens | seq:', seq, '| top:', tokens.map(t => t.ticker + ' ' + t.match + '%').join(', '));
    channel.postMessage({ type: 'GRAD_DATA', tokens, seq });
  }

  function startScan(id, refPixels, seq) {
    if (id !== scanId) { console.log('🚫 [7] startScan abortado'); return; }
    const panel = getPanel();
    const btnsNow = panel ? panel.querySelectorAll('[class*="group/quickBuyButton"]').length : 0;
    console.log('🔄 [7] startScan — panel:', panel ? 'OK' : 'NULL', '| botones actuales:', btnsNow);
    if (!panel) { doScan(id, refPixels, seq); return; }

    let fired = false;
    let sawEmpty = (btnsNow === 0);
    panelObs = new MutationObserver(() => {
      if (fired) return;
      const count = panel.querySelectorAll('[class*="group/quickBuyButton"]').length;
      if (!count) { sawEmpty = true; return; }
      if (!sawEmpty) return;
      // buttons appeared after empty — wait 200ms to confirm they're stable (not a React cache flash)
      if (debTimer) clearTimeout(debTimer);
      debTimer = setTimeout(() => {
        const stable = panel.querySelectorAll('[class*="group/quickBuyButton"]').length;
        if (!stable) { sawEmpty = true; return; } // disappeared = stale cache, keep watching
        fired = true;
        if (safeTimer) { clearTimeout(safeTimer); safeTimer = null; }
        console.log('✅ [8] MutationObserver: botones estables en panel, count:', stable);
        doScan(id, refPixels, seq);
      }, 200);
    });
    panelObs.observe(panel, { childList: true, subtree: true });
    safeTimer = setTimeout(() => {
      if (fired) return;
      if (id !== scanId) return;
      console.log('⏰ [8] safeTimer disparado (MutationObserver NO fires), botones en panel:', panel.querySelectorAll('[class*="group/quickBuyButton"]').length);
      doScan(id, refPixels, seq);
    }, 800);
  }

  // ======= BUY EXECUTION =======

  function executePendingBuy() {
    if (!pendingBuy) return;
    const { ticker, name, ca } = pendingBuy;
    const panel = getPanel();
    if (!panel) { console.log('❌ Grad: no panel for', ticker || name); return; }

    const btns = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')];
    let target = null;
    for (const btn of btns) {
      let el = btn.parentElement, row = null;
      for (let i = 0; i < 6; i++) {
        if (el?.className?.includes('max-h-[64px]')) { row = el; break; }
        el = el?.parentElement;
      }
      if (!row) continue;
      const divs = row.querySelectorAll('div[class*="min-w-0"][class*="truncate"][class*="whitespace-nowrap"]');
      const t    = divs[0]?.textContent.trim() || '';
      const n    = divs[1]?.textContent.trim() || divs[0]?.textContent.trim() || '';
      let rowCA = '';
      for (const a of row.querySelectorAll('a[href]')) {
        const h = a.href;
        if (h.includes('pump.fun')) { const m = h.match(/\/coin\/([A-Za-z0-9]{32,})/); if (m) { rowCA = m[1]; break; } }
        else if (h.includes('bonk'))  { const m = h.match(/\/([A-Za-z0-9]{32,})/);      if (m) { rowCA = m[1]; break; } }
        else if (h.includes('/meme/') && !rowCA) { const m = h.match(/\/meme\/([A-Za-z0-9]{32,})/); if (m) rowCA = m[1]; }
      }
      const matched = ca ? (rowCA && ca === rowCA) : ((ticker && t === ticker) || (name && n === name));
      if (matched) { target = btn; break; }
    }

    if (target) {
      console.log('✅ Grad buy:', ticker || name);
      pendingBuy = null;
      fireClick(target);
    } else {
      console.log('❌ Grad: button not found for', ticker, name);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') executePendingBuy();
  });

  // ======= MESSAGE HANDLING =======

  channel.onmessage = (e) => {
    const msg = e.data;

    if (msg.type === 'NEW_PAIR') {
      const t0 = Date.now();
      console.log('📨 [1] NEW_PAIR recibido:', msg.name, '| seq:', msg.seq, '| t=0ms');
      if (newPairTimer) clearTimeout(newPairTimer);
      abortScan();
      newPairTimer = setTimeout(() => {
        newPairTimer = null;
        const id = ++scanId;
        const seq = msg.seq;
        console.log('⏱ [2] timer 200ms listo, id:', id, '| t=' + (Date.now()-t0) + 'ms');
        getPixels(msg.refImgSrc, pixels => {
          if (id !== scanId) { console.log('🚫 [3] ABORTADO en getPixels, id:', id, 'scanId:', scanId); return; }
          console.log('🖼 [3] getPixels listo, pixels:', pixels ? 'OK' : 'NULL', '| t=' + (Date.now()-t0) + 'ms');
          ensurePanelOpen(() => {
            if (id !== scanId) { console.log('🚫 [4] ABORTADO en ensurePanelOpen'); return; }
            const panel = getPanel();
            console.log('🔍 [4] panel:', panel ? 'ENCONTRADO' : 'NULL', '| t=' + (Date.now()-t0) + 'ms');
            if (!panel) { channel.postMessage({ type: 'GRAD_DATA', tokens: [], seq }); return; }
            ensureGraduatedView(panel, () => {
              if (id !== scanId) { console.log('🚫 [5] ABORTADO en ensureGraduatedView'); return; }
              console.log('🎛 [5] graduatedView OK, typeo nombre:', msg.name, '| t=' + (Date.now()-t0) + 'ms');
              typeInPanel(msg.name);
              const inputVal = panel.querySelector('input')?.value;
              console.log('⌨️ [6] input ahora dice:', inputVal, '| botones en panel:', panel.querySelectorAll('[class*="group/quickBuyButton"]').length, '| t=' + (Date.now()-t0) + 'ms');
              startScan(id, pixels, seq);
            });
          });
        });
      }, 200);
    }

    if (msg.type === 'EXECUTE_BUY_GRAD') {
      const { ticker, name, ca } = msg;
      pendingBuy = { ticker, name, ca };
      window.focus();
      executePendingBuy();
    }
  };

  console.log('📡 Axiom Graduated Receiver v1.82-debug active');
})();

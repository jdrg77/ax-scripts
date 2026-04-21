// ==UserScript==
// @name         Axiom - Graduated Receiver
// @namespace    http://tampermonkey.net/
// @version      1.5-debug
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

  function typeInPanel(name) {
    const input = getPanel()?.querySelector('input');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function ensurePanelOpen(cb) {
    if (getPanel()) { cb(); return; }
    const searchBtn = document.querySelector('[class*="ri-search"]')?.closest('button');
    if (!searchBtn) { console.log('❌ Grad: no search button found'); cb(); return; }
    searchBtn.click();
    const wait = setInterval(() => {
      if (getPanel()) { clearInterval(wait); cb(); }
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

  function extractBtnInfo(btn) {
    const row = btn.closest('[class*="max-h-[64px]"]');
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
    return { ticker, name, age, mc, imgSrc: coinImg?.src || '' };
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
    if (id !== scanId) return;
    abortScan();
    scanId = id;

    const panel = getPanel();
    if (!panel) {
      console.log('❌ Grad: panel gone at doScan');
      channel.postMessage({ type: 'GRAD_DATA', tokens: [], seq });
      return;
    }

    const btns  = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')];
    console.log('🔍 Grad: scanning', btns.length, 'buttons, chip active:', isGraduatedChipActive(panel));
    const infos = btns.map(extractBtnInfo).filter(Boolean);
    if (!infos.length) {
      console.log('⚠️ Grad: 0 tokens found in panel');
      channel.postMessage({ type: 'GRAD_DATA', tokens: [], seq });
      return;
    }

    let pending = infos.length;
    const results = [];

    infos.forEach(info => {
      if (!info.imgSrc || !refPixels) {
        results.push({ ticker: info.ticker, name: info.name, age: info.age, mc: info.mc, imgSrc: info.imgSrc, match: 0 });
        if (--pending === 0) broadcastResults(results, seq);
        return;
      }
      getPixels(info.imgSrc, pixels => {
        results.push({
          ticker: info.ticker, name: info.name, age: info.age, mc: info.mc, imgSrc: info.imgSrc,
          match: pixels ? pixelSimilarity(refPixels, pixels) : 0
        });
        if (--pending === 0) broadcastResults(results, seq);
      });
    });
  }

  function broadcastResults(tokens, seq) {
    tokens.sort((a, b) => b.match - a.match);
    console.log('📡 Grad broadcast:', tokens.length, 'tokens, top:', tokens[0]?.ticker, tokens[0]?.match + '%', '| seq:', seq);
    channel.postMessage({ type: 'GRAD_DATA', tokens, seq });
  }

  function startScan(id, refPixels, seq) {
    if (id !== scanId) return;
    const panel = getPanel();
    if (!panel) { doScan(id, refPixels, seq); return; }

    panelObs = new MutationObserver(() => {
      if (debTimer) clearTimeout(debTimer);
      debTimer = setTimeout(() => doScan(id, refPixels, seq), 150);
    });
    panelObs.observe(panel, { childList: true, subtree: true });
    safeTimer = setTimeout(() => doScan(id, refPixels, seq), 1000);
  }

  // ======= MESSAGE HANDLING =======

  channel.onmessage = (e) => {
    const msg = e.data;

    if (msg.type === 'NEW_PAIR') {
      console.log('📨 Grad: NEW_PAIR received:', msg.name, '| seq:', msg.seq);
      if (newPairTimer) clearTimeout(newPairTimer);
      newPairTimer = setTimeout(() => {
        newPairTimer = null;
        const id = ++scanId;
        const seq = msg.seq;
        getPixels(msg.refImgSrc, pixels => {
          if (id !== scanId) return;
          ensurePanelOpen(() => {
            if (id !== scanId) return;
            const panel = getPanel();
            if (!panel) { channel.postMessage({ type: 'GRAD_DATA', tokens: [], seq }); return; }
            ensureGraduatedView(panel, () => {
              if (id !== scanId) return;
              typeInPanel(msg.name);
              startScan(id, pixels, seq);
            });
          });
        });
      }, 300);
    }

    if (msg.type === 'EXECUTE_BUY_GRAD') {
      const { ticker, name } = msg;
      const panel = getPanel();
      if (!panel) { console.log('❌ Grad: no panel for', ticker || name); return; }

      const btns = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')];
      let target = null;
      for (const btn of btns) {
        const row  = btn.closest('[class*="max-h-[64px]"]');
        if (!row) continue;
        const divs = row.querySelectorAll('div[class*="min-w-0"][class*="truncate"][class*="whitespace-nowrap"]');
        const t    = divs[0]?.textContent.trim() || '';
        const n    = divs[1]?.textContent.trim() || divs[0]?.textContent.trim() || '';
        if ((ticker && t === ticker) || (name && n === name)) { target = btn; break; }
      }

      if (target) {
        console.log('✅ Grad buy:', ticker || name);
        fireClick(target);
      } else {
        console.log('❌ Grad: button not found for', ticker, name);
      }
    }
  };

  console.log('📡 Axiom Graduated Receiver v1.5-debug active (panel visible)');
})();

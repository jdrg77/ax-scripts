// ==UserScript==
// @name         Axiom QBuy Best Match
// @namespace    http://tampermonkey.net/
// @version      1.1
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Session Map: pairKey → { ticker, name, imgSrc, matchPct }
  const sessionBest = new Map();
  // Mini button pool: pairKey → DOM element
  const miniPool    = new Map();
  let lastGlowBtns  = [];
  let lastNormalSize = { w: 48, h: 48 };

  // === Helpers ===

  function getRowPairKey(row) {
    const tickerEl = row.querySelector('div[class*="min-w-0"][class*="truncate"][class*="text-[16px]"]');
    const nameEl   = row.querySelector('div[class*="min-w-0"][class*="flex-1"][class*="overflow-hidden"]');
    const ticker   = tickerEl?.textContent.trim() || '';
    const name     = nameEl?.textContent.trim()   || '';
    return (ticker || name) ? (ticker + '|' + name).toLowerCase() : null;
  }

  function getPairKey() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    return rows.length ? getRowPairKey(rows[0]) : null;
  }

  function getQBButtons() {
    return [...document.querySelectorAll('button')].filter(btn =>
      btn.style?.position === 'fixed' &&
      btn.style?.zIndex   === '9999'  &&
      btn.style?.display  !== 'none'  &&
      btn.querySelector?.('.qb-sim-badge')
    );
  }

  function getBadgePct(btn) {
    const text = btn.querySelector('.qb-sim-badge')?.textContent?.trim() || '';
    if (!text || text === '…' || text === '?' || text === '—') return -1;
    const pct = parseFloat(text);
    return isNaN(pct) ? -1 : pct;
  }

  function getBtnImgSrc(btn) {
    return btn.querySelector('img.qb-coin-img')?.src || null;
  }

  function badgeColor(pct) {
    if (pct >= 75) return '#78ffa0';
    if (pct >= 50) return '#ffd700';
    return '#ff6b6b';
  }

  function fireClick(el) {
    const r  = el.getBoundingClientRect();
    const cx = r.left + r.width  / 2;
    const cy = r.top  + r.height / 2;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(ev =>
      el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    );
  }

  function findLiveBtn(best) {
    const allBtns = getQBButtons();
    let target = best.imgSrc
      ? allBtns.find(btn => getBtnImgSrc(btn) === best.imgSrc) || null
      : null;
    if (!target) {
      target = allBtns.find(btn =>
        (best.ticker && btn._ticker === best.ticker) ||
        (best.name   && btn._name   === best.name)
      ) || null;
    }
    return target;
  }

  // === Glow ===

  function applyGlow(btn) {
    btn.style.boxShadow = '0 0 18px 5px #ffd700, 0 0 36px 10px rgba(255,215,0,0.4)';
    btn.style.outline   = '2px solid #ffd700';
    btn.setAttribute('data-qbm-glow', '1');
  }

  function clearGlows() {
    lastGlowBtns.forEach(btn => {
      if (!btn.isConnected || btn.getAttribute('data-qbm-glow') !== '1') return;
      btn.style.removeProperty('box-shadow');
      btn.style.removeProperty('outline');
      btn.removeAttribute('data-qbm-glow');
    });
    lastGlowBtns = [];
  }

  function updateGlow() {
    const btns = getQBButtons();
    let maxPct = -1;
    btns.forEach(btn => { const p = getBadgePct(btn); if (p > maxPct) maxPct = p; });

    // Track reference size while buttons are visible
    if (btns.length) {
      const r = btns[0].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) lastNormalSize = { w: r.width, h: r.height };
    }

    clearGlows();
    if (maxPct < 0) return;

    const winners = btns.filter(btn => getBadgePct(btn) === maxPct);
    winners.forEach(btn => applyGlow(btn));
    lastGlowBtns = winners;

    // Store best in session Map (only upgrade, never downgrade)
    const key = getPairKey();
    if (!key) return;
    const existing = sessionBest.get(key);
    if (!existing || maxPct > existing.matchPct) {
      const best = winners[0];
      sessionBest.set(key, {
        ticker:   best._ticker || '',
        name:     best._name   || '',
        imgSrc:   getBtnImgSrc(best),
        matchPct: maxPct
      });
    }
  }

  // === Mini buttons ===

  function createMiniBtn(pairKey) {
    // Clone QB overlay button for visual consistency (same Axiom classes + style)
    // zoom: 0.75 scales everything (button + children) to 75% without breaking layout
    const refBtn = getQBButtons()[0];
    let el;
    if (refBtn) {
      el = refBtn.cloneNode(false); // shallow: gets Axiom classes, no QBuy children
      el.removeAttribute('data-qb-added');
      el.style.zoom = '0.75';
    } else {
      el = document.createElement('button');
      el.style.background   = 'rgba(20,20,30,0.92)';
      el.style.border       = '1.5px solid rgba(255,215,0,0.7)';
      el.style.borderRadius = '6px';
      el.style.cursor       = 'pointer';
    }

    el.setAttribute('data-qbm-mini', pairKey);
    el.style.position = 'fixed';
    el.style.zIndex   = '10000';
    el.style.display  = 'none';
    el.style.overflow = 'visible';

    // Coin image — same layout as QBuy (left:-66px), zoom scales it automatically
    const coinImg = document.createElement('img');
    coinImg.className = 'qbm-coin-img';
    coinImg.style.cssText = 'width:60px;height:60px;border-radius:50%;object-fit:cover;position:absolute;left:-66px;top:50%;transform:translateY(-50%);pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
    el.appendChild(coinImg);

    // Match% badge
    const badge = document.createElement('span');
    badge.className = 'qbm-badge';
    badge.style.cssText = 'position:absolute;left:-66px;top:-10px;font-size:11px;font-weight:700;font-family:monospace;color:#fff;background:rgba(0,0,0,0.72);border-radius:8px;padding:1px 5px;pointer-events:none;white-space:nowrap;border:1px solid currentColor;z-index:10001;';
    el.appendChild(badge);

    // Name label
    const label = document.createElement('div');
    label.className = 'qbm-label';
    label.style.cssText = 'position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:2px;font-size:10px;font-weight:600;font-family:monospace;color:#ccc;background:rgba(0,0,0,0.65);border-radius:4px;padding:1px 4px;pointer-events:none;white-space:nowrap;z-index:10001;';
    el.appendChild(label);

    el.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      const best = sessionBest.get(pairKey);
      if (best) executeBest(best);
    });

    document.body.appendChild(el);
    miniPool.set(pairKey, el);
    return el;
  }

  function getOrCreateMiniBtn(pairKey) {
    const existing = miniPool.get(pairKey);
    if (existing?.isConnected) return existing;
    return createMiniBtn(pairKey);
  }

  function updateMiniButtons() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    const activeKeys = new Set();

    rows.forEach(row => {
      const key  = getRowPairKey(row);
      if (!key) return;
      const best = sessionBest.get(key);
      if (!best) return;

      const rect = row.getBoundingClientRect();
      if (rect.width < 10 || rect.bottom < 0 || rect.top > window.innerHeight) return;

      activeKeys.add(key);

      const el = getOrCreateMiniBtn(key);

      // Position: right edge of row, slightly below vertical center
      const miniH = lastNormalSize.h * 0.75;
      const miniW = lastNormalSize.w * 0.75;
      el.style.left = (rect.right - miniW - 6) + 'px';
      el.style.top  = (rect.top + rect.height * 0.62 - miniH / 2) + 'px';

      // Update children
      const coinImg = el.querySelector('.qbm-coin-img');
      const badge   = el.querySelector('.qbm-badge');
      const label   = el.querySelector('.qbm-label');

      if (coinImg && coinImg.src !== (best.imgSrc || '')) coinImg.src = best.imgSrc || '';
      if (badge) {
        const pctText = best.matchPct.toFixed(1) + '%';
        if (badge.textContent !== pctText) badge.textContent = pctText;
        const col = badgeColor(best.matchPct);
        badge.style.color       = col;
        badge.style.borderColor = col;
      }
      if (label) {
        const nameText = (best.name || best.ticker).slice(0, 14);
        if (label.textContent !== nameText) label.textContent = nameText;
      }

      el.style.display = '';
    });

    // Hide mini buttons whose rows are not currently in view
    miniPool.forEach((el, key) => {
      if (!activeKeys.has(key) && el.isConnected) el.style.display = 'none';
    });
  }

  // === Buy execution ===

  function getSearchPanel() {
    return [...document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]')]
      .find(el => el.querySelector('input') || el.querySelector('[class*="group/quickBuyButton"]')) || null;
  }

  function typeInPanel(panel, text) {
    const input = panel.querySelector('input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function executeBest(best) {
    // Immediate: overlay button already visible
    const live = findLiveBtn(best);
    if (live) { fireClick(live); return; }

    // Open panel and search for the token
    window.axiomUserOpen = true;

    const doSearch = () => {
      const panel = getSearchPanel();
      if (!panel) { window.axiomUserOpen = false; return; }
      typeInPanel(panel, best.name || best.ticker);
      setTimeout(() => {
        const target = findLiveBtn(best);
        if (target) fireClick(target);
        else console.log('⭐ QBM: token not found in panel results');
        setTimeout(() => { window.axiomUserOpen = false; }, 400);
      }, 400);
    };

    if (!getSearchPanel()) {
      const searchBtn = document.querySelector('[class*="ri-search"]')?.closest('button');
      if (!searchBtn) { window.axiomUserOpen = false; return; }
      searchBtn.click();
      setTimeout(doSearch, 150);
    } else {
      doSearch();
    }
  }

  // === Main loop ===

  setInterval(() => { updateGlow(); updateMiniButtons(); }, 50);

  console.log('⭐ Axiom QBuy Best Match v1.1');
})();

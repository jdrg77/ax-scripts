// ==UserScript==
// @name         Axiom QBuy Best Match
// @namespace    http://tampermonkey.net/
// @version      1.6
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Session Map: rowCA → { rowCA, ca, ticker, name, imgSrc, matchPct, isGrad }
  // rowCA = Contract Address of the pulse row (unique key, no collisions)
  // ca    = Contract Address of the best-match QB button (what to search by)
  const sessionBest = new Map();
  // Mini button pool: rowCA → DOM element
  const miniPool    = new Map();
  let lastGlowBtns  = [];
  let lastNormalSize = { w: 48, h: 48 };

  // === CA extraction ===

  function getCAFromRow(row) {
    const link = row.querySelector('a[href*="pump.fun/coin/"]');
    if (link) {
      const m = link.href.match(/\/coin\/([A-Za-z0-9]{32,})/);
      if (m) return m[1];
    }
    return null;
  }

  function getCAFromBtn(btn) {
    // Grad proxies expose ca directly
    if (btn._gradData?.ca) return btn._gradData.ca;
    // Normal overlay buttons: read from _original's panel row
    const row = btn._original?.closest?.('[class*="max-h-[64px]"]');
    if (row) return getCAFromRow(row);
    return null;
  }

  function getTopCA() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    return rows.length ? getCAFromRow(rows[0]) : null;
  }

  // === QB button helpers ===

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

  function isSpecial(btn) {
    const bg = btn.style.background || '';
    return bg.includes('255, 215, 0') || bg.includes('120, 255, 160');
  }

  function badgeColor(pct) {
    if (pct >= 75) return '#78ffa0';
    if (pct >= 50) return '#ffd700';
    return '#ff6b6b';
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

    if (btns.length) {
      const r = btns[0].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) lastNormalSize = { w: r.width, h: r.height };
    }

    // Glow: non-specials only (specials already highlighted by gold/green color)
    const glowCandidates = btns.filter(btn => !isSpecial(btn));
    let glowMax = -1;
    glowCandidates.forEach(btn => { const p = getBadgePct(btn); if (p > glowMax) glowMax = p; });
    clearGlows();
    if (glowMax >= 0) {
      const winners = glowCandidates.filter(btn => getBadgePct(btn) === glowMax);
      winners.forEach(btn => applyGlow(btn));
      lastGlowBtns = winners;
    }

    // Session Map: ALL buttons (including specials), keyed by top pulse row CA
    if (!btns.length) return;
    const rowCA = getTopCA();
    if (!rowCA) return;
    let overallMax = -1;
    btns.forEach(btn => { const p = getBadgePct(btn); if (p > overallMax) overallMax = p; });
    if (overallMax < 0) return;
    const existing = sessionBest.get(rowCA);
    if (!existing || overallMax > existing.matchPct) {
      const winner = btns.find(btn => getBadgePct(btn) === overallMax);
      sessionBest.set(rowCA, {
        rowCA,
        ca:       getCAFromBtn(winner),  // match button's own CA (for panel search)
        ticker:   winner._ticker  || '',
        name:     winner._name    || '',
        imgSrc:   getBtnImgSrc(winner),
        matchPct: overallMax,
        isGrad:   !!winner._gradData
      });
    }
  }

  // === Mini buttons ===

  function createMiniBtn(rowCA) {
    const refBtn = getQBButtons()[0];
    let el;
    if (refBtn) {
      el = refBtn.cloneNode(false);
      el.removeAttribute('data-qb-added');
    } else {
      el = document.createElement('button');
      el.style.background   = 'rgba(20,20,30,0.92)';
      el.style.border       = '1.5px solid rgba(255,215,0,0.7)';
      el.style.borderRadius = '6px';
      el.style.cursor       = 'pointer';
    }

    el.setAttribute('data-qbm-mini', rowCA);
    el.style.position = 'fixed';
    el.style.zIndex   = '10000';
    el.style.display  = 'none';
    el.style.overflow = 'visible';

    // Badge at top-right corner — no external elements sticking into row content
    const badge = document.createElement('span');
    badge.className = 'qbm-badge';
    badge.style.cssText = 'position:absolute;top:-9px;right:-9px;font-size:10px;font-weight:700;font-family:monospace;color:#fff;background:rgba(0,0,0,0.85);border-radius:8px;padding:1px 5px;pointer-events:none;white-space:nowrap;border:1.5px solid currentColor;z-index:10001;';
    el.appendChild(badge);

    el.addEventListener('click', e => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
      const best = sessionBest.get(rowCA);
      if (best) executeBest(best);
    });

    document.body.appendChild(el);
    miniPool.set(rowCA, el);
    return el;
  }

  function getOrCreateMiniBtn(rowCA) {
    const existing = miniPool.get(rowCA);
    if (existing?.isConnected) return existing;
    return createMiniBtn(rowCA);
  }

  function updateMiniButtons() {
    const rows      = document.querySelectorAll('[class*="group/pulseRow"]');
    const activeKeys = new Set();
    const seenCAs    = new Set(); // skip duplicate CAs (same token in multiple rows)

    rows.forEach(row => {
      const rowCA = getCAFromRow(row);
      if (!rowCA || seenCAs.has(rowCA)) return;
      seenCAs.add(rowCA);

      const best = sessionBest.get(rowCA);
      if (!best) return;

      const rect = row.getBoundingClientRect();
      if (rect.width < 10 || rect.bottom < 0 || rect.top > window.innerHeight) return;

      activeKeys.add(rowCA);

      const el     = getOrCreateMiniBtn(rowCA);
      const miniH  = lastNormalSize.h * 0.75;
      const miniW  = lastNormalSize.w * 0.75;
      el.style.left = (rect.right - miniW - 6) + 'px';
      el.style.top  = (rect.top + rect.height * 0.62 - miniH / 2) + 'px';

      const badge = el.querySelector('.qbm-badge');
      if (badge) {
        const pctText = best.matchPct.toFixed(1) + '%';
        if (badge.textContent !== pctText) badge.textContent = pctText;
        const col = badgeColor(best.matchPct);
        badge.style.color       = col;
        badge.style.borderColor = col;
      }

      el.style.display = '';
    });

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

  function bringPanelToFront() {
    const panel = getSearchPanel();
    if (!panel) return;
    const wrapper = panel.parentElement;
    const overlay = wrapper?.parentElement;
    if (wrapper) {
      wrapper.style.removeProperty('z-index');
      wrapper.style.removeProperty('pointer-events');
      wrapper.style.removeProperty('transition');
      wrapper.style.removeProperty('animation');
    }
    if (overlay) {
      overlay.style.removeProperty('z-index');
      overlay.style.removeProperty('pointer-events');
      overlay.style.removeProperty('background');
      overlay.style.removeProperty('backdrop-filter');
      overlay.style.removeProperty('transition');
      overlay.style.removeProperty('animation');
    }
  }

  // After CA search, Axiom returns exactly 1 result → any visible QB button is correct
  function waitForAnyBtn(timeoutMs, cb) {
    const start = Date.now();
    const poll = () => {
      const btns   = getQBButtons();
      const target = btns.find(btn => getBadgePct(btn) >= 0) || btns[0] || null;
      if (target) { cb(target); return; }
      if (Date.now() - start > timeoutMs) { cb(null); return; }
      setTimeout(poll, 50);
    };
    poll();
  }

  function executeBest(best) {
    window.axiomUserOpen = true;

    const doExecute = () => {
      bringPanelToFront();
      const panel   = getSearchPanel();
      // CA search returns exactly 1 result → no ambiguity; fall back to name/ticker
      const query   = best.ca || best.name || best.ticker;
      if (panel) typeInPanel(panel, query);

      // 100ms for panel to update + 500ms extra for graduated toggle
      const preDelay = 100 + (best.isGrad ? 500 : 0);
      setTimeout(() => {
        waitForAnyBtn(700, target => {
          if (target) target.click();
          else console.log('⭐ QBM: no QB button found after search for', query);
          setTimeout(() => { window.axiomUserOpen = false; }, 400);
        });
      }, preDelay);
    };

    if (!getSearchPanel()) {
      const searchBtn = document.querySelector('[class*="ri-search"]')?.closest('button');
      if (!searchBtn) { window.axiomUserOpen = false; return; }
      searchBtn.click();
      setTimeout(doExecute, 150);
    } else {
      doExecute();
    }
  }

  // === Main loop ===

  setInterval(() => { updateGlow(); updateMiniButtons(); }, 50);

  console.log('⭐ Axiom QBuy Best Match v1.6');
})();

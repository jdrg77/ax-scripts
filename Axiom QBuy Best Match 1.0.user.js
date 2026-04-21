// ==UserScript==
// @name         Axiom QBuy Best Match
// @namespace    http://tampermonkey.net/
// @version      2.7
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Session Map: rowCA → { rowCA, ca, ticker, name, imgSrc, matchPct, isGrad, age, mc, solText }
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

  function getBtnSolText(btn) {
    const orig = btn._original;
    if (orig) {
      const text = orig.textContent.replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    return '';
  }

  function getBtnInfoBar(btn) {
    const bar = btn.querySelector('.qb-info-bar');
    if (!bar) return { age: '', mc: '' };
    const spans = [...bar.querySelectorAll('span')];
    return {
      age: spans[0]?.textContent?.trim() || '',
      mc:  spans[1]?.textContent?.trim() || '',
    };
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
      const { age, mc } = getBtnInfoBar(winner);
      sessionBest.set(rowCA, {
        rowCA,
        ca:       getCAFromBtn(winner),
        ticker:   winner._ticker  || '',
        name:     winner._name    || '',
        imgSrc:   getBtnImgSrc(winner),
        matchPct: overallMax,
        isGrad:   !!winner._gradData,
        age,
        mc,
        solText:  getBtnSolText(winner),
      });
    }
  }

  // === Mini buttons ===

  function createMiniBtn(rowCA) {
    const el = document.createElement('button');
    el.setAttribute('data-qbm-mini', rowCA);
    el.style.position       = 'fixed';
    el.style.zIndex         = '10000';
    el.style.display        = 'none';
    el.style.overflow       = 'visible';
    el.style.background     = 'rgba(20,20,30,0.92)';
    el.style.border         = '1.5px solid rgba(255,215,0,0.7)';
    el.style.borderRadius   = '6px';
    el.style.cursor         = 'pointer';
    el.style.alignItems     = 'center';
    el.style.justifyContent = 'center';
    el.style.transform      = 'scale(0.7842)';
    el.style.transformOrigin = 'top-left';

    // Coin image (left side, same as QBuy overlay buttons)
    const coinImg = document.createElement('img');
    coinImg.className = 'qbm-coin-img';
    coinImg.style.cssText = 'width:60px;height:60px;border-radius:50%;object-fit:cover;position:absolute;left:-66px;top:50%;transform:translateY(-50%);pointer-events:auto;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
    coinImg.addEventListener('click', e => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
      const best = sessionBest.get(rowCA);
      if (best?.ca) window.location.href = '/meme/' + best.ca;
    });
    el.appendChild(coinImg);

    // % badge at top-left corner of coin image
    const pctBadge = document.createElement('span');
    pctBadge.className = 'qbm-pct';
    pctBadge.style.cssText = 'position:absolute;left:-36px;top:calc(50% - 25px);transform:translate(-50%,-50%);font-size:10px;font-weight:700;font-family:monospace;color:#fff;background:rgba(0,0,0,0.85);border-radius:8px;padding:1px 5px;pointer-events:none;white-space:nowrap;border:1.5px solid currentColor;z-index:10001;';
    el.appendChild(pctBadge);

    // SOL amount text centered in button body
    const amountEl = document.createElement('div');
    amountEl.className = 'qbm-amount';
    amountEl.style.cssText = 'font-size:11px;font-weight:700;font-family:monospace;color:#fff;pointer-events:none;text-align:center;line-height:1.2;';
    el.appendChild(amountEl);

    // Ticker/name label above button
    const label = document.createElement('div');
    label.className = 'qbm-label';
    label.style.cssText = 'position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:2px;font-size:10px;font-weight:600;font-family:monospace;color:#ccc;background:rgba(0,0,0,0.65);border-radius:4px;padding:1px 4px;pointer-events:none;white-space:nowrap;z-index:10001;';
    el.appendChild(label);

    // Age + MC bar below button (mirrors QBuy's qb-info-bar)
    const infoBar = document.createElement('div');
    infoBar.className = 'qbm-info-bar';
    infoBar.style.cssText = 'position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:2px;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:4px;font-size:11px;font-weight:700;font-family:monospace;pointer-events:none;white-space:nowrap;z-index:10001;';

    const ageEl = document.createElement('span');
    ageEl.className = 'qbm-age';
    ageEl.style.cssText = 'color:#ffd700;background:rgba(0,0,0,0.7);border-radius:4px;padding:1px 5px;';
    infoBar.appendChild(ageEl);

    const mcEl = document.createElement('span');
    mcEl.className = 'qbm-mc';
    mcEl.style.cssText = 'color:#5bb8ff;background:rgba(0,0,0,0.7);border-radius:4px;padding:1px 5px;';
    infoBar.appendChild(mcEl);

    el.appendChild(infoBar);

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

  function isPanelVisible() {
    const panel = getSearchPanel();
    if (!panel) return false;
    return panel.parentElement?.style.zIndex !== '-9999';
  }

  function updateMiniButtons() {
    if (isPanelVisible()) {
      miniPool.forEach(el => { if (el.isConnected) el.style.display = 'none'; });
      return;
    }

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

      const el   = getOrCreateMiniBtn(rowCA);
      const btnW = lastNormalSize.w;
      const btnH = lastNormalSize.h;

      // Center within the visible "0 SOL" div (desktop one has width > 0; mobile one is hidden)
      const solDiv = Array.from(
        row.querySelectorAll('[class*="z-20"][class*="absolute"][class*="right-0"][class*="bottom-0"]')
      ).find(el => el.getBoundingClientRect().width > 0);
      let posLeft, posTop;
      if (solDiv) {
        const sr = solDiv.getBoundingClientRect();
        posLeft = sr.left + sr.width  / 2 - btnW / 2 + 79;
        posTop  = sr.bottom - btnH - 10;
      } else {
        posLeft = rect.right - btnW - 4;
        posTop  = rect.top + rect.height / 2 - btnH / 2;
      }
      el.style.left   = posLeft + 'px';
      el.style.top    = posTop  + 'px';
      el.style.width  = btnW + 'px';
      el.style.height = btnH + 'px';

      const coinImg = el.querySelector('.qbm-coin-img');
      if (coinImg && best.imgSrc && coinImg.src !== best.imgSrc) coinImg.src = best.imgSrc;

      const pctBadge = el.querySelector('.qbm-pct');
      if (pctBadge) {
        const pctText = best.matchPct.toFixed(1) + '%';
        if (pctBadge.textContent !== pctText) pctBadge.textContent = pctText;
        const col = badgeColor(best.matchPct);
        pctBadge.style.color       = col;
        pctBadge.style.borderColor = col;
      }

      const amountEl = el.querySelector('.qbm-amount');
      if (amountEl && amountEl.textContent !== (best.solText || '')) amountEl.textContent = best.solText || '';

      const label = el.querySelector('.qbm-label');
      if (label) {
        const nameText = (best.ticker || best.name || '').slice(0, 14);
        if (label.textContent !== nameText) label.textContent = nameText;
      }

      const ageEl = el.querySelector('.qbm-age');
      if (ageEl && ageEl.textContent !== (best.age || '')) ageEl.textContent = best.age || '';

      const mcEl = el.querySelector('.qbm-mc');
      if (mcEl && mcEl.textContent !== (best.mc || '')) mcEl.textContent = best.mc || '';

      const infoBar = el.querySelector('.qbm-info-bar');
      if (infoBar) infoBar.style.display = (best.age || best.mc) ? '' : 'none';

      el.style.display        = 'flex';
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

  console.log('⭐ Axiom QBuy Best Match v2.7');
})();

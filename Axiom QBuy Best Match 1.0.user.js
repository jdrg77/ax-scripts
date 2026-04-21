// ==UserScript==
// @name         Axiom QBuy Best Match
// @namespace    http://tampermonkey.net/
// @version      1.0
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
  let lastGlowBtns  = [];
  let lastNormalSize = { w: 48, h: 48 };

  // === Helpers ===

  function getPairKey() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    if (!rows.length) return null;
    const row      = rows[0];
    const tickerEl = row.querySelector('div[class*="min-w-0"][class*="truncate"][class*="text-[16px]"]');
    const nameEl   = row.querySelector('div[class*="min-w-0"][class*="flex-1"][class*="overflow-hidden"]');
    const ticker   = tickerEl?.textContent.trim() || '';
    const name     = nameEl?.textContent.trim()   || '';
    return (ticker || name) ? (ticker + '|' + name).toLowerCase() : null;
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

  function fireClick(el) {
    const r  = el.getBoundingClientRect();
    const cx = r.left + r.width  / 2;
    const cy = r.top  + r.height / 2;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(ev =>
      el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    );
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
    const btns  = getQBButtons();
    let maxPct  = -1;

    btns.forEach(btn => { const p = getBadgePct(btn); if (p > maxPct) maxPct = p; });

    // Track ref size while buttons are visible
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
        ticker:   best._ticker  || '',
        name:     best._name    || '',
        imgSrc:   getBtnImgSrc(best),
        matchPct: maxPct
      });
    }
  }

  // === Mini button ===

  const mini = { el: null, img: null, badge: null, label: null };

  function ensureMini() {
    if (mini.el?.isConnected) return;

    const el = document.createElement('button');
    el.setAttribute('data-qbm', '1');
    el.style.cssText = 'position:fixed;z-index:10000;display:none;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:3px 5px;background:rgba(0,0,0,0.88);border:1.5px solid #ffd700;border-radius:6px;cursor:pointer;overflow:visible;box-sizing:border-box;pointer-events:auto;';
    el.addEventListener('click', onMiniBtnClick);

    const img = document.createElement('img');
    img.style.cssText = 'border-radius:50%;object-fit:cover;flex-shrink:0;display:block;';
    el.appendChild(img);

    const badge = document.createElement('span');
    badge.style.cssText = 'font-size:9px;font-weight:700;font-family:monospace;color:#ffd700;line-height:1;';
    el.appendChild(badge);

    const label = document.createElement('span');
    label.style.cssText = 'font-size:8px;font-weight:600;font-family:monospace;color:#ccc;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    el.appendChild(label);

    document.body.appendChild(el);
    mini.el    = el;
    mini.img   = img;
    mini.badge = badge;
    mini.label = label;
  }

  function updateMiniBtn() {
    const key = getPairKey();
    if (!key) { if (mini.el) mini.el.style.display = 'none'; return; }

    const best = sessionBest.get(key);
    if (!best || best.matchPct < 0) { if (mini.el) mini.el.style.display = 'none'; return; }

    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    if (!rows.length) { if (mini.el) mini.el.style.display = 'none'; return; }

    const topRow = rows[0];
    const rect   = topRow.getBoundingClientRect();
    if (rect.width < 10) { if (mini.el) mini.el.style.display = 'none'; return; }

    ensureMini();

    // Size: 75% of normal QB button, min 36px
    const miniH = Math.max(Math.round(lastNormalSize.h * 0.75), 36);
    const miniW = Math.max(Math.round(lastNormalSize.w * 0.75), 40);
    const imgSz = Math.round(miniH * 0.5);

    // Anchor to right edge of pulse row, vertically centered
    mini.el.style.width  = miniW + 'px';
    mini.el.style.height = miniH + 'px';
    mini.el.style.left   = (rect.right - miniW - 6) + 'px';
    mini.el.style.top    = (rect.top + rect.height / 2 - miniH / 2) + 'px';

    // Update children only if changed
    if (mini.img.src !== (best.imgSrc || '')) {
      mini.img.src              = best.imgSrc || '';
      mini.img.style.width      = imgSz + 'px';
      mini.img.style.height     = imgSz + 'px';
      mini.img.style.display    = best.imgSrc ? 'block' : 'none';
    }
    const pctText = best.matchPct.toFixed(1) + '%';
    if (mini.badge.textContent !== pctText) mini.badge.textContent = pctText;
    const nameText = (best.name || best.ticker).slice(0, 10);
    if (mini.label.textContent !== nameText) mini.label.textContent = nameText;
    mini.label.style.maxWidth = miniW + 'px';

    mini.el.style.display = 'flex';
  }

  function onMiniBtnClick(e) {
    e.stopPropagation();
    e.preventDefault();

    const key = getPairKey();
    if (!key) return;
    const best = sessionBest.get(key);
    if (!best) return;

    const allBtns = getQBButtons();

    // Primary: match by coin image src (avoids same-name confusion)
    let target = best.imgSrc
      ? allBtns.find(btn => getBtnImgSrc(btn) === best.imgSrc) || null
      : null;

    // Fallback: match by ticker then name
    if (!target) {
      target = allBtns.find(btn =>
        (best.ticker && btn._ticker === best.ticker) ||
        (best.name   && btn._name   === best.name)
      ) || null;
    }

    if (target) {
      fireClick(target);
    } else {
      console.log('⭐ QBM: best match button not visible — open the panel first');
    }
  }

  // === Main loop ===

  setInterval(() => { updateGlow(); updateMiniBtn(); }, 50);

  console.log('⭐ Axiom QBuy Best Match v1.0');
})();

// ==UserScript==
// @name         Axiom QBuy Best Match
// @namespace    http://tampermonkey.net/
// @version      7.96
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') === 'grad') return;

  const gradChannel = new BroadcastChannel('axiom-tabs');

  // Session Map: rowCA → { rowCA, ca, ticker, name, imgSrc, matchPct, isGrad, age, mc, solText }
  const sessionBest = new Map();
  // Mini button pool: rowCA → DOM element
  const miniPool    = new Map();
  let lastGlowBtns  = [];
  let lastNormalSize = { w: 48, h: 48 };
  let prefetchCount    = 0;
  let prefetchCooldown = false;
  let cooldownTimer    = null;

  // Graduated candidates received from Tab 2 via BroadcastChannel
  // Each: { ticker, name, age, mc, imgSrc, match, _isGrad: true }
  let gradCandidates  = [];
  let gradSeqApplied  = -1; // seq of the last accepted GRAD_DATA

  // ======= BROADCHANNEL =======

  gradChannel.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'GRAD_DATA') {
      if (msg.seq !== undefined && msg.seq !== window.__gradSeq) return; // stale scan, discard
      gradCandidates = (msg.tokens || []).map(t => ({ ...t, _isGrad: true }));
      gradSeqApplied = msg.seq ?? -1;
      updateGlow();
    }
  };

  // ======= PREFETCH START =======

  window.addEventListener('axiomPrefetchStart', () => {
    prefetchCount++;
    prefetchCooldown = true;
    gradCandidates   = [];
    gradSeqApplied   = -1;
    let lastSnapshot = getQBButtons();
    const checkChanged = setInterval(() => {
      const curr = getQBButtons();
      if (curr.length !== lastSnapshot.length || curr.some(b => !lastSnapshot.includes(b))) {
        lastSnapshot = curr;
        clearTimeout(cooldownTimer);
        cooldownTimer = setTimeout(() => { clearInterval(checkChanged); prefetchCooldown = false; }, 100);
      }
    }, 50);
    setTimeout(() => { clearInterval(checkChanged); prefetchCooldown = false; }, 3000);
  });

  // === CA extraction ===

  function getCAFromRow(row) {
    const meme = row.querySelector('a[href*="/meme/"]');
    if (meme) {
      const m = meme.href.match(/\/meme\/([A-Za-z0-9]{32,})/);
      if (m) return m[1];
    }
    const pump = row.querySelector('a[href*="pump.fun/coin/"]');
    if (pump) {
      const m = pump.href.match(/\/coin\/([A-Za-z0-9]{32,})/);
      if (m) return m[1];
    }
    return null;
  }

  function getTopRowPlatform() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    if (!rows.length) return 'other';
    const row = rows[0];
    if (row.querySelector('img[src*="bonk"]')) return 'bonk';
    if (row.querySelector('img[src*="pump"]')) return 'pump';
    return 'other';
  }

  function getBtnPlatform(btn) {
    if (btn._isGrad) return btn.platform || 'other';
    return btn._platform || 'other';
  }

  function getBtnHasDex(btn) {
    if (btn._isGrad) return false;
    const bg = btn._original?.style?.background || '';
    if (bg) return bg.includes('120, 255, 160') || bg.includes('120,255,160');
    return !!btn._hasDex;
  }

  function getCAFromBtn(btn) {
    if (btn._isGrad) return btn.ca || null;
    return btn._ca || null;
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
      btn.querySelector?.('.qb-sim-badge') &&
      !btn._isGradProxy
    );
  }

  function getBadgePct(btn) {
    if (btn._isGrad) return btn.match ?? -1;
    const text = btn.querySelector('.qb-sim-badge')?.textContent?.trim() || '';
    if (!text || text === '…' || text === '?' || text === '—') return -1;
    const pct = parseFloat(text);
    return isNaN(pct) ? -1 : pct;
  }

  function getBtnImgSrc(btn) {
    if (btn._isGrad) return btn.imgSrc || null;
    return btn.querySelector('img.qb-coin-img')?.src || null;
  }

  function getBtnSolText(btn) {
    if (!btn._isGrad && btn._original) {
      const text = btn._original.textContent.replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
    for (const b of getQBButtons()) {
      if (b._original) {
        const text = b._original.textContent.replace(/\s+/g, ' ').trim();
        if (text) return text;
      }
    }
    return '';
  }

  function getBtnInfoBar(btn) {
    if (btn._isGrad) return { age: btn.age || '', mc: btn.mc || '' };
    const bar = btn.querySelector('.qb-info-bar');
    if (!bar) return { age: '', mc: '' };
    const spans = [...bar.querySelectorAll('span')];
    return {
      age: spans[0]?.textContent?.trim() || '',
      mc:  spans[1]?.textContent?.trim() || '',
    };
  }

  function badgeColor(pct) {
    if (pct >= 75) return '#78ffa0';
    if (pct >= 50) return '#ffd700';
    return '#ff6b6b';
  }

  // === Glow ===

  function applyGlow(btn) {
    if (btn._isGrad) return; // no DOM element to glow
    btn.style.boxShadow = '0 0 18px 5px #ffd700, 0 0 36px 10px rgba(255,215,0,0.4)';
    btn.style.outline   = '2px solid #ffd700';
    btn.setAttribute('data-qbm-glow', '1');
  }

  function clearGlows() {
    lastGlowBtns.forEach(btn => {
      if (btn._isGrad || !btn.isConnected || btn.getAttribute('data-qbm-glow') !== '1') return;
      btn.style.removeProperty('box-shadow');
      btn.style.removeProperty('outline');
      btn.removeAttribute('data-qbm-glow');
    });
    lastGlowBtns = [];
  }

  function updateGlow() {
    const normalBtns = getQBButtons(); // all are normal in v9.0

    if (normalBtns.length) {
      const r = normalBtns[0].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) lastNormalSize = { w: r.width, h: r.height };
    }

    const topNormal = normalBtns[0] || null;
    const seqOk     = gradSeqApplied !== -1 && gradSeqApplied === (window.__gradSeq ?? -1);
    const topGrad   = seqOk ? (gradCandidates[0] || null) : null;

    let winner;
    if (!topNormal && !topGrad) { clearGlows(); return; }
    else if (!topGrad)   winner = topNormal;
    else if (!topNormal) winner = topGrad;
    else {
      const topRowPlat = getTopRowPlatform();
      const matchN = topRowPlat !== 'other' && getBtnPlatform(topNormal) === topRowPlat;
      const matchG = topRowPlat !== 'other' && (topGrad.platform || 'other') === topRowPlat;
      if      (matchN && !matchG) winner = topNormal;
      else if (matchG && !matchN) winner = topGrad;
      else {
        const pN = getBadgePct(topNormal), pG = getBadgePct(topGrad);
        const tier = p => p >= 75 ? 2 : p >= 50 ? 1 : 0;
        const tN = tier(pN), tG = tier(pG);
        winner = tN !== tG ? (tN > tG ? topNormal : topGrad) : (pN >= pG ? topNormal : topGrad);
      }
    }

    const overallMax = getBadgePct(winner);

    clearGlows();
    if (overallMax >= 0) {
      applyGlow(winner);
      lastGlowBtns = [winner];
    }

    if (overallMax < 0) return;
    const rowCA = getTopCA();
    if (!rowCA) return;
    const existing = sessionBest.get(rowCA);
    if (prefetchCount > 2 && !prefetchCooldown && (!existing || overallMax > existing.matchPct)) {
      const { age, mc } = getBtnInfoBar(winner);
      sessionBest.set(rowCA, {
        rowCA,
        ca:       getCAFromBtn(winner) || rowCA,
        ticker:   winner._isGrad ? (winner.ticker || '') : (winner._ticker || ''),
        name:     winner._isGrad ? (winner.name   || '') : (winner._name   || ''),
        imgSrc:   getBtnImgSrc(winner),
        matchPct: overallMax,
        isGrad:   !!winner._isGrad,
        platform: getBtnPlatform(winner),
        hasDex:   getBtnHasDex(winner),
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
    el.style.zIndex         = '99999';
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

    const coinImg = document.createElement('img');
    coinImg.className = 'qbm-coin-img';
    coinImg.style.cssText = 'width:60px;height:60px;border-radius:50%;object-fit:cover;position:absolute;left:-66px;top:50%;transform:translateY(-50%);pointer-events:auto;cursor:pointer;box-shadow:0 0 0 1px rgba(255,255,255,0.35),0 2px 8px rgba(0,0,0,0.4);';
    coinImg.addEventListener('click', e => {
      e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
      const best = sessionBest.get(rowCA);
      if (best?.ca) {
        const existing = document.querySelector(`a[href*="${best.ca}"]`);
        if (existing) { existing.click(); }
        else { history.pushState({}, '', `/meme/${best.ca}?chain=sol`); window.dispatchEvent(new PopStateEvent('popstate')); }
      }
    });
    el.appendChild(coinImg);

    const pctBadge = document.createElement('span');
    pctBadge.className = 'qbm-pct';
    pctBadge.style.cssText = 'position:absolute;left:-36px;top:calc(50% - 25px);transform:translate(-50%,-50%);font-size:10px;font-weight:700;font-family:monospace;color:#fff;background:rgba(0,0,0,0.85);border-radius:8px;padding:1px 5px;pointer-events:none;white-space:nowrap;border:1.5px solid currentColor;z-index:10001;';
    el.appendChild(pctBadge);

    const amountEl = document.createElement('div');
    amountEl.className = 'qbm-amount';
    amountEl.style.cssText = 'font-size:11px;font-weight:700;font-family:monospace;color:#fff;pointer-events:none;text-align:center;line-height:1.2;';
    el.appendChild(amountEl);

    const label = document.createElement('div');
    label.className = 'qbm-label';
    label.style.cssText = 'position:fixed;display:none;font-size:10px;font-weight:600;font-family:monospace;color:#ccc;background:rgba(0,0,0,0.65);border-radius:4px;padding:1px 4px;pointer-events:none;white-space:nowrap;z-index:100000;transform:translateX(-50%);';
    document.body.appendChild(label);
    el._label = label;

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
      e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
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
    if (existing?._label?.isConnected) existing._label.remove();
    return createMiniBtn(rowCA);
  }

  function isPanelVisible() {
    const panel = getSearchPanel();
    if (!panel) return false;
    return panel.parentElement?.style.zIndex !== '-9999';
  }

  function updateMiniButtons() {
    if (isPanelVisible()) {
      miniPool.forEach(el => { if (el.isConnected) el.style.display = 'none'; if (el._label) el._label.style.display = 'none'; });
      return;
    }

    const rows      = document.querySelectorAll('[class*="group/pulseRow"]');
    const activeKeys = new Set();
    const seenCAs    = new Set();

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

      const label = el._label;
      if (label) {
        const nameText = best.name || best.ticker || '';
        if (label.textContent !== nameText) label.textContent = nameText;
        label.style.left    = (posLeft + (btnW * 0.7842) / 2) + 'px';
        label.style.top     = (posTop - 18) + 'px';
        label.style.display = '';
      }

      const ageEl = el.querySelector('.qbm-age');
      if (ageEl && ageEl.textContent !== (best.age || '')) ageEl.textContent = best.age || '';

      const mcEl = el.querySelector('.qbm-mc');
      if (mcEl && mcEl.textContent !== (best.mc || '')) mcEl.textContent = best.mc || '';

      const infoBar = el.querySelector('.qbm-info-bar');
      if (infoBar) infoBar.style.display = (best.age || best.mc) ? '' : 'none';

      const pumpDex    = best.platform === 'pump' && !best.isGrad && best.hasDex;
      const platBorder = pumpDex                  ? '#78ffa0'
                       : best.platform === 'pump' ? '#ffd700'
                       : best.platform === 'bonk' ? '#ff8c00'
                       : badgeColor(best.matchPct);
      const platGlow   = pumpDex                  ? 'rgba(120,255,160,0.7)'
                       : best.platform === 'pump' ? 'rgba(255,215,0,0.6)'
                       : best.platform === 'bonk' ? 'rgba(255,140,0,0.6)'
                       : badgeColor(best.matchPct) + '40';
      const platBg     = pumpDex                  ? 'rgba(120,255,160,0.85)'
                       : best.platform === 'pump' ? 'rgba(255,215,0,0.85)'
                       : best.platform === 'bonk' ? 'rgba(255,140,0,0.85)'
                       : 'rgba(20,20,30,0.92)';
      el.style.background = platBg;
      el.style.border    = `1.5px solid ${platBorder}`;
      el.style.boxShadow = `0 0 8px 2px ${platGlow}`;

      el.style.display = 'flex';
    });

    miniPool.forEach((el, key) => {
      if (!activeKeys.has(key) && el.isConnected) { el.style.display = 'none'; if (el._label) el._label.style.display = 'none'; }
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

  function waitForNewBtn(prevBtns, timeoutMs, cb) {
    const start = Date.now();
    const poll = () => {
      const current = getQBButtons();
      const newBtn  = current.find(b => !prevBtns.includes(b) && getBadgePct(b) >= 0)
                   || current.find(b => !prevBtns.includes(b))
                   || null;
      if (newBtn) { cb(newBtn); return; }
      if (!prevBtns.length && current.length) {
        cb(current.find(b => getBadgePct(b) >= 0) || current[0]);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        cb(current.find(b => getBadgePct(b) >= 0) || current[0] || null);
        return;
      }
      setTimeout(poll, 50);
    };
    poll();
  }

  function executeBest(best) {
    // Graduated token: route to Tab 2 via BroadcastChannel
    if (best.isGrad) {
      console.log('📡 QBM → Tab2: EXECUTE_BUY_GRAD', best.ticker || best.name);
      gradChannel.postMessage({ type: 'EXECUTE_BUY_GRAD', ticker: best.ticker, name: best.name, ca: best.ca });
      return;
    }

    window.axiomUserOpen = true;

    const isCurrentPrefetch = best.rowCA === getTopCA();

    if (isCurrentPrefetch) {
      const sorted = getQBButtons().sort((a, b) => getBadgePct(b) - getBadgePct(a));
      const target = sorted[0] || null;
      if (target) { target.click(); setTimeout(() => { window.axiomUserOpen = false; }, 400); return; }
      // No proxy buttons yet — fall through to historical flow
    }

    // Historical token: open panel, type CA, wait for NEW buttons after search
    const doExecute = () => {
      bringPanelToFront();
      const panel = getSearchPanel();
      if (!panel) { window.axiomUserOpen = false; return; }
      const query    = best.ca || best.name || best.ticker;
      const prevBtns = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')];
      typeInPanel(panel, query);
      const start = Date.now();
      const poll = () => {
        const btns = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')];
        const fresh = btns.filter(b => !prevBtns.includes(b));
        const target = fresh[0] || null;
        if (target) {
          const r = target.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(ev =>
            target.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
          );
          setTimeout(() => { window.axiomUserOpen = false; }, 400);
          return;
        }
        if (Date.now() - start > 1500) { window.axiomUserOpen = false; return; }
        setTimeout(poll, 50);
      };
      setTimeout(poll, 100);
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

  console.log('⭐ Axiom QBuy Best Match v7.96 — two-tab graduated support');
})();

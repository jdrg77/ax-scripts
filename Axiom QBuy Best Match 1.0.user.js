// ==UserScript==
// @name         Axiom QBuy Best Match
// @namespace    http://tampermonkey.net/
// @version      8.37
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  const _p = new URLSearchParams(location.search);
  if (_p.get('tab') === 'grad' || _p.get('role') === 'buyer') return;

  const gradChannel = new BroadcastChannel('axiom-tabs');

  // Session Map: rowCA → { rowCA, ca, ticker, name, imgSrc, matchPct, isGrad, age, mc, solText }
  const sessionBest = new Map();
  const _prevHasBestMatch = window.__axiomHasBestMatch;
  window.__axiomHasBestMatch = ca => sessionBest.has(ca) || !!_prevHasBestMatch?.(ca);
  // Mini button pool: rowCA → DOM element
  const miniPool    = new Map();
  let lastGlowBtns  = [];
  let lastNormalSize = { w: 48, h: 48 };
  let prefetchCount    = 0;
  let prefetchCooldown = false;
  let cooldownTimer    = null;

  // Graduated candidates received from Tab 2 via BroadcastChannel
  // Each: { ticker, name, age, mc, imgSrc, match, _isGrad: true }
  let gradCandidates    = [];
  let gradSeqApplied    = -1; // seq of the last accepted GRAD_DATA
  let awaitingT2Confirm = false;
  let awaitT2Timer      = null;
  let stableCA          = null;
  let stableCAStart     = 0;

  // ======= BROADCHANNEL =======

  gradChannel.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'GRAD_DATA') {
      if (msg.seq !== undefined && msg.seq !== window.__gradSeq) return; // stale scan, discard
      gradCandidates = (msg.tokens || []).map(t => ({ ...t, _isGrad: true }));
      gradSeqApplied = msg.seq ?? -1;
      clearTimeout(awaitT2Timer);
      awaitingT2Confirm = false;
      updateGlow();
    }
  };

  // ======= PREFETCH START =======

  window.addEventListener('axiomPrefetchStart', () => {
    prefetchCount++;
    prefetchCooldown = true;
    const hadGrad    = gradCandidates.length > 0;
    gradCandidates   = [];
    gradSeqApplied   = -1;
    clearTimeout(cooldownTimer);
    clearTimeout(awaitT2Timer);
    if (hadGrad) {
      awaitingT2Confirm = true;
      awaitT2Timer = setTimeout(() => { awaitingT2Confirm = false; }, 500);
    }
    cooldownTimer = setTimeout(() => { prefetchCooldown = false; }, 400);
  });

  window.addEventListener('axiomAPIResult', (e) => {
    const d = e.detail;
    if (!d?.ca || !d.pairAddress) return;

    const keyCA    = d.ca;
    const existing = sessionBest.get(keyCA);
    if (existing && d.matchPct <= existing.matchPct) return;

    const template = getQBButtons()[0]?._original?.cloneNode(true) || null;

    sessionBest.set(keyCA, {
      rowCA:       keyCA,
      ca:          d.ca,
      pairAddress: d.pairAddress,
      newPairCA:   d._rescuedRowCA || d.rowCA || keyCA,
      memeHref:    `/meme/${d.pairAddress}?chain=sol`,
      btnTemplate: template,
      ticker:      d.ticker,
      name:        d.name,
      imgSrc:      d.imgSrc,
      age:         '',
      mc:          '',
      matchPct:    d.matchPct,
      isGrad:      false,
      platform:    'pump',
      isMigrated:  false,
      hasDex:      false,
    });
    console.log('✅ Best Match API result saved:', d.ticker, d.matchPct + '%');
  });


  // === CA extraction ===

  function getCAFromRow(row) {
    const pump = row.querySelector('a[href*="pump.fun/coin/"]');
    if (pump) {
      const m = pump.href.match(/\/coin\/([A-Za-z0-9]{32,})/);
      if (m) return m[1];
    }
    const meme = row.querySelector('a[href*="/meme/"]');
    if (meme) {
      const m = meme.href.match(/\/meme\/([A-Za-z0-9]{32,})/);
      if (m) return m[1];
    }
    return null;
  }

  function getTopRowPlatform() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    if (!rows.length) return 'other';
    const row = rows[0];
    if (row.querySelector('img[src*="bonk"]')) return 'bonk';
    if (row.querySelector('img[src*="pump-grad.svg"][alt="Raydium V4"]')) return 'raydium';
    if (row.querySelector('img[src*="pump"]')) return 'pump';
    return 'other';
  }

  function getBtnPlatform(btn) {
    if (btn._isGrad) return btn.platform || 'other';
    return btn._platform || 'other';
  }

  function getBtnHasDex(btn) {
    if (btn._isGrad) return btn.hasDex || false;
    return !!btn._hasDex;
  }

  function getBtnIsMigrated(btn) {
    if (btn._isGrad) return btn.isMigrated || false;
    return !!btn._isMigrated;
  }

  function getCAFromBtn(btn) {
    if (btn._isGrad) return btn.ca || null;
    const row = btn._original?.closest('[class*="max-h-[64px]"]');
    if (row) {
      for (const a of row.querySelectorAll('a[href]')) {
        const h = a.href || '';
        if (h.includes('pump.fun')) { const m = h.match(/\/coin\/([A-Za-z0-9]{32,})/); if (m) return m[1]; }
        if (h.includes('bonk'))     { const m = h.match(/\/([A-Za-z0-9]{32,})/);       if (m) return m[1]; }
      }
    }
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
    if (btn._isGrad) return;
    const platform   = btn._platform || 'other';
    const isMigrated = btn._isMigrated || false;
    const hasDex     = btn._hasDex || false;
    const isPumpMig  = platform === 'pump' && isMigrated;
    const isPumpDex  = platform === 'pump' && hasDex && !isMigrated;
    const color = platform === 'bonk'    ? '#ff8c00'
                : platform === 'raydium' ? '#0033FF'
                : isPumpMig              ? '#ffd700'
                : isPumpDex              ? '#78ffa0'
                : '#ffd700';
    const glow  = platform === 'bonk'    ? 'rgba(255,140,0,0.4)'
                : platform === 'raydium' ? 'rgba(0,51,255,0.4)'
                : isPumpMig              ? 'rgba(255,215,0,0.4)'
                : isPumpDex              ? 'rgba(120,255,160,0.4)'
                : 'rgba(255,215,0,0.4)';
    btn.style.boxShadow = `0 0 18px 5px ${color}, 0 0 36px 10px ${glow}`;
    btn.style.setProperty('outline', `2px solid ${color}`, 'important');
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
    if (prefetchCooldown) return;
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
    if (rowCA !== stableCA) { stableCA = rowCA; stableCAStart = Date.now(); }
    const existing = sessionBest.get(rowCA);
    if (!prefetchCooldown && !window.axiomUserOpen && Date.now() - stableCAStart >= 150 && (!existing || overallMax > existing.matchPct)) {
      const { age, mc } = getBtnInfoBar(winner);
      const winnerRow = winner._isGrad ? null : winner._original?.closest('[class*="max-h-[64px]"]');
      const _memeLink = winnerRow?.querySelector('a[href*="/meme/"]');
      const memeHref  = _memeLink ? (new URL(_memeLink.href).pathname + new URL(_memeLink.href).search) : null;
      const pairAddress = winner._isGrad
        ? (winner.pairAddress || winner.ca || null)
        : (winner._pairAddress || memeHref?.match(/\/meme\/([A-Za-z0-9]{32,})/)?.[1] || null);
      sessionBest.set(rowCA, {
        rowCA,
        ca:          getCAFromBtn(winner) || null,
        pairAddress,
        newPairCA:   localStorage.getItem('axiomNewPairCA') || '',
        memeHref,
        btnTemplate: winner._isGrad ? null : winner._original?.cloneNode(true),
        ticker:      winner._isGrad ? (winner.ticker || '') : (winner._ticker || ''),
        name:       winner._isGrad ? (winner.name   || '') : (winner._name   || ''),
        imgSrc:     getBtnImgSrc(winner),
        matchPct:   overallMax,
        isGrad:     !!winner._isGrad,
        platform:   getBtnPlatform(winner),
        hasDex:     getBtnHasDex(winner),
        isMigrated: getBtnIsMigrated(winner),
        age,
        mc,
        solText:    getBtnSolText(winner),
      });
    }
  }

  // === Mini buttons ===

  function createMiniBtn(rowCA, template) {
    const el = template ? template.cloneNode(true) : document.createElement('button');
    delete el.dataset.qbAdded;
    el.setAttribute('data-qbm-mini', rowCA);
    el.style.cssText         = '';
    el.style.position        = 'fixed';
    el.style.zIndex          = '99999';
    el.style.display         = 'none';
    el.style.overflow        = 'visible';
    el.style.cursor          = 'pointer';
    el.style.transform       = 'scale(0.7842)';
    el.style.transformOrigin = 'top-left';

    const coinImg = document.createElement('img');
    coinImg.className = 'qbm-coin-img';
    coinImg.style.cssText = 'width:60px;height:60px;border-radius:50%;object-fit:cover;position:absolute;left:-66px;top:50%;transform:translateY(-50%);pointer-events:auto;cursor:pointer;box-shadow:0 0 0 1px rgba(255,255,255,0.35),0 2px 8px rgba(0,0,0,0.4);';
    coinImg.addEventListener('click', e => {
      e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
      const best = sessionBest.get(rowCA);
      if (best) {
        const href = best.memeHref || (best.ca ? `/meme/${best.ca}?chain=sol` : null);
        if (href) { history.pushState({}, '', href); window.dispatchEvent(new PopStateEvent('popstate')); }
      }
    });
    el.appendChild(coinImg);

    const pctBadge = document.createElement('span');
    pctBadge.className = 'qbm-pct';
    pctBadge.style.cssText = 'position:absolute;left:-36px;top:calc(50% - 25px);transform:translate(-50%,-50%);font-size:10px;font-weight:700;font-family:monospace;color:#fff;background:rgba(0,0,0,0.85);border-radius:8px;padding:1px 5px;pointer-events:none;white-space:nowrap;border:1.5px solid currentColor;z-index:10001;';
    el.appendChild(pctBadge);

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
      if (!best) return;
      if (window.__ringArmedRowCAs?.has(rowCA)) {
        const ringChannel = new BroadcastChannel('axiom-buyer-ring');
        ringChannel.postMessage({ type: 'BUY_BY_CA', ca: best.ca });
        ringChannel.close();
      } else {
        executeBest(best);
      }
    });

    document.body.appendChild(el);
    miniPool.set(rowCA, el);
    return el;
  }

  function getOrCreateMiniBtn(rowCA, best) {
    const existing = miniPool.get(rowCA);
    if (existing?.isConnected && existing._matchPct === best.matchPct) return existing;
    if (existing?.isConnected) existing.remove();
    if (existing?._label?.isConnected) existing._label.remove();
    const el = createMiniBtn(rowCA, best.btnTemplate);
    el._matchPct = best.matchPct;
    el.dataset.qbmNewPairCa = best.newPairCA || '';
    return el;
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

    const rows       = document.querySelectorAll('[class*="group/pulseRow"]');
    const seenCAs    = new Set();
    const coveredRows = new Set();

    rows.forEach((row, rowIdx) => {
      const rowCA = getCAFromRow(row);
      if (!rowCA || seenCAs.has(rowCA)) return;
      seenCAs.add(rowCA);

      if (awaitingT2Confirm && rowIdx === 0) return;

      const best = sessionBest.get(rowCA);
      if (!best) return;

      const rect = row.getBoundingClientRect();
      if (rect.width < 10) return;

      const el   = getOrCreateMiniBtn(rowCA, best);
      el.dataset.qbmPair = best.ca || best.pairAddress || '';
      const btnW = lastNormalSize.w;
      const btnH = lastNormalSize.h;

      const solDiv = Array.from(
        row.querySelectorAll('[class*="z-20"][class*="absolute"][class*="right-0"][class*="bottom-0"]')
      ).find(el => el.getBoundingClientRect().width > 0);
      let posLeft, posTop;
      if (solDiv) {
        const sr = solDiv.getBoundingClientRect();
        posLeft = sr.left + sr.width  / 2 - btnW / 2 + 60;
      } else {
        posLeft = rect.right - btnW - 23;
      }
      posTop = rect.top + rect.height / 2 - btnH / 2 + 30;
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

      const isPumpMigrated = best.platform === 'pump' && best.isMigrated;
      const isPumpDex      = best.platform === 'pump' && best.hasDex && !best.isMigrated;
      const platBorder = best.platform === 'bonk'    ? '#ff8c00'
                       : best.platform === 'raydium' ? '#0033FF'
                       : isPumpMigrated              ? '#ffd700'
                       : isPumpDex                   ? '#78ffa0'
                       : badgeColor(best.matchPct);
      const platGlow   = best.platform === 'bonk'    ? 'rgba(255,140,0,0.6)'
                       : best.platform === 'raydium' ? 'rgba(0,51,255,0.7)'
                       : isPumpMigrated              ? 'rgba(255,215,0,0.6)'
                       : isPumpDex                   ? 'rgba(120,255,160,0.7)'
                       : badgeColor(best.matchPct) + '40';
      const platBg     = best.platform === 'bonk'    ? 'rgba(255,140,0,0.85)'
                       : best.platform === 'raydium' ? 'rgba(0,51,255,0.85)'
                       : isPumpMigrated              ? 'rgba(255,215,0,0.85)'
                       : isPumpDex                   ? 'rgba(120,255,160,0.85)'
                       : 'rgba(20,20,30,0.92)';
      el.style.background = platBg;
      el.style.border    = `1.5px solid ${platBorder}`;
      el.style.boxShadow = `0 0 8px 2px ${platGlow}`;

      el.style.display = 'flex';
      row.setAttribute('data-bm1-active', '1');
      coveredRows.add(row);
    });

    document.querySelectorAll('[data-bm1-active]').forEach(r => {
      if (!coveredRows.has(r)) r.removeAttribute('data-bm1-active');
    });

    miniPool.forEach((el, ca) => {
      if (!seenCAs.has(ca)) {
        el.style.display = 'none';
        if (el._label) el._label.style.display = 'none';
      }
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

  function fireClickOnEl(el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(ev =>
      el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    );
  }

  function executeBest(best) {
    window.axiomUserOpen = true;

    const doExecute = () => {
      bringPanelToFront();
      const panel = getSearchPanel();
      if (!panel) { window.axiomUserOpen = false; return; }
      const query = best.ca || best.name || best.ticker;
      if (!query) { window.axiomUserOpen = false; return; }

      // Snapshot stale buttons before typing, only click genuinely new ones
      const prevBtns = new Set(panel.querySelectorAll('[class*="group/quickBuyButton"]'));
      typeInPanel(panel, query);

      const start = Date.now();
      const poll = () => {
        const btns = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')];
        const fresh = btns.filter(b => !prevBtns.has(b));
        if (fresh.length > 0) {
          fireClickOnEl(fresh[0]);
          window.open(`https://axiom.trade/meme/${query}?chain=sol`, '_blank');
          setTimeout(() => { window.axiomUserOpen = false; }, 400);
          return;
        }
        if (Date.now() - start > 1500) { window.axiomUserOpen = false; return; }
        setTimeout(poll, 50);
      };
      setTimeout(poll, 50);
    };

    if (!getSearchPanel() || !isPanelVisible()) {
      const searchBtn = document.querySelector('[class*="ri-search"]')?.closest('button');
      if (!searchBtn) { window.axiomUserOpen = false; return; }
      searchBtn.click();
      setTimeout(doExecute, 150);
    } else {
      doExecute();
    }
  }

  // === Main loop ===

  setInterval(() => { updateGlow(); updateMiniButtons(); }, 4);

  console.log('⭐ Axiom QBuy Best Match v8.10 — Raydium V4 blue styling');
})();

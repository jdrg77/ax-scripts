// ==UserScript==
// @name         Axiom QBuy Pro
// @namespace    http://tampermonkey.net/
// @version      1.3
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Pro.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Pro.user.js
// ==/UserScript==

(function () {
  'use strict';
  const _tab = new URLSearchParams(location.search).get('tab');
  if (_tab === 'grad' || _tab === 't3') return;

  // ============================================================
  // 1. DCT pHash
  // ============================================================

  const HASH_SIZE = 32, HASH_BITS = 8, CACHE_MAX = 500;
  const hashCache = new Map();

  function dct1d(f) {
    const N = f.length, F = new Float32Array(N), pi2N = Math.PI / (2 * N);
    for (let u = 0; u < N; u++) {
      let s = 0;
      for (let i = 0; i < N; i++) s += f[i] * Math.cos((2 * i + 1) * u * pi2N);
      F[u] = s;
    }
    return F;
  }

  function computeHash(img) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = HASH_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, HASH_SIZE, HASH_SIZE);
    const data = ctx.getImageData(0, 0, HASH_SIZE, HASH_SIZE).data;
    const gray = new Float32Array(HASH_SIZE * HASH_SIZE);
    for (let i = 0; i < data.length; i += 4)
      gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const tmp = new Float32Array(HASH_SIZE * HASH_SIZE);
    for (let r = 0; r < HASH_SIZE; r++) {
      const row = dct1d(gray.slice(r * HASH_SIZE, (r + 1) * HASH_SIZE));
      for (let c = 0; c < HASH_SIZE; c++) tmp[r * HASH_SIZE + c] = row[c];
    }
    const dct = new Float32Array(HASH_SIZE * HASH_SIZE);
    for (let c = 0; c < HASH_SIZE; c++) {
      const col = new Float32Array(HASH_SIZE);
      for (let r = 0; r < HASH_SIZE; r++) col[r] = tmp[r * HASH_SIZE + c];
      const cd = dct1d(col);
      for (let r = 0; r < HASH_SIZE; r++) dct[r * HASH_SIZE + c] = cd[r];
    }
    let sum = 0;
    for (let x = 0; x < HASH_BITS; x++)
      for (let y = 0; y < HASH_BITS; y++) sum += dct[x * HASH_SIZE + y];
    const mean = sum / (HASH_BITS * HASH_BITS);
    let hash = '';
    for (let x = 0; x < HASH_BITS; x++)
      for (let y = 0; y < HASH_BITS; y++) hash += dct[x * HASH_SIZE + y] > mean ? '1' : '0';
    return hash;
  }

  function getHash(src, cb) {
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) return cb(null);
    if (hashCache.has(src)) return cb(hashCache.get(src));
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        const hash = computeHash(img);
        if (hashCache.size >= CACHE_MAX) hashCache.delete(hashCache.keys().next().value);
        hashCache.set(src, hash);
        cb(hash);
      } catch (e) { cb(null); }
    };
    img.onerror = () => cb(null);
    img.src = src.includes('?') ? src : src + '?qb=1';
  }

  function hashSimilarity(h1, h2) {
    if (!h1 || !h2 || h1.length !== h2.length) return 0;
    let m = 0;
    for (let i = 0; i < h1.length; i++) if (h1[i] === h2[i]) m++;
    return parseFloat(((m / h1.length) * 100).toFixed(1));
  }

  // ============================================================
  // 2. search-v5 API
  // ============================================================

  async function searchTokenAPI(query, onlyBonded = false, onlyDexPaid = false) {
    try {
      const res = await fetch('https://api10.axiom.trade/search-v5', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          query,
          includedProtocols: ['bonk', 'pump'],
          sort: 'mcap',
          isOg: false,
          includedQuoteTokens: ['SOL', 'USDC', 'USD1'],
          onlyBonded,
          onlyDexPaid,
          v: Date.now(),
        }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  // ============================================================
  // 3. Row utilities
  // ============================================================

  function getRowName(row) {
    const btn = row.querySelector('div[role="button"]');
    if (!btn) return '';
    const span = btn.querySelector('span[class*="text-[16px]"]')
               || btn.querySelector('span.text-\\[16px\\]')
               || btn.querySelectorAll('span')[0];
    return span?.textContent.trim() || '';
  }

  function getRowCA(row) {
    const meme = row.querySelector('a[href*="/meme/"]');
    if (meme) { const m = meme.href.match(/\/meme\/([A-Za-z0-9]{32,})/); if (m) return m[1]; }
    const pump = row.querySelector('a[href*="pump.fun/coin/"]');
    if (pump) { const m = pump.href.match(/\/coin\/([A-Za-z0-9]{32,})/); if (m) return m[1]; }
    return '';
  }

  function getRowImgSrc(row) {
    return Array.from(row.querySelectorAll('img[class*="object-cover"]'))
      .find(img => img.src && !img.src.startsWith('data:'))?.src || null;
  }

  function getRowPlatform(row) {
    if (row.querySelector('img[src*="bonk"]')) return 'bonk';
    if (row.querySelector('img[src*="pump-grad.svg"][alt="Raydium V4"]')) return 'raydium';
    if (row.querySelector('img[src*="pump"]')) return 'pump';
    return 'other';
  }

  function isPlaceholder(src) {
    return !src || src.includes('/pfps/') || src.includes('axiom-assets');
  }

  // ============================================================
  // 4. Parallel Analyzer
  // ============================================================

  const MAX_CONC   = 3;
  const STAGGER_MS = 150;
  const started    = new Set();
  const queue      = [];
  const sessionBest = new Map(); // rowCA → [{match}, {match}] top 2
  let   activeCount  = 0;
  let   lastStartMs  = 0;

  const MIN_MATCH_PCT = 55;

  async function scoreResults(results, refHash) {
    if (!results?.length) return [];
    const scored = await Promise.race([
      Promise.all(results.map(token => new Promise(resolve => {
        const imgSrc = `https://axiomtrading.axiom-cdn.io/${token.tokenAddress}.webp`;
        getHash(imgSrc, hash => resolve({ token, pct: hashSimilarity(refHash, hash) }));
      }))),
      new Promise(resolve => setTimeout(() => resolve([]), 6000)),
    ]);
    return scored;
  }

  // Port of sortNormal from QBuy 17.221 — special tokens only (grad + dex paid)
  function rankScored(scored, rowName, gradSet, dexSet) {
    const norm       = s => (s || '').toLowerCase().trim();
    const rn         = norm(rowName);
    const isGrad     = s => gradSet.has(s.token.tokenAddress);
    const isDex      = s => dexSet.has(s.token.tokenAddress);
    const nameMatch  = s => norm(s.token.tokenName)   === rn;
    const tickerMatch= s => norm(s.token.tokenTicker) === rn;
    const exactMatch = s => nameMatch(s) || tickerMatch(s);
    const byPct      = (a, b) => b.pct - a.pct;

    const getPlatform = s => {
      if (isGrad(s)) return 'raydium';
      if (s.token.protocol === 'bonk') return 'bonk';
      if (isDex(s)) return 'pump-dex';
      return 'pump';
    };

    // Equivalent to sortRest — tiers by pct (no age data from API)
    function sortRest(list) {
      const tier1 = list.filter(s => s.pct >  85).sort(byPct);
      const tier2 = list.filter(s => s.pct >  72 && s.pct <= 85).sort(byPct);
      const tier3 = list.filter(s => s.pct >= 58.21 && s.pct <= 72).sort(byPct);
      const tier4 = list.filter(s => s.pct >= MIN_MATCH_PCT && s.pct < 58.21).sort(byPct);
      return [...tier1, ...tier2, ...tier3, ...tier4];
    }

    // special = graduated (≈ gold/green in original)
    const special = scored.filter(isGrad);
    // blues = exact name/ticker match from non-grad, max 3
    const blues   = scored.filter(s => !isGrad(s) && exactMatch(s)).sort(byPct).slice(0, 3);
    const others  = scored.filter(s => !isGrad(s) && !exactMatch(s));

    let sortedSpecial;
    const hasExact     = special.some(exactMatch);
    const hasNameOnly  = !hasExact && special.some(nameMatch);

    if (hasExact) {
      const ex    = special.filter(exactMatch);
      const ultra = ex.filter(s => s.pct > 85).sort(byPct);
      const rest  = ex.filter(s => s.pct <= 85).sort(byPct);
      const nonEx = special.filter(s => !exactMatch(s));
      sortedSpecial = [...ultra, ...rest, ...sortRest(nonEx)];
    } else if (hasNameOnly) {
      const nm    = special.filter(nameMatch);
      sortedSpecial = [...nm.sort(byPct), ...sortRest(special.filter(s => !nameMatch(s)))];
    } else {
      sortedSpecial = sortRest(special);
    }

    const ranked = [...sortedSpecial, ...blues, ...sortRest(others)];
    // Attach platform and filter out below threshold
    return ranked
      .filter(s => s.pct >= MIN_MATCH_PCT)
      .map(s => ({ ...s, resolvedPlatform: getPlatform(s) }));
  }

  async function analyzeRow({ name, refImgSrc, rowCA }) {
    const refHash = await new Promise(resolve => getHash(refImgSrc, resolve));
    if (!refHash) return;

    // Only special tokens: graduated (migrated) or dex paid — pump normal is never shown
    const [gradResults, dexResults] = await Promise.all([
      searchTokenAPI(name, true,  false),
      searchTokenAPI(name, false, true),
    ]);

    const gradSet = new Set((gradResults || []).map(t => t.tokenAddress));
    const dexSet  = new Set((dexResults  || []).map(t => t.tokenAddress));

    // Merge + dedupe (grad takes precedence over dex on duplicate)
    const seen = new Set();
    const unique = [...(gradResults || []), ...(dexResults || [])].filter(t => {
      if (seen.has(t.tokenAddress)) return false;
      seen.add(t.tokenAddress);
      return true;
    });
    if (!unique.length) return;

    const scored  = await scoreResults(unique, refHash);
    const ranked  = rankScored(scored, name, gradSet, dexSet);
    const top2    = ranked.slice(0, 2);
    if (!top2.length) return;

    const matches = top2.map(s => ({
      rowCA,
      ca:          s.token.tokenAddress,
      pairAddress: s.token.pairAddress || s.token.tokenAddress,
      memeHref:    `/meme/${s.token.pairAddress || s.token.tokenAddress}?chain=sol`,
      ticker:      s.token.tokenTicker || '',
      name:        s.token.tokenName   || '',
      imgSrc:      `https://axiomtrading.axiom-cdn.io/${s.token.tokenAddress}.webp`,
      matchPct:    s.pct,
      platform:    s.resolvedPlatform,
    }));

    sessionBest.set(rowCA, matches);
    console.log(`[Pro] ✅ ${name} → ${matches.map(m => `${m.ticker} ${m.matchPct}% [${m.platform}]`).join(' | ')}`);
  }

  function tryStart() {
    if (activeCount >= MAX_CONC || !queue.length) return;
    const now = Date.now();
    const wait = Math.max(0, lastStartMs + STAGGER_MS - now);
    if (wait > 0) { setTimeout(tryStart, wait); return; }
    const task = queue.shift();
    activeCount++;
    lastStartMs = Date.now();
    analyzeRow(task).finally(() => { activeCount--; tryStart(); });
    tryStart();
  }

  function enqueue(task, priority = false) {
    const key = task.rowCA || task.name;
    if (!key) return;
    if (sessionBest.has(task.rowCA)) return;
    if (started.has(key)) return;
    if (started.size > 500) started.clear();
    started.add(key);
    if (priority) queue.unshift(task); else queue.push(task);
    tryStart();
  }

  function scanRows() {
    document.querySelectorAll('[class*="group/pulseRow"]').forEach(row => {
      const name      = getRowName(row);
      if (!name) return;
      const ca        = getRowCA(row);
      const refImgSrc = getRowImgSrc(row);
      if (isPlaceholder(refImgSrc)) return;
      enqueue({ name, refImgSrc, rowCA: ca || name, platform: getRowPlatform(row) });
    });
  }

  new MutationObserver(scanRows).observe(document.body, { childList: true, subtree: true });

  // ============================================================
  // 5. Mini Buttons (2 per row)
  // ============================================================

  const miniPool  = new Map(); // rowCA → [btn0, btn1]
  let lastBtnSize = { w: 44, h: 44 };
  const SCALE     = 0.7842;

  function getSearchPanel() {
    return [...document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]')]
      .find(el => el.querySelector('input') || el.querySelector('[class*="group/quickBuyButton"]')) || null;
  }

  function isPanelVisible() {
    const p = getSearchPanel();
    return p ? p.parentElement?.style.zIndex !== '-9999' : false;
  }

  function badgeColor(pct) {
    if (pct >= 75) return '#78ffa0';
    if (pct >= 50) return '#ffd700';
    return '#ff6b6b';
  }

  function createMiniBtn(rowCA, idx) {
    const el = document.createElement('button');
    el.setAttribute('data-qbm-mini', rowCA);
    el.style.cssText = 'position:fixed;z-index:99999;display:none;overflow:visible;cursor:pointer;' +
      'transform:scale(' + SCALE + ');transform-origin:top-left;border-radius:8px;' +
      'align-items:center;justify-content:center;';

    const coinImg = document.createElement('img');
    coinImg.className = 'qbm-coin-img';
    coinImg.style.cssText = 'width:60px;height:60px;border-radius:50%;object-fit:cover;position:absolute;' +
      'left:-66px;top:50%;transform:translateY(-50%);pointer-events:auto;cursor:pointer;' +
      'box-shadow:0 0 0 1px rgba(255,255,255,0.35),0 2px 8px rgba(0,0,0,0.4);';
    coinImg.addEventListener('click', e => {
      e.stopPropagation(); e.preventDefault();
      const best = sessionBest.get(rowCA)?.[idx];
      if (best?.memeHref) { history.pushState({}, '', best.memeHref); window.dispatchEvent(new PopStateEvent('popstate')); }
    });
    el.appendChild(coinImg);

    const pctBadge = document.createElement('span');
    pctBadge.className = 'qbm-pct';
    pctBadge.style.cssText = 'position:absolute;left:-36px;top:calc(50% - 25px);transform:translate(-50%,-50%);' +
      'font-size:10px;font-weight:700;font-family:monospace;color:#fff;background:rgba(0,0,0,0.85);' +
      'border-radius:8px;padding:1px 5px;pointer-events:none;white-space:nowrap;border:1.5px solid currentColor;z-index:10001;';
    el.appendChild(pctBadge);

    const label = document.createElement('div');
    label.className = 'qbm-label';
    label.style.cssText = 'position:fixed;display:none;font-size:10px;font-weight:600;font-family:monospace;' +
      'color:#ccc;background:rgba(0,0,0,0.65);border-radius:4px;padding:1px 4px;pointer-events:none;white-space:nowrap;z-index:100000;transform:translateX(-50%);';
    document.body.appendChild(label);
    el._label = label;
    el._idx   = idx;

    el.addEventListener('click', e => {
      e.stopPropagation(); e.preventDefault();
      if (e.target.closest('img.qbm-coin-img')) return;
      const best = sessionBest.get(rowCA)?.[idx];
      if (best) { localStorage.setItem('axiomTopPairCA', best.ca || rowCA); executeBest(best); }
    });

    document.body.appendChild(el);
    return el;
  }

  function getOrCreateMiniBtn(rowCA, idx) {
    let pool = miniPool.get(rowCA);
    if (!pool) { pool = [null, null]; miniPool.set(rowCA, pool); }
    if (!pool[idx]?.isConnected) {
      pool[idx]?._label?.isConnected && pool[idx]._label.remove();
      pool[idx] = createMiniBtn(rowCA, idx);
    }
    return pool[idx];
  }

  function updateBtnSize() {
    const panel = getSearchPanel();
    if (!panel) return;
    const btn = panel.querySelector('[class*="group/quickBuyButton"]');
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) lastBtnSize = { w: r.width, h: r.height };
  }

  function updateMiniButtons() {
    updateBtnSize();

    if (isPanelVisible()) {
      miniPool.forEach(pool => pool.forEach(btn => {
        if (btn?.isConnected) { btn.style.display = 'none'; if (btn._label) btn._label.style.display = 'none'; }
      }));
      return;
    }

    const rows   = document.querySelectorAll('[class*="group/pulseRow"]');
    const seen   = new Set();
    const btnW   = lastBtnSize.w;
    const btnH   = lastBtnSize.h;
    const scaledW = btnW * SCALE;

    rows.forEach(row => {
      const ca  = getRowCA(row);
      const key = ca || getRowName(row);
      if (!key || seen.has(key)) return;
      seen.add(key);

      const matches = sessionBest.get(ca || key);
      if (!matches?.length) return;

      const rect = row.getBoundingClientRect();
      if (rect.width < 10) return;

      const solDiv = Array.from(
        row.querySelectorAll('[class*="z-20"][class*="absolute"][class*="right-0"][class*="bottom-0"]')
      ).find(el => el.getBoundingClientRect().width > 0);

      let baseLeft;
      if (solDiv) {
        const sr = solDiv.getBoundingClientRect();
        baseLeft = sr.left + sr.width / 2 - btnW / 2 + 40;
      } else {
        baseLeft = rect.right - btnW - 43;
      }
      const posTop = rect.top + rect.height / 2 - btnH / 2 + 30;

      matches.slice(0, 2).forEach((best, idx) => {
        const el = getOrCreateMiniBtn(ca || key, idx);
        // btn0 rightmost, btn1 to the left
        const posLeft = baseLeft - idx * (scaledW + 8);

        el.style.left   = posLeft + 'px';
        el.style.top    = posTop  + 'px';
        el.style.width  = btnW    + 'px';
        el.style.height = btnH    + 'px';
        el.dataset.qbmPair = best.pairAddress || best.ca || '';

        const coinImg = el.querySelector('.qbm-coin-img');
        if (coinImg && best.imgSrc && coinImg.src !== best.imgSrc) coinImg.src = best.imgSrc;

        const pctBadge = el.querySelector('.qbm-pct');
        if (pctBadge) {
          const txt = best.matchPct.toFixed(1) + '%';
          if (pctBadge.textContent !== txt) pctBadge.textContent = txt;
          const col = badgeColor(best.matchPct);
          pctBadge.style.color       = col;
          pctBadge.style.borderColor = col;
        }

        if (el._label) {
          const nameText = best.name || best.ticker || '';
          if (el._label.textContent !== nameText) el._label.textContent = nameText;
          el._label.style.left    = (posLeft + scaledW / 2) + 'px';
          el._label.style.top     = (posTop - 18) + 'px';
          el._label.style.display = '';
        }

        const platBg     = best.platform === 'bonk'     ? 'rgba(255,140,0,0.85)'
                         : best.platform === 'raydium'  ? 'rgba(0,51,255,0.85)'
                         : best.platform === 'pump-dex' ? 'rgba(120,255,160,0.85)'
                         : 'rgba(20,20,30,0.92)';
        const platBorder = best.platform === 'bonk'     ? '#ff8c00'
                         : best.platform === 'raydium'  ? '#0033FF'
                         : best.platform === 'pump-dex' ? '#78ffa0'
                         : badgeColor(best.matchPct);
        el.style.background = platBg;
        el.style.border     = `1.5px solid ${platBorder}`;
        el.style.boxShadow  = `0 0 8px 2px ${platBorder}40`;
        el.style.display    = 'flex';
      });
    });

    miniPool.forEach((pool, ca) => {
      if (!seen.has(ca)) pool.forEach(btn => {
        if (btn?.isConnected) { btn.style.display = 'none'; if (btn._label) btn._label.style.display = 'none'; }
      });
    });
  }

  setInterval(updateMiniButtons, 16);

  // ============================================================
  // 6. Buy execution
  // ============================================================

  window.axiomUserOpen = false;

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
      wrapper.style.removeProperty('z-index'); wrapper.style.removeProperty('pointer-events');
      wrapper.style.removeProperty('transition'); wrapper.style.removeProperty('animation');
    }
    if (overlay) {
      overlay.style.removeProperty('z-index'); overlay.style.removeProperty('pointer-events');
      overlay.style.removeProperty('background'); overlay.style.removeProperty('backdrop-filter');
      overlay.style.removeProperty('transition'); overlay.style.removeProperty('animation');
    }
  }

  function fireClick(el) {
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
      const prevBtns = new Set(panel.querySelectorAll('[class*="group/quickBuyButton"]'));
      typeInPanel(panel, query);
      const start = Date.now();
      const poll = () => {
        const fresh = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')].filter(b => !prevBtns.has(b));
        if (fresh.length) { fireClick(fresh[0]); setTimeout(() => { window.axiomUserOpen = false; }, 400); return; }
        if (Date.now() - start > 1500) { window.axiomUserOpen = false; return; }
        setTimeout(poll, 50);
      };
      setTimeout(poll, 50);
    };
    if (!getSearchPanel()) {
      const btn = document.querySelector('[class*="ri-search"]')?.closest('button');
      if (!btn) { window.axiomUserOpen = false; return; }
      btn.click();
      setTimeout(doExecute, 150);
    } else {
      doExecute();
    }
  }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.axiomUserOpen = false;
  }, true);

  // ============================================================
  // 7. Row Highlighter
  // ============================================================

  {
    const style = document.createElement('style');
    style.textContent = `[class*="bg-backgroundTertiary"] div[style*="max-width"] { max-width:none !important; white-space:nowrap !important; overflow:visible !important; }`;
    document.head.appendChild(style);

    function highlightRows() {
      const panel = document.querySelector('[class*="bg-backgroundTertiary"]');
      if (!panel) return;
      panel.querySelectorAll('[class*="cursor-pointer"][class*="flex-row"][class*="items-center"]').forEach(row => {
        row.style.boxShadow = ''; row.style.borderRadius = ''; row.style.background = ''; row.style.border = '';
        const photoBox = row.querySelector('div.relative');
        if (photoBox) photoBox.style.boxShadow = '';
        row.querySelectorAll('button').forEach(btn => { btn.style.background = ''; btn.style.color = ''; });
        const isMigrated = !!row.querySelector('[style*="FFD700"],[style*="ffd700"],img[src*="-grad"]');
        const isBonk     = !!row.querySelector('img[src*="bonk"]');
        const isRaydium  = !!row.querySelector('img[src*="pump-grad.svg"][alt="Raydium V4"]');
        const isPump     = !isRaydium && !!row.querySelector('img[src*="pump"]');
        const hasDex     = !!row.querySelector('[class*="icon-dex-paid"]');
        if (isRaydium) {
          row.style.borderRadius = '8px';
          row.style.background   = 'rgba(0,51,255,0.07)';
          row.style.boxShadow    = '0 0 12px rgba(0,51,255,0.35)';
          const qb = row.querySelector('[class*="bg-primaryBlue"]');
          if (qb) { qb.style.setProperty('background','rgb(0,51,255)','important'); qb.style.color = '#fff'; }
        } else if (isBonk) {
          row.style.borderRadius = '8px';
          row.style.background   = 'rgba(255,140,0,0.07)';
          row.style.boxShadow    = '0 0 12px rgba(255,140,0,0.35)';
        } else if (isPump && !isMigrated && hasDex) {
          row.style.borderRadius = '8px';
          row.style.background   = 'rgba(120,255,160,0.10)';
          row.style.boxShadow    = '0 0 14px rgba(120,255,160,0.6)';
          row.style.border       = '1px solid rgba(120,255,160,0.5)';
          const qb = row.querySelector('[class*="bg-primaryBlue"]');
          if (qb) { qb.style.background = 'rgb(120,255,160)'; qb.style.color = '#000'; }
        } else if (isPump && !isMigrated) {
          row.style.borderRadius = '8px';
          row.style.boxShadow    = '0 0 12px rgba(0,200,80,0.4)';
          row.style.border       = '1px solid rgba(0,200,80,0.3)';
        }
        if (isMigrated && photoBox) {
          photoBox.style.boxShadow = '0 0 5px 1px rgba(255,240,0,0.9),0 0 10px 2px rgba(255,240,0,0.3)';
        }
        if (isMigrated) {
          const qb = row.querySelector('[class*="bg-primaryBlue"]');
          if (qb) { qb.style.background = 'rgb(255,215,0)'; qb.style.color = '#000'; }
        }
      });
    }

    let _rhPanel = null, _rhObs = null, _rhRaf = false;
    function _rhSchedule() {
      if (_rhRaf) return; _rhRaf = true;
      requestAnimationFrame(() => { _rhRaf = false; highlightRows(); _rhObs?.takeRecords(); });
    }
    function _rhAttach() {
      const panel = document.querySelector('[class*="bg-backgroundTertiary"]');
      if (panel === _rhPanel && _rhObs) return;
      _rhObs?.disconnect(); _rhObs = null; _rhPanel = null;
      if (!panel) return;
      _rhPanel = panel;
      _rhObs = new MutationObserver(_rhSchedule);
      _rhObs.observe(panel, { childList: true, subtree: true });
      _rhSchedule();
    }
    _rhAttach();
    setInterval(_rhAttach, 1000);
  }

  // ============================================================
  // 8. Trades Popup
  // ============================================================

  {
    const TP_SERVERS = ['https://api2.axiom.trade','https://api3.axiom.trade','https://api6.axiom.trade'];
    const TP_TTL     = 8000;
    const tpCache    = new Map();
    let tpPopup = null, tpHideTimer = null, tpCurrentCA = null, tpRefresh = null;

    function tpDecode(row) {
      return { type: row[2], createdAt: new Date(row[3]), liquiditySol: row[4],
        makerAddress: row[6], priceSol: row[7], priceUsd: row[8], totalSol: row[10], totalUsd: row[11] };
    }
    async function tpFetch(pair) {
      const c = tpCache.get(pair);
      if (c && Date.now() - c.ts < TP_TTL) return c.trades;
      const srv = TP_SERVERS[Math.floor(Math.random() * TP_SERVERS.length)];
      try {
        const r = await fetch(`${srv}/transactions-feed-v3`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pairAddress: pair, orderBy: 'DESC' }),
        });
        if (!r.ok) return null;
        const data = await r.json();
        const trades = (Array.isArray(data) ? data : []).map(tpDecode);
        tpCache.set(pair, { trades, ts: Date.now() });
        return trades;
      } catch (e) { return null; }
    }
    function tpFmtAge(d) { const s=Math.floor((Date.now()-d.getTime())/1000); return s<60?s+'s':s<3600?Math.floor(s/60)+'m':Math.floor(s/3600)+'h'; }
    function tpFmtMC(liq, ps, pu) {
      if (!ps||!pu) return '—'; const sp=pu/ps,mc=liq*2*sp;
      return mc>=1e6?'$'+(mc/1e6).toFixed(1)+'M':mc>=1e3?'$'+(mc/1e3).toFixed(1)+'K':'$'+mc.toFixed(0);
    }
    function tpFmtSol(n) { return n>=10?n.toFixed(2):n>=1?n.toFixed(3):n>=0.01?n.toFixed(3):n.toFixed(4); }
    function tpFmtWallet(a) { return (!a||a.length<3)?a||'?':a.slice(-3); }
    const BAR_MAX=33;
    function tpBar(a) { if(a<1) return 0; return Math.min(100,Math.max(1,Math.pow(a/BAR_MAX,2/3)*100)); }

    function tpEnsure() {
      if (tpPopup) return tpPopup;
      tpPopup = document.createElement('div');
      tpPopup.style.cssText = 'position:fixed;z-index:2147483646;display:none;background:#0b0d13;border:1px solid #1e2131;border-radius:8px;width:292px;box-shadow:0 8px 32px rgba(0,0,0,0.8);font-family:GeistMono,ui-monospace,monospace;font-size:12px;color:#c1c5dc;pointer-events:none;overflow:hidden;';
      document.body.appendChild(tpPopup);
      return tpPopup;
    }
    function tpRender(trades) {
      const p = tpEnsure();
      if (!trades) { p.innerHTML='<div style="padding:14px;color:#777a8c;text-align:center">Error cargando</div>'; return; }
      if (!trades.length) { p.innerHTML='<div style="padding:14px;color:#777a8c;text-align:center">Sin trades</div>'; return; }
      const SOL_ICON='<img src="https://axiom-assets.axiom-cdn.io/images/sol-fill.svg" style="width:10px;height:10px;margin-right:2px;vertical-align:middle;display:inline"/>';
      const header='<div style="display:flex;align-items:center;padding:4px 16px;border-bottom:1px solid #1e2131;color:#777a8c;font-size:12px;line-height:16px;min-height:24px"><span style="flex:1">Amount</span><span style="flex:1">MC</span><span style="flex:1">Trader</span><span style="max-width:32px;flex:1;text-align:right">Age ↓</span></div>';
      const rows = trades.slice(0,20).map(t => {
        const buy=t.type==='buy', ac=buy?'#2fe3ac':'#f20202', gf=buy?'#2FC2E3':'#D139EC', gt=buy?'#2fe3ac':'#f20202';
        const bw=tpBar(t.totalSol), bd=bw>0?`<div style="position:absolute;left:0;top:0;height:100%;background:linear-gradient(to right,${gf}00,${gt});opacity:0.15;width:${bw.toFixed(2)}%"></div>`:'';
        return `<div style="position:relative;display:flex;align-items:center;height:24px;padding:0 16px;box-sizing:border-box">${bd}<div style="position:relative;z-index:1;display:flex;flex:1;align-items:center"><span style="flex:1;display:flex;align-items:center;color:${ac}">${SOL_ICON}${tpFmtSol(t.totalSol)}</span><span style="flex:1;color:#c1c5dc">${tpFmtMC(t.liquiditySol,t.priceSol,t.priceUsd)}</span><span style="flex:1;color:#c1c5dc">${tpFmtWallet(t.makerAddress)}</span><span style="max-width:32px;flex:1;text-align:right;color:#777a8c">${tpFmtAge(t.createdAt)}</span></div></div>`;
      }).join('');
      p.innerHTML = header + '<div style="font-size:0">' + rows + '</div>';
    }
    function tpPosition(x, y) {
      const p=tpEnsure(), pw=292, ph=380;
      let l=x+16, t=y-80;
      if (l+pw>window.innerWidth-8) l=x-pw-16;
      if (t+ph>window.innerHeight-8) t=window.innerHeight-ph-8;
      if (t<8) t=8;
      p.style.left=l+'px'; p.style.top=t+'px';
    }
    function tpShow(pair, x, y) {
      clearTimeout(tpHideTimer); clearInterval(tpRefresh);
      const p=tpEnsure(); tpCurrentCA=pair;
      tpPosition(x,y); p.style.display='block';
      p.innerHTML='<div style="padding:14px;color:#777a8c;text-align:center">Cargando…</div>';
      const load=()=>{ if(tpCurrentCA!==pair) return; tpFetch(pair).then(t=>{ if(tpCurrentCA===pair) tpRender(t); }); };
      load(); tpRefresh=setInterval(load, TP_TTL);
    }
    function tpHide() {
      clearTimeout(tpHideTimer);
      tpHideTimer=setTimeout(()=>{ tpCurrentCA=null; clearInterval(tpRefresh); if(tpPopup) tpPopup.style.display='none'; },100);
    }
    function tpHook(el, getCA) {
      if (el.__tpHooked) return; el.__tpHooked=true;
      el.addEventListener('mouseenter', e=>{ const ca=getCA(el); if(ca) tpShow(ca,e.clientX,e.clientY); });
      el.addEventListener('mousemove',  e=>{ if(tpCurrentCA) tpPosition(e.clientX,e.clientY); });
      el.addEventListener('mouseleave', tpHide);
    }
    function tpGetPair(row) {
      const a=row.querySelector('a[href*="/meme/"]');
      if (!a) return null;
      const m=a.href.match(/\/meme\/([A-Za-z0-9]{32,})/);
      return m?m[1]:null;
    }
    function tpScan() {
      document.querySelectorAll('[data-qbm-mini]').forEach(btn =>
        tpHook(btn, el => el.dataset.qbmPair || el.getAttribute('data-qbm-mini'))
      );
      document.querySelectorAll('[class*="group/pulseRow"]').forEach(row => {
        const ca=tpGetPair(row); if(!ca) return;
        tpHook(row, ()=>ca);
      });
    }
    new MutationObserver(tpScan).observe(document.body,{childList:true,subtree:true});
    setInterval(tpScan, 500);
  }

  // ============================================================
  // 9. Show Full Names
  // ============================================================

  {
    function snIsPanelOpen() {
      const p=document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
      return p ? p.parentElement?.style.zIndex !== '-9999' : false;
    }
    function snFix() {
      const names=document.querySelectorAll('div.truncate.text-left,[class*="truncate"][class*="text-left"]');
      if (snIsPanelOpen()) { names.forEach(n=>{n.style.zIndex='0';}); return; }
      names.forEach(name=>{
        if (!name.__placeholder) {
          const ph=document.createElement('div');
          ph.style.display='inline-block'; ph.style.width=name.offsetWidth+'px'; ph.style.height=name.offsetHeight+'px';
          name.__placeholder=ph; name.parentNode.insertBefore(ph,name);
        }
        const r=name.__placeholder.getBoundingClientRect();
        name.style.position='fixed'; name.style.left=r.left+'px'; name.style.top=r.top+'px';
        name.style.overflow='visible'; name.style.textOverflow='clip'; name.style.whiteSpace='nowrap';
        name.style.maxWidth='none'; name.style.width='auto'; name.style.zIndex='2147483647'; name.style.pointerEvents='none';
      });
    }
    snFix(); setInterval(snFix, 16);
    window.addEventListener('scroll', snFix, true);
    window.addEventListener('resize', snFix);
    let _snFiring=false;
    document.addEventListener('click', e=>{
      if (_snFiring) return;
      const names=document.querySelectorAll('div.truncate.text-left,[class*="truncate"][class*="text-left"]');
      for (const name of names) {
        if (name.style.position!=='fixed') continue;
        const r=name.getBoundingClientRect();
        if (e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) continue;
        if (e.target&&(e.target.tagName==='IMG'||e.target.closest('img'))) return;
        e.stopPropagation(); _snFiring=true;
        name.style.pointerEvents='auto';
        name.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:window,clientX:e.clientX,clientY:e.clientY}));
        name.style.pointerEvents='none'; _snFiring=false; return;
      }
    }, true);
  }

  // ============================================================
  // 10. Click Search
  // ============================================================

  {
    window.open = () => null;
    document.addEventListener('click', e=>{ const a=e.target.closest('a[target="_blank"]'); if(a){a.target='_self';e.preventDefault();} }, true);

    function csOpenSearch(token) {
      window.axiomUserOpen = true;
      const panel=document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
      if (panel) {
        const w=panel.parentElement, o=w?.parentElement;
        if(w){w.style.removeProperty('z-index');w.style.removeProperty('pointer-events');}
        if(o){o.style.removeProperty('z-index');o.style.removeProperty('pointer-events');o.style.removeProperty('background');o.style.removeProperty('backdrop-filter');}
      } else {
        document.querySelector('[class*="ri-search"]')?.closest('button')?.click();
      }
      setTimeout(()=>{
        const inp=document.querySelector('[class*="bg-backgroundTertiary"] input');
        if(!inp) return;
        const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
        setter.call(inp,token); inp.dispatchEvent(new Event('input',{bubbles:true}));
      },100);
    }

    const _csHandler = e => {
      if (e.button!==0) return;
      const row=e.target.closest('[class*="group/pulseRow"]'); if(!row) return;
      const tickerEl=e.target.closest('[style*="max-width"]');
      if (tickerEl) { const t=tickerEl.textContent.trim(); if(!t) return; e.preventDefault(); e.stopImmediatePropagation(); csOpenSearch(t); return; }
      const nameEl=e.target.closest('div.min-w-0.overflow-hidden.truncate.whitespace-nowrap');
      if (nameEl&&!nameEl.style.maxWidth) {
        const t=nameEl.textContent.trim(); if(!t) return;
        const btn=nameEl.closest('div[role="button"]'); if(!btn) return;
        e.preventDefault(); e.stopImmediatePropagation(); window.axiomUserOpen=true;
        btn.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,view:window}));
        setTimeout(()=>{
          const item=[...document.querySelectorAll('[role="menuitem"]')].find(el=>el.textContent?.trim()===`Search for ${t}`);
          if(item) item.click();
        },10);
      }
    };
    document.addEventListener('pointerdown', _csHandler, true);
    document.addEventListener('mousedown',   _csHandler, true);
    document.addEventListener('click',       _csHandler, true);

    // Detect user manually opening search
    document.addEventListener('click', e=>{
      const btn=e.target.closest('[class*="ri-search"]')?.closest('button');
      if(btn) { window.axiomUserOpen=true; }
      const mi=e.target.closest('[role="menuitem"]');
      if(mi&&mi.textContent?.includes('Search for')) window.axiomUserOpen=true;
    }, true);

    const _csMO=new MutationObserver(()=>{
      if(!document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]')) window.axiomUserOpen=false;
    });
    _csMO.observe(document.body,{childList:true,subtree:true});
  }

  // ============================================================
  // 11. MC Highlight
  // ============================================================

  {
    function mcParse(txt) {
      const m=txt.trim().match(/^\$([\d.]+)(K|M)?$/); if(!m) return 0;
      let v=parseFloat(m[1]); if(m[2]==='K') v*=1000; if(m[2]==='M') v*=1000000; return v;
    }
    function mcHighlight() {
      const panel=document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]'); if(!panel) return;
      [...panel.querySelectorAll('span,div')].filter(el=>el.textContent.trim().match(/^\$[\d.]+[KM]?$/)&&el.children.length===0).forEach(el=>{
        if (!el.parentElement.textContent.trim().startsWith('MC')) return;
        const v=mcParse(el.textContent);
        if(v>=100000){el.style.color='#ff3333';el.style.textShadow='0 0 8px rgba(255,50,50,0.9),0 0 16px rgba(255,50,50,0.5)';}
        else{el.style.color='';el.style.textShadow='';}
      });
    }
    new MutationObserver(mcHighlight).observe(document.body,{childList:true,subtree:true});
  }

  // ============================================================
  // 12. Pause On Hover
  // ============================================================

  {
    function pohGetHandler() {
      const sc=document.querySelector('.absolute.inset-0.overflow-y-auto'); if(!sc) return null;
      const fk=Object.keys(sc).find(k=>k.startsWith('__reactFiber')); if(!fk) return null;
      return sc[fk].return.stateNode;
    }
    function pohAttach(el, hd) {
      if(el.__pohHooked) return; el.__pohHooked=true;
      el.addEventListener('mouseenter',e=>hd.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,cancelable:true,clientX:e.clientX,clientY:e.clientY})));
      el.addEventListener('mousemove', e=>hd.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,cancelable:true,clientX:e.clientX,clientY:e.clientY})));
    }
    const _pohMO=new MutationObserver(()=>{
      const hd=pohGetHandler(); if(!hd) return;
      [...document.querySelectorAll('button')].filter(b=>b.style?.position==='fixed').forEach(b=>pohAttach(b,hd));
      [...document.querySelectorAll('img.qbm-coin-img')].forEach(b=>pohAttach(b,hd));
    });
    _pohMO.observe(document.body,{childList:true,subtree:true});
    const _pohInt=setInterval(()=>{
      const hd=pohGetHandler(); if(!hd) return; clearInterval(_pohInt);
      [...document.querySelectorAll('button')].filter(b=>b.style?.position==='fixed').forEach(b=>pohAttach(b,hd));
      [...document.querySelectorAll('img.qbm-coin-img')].forEach(b=>pohAttach(b,hd));
    },500);
  }

  // ============================================================
  // 13. Search Panel Left
  // ============================================================

  {
    const _splMO=new MutationObserver(()=>{
      const panel=document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
      if(!panel||panel.dataset.moved) return;
      panel.dataset.moved='true';
      const w=panel.parentElement; if(!w) return;
      const cur=w.style.transform, m=cur.match(/translate\((\d+)px,\s*(\d+)px\)/);
      if(m) { w.style.transform=`translate(${parseInt(m[1])-231}px,${parseInt(m[2])-151}px)`; }
      else  { w.style.marginLeft='-373px'; w.style.marginTop='-151px'; }
    });
    _splMO.observe(document.body,{childList:true,subtree:true});
  }

  // ============================================================
  // Debug API
  // ============================================================

  window.__qbPro = { sessionBest, started, queue, hashCache,
    getState: () => ({ active: activeCount, queued: queue.length, analyzed: started.size, results: sessionBest.size }) };

  console.log('🚀 Axiom QBuy Pro v1.3 loaded');

})();

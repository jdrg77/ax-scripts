// ==UserScript==
// @name         Axiom QBuy Best Match 2
// @namespace    http://tampermonkey.net/
// @version      1.23
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%202.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%202.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  const _p = new URLSearchParams(location.search);
  if (_p.get('tab') === 'grad' || _p.get('role') === 'buyer') return;

  // ============================================================
  // 0. SOL price cache + format helpers
  // ============================================================
  let solPriceUsd = 85.96;
  function refreshSolPrice() {
    try {
      if (typeof window.__solPriceUsd === 'number' && window.__solPriceUsd > 0)
        solPriceUsd = window.__solPriceUsd;
    } catch (e) {}
  }
  setInterval(refreshSolPrice, 30000);
  refreshSolPrice();

  function formatAge(createdAt) {
    if (!createdAt) return '';
    const ms = Date.now() - new Date(createdAt).getTime();
    if (!isFinite(ms) || ms < 0) return '';
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    const d = Math.floor(h / 24);
    if (d < 30) return d + 'd';
    const mo = Math.floor(d / 30);
    if (mo < 12) return mo + 'mo';
    return Math.floor(mo / 12) + 'y';
  }
  function formatMc(n) {
    if (!n || !isFinite(n) || n <= 0) return '';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

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
  async function searchTokenAPI(query) {
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
          onlyBonded: false,
          onlyDexPaid: false,
          maxResults: 20,
          v: Date.now(),
        }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  const PUMP_MIGRATED_PROTOCOLS = new Set(['Pump AMM', 'Raydium V4']);
  const BONK_PROTOCOLS          = new Set(['LaunchLab', 'Raydium CPMM']);

  function isAcceptedToken(t) {
    if (PUMP_MIGRATED_PROTOCOLS.has(t.protocol)) return true;
    if (t.protocol === 'Raydium CPMM')           return true;
    if (t.protocol === 'Pump V1')                return !!t.dexPaid;
    if (t.protocol === 'LaunchLab')              return !!t.dexPaid;
    return false;
  }

  function isMigrated(t)        { return PUMP_MIGRATED_PROTOCOLS.has(t.protocol) || t.protocol === 'Raydium CPMM'; }
  function isPumpDexNoMig(t)    { return t.protocol === 'Pump V1' && !!t.dexPaid; }

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
    const pump = row.querySelector('a[href*="pump.fun/coin/"]');
    if (pump) { const m = pump.href.match(/\/coin\/([A-Za-z0-9]{32,})/); if (m) return m[1]; }
    const meme = row.querySelector('a[href*="/meme/"]');
    if (meme) { const m = meme.href.match(/\/meme\/([A-Za-z0-9]{32,})/); if (m) return m[1]; }
    return '';
  }

  function getRowImgSrc(row) {
    return Array.from(row.querySelectorAll('img[class*="object-cover"]'))
      .find(img => img.src && !img.src.startsWith('data:'))?.src || null;
  }

  function isPlaceholder(src) {
    return !src || src.includes('/pfps/') || src.includes('axiom-assets');
  }

  function getRowPlatform(row) {
    if (row.querySelector('img[src*="bonk"]')) return 'bonk';
    if (row.querySelector('img[src*="pump-grad.svg"][alt="Raydium V4"]')) return 'raydium';
    if (row.querySelector('img[src*="pump"]')) return 'pump';
    return 'other';
  }

  // ============================================================
  // 4. Parallel Analyzer
  // ============================================================
  const MAX_CONC   = 3;
  const STAGGER_MS = 0;
  const started    = new Set();
  const queue      = [];
  const sessionBest = new Map();
  let   activeCount = 0;
  let   lastStartMs = 0;
  const MIN_MATCH_PCT = 55;

  const _prevHasBestMatch = window.__axiomHasBestMatch;
  window.__axiomHasBestMatch = ca => sessionBest.has(ca) || !!_prevHasBestMatch?.(ca);

  async function scoreResults(results, refHash) {
    if (!results?.length) return [];
    return await Promise.race([
      Promise.all(results.map(token => new Promise(resolve => {
        const imgSrc    = `https://axiomtrading.axiom-cdn.io/${token.tokenAddress}.webp`;
        const ageHours  = token.createdAt
          ? (Date.now() - new Date(token.createdAt).getTime()) / 3600000
          : 9999;
        const priceSol  = (token.liquidityToken && token.liquidityToken > 0)
          ? (token.liquiditySol / token.liquidityToken) : 0;
        const marketCap = priceSol * (token.supply || 0) * solPriceUsd;
        getHash(imgSrc, hash => resolve({ token, pct: hashSimilarity(refHash, hash), ageHours, marketCap }));
      }))),
      new Promise(resolve => setTimeout(() => resolve([]), 6000)),
    ]);
  }

  function rankScored(scored, rowName, gradSet, dexSet, rowPlatform) {
    const norm            = s => (s || '').toLowerCase().trim();
    const rn              = norm(rowName);
    const isGrad          = s => gradSet.has(s.token.tokenAddress);
    const isDex           = s => dexSet.has(s.token.tokenAddress);
    const nameMatch       = s => norm(s.token.tokenName)   === rn;
    const tickerMatch     = s => norm(s.token.tokenTicker) === rn;
    const nameTickerMatch = s => nameMatch(s) && tickerMatch(s);
    const nameOnlyMatch   = s => nameMatch(s) && !tickerMatch(s);

    const sortByRecent    = (a, b) => a.ageHours - b.ageHours;
    const sortByOldest    = (a, b) => b.ageHours - a.ageHours;
    const sortByMatchDesc = (a, b) => b.pct - a.pct;
    const sortByAgeMC     = (a, b) => a.ageHours !== b.ageHours ? a.ageHours - b.ageHours : b.marketCap - a.marketCap;

    const getPlatform = s => {
      if (isGrad(s))                              return 'pump-migrado';
      if (BONK_PROTOCOLS.has(s.token.protocol))   return 'bonk';
      if (isDex(s))                               return 'pump-dex';
      return 'pump-nodex';
    };
    const platMatches = s => {
      const p = getPlatform(s);
      if (rowPlatform === 'bonk')    return p === 'bonk';
      if (rowPlatform === 'raydium') return p === 'pump-migrado';
      if (rowPlatform === 'pump')    return p === 'pump-dex' || p === 'pump-nodex' || p === 'pump-migrado';
      return false;
    };
    const platFirst = (arr, sortFn) => {
      if (!rowPlatform || rowPlatform === 'other') return [...arr].sort(sortFn);
      return [
        ...[...arr].filter(platMatches).sort(sortFn),
        ...[...arr].filter(s => !platMatches(s)).sort(sortFn),
      ];
    };

    const special = scored.filter(s => isGrad(s) || isDex(s));
    const blues   = scored
      .filter(s => !isGrad(s) && !isDex(s) && (nameMatch(s) || tickerMatch(s)))
      .sort(sortByOldest)
      .slice(0, 3);

    function sortRest(list) {
      const ageDays = s => s.ageHours / 24;
      const tier1  = list.filter(s => ageDays(s) < 7  && s.pct > 72);
      const t1High = platFirst(tier1.filter(s => s.pct > 92), sortByRecent);
      const t1Low  = platFirst(tier1.filter(s => s.pct <= 92), sortByMatchDesc);
      const tier2  = platFirst(list.filter(s => ageDays(s) >= 7 && s.pct > 80), sortByRecent);
      const tier3  = platFirst(list.filter(s => ageDays(s) >= 7 && s.pct >= 75 && s.pct <= 80), sortByRecent);
      const tier4  = platFirst(list.filter(s => s.pct >= 58.21 && s.pct < 75), sortByAgeMC);
      const tier5  = platFirst(list.filter(s => s.pct < 58.21), sortByAgeMC);
      return [...t1High, ...t1Low, ...tier2, ...tier3, ...tier4, ...tier5];
    }

    let sortedSpecial;
    const hasNameTicker = special.some(nameTickerMatch);
    const hasNameOnly   = !hasNameTicker && special.some(nameOnlyMatch);

    if (hasNameTicker) {
      const nt     = special.filter(nameTickerMatch);
      const ultra  = platFirst(nt.filter(s => s.pct > 85), sortByMatchDesc);
      const rest   = platFirst(nt.filter(s => s.pct <= 85), sortByRecent);
      const others = special.filter(s => !nameTickerMatch(s));
      sortedSpecial = [...ultra, ...rest, ...sortRest(others)];
    } else if (hasNameOnly) {
      const no     = special.filter(nameOnlyMatch);
      const recent = platFirst(no.filter(s => s.ageHours < 24), sortByRecent);
      const old    = platFirst(no.filter(s => s.ageHours >= 24), sortByMatchDesc);
      const others = special.filter(s => !nameOnlyMatch(s));
      sortedSpecial = [...recent, ...old, ...sortRest(others)];
    } else {
      sortedSpecial = sortRest(special);
    }

    return [...sortedSpecial, ...blues]
      .filter(s => s.pct >= MIN_MATCH_PCT)
      .map(s => ({ ...s, resolvedPlatform: getPlatform(s) }));
  }

  async function analyzeRow({ name, refImgSrc, rowCA, rowPlatform }) {
    const refHash = await new Promise(resolve => getHash(refImgSrc, resolve));
    if (!refHash) return;

    const raw = await searchTokenAPI(name);
    if (!raw || !raw.length) return;

    const unique = raw.filter(isAcceptedToken);
    if (!unique.length) return;

    const gradSet = new Set(unique.filter(isMigrated).map(t => t.tokenAddress));
    const dexSet  = new Set(unique.filter(isPumpDexNoMig).map(t => t.tokenAddress));

    const scored = await scoreResults(unique, refHash);
    const ranked = rankScored(scored, name, gradSet, dexSet, rowPlatform);
    if (!ranked.length) return;

    const s = ranked[0];
    const existing = sessionBest.get(rowCA);
    if (existing && s.pct <= existing.matchPct) return;

    const t = s.token;
    const matchedAge   = formatAge(t.createdAt);
    const matchedMcUsd = s.marketCap;
    const matchedMc    = formatMc(s.marketCap);

    sessionBest.set(rowCA, {
      rowCA,
      ca:          t.tokenAddress,
      tokenCA:     t.tokenAddress,
      pairAddress: t.pairAddress || t.tokenAddress,
      memeHref:    `/meme/${t.pairAddress || t.tokenAddress}?chain=sol`,
      ticker:      t.tokenTicker || '',
      name:        t.tokenName   || '',
      imgSrc:      `https://axiomtrading.axiom-cdn.io/${t.tokenAddress}.webp`,
      matchPct:    s.pct,
      platform:    s.resolvedPlatform,
      matchedAge,
      matchedMc,
      matchedMcUsd,
    });
    const btn = document.querySelector(`[data-qbm-mini="${rowCA}"]`);
    if (btn) btn.dataset.qbmPair = t.tokenAddress;
    console.log(`[BM] ✅ ${name} → ${t.tokenTicker} ${s.pct}% [${s.resolvedPlatform}] age=${matchedAge} mc=${matchedMc}`);
  }

  function tryStart() {
    if (activeCount >= MAX_CONC || !queue.length) return;
    const now  = Date.now();
    const wait = Math.max(0, lastStartMs + STAGGER_MS - now);
    if (wait > 0) { setTimeout(tryStart, wait); return; }
    const task = queue.shift();
    activeCount++;
    lastStartMs = Date.now();
    analyzeRow(task).finally(() => { activeCount--; tryStart(); });
    tryStart();
  }

  function enqueue(task) {
    const key = task.rowCA || task.name;
    if (!key) return;
    if (sessionBest.has(task.rowCA)) return;
    if (started.has(key)) return;
    if (started.size > 500) started.clear();
    started.add(key);
    queue.push(task);
    tryStart();
  }

  function getFirst4Rows() {
    const header = Array.from(document.querySelectorAll('*'))
      .find(el => el.children.length < 5 && el.textContent.trim() === 'New Pairs');
    if (!header) return [];
    const col = header.parentElement?.parentElement?.parentElement;
    if (!col) return [];
    const virtualList = Array.from(col.querySelectorAll('div')).find(div => {
      const s = div.getAttribute('style') || '';
      return s.includes('position: relative') &&
             div.querySelectorAll('[style*="position: absolute"]').length > 3;
    });
    if (!virtualList) return [];
    return Array.from(virtualList.querySelectorAll(':scope > [style*="position: absolute"]')).slice(1, 4);
  }

  function scanRows() {
    getFirst4Rows().forEach(row => {
      const pulseRow  = row.querySelector('[class*="group/pulseRow"]') || row;
      const name      = getRowName(pulseRow);
      if (!name) return;
      const ca          = getRowCA(pulseRow);
      const refImgSrc   = getRowImgSrc(pulseRow);
      if (isPlaceholder(refImgSrc)) return;
      const rowPlatform = getRowPlatform(pulseRow);
      enqueue({ name, refImgSrc, rowCA: ca || name, rowPlatform });
    });
  }

  // Scan on mutations AND on a fixed interval — ensures row 0 is never missed
  new MutationObserver(scanRows).observe(document.body, { childList: true, subtree: true });
  setInterval(scanRows, 500);
  setTimeout(scanRows, 800); // initial scan once DOM settles

  // ============================================================
  // 5. Mini Buttons
  // ============================================================
  const miniPool = new Map();
  const BTN_W = 68, BTN_H = 23;
  const AVATAR = 44, AVATAR_OFFSET = 48;
  const lastNormalSize = { w: 68, h: 23 };

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

  function platStyle(platform) {
    if (platform === 'pump-migrado') return { bg: 'rgba(255,215,0,0.85)',   border: 'rgb(255,215,0)',   shadow: 'rgba(255,215,0,0.6)'   };
    if (platform === 'pump-dex')     return { bg: 'rgba(120,255,160,0.85)', border: 'rgb(120,255,160)', shadow: 'rgba(120,255,160,0.6)' };
    if (platform === 'bonk')         return { bg: 'rgba(255,140,0,0.85)',   border: 'rgb(255,140,0)',   shadow: 'rgba(255,140,0,0.6)'   };
    return                                  { bg: 'rgba(20,20,30,0.92)',    border: '#555',             shadow: 'rgba(0,0,0,0.4)'       };
  }

  function createMiniBtn(rowCA) {
    const el = document.createElement('button');
    el.setAttribute('data-qbm-mini', rowCA);
    el.style.cssText = 'position:fixed;z-index:99999;display:none;overflow:visible;cursor:pointer;' +
      'flex-direction:row;gap:3px;align-items:center;justify-content:center;' +
      'border-radius:999px;padding:0 8px;box-sizing:border-box;';

    const icon = document.createElement('i');
    icon.className = 'ri-flashlight-fill';
    icon.style.cssText = 'font-size:12px;position:relative;z-index:10;pointer-events:none;';
    el.appendChild(icon);

    const solSpan = document.createElement('span');
    solSpan.className = 'qbm-sol';
    solSpan.style.cssText = 'font-size:9px;font-weight:700;position:relative;z-index:10;pointer-events:none;';
    el.appendChild(solSpan);

    const coinImg = document.createElement('img');
    coinImg.className = 'qbm-coin-img';
    coinImg.style.cssText = 'width:' + AVATAR + 'px;height:' + AVATAR + 'px;' +
      'min-width:' + AVATAR + 'px;min-height:' + AVATAR + 'px;aspect-ratio:1/1;' +
      'border-radius:50%;object-fit:cover;position:absolute;' +
      'left:-' + AVATAR_OFFSET + 'px;top:50%;transform:translateY(-50%);' +
      'pointer-events:auto;cursor:pointer;flex-shrink:0;' +
      'box-shadow:rgba(255,255,255,0.35) 0px 0px 0px 1px,rgba(0,0,0,0.4) 0px 2px 8px;';
    coinImg.addEventListener('click', e => {
      e.stopPropagation(); e.preventDefault();
      const best = sessionBest.get(rowCA);
      if (best?.memeHref) { history.pushState({}, '', best.memeHref); window.dispatchEvent(new PopStateEvent('popstate')); }
    });
    el.appendChild(coinImg);

    const pctBadge = document.createElement('span');
    pctBadge.className = 'qbm-pct';
    pctBadge.style.cssText = 'position:absolute;left:-26px;top:calc(50% - 22px);' +
      'transform:translate(-50%,-50%);font-size:7px;font-weight:700;font-family:monospace;' +
      'background:rgba(0,0,0,0.85);border-radius:5px;padding:0 3px;pointer-events:none;' +
      'white-space:nowrap;border:1px solid currentColor;z-index:10001;line-height:1.4;';
    el.appendChild(pctBadge);

    const label = document.createElement('div');
    label.className = 'qbm-label';
    label.style.cssText = 'position:fixed;display:none;font-size:10px;font-weight:600;' +
      'font-family:monospace;color:#ccc;background:rgba(0,0,0,0.65);border-radius:4px;' +
      'padding:1px 4px;pointer-events:none;white-space:nowrap;z-index:100000;' +
      'transform:translate(-50%,-100%);';
    document.body.appendChild(label);
    el._label = label;

    const infoBar = document.createElement('div');
    infoBar.className = 'qbm-info';
    infoBar.style.cssText = 'position:absolute;top:100%;left:50%;transform:translateX(-50%);' +
      'margin-top:2px;display:flex;flex-direction:row;align-items:center;justify-content:center;' +
      'gap:3px;font-size:9px;font-weight:700;font-family:monospace;pointer-events:none;' +
      'white-space:nowrap;z-index:10001;';
    el.appendChild(infoBar);

    el.addEventListener('click', e => {
      e.stopPropagation(); e.stopImmediatePropagation(); e.preventDefault();
      if (e.target.closest('img.qbm-coin-img')) return;
      const best = sessionBest.get(rowCA);
      if (!best) return;
      if (window.__ringArmedRowCAs?.has(rowCA)) {
        const ringChannel = new BroadcastChannel('axiom-buyer-ring');
        ringChannel.postMessage({ type: 'BUY_BY_CA', ca: best.tokenCA });
        ringChannel.close();
      } else {
        executeBest(best);
      }
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

  function getSOLAmount() {
    const input = Array.from(document.querySelectorAll('input'))
      .find(i => i.value && !isNaN(parseFloat(i.value)) && parseFloat(i.value) < 100 && i.placeholder === '0.0');
    return input ? parseFloat(input.value) : 0.01;
  }

  function updateMiniButtons() {
    const rows   = document.querySelectorAll('[class*="group/pulseRow"]');
    const seen   = new Set();
    const solAmt = getSOLAmount() + ' SOL';
    const btnW   = lastNormalSize.w;
    const btnH   = lastNormalSize.h;

    rows.forEach(row => {
      const ca  = getRowCA(row);
      const key = ca || getRowName(row);
      if (!key || seen.has(key)) return;
      seen.add(key);

      if (row.hasAttribute('data-bm1-active')) return;
      const best = sessionBest.get(ca || key);
      if (!best) return;

      const rect = row.getBoundingClientRect();
      if (rect.width < 10) return;

      const solDiv = Array.from(
        row.querySelectorAll('[class*="z-20"][class*="absolute"][class*="right-0"][class*="bottom-0"]')
      ).find(el => el.getBoundingClientRect().width > 0);

      let posLeft;
      if (solDiv) {
        const sr = solDiv.getBoundingClientRect();
        posLeft  = sr.left + sr.width / 2 - btnW / 2 + 63;
      } else {
        posLeft = rect.right - btnW - 20;
      }
      const posTop = rect.top + rect.height / 2 - btnH / 2 + 30;

      const el = getOrCreateMiniBtn(ca || key);
      el.style.left      = posLeft + 'px';
      el.style.top       = posTop  + 'px';
      el.style.width     = btnW + 'px';
      el.style.height    = btnH + 'px';
      el.dataset.qbmPair = best.tokenCA || '';

      const coinImg = el.querySelector('.qbm-coin-img');
      if (coinImg && best.imgSrc && coinImg.src !== best.imgSrc) coinImg.src = best.imgSrc;

      const pctBadge = el.querySelector('.qbm-pct');
      if (pctBadge) {
        const txt = best.matchPct.toFixed(1) + '%';
        if (pctBadge.textContent !== txt) pctBadge.textContent = txt;
        const col = badgeColor(best.matchPct);
        pctBadge.style.color = col;
        pctBadge.style.borderColor = col;
      }

      const solSpan = el.querySelector('.qbm-sol');
      if (solSpan && solSpan.textContent !== solAmt) solSpan.textContent = solAmt;

      const age = best.matchedAge || '';
      const mc  = best.matchedMc  || '';
      const infoBar = el.querySelector('.qbm-info');
      if (infoBar) {
        const ageTxt = age ? `<span style="color:rgb(255,215,0);background:rgba(0,0,0,0.7);border-radius:4px;padding:1px 5px;">${age}</span>` : '';
        const mcTxt  = mc  ? `<span style="color:rgb(91,184,255);background:rgba(0,0,0,0.7);border-radius:4px;padding:1px 5px;">${mc}</span>` : '';
        const html   = ageTxt + mcTxt;
        if (infoBar.innerHTML !== html) infoBar.innerHTML = html;
      }

      const ps = platStyle(best.platform);
      el.style.background = ps.bg;
      el.style.border     = `1.5px solid ${ps.border}`;
      el.style.boxShadow  = `${ps.shadow} 0px 0px 8px 2px`;
      el.style.display    = 'flex';

      const label = el._label;
      if (label) {
        const nameText = best.name || best.ticker || '';
        if (label.textContent !== nameText) label.textContent = nameText;
        label.style.left    = (posLeft + (btnW * 0.7842) / 2 - 4) + 'px';
        label.style.top     = (posTop - 5) + 'px';
        label.style.display = '';
      }
    });

    miniPool.forEach((btn, ca) => {
      if (!seen.has(ca) && btn?.isConnected) {
        btn.style.display = 'none';
        if (btn._label) btn._label.style.display = 'none';
      }
    });
  }

  // ============================================================
  // 6. Buy execution (independent — no axiomUserOpen)
  // ============================================================
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
    const doExecute = () => {
      bringPanelToFront();
      const panel = getSearchPanel();
      if (!panel) return;
      const query = best.tokenCA || best.ca;
      if (!query) return;
      const prevBtns = new Set(panel.querySelectorAll('[class*="group/quickBuyButton"]'));
      typeInPanel(panel, query);
      const start = Date.now();
      const poll = () => {
        const btns  = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')];
        const fresh = btns.filter(b => !prevBtns.has(b));
        if (fresh.length > 0) { fireClickOnEl(fresh[0]); if (best.memeHref) { history.pushState({}, '', best.memeHref); window.dispatchEvent(new PopStateEvent('popstate')); } return; }
        if (Date.now() - start > 1500) return;
        setTimeout(poll, 50);
      };
      setTimeout(poll, 50);
    };
    if (!getSearchPanel() || !isPanelVisible()) {
      const searchBtn = document.querySelector('[class*="ri-search"]')?.closest('button');
      if (!searchBtn) return;
      searchBtn.click();
      setTimeout(doExecute, 150);
    } else {
      doExecute();
    }
  }

  // ============================================================
  // 7. Main loop + exports
  // ============================================================
  setInterval(updateMiniButtons, 16);

  window.__axiomGetTop3BM2 = () => {
    const rows = getFirst4Rows();
    const result = [];
    for (const row of rows) {
      if (result.length >= 3) break;
      const pulseRow = row.querySelector('[class*="group/pulseRow"]') || row;
      const ca = getRowCA(pulseRow);
      if (!ca) continue;
      const best = sessionBest.get(ca);
      if (!best) continue;
      result.push({ rowCA: ca, tokenCA: best.tokenCA });
    }
    return result;
  };

  window.__qbBM = {
    sessionBest, started, queue, hashCache,
    setSolPrice: p => { window.__solPriceUsd = p; solPriceUsd = p; },
    getState: () => ({ active: activeCount, queued: queue.length, analyzed: started.size, results: sessionBest.size, solPriceUsd }),
  };

  console.log('⭐ Axiom QBuy Best Match 2 v1.14 — rows 2-4, skips data-bm1-active rows');
})();

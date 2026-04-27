// ==UserScript==
// @name         Axiom QBuy Best Match 2 2
// @namespace    http://tampermonkey.net/
// @version      1.6
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%202.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%20Best%20Match%202.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') === 'grad') return;

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

  function getRowAgeAndMC(row) {
    const ageEl = row.querySelector('span[class*="pointer-events-none"]');
    const age   = ageEl?.textContent?.trim() || '';
    let mc = '';
    for (const c of row.querySelectorAll('div[class*="gap-[4px]"]')) {
      const spans = [...c.querySelectorAll('span')];
      const lbl   = spans.find(s => s.textContent.trim() === 'MC');
      if (lbl) { mc = spans.find(s => s !== lbl && s.textContent.trim())?.textContent.trim() || ''; break; }
    }
    return { age, mc };
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

  // ============================================================
  // 4. Parallel Analyzer
  // ============================================================
  const MAX_CONC   = 3;
  const STAGGER_MS = 150;
  const started    = new Set();
  const queue      = [];
  const sessionBest = new Map(); // rowCA → best match
  let   activeCount  = 0;
  let   lastStartMs  = 0;

  const MIN_MATCH_PCT = 55;

  window.__axiomHasBestMatch = ca => sessionBest.has(ca);

  async function scoreResults(results, refHash) {
    if (!results?.length) return [];
    return await Promise.race([
      Promise.all(results.map(token => new Promise(resolve => {
        const imgSrc = `https://axiomtrading.axiom-cdn.io/${token.tokenAddress}.webp`;
        getHash(imgSrc, hash => resolve({ token, pct: hashSimilarity(refHash, hash) }));
      }))),
      new Promise(resolve => setTimeout(() => resolve([]), 6000)),
    ]);
  }

  function rankScored(scored, rowName, gradSet, dexSet) {
    const norm        = s => (s || '').toLowerCase().trim();
    const rn          = norm(rowName);
    const isGrad      = s => gradSet.has(s.token.tokenAddress);
    const isDex       = s => dexSet.has(s.token.tokenAddress);
    const nameMatch   = s => norm(s.token.tokenName)   === rn;
    const tickerMatch = s => norm(s.token.tokenTicker) === rn;
    const exactMatch  = s => nameMatch(s) || tickerMatch(s);
    const byPct       = (a, b) => b.pct - a.pct;

    const getPlatform = s => {
      if (isGrad(s)) return 'pump-migrado';
      if (s.token.protocol === 'bonk') return 'bonk';
      if (isDex(s)) return 'pump-dex';
      return 'pump-nodex';
    };

    function sortRest(list) {
      const tier1 = list.filter(s => s.pct >  85).sort(byPct);
      const tier2 = list.filter(s => s.pct >  72 && s.pct <= 85).sort(byPct);
      const tier3 = list.filter(s => s.pct >= 58.21 && s.pct <= 72).sort(byPct);
      const tier4 = list.filter(s => s.pct >= MIN_MATCH_PCT && s.pct < 58.21).sort(byPct);
      return [...tier1, ...tier2, ...tier3, ...tier4];
    }

    const special = scored.filter(isGrad);
    const blues   = scored.filter(s => !isGrad(s) && exactMatch(s)).sort(byPct).slice(0, 3);
    const others  = scored.filter(s => !isGrad(s) && !exactMatch(s));

    let sortedSpecial;
    const hasExact    = special.some(exactMatch);
    const hasNameOnly = !hasExact && special.some(nameMatch);

    if (hasExact) {
      const ex    = special.filter(exactMatch);
      const ultra = ex.filter(s => s.pct > 85).sort(byPct);
      const rest  = ex.filter(s => s.pct <= 85).sort(byPct);
      const nonEx = special.filter(s => !exactMatch(s));
      sortedSpecial = [...ultra, ...rest, ...sortRest(nonEx)];
    } else if (hasNameOnly) {
      const nm = special.filter(nameMatch);
      sortedSpecial = [...nm.sort(byPct), ...sortRest(special.filter(s => !nameMatch(s)))];
    } else {
      sortedSpecial = sortRest(special);
    }

    return [...sortedSpecial, ...blues, ...sortRest(others)]
      .filter(s => s.pct >= MIN_MATCH_PCT)
      .map(s => ({ ...s, resolvedPlatform: getPlatform(s) }));
  }

  async function analyzeRow({ name, refImgSrc, rowCA }) {
    const refHash = await new Promise(resolve => getHash(refImgSrc, resolve));
    if (!refHash) return;

    const [gradResults, dexResults] = await Promise.all([
      searchTokenAPI(name, true,  false),
      searchTokenAPI(name, false, true),
    ]);

    const gradSet = new Set((gradResults || []).map(t => t.tokenAddress));
    const dexSet  = new Set((dexResults  || []).map(t => t.tokenAddress));

    const seen = new Set();
    const unique = [...(gradResults || []), ...(dexResults || [])].filter(t => {
      if (seen.has(t.tokenAddress)) return false;
      seen.add(t.tokenAddress);
      return true;
    });
    if (!unique.length) return;

    const scored = await scoreResults(unique, refHash);
    const ranked = rankScored(scored, name, gradSet, dexSet);
    if (!ranked.length) return;

    const s = ranked[0];
    const existing = sessionBest.get(rowCA);
    if (existing && s.pct <= existing.matchPct) return;

    sessionBest.set(rowCA, {
      rowCA,
      ca:          s.token.tokenAddress,
      tokenCA:     s.token.tokenAddress,
      pairAddress: s.token.pairAddress || s.token.tokenAddress,
      memeHref:    `/meme/${s.token.pairAddress || s.token.tokenAddress}?chain=sol`,
      ticker:      s.token.tokenTicker || '',
      name:        s.token.tokenName   || '',
      imgSrc:      `https://axiomtrading.axiom-cdn.io/${s.token.tokenAddress}.webp`,
      matchPct:    s.pct,
      platform:    s.resolvedPlatform,
    });
    const btn = document.querySelector(`[data-qbm-mini="${rowCA}"]`);
    if (btn) btn.dataset.qbmPair = s.token.tokenAddress;
    console.log(`[BM] ✅ ${name} → ${s.token.tokenTicker} ${s.pct}% [${s.resolvedPlatform}]`);
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
    return Array.from(virtualList.querySelectorAll(':scope > [style*="position: absolute"]')).slice(0, 4);
  }

  function scanRows() {
    getFirst4Rows().forEach(row => {
      const pulseRow  = row.querySelector('[class*="group/pulseRow"]') || row;
      const name      = getRowName(pulseRow);
      if (!name) return;
      const ca        = getRowCA(pulseRow);
      const refImgSrc = getRowImgSrc(pulseRow);
      if (isPlaceholder(refImgSrc)) return;
      enqueue({ name, refImgSrc, rowCA: ca || name });
    });
  }

  new MutationObserver(scanRows).observe(document.body, { childList: true, subtree: true });

  // ============================================================
  // 5. Glow on original QB buttons (ported from v8.26)
  // ============================================================
  let lastGlowBtns   = [];
  let lastNormalSize = { w: 48, h: 48 };

  function getQBButtons() {
    return [...document.querySelectorAll('button')].filter(btn =>
      btn.style?.position === 'fixed' &&
      btn.style?.zIndex   === '9999'  &&
      btn.style?.display  !== 'none'  &&
      btn.querySelector?.('.qb-sim-badge')
    );
  }

  function platColorFor(platform) {
    if (platform === 'bonk')         return { color: '#ff8c00', glow: 'rgba(255,140,0,0.4)' };
    if (platform === 'pump-migrado') return { color: '#ffd700', glow: 'rgba(255,215,0,0.4)' };
    if (platform === 'pump-dex')     return { color: '#78ffa0', glow: 'rgba(120,255,160,0.4)' };
    return                                  { color: '#ffd700', glow: 'rgba(255,215,0,0.4)' };
  }

  function applyGlow(btn, platform) {
    const { color, glow } = platColorFor(platform);
    btn.style.boxShadow = `0 0 18px 5px ${color}, 0 0 36px 10px ${glow}`;
    btn.style.setProperty('outline', `2px solid ${color}`, 'important');
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
    const qbBtns = getQBButtons();
    if (qbBtns.length) {
      const r = qbBtns[0].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) lastNormalSize = { w: r.width, h: r.height };
    }

    clearGlows();

    const topRow = document.querySelector('[class*="group/pulseRow"]');
    if (!topRow) return;
    const topCA = getRowCA(topRow);
    if (!topCA) return;
    const best = sessionBest.get(topCA);
    if (!best) return;
    const topQB = qbBtns[0];
    if (!topQB) return;
    applyGlow(topQB, best.platform);
    lastGlowBtns = [topQB];
  }

  // ============================================================
  // 6. Mini Buttons
  // ============================================================
  const miniPool = new Map();
  const BTN_W = 68.9, BTN_H = 30;

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
    el.style.cssText = `position:fixed;z-index:99999;display:none;overflow:visible;cursor:pointer;` +
      `flex-direction:row;gap:4px;align-items:center;justify-content:center;` +
      `border-radius:999px;transform:scale(0.7842);transform-origin:top left;`;

    const icon = document.createElement('i');
    icon.className = 'ri-flashlight-fill';
    icon.style.cssText = 'font-size:16px;position:relative;z-index:10;pointer-events:none;';
    el.appendChild(icon);

    const solSpan = document.createElement('span');
    solSpan.className = 'qbm-sol';
    solSpan.style.cssText = 'font-size:12px;font-weight:700;position:relative;z-index:10;pointer-events:none;';
    el.appendChild(solSpan);

    const coinImg = document.createElement('img');
    coinImg.className = 'qbm-coin-img';
    coinImg.style.cssText = 'width:60px;height:60px;border-radius:50%;object-fit:cover;position:absolute;' +
      'left:-66px;top:50%;transform:translateY(-50%);pointer-events:auto;cursor:pointer;' +
      'box-shadow:rgba(255,255,255,0.35) 0px 0px 0px 1px,rgba(0,0,0,0.4) 0px 2px 8px;';
    coinImg.addEventListener('click', e => {
      e.stopPropagation(); e.preventDefault();
      const best = sessionBest.get(rowCA);
      if (best?.memeHref) { history.pushState({}, '', best.memeHref); window.dispatchEvent(new PopStateEvent('popstate')); }
    });
    el.appendChild(coinImg);

    const pctBadge = document.createElement('span');
    pctBadge.className = 'qbm-pct';
    pctBadge.style.cssText = 'position:absolute;left:-36px;top:calc(50% - 25px);transform:translate(-50%,-50%);' +
      'font-size:10px;font-weight:700;font-family:monospace;background:rgba(0,0,0,0.85);' +
      'border-radius:8px;padding:1px 5px;pointer-events:none;white-space:nowrap;border:1.5px solid currentColor;z-index:10001;';
    el.appendChild(pctBadge);

    const label = document.createElement('div');
    label.className = 'qbm-label';
    label.style.cssText = 'position:fixed;display:none;font-size:10px;font-weight:600;font-family:monospace;' +
      'color:#ccc;background:rgba(0,0,0,0.65);border-radius:4px;padding:1px 4px;' +
      'pointer-events:none;white-space:nowrap;z-index:100000;transform:translateX(-50%);';
    document.body.appendChild(label);
    el._label = label;

    const infoBar = document.createElement('div');
    infoBar.className = 'qbm-info';
    infoBar.style.cssText = 'position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:2px;' +
      'display:flex;flex-direction:row;align-items:center;justify-content:center;gap:4px;' +
      'font-size:11px;font-weight:700;font-family:monospace;pointer-events:none;white-space:nowrap;z-index:10001;';
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
    if (isPanelVisible()) {
      miniPool.forEach(btn => {
        if (btn?.isConnected) btn.style.display = 'none';
        if (btn?._label) btn._label.style.display = 'none';
      });
      return;
    }

    const rows  = document.querySelectorAll('[class*="group/pulseRow"]');
    const seen  = new Set();
    const solAmt = getSOLAmount() + ' SOL';
    const btnW = lastNormalSize.w;
    const btnH = lastNormalSize.h;

    rows.forEach(row => {
      const ca  = getRowCA(row);
      const key = ca || getRowName(row);
      if (!key || seen.has(key)) return;
      seen.add(key);

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
        posLeft  = sr.left + sr.width / 2 - btnW / 2 + 75;
      } else {
        posLeft = rect.right - btnW - 8;
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

      const { age, mc } = getRowAgeAndMC(row);
      const infoBar = el.querySelector('.qbm-info');
      if (infoBar) {
        const ageTxt = age ? `<span style="color:rgb(255,215,0);background:rgba(0,0,0,0.7);border-radius:4px;padding:1px 5px;">${age}</span>` : '';
        const mcTxt  = mc  ? `<span style="color:rgb(91,184,255);background:rgba(0,0,0,0.7);border-radius:4px;padding:1px 5px;">MC ${mc}</span>` : '';
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
        label.style.left    = (posLeft + (btnW * 0.7842) / 2) + 'px';
        label.style.top     = (posTop - 18) + 'px';
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
  // 7. Buy execution
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
    window.axiomUserOpen = true;
    const doExecute = () => {
      bringPanelToFront();
      const panel = getSearchPanel();
      if (!panel) { window.axiomUserOpen = false; return; }
      const query = best.tokenCA || best.ca;
      if (!query) { window.axiomUserOpen = false; return; }
      const prevBtns = new Set(panel.querySelectorAll('[class*="group/quickBuyButton"]'));
      typeInPanel(panel, query);
      const start = Date.now();
      const poll = () => {
        const btns = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')];
        const fresh = btns.filter(b => !prevBtns.has(b));
        if (fresh.length > 0) { fireClickOnEl(fresh[0]); setTimeout(() => { window.axiomUserOpen = false; }, 400); return; }
        if (Date.now() - start > 1500) { window.axiomUserOpen = false; return; }
        setTimeout(poll, 50);
      };
      setTimeout(poll, 50);
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

  // ============================================================
  // 8. Main loop + exports
  // ============================================================
  setInterval(() => { updateGlow(); updateMiniButtons(); }, 16);

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
    getState: () => ({ active: activeCount, queued: queue.length, analyzed: started.size, results: sessionBest.size }),
  };

  console.log('⭐ Axiom QBuy Best Match v1.6 loaded');
})();

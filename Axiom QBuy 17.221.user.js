// ==UserScript==
// @name         Axiom QBuy 17.221
// @namespace    http://tampermonkey.net/
// @version      11.5
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%2017.221.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%2017.221.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') === 'grad') return;

  const HASH_SIZE     = 32;
  const HASH_BITS     = 8;
  const addedBtns     = [];
  const gradProxyBtns = [];
  const gradChannel   = new BroadcastChannel('axiom-tabs');
  const hashCache     = new Map();
  let   gradCandidates = [];
  let   gradProxyAnchor = null;
  let scrollEl        = null;
  let lastPanel       = null;
  let isPanelVisible  = false;
  let hasActiveSearch = false;
  let updateTimeout   = null;
  let referenceHash   = null;
  let referenceSource = null;

  function dct1d(f) {
    const N = f.length;
    const F = new Float32Array(N);
    const pi2N = Math.PI / (2 * N);
    for (let u = 0; u < N; u++) {
      let sum = 0;
      for (let i = 0; i < N; i++) sum += f[i] * Math.cos((2 * i + 1) * u * pi2N);
      F[u] = sum;
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
    // Separable 2D DCT: rows then columns
    const tmp = new Float32Array(HASH_SIZE * HASH_SIZE);
    for (let r = 0; r < HASH_SIZE; r++) {
      const row = dct1d(gray.slice(r * HASH_SIZE, (r + 1) * HASH_SIZE));
      for (let c = 0; c < HASH_SIZE; c++) tmp[r * HASH_SIZE + c] = row[c];
    }
    const dct = new Float32Array(HASH_SIZE * HASH_SIZE);
    for (let c = 0; c < HASH_SIZE; c++) {
      const col = new Float32Array(HASH_SIZE);
      for (let r = 0; r < HASH_SIZE; r++) col[r] = tmp[r * HASH_SIZE + c];
      const colDCT = dct1d(col);
      for (let r = 0; r < HASH_SIZE; r++) dct[r * HASH_SIZE + c] = colDCT[r];
    }
    // Top-left HASH_BITS×HASH_BITS — compute mean then build binary hash
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
    img.onload = function() {
      try {
        const hash = computeHash(img);
        hashCache.set(src, hash);
        cb(hash);
      } catch(e) { cb(null); }
    };
    img.onerror = () => cb(null);
    img.src = src.includes('?') ? src : src + '?qb=1';
  }

  function hashSimilarity(h1, h2) {
    if (!h1 || !h2 || h1.length !== h2.length) return null;
    let matches = 0;
    for (let i = 0; i < h1.length; i++) if (h1[i] === h2[i]) matches++;
    return parseFloat(((matches / h1.length) * 100).toFixed(1));
  }

  function setReference(src) {
    if (!src || src.startsWith('data:') || src === referenceSource) return;
    referenceSource = src;
    referenceHash   = null;
    getHash(src, (hash) => {
      referenceHash = hash;
      updateAllBadges();
      scheduleUpdate();
    });
  }

  function getRealImage(containerEl) {
    if (!containerEl) return null;
    return Array.from(containerEl.querySelectorAll('img[class*="object-cover"]'))
      .find(img => img.src && !img.src.startsWith('data:')) || null;
  }

  function getTopPulseRowImage() {
    const panel = document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
    const rows = [...document.querySelectorAll('[class*="group/pulseRow"]')]
      .filter(r => !panel || !panel.contains(r));
    if (!rows.length) return null;
    return getRealImage(rows[0]);
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

  window.qbSetReference = function (src) { setReference(src); };

  function getNewPair() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    if (!rows.length) return null;
    const row      = rows[0];
    const tickerEl = row.querySelector('div[class*="min-w-0"][class*="truncate"][class*="text-[16px]"]');
    const nameEl   = row.querySelector('div[class*="min-w-0"][class*="flex-1"][class*="overflow-hidden"]');
    return {
      ticker: tickerEl?.textContent.trim() || '',
      name:   nameEl?.textContent.trim()   || ''
    };
  }

  function ageToSeconds(ageStr) {
    if (!ageStr) return Infinity;
    const s   = ageStr.trim().toLowerCase();
    const num = parseFloat(s);
    if (isNaN(num)) return Infinity;
    if (s.endsWith('mo')) return num * 30 * 24 * 3600;
    if (s.endsWith('y'))  return num * 365 * 24 * 3600;
    if (s.endsWith('d'))  return num * 24 * 3600;
    if (s.endsWith('h'))  return num * 3600;
    if (s.endsWith('m'))  return num * 60;
    if (s.endsWith('s'))  return num;
    return Infinity;
  }

  function mcToNumber(mcStr) {
    if (!mcStr) return 0;
    const s   = mcStr.replace('$', '').trim().toUpperCase();
    const num = parseFloat(s);
    if (isNaN(num)) return 0;
    if (s.endsWith('T')) return num * 1e12;
    if (s.endsWith('B')) return num * 1e9;
    if (s.endsWith('M')) return num * 1e6;
    if (s.endsWith('K')) return num * 1e3;
    return num;
  }

  function getTokenData(newBtn) {
    const originalBtn = newBtn._original;
    if (!originalBtn) return null;

    const bgColor = originalBtn.style.background || '';
    const isGold  = bgColor.includes('255, 215, 0');
    const isGreen = bgColor.includes('120, 255, 160');

    const row = originalBtn.closest('[class*="max-h-[64px]"]');
    if (!row) return null;

    const truncateDivs = row.querySelectorAll('div[class*="min-w-0"][class*="truncate"][class*="whitespace-nowrap"]');
    const ticker = truncateDivs[0]?.textContent.trim() || '';
    const name   = truncateDivs[1]?.textContent.trim() || truncateDivs[0]?.textContent.trim() || '';

    const ageEl    = row.querySelector('span[class*="pointer-events-none"]');
    const ageSecs  = ageToSeconds(ageEl?.textContent?.trim() || '');
    const ageHours = ageSecs / 3600;

    let mc = '';
    for (const container of row.querySelectorAll('div[class*="gap-[4px]"]')) {
      const spans     = [...container.querySelectorAll('span')];
      const labelSpan = spans.find(s => s.textContent.trim() === 'MC');
      if (labelSpan) {
        mc = spans.find(s => s !== labelSpan && s.textContent.trim())?.textContent.trim() || '';
        break;
      }
    }
    if (!mc) {
      const mcLabel = [...row.querySelectorAll('span')].find(s => s.textContent.trim() === 'MC');
      if (mcLabel) {
        let next = mcLabel.nextElementSibling;
        while (next) {
          if (next.textContent.trim() && next.textContent.trim() !== 'MC') { mc = next.textContent.trim(); break; }
          next = next.nextElementSibling;
        }
      }
    }

    return { newBtn, ticker, name, ageHours, marketCap: mcToNumber(mc), isGold, isGreen, match: newBtn._matchPct ?? 0, platform: newBtn._platform || 'other' };
  }

  function sortNormal(tokens, newPair, topRowPlat) {
    const normalize       = s => (s || '').toLowerCase().trim();
    const sameName        = t => normalize(t.name)   === normalize(newPair.name);
    const sameTicker      = t => normalize(t.ticker) === normalize(newPair.ticker);
    const nameTickerMatch = t => sameName(t) && sameTicker(t);
    const nameOnlyMatch   = t => sameName(t) && !sameTicker(t);

    const sortByRecent    = (a, b) => a.ageHours - b.ageHours;
    const sortByOldest    = (a, b) => b.ageHours - a.ageHours;
    const sortByMatchDesc = (a, b) => b.match - a.match;
    const sortByAgeMC     = (a, b) => (a.ageHours !== b.ageHours ? a.ageHours - b.ageHours : b.marketCap - a.marketCap);

    const platFirst = (arr, sortFn) => {
      if (!topRowPlat || topRowPlat === 'other') return [...arr].sort(sortFn);
      return [
        ...[...arr].filter(t => t.platform === topRowPlat).sort(sortFn),
        ...[...arr].filter(t => t.platform !== topRowPlat).sort(sortFn)
      ];
    };

    const special = tokens.filter(t => t.isGold || t.isGreen);
    const blues   = tokens
      .filter(t => !t.isGold && !t.isGreen && (sameName(t) || sameTicker(t)))
      .sort(sortByOldest)
      .slice(0, 3);

    function sortRest(list) {
      const ageDays = t => t.ageHours / 24;
      const tier1   = list.filter(t => ageDays(t) < 7 && t.match > 72);
      const t1High  = platFirst(tier1.filter(t => t.match > 92), sortByRecent);
      const t1Low   = platFirst(tier1.filter(t => t.match <= 92), sortByMatchDesc);
      const tier2   = platFirst(list.filter(t => ageDays(t) >= 7 && t.match > 80), sortByRecent);
      const tier3   = platFirst(list.filter(t => ageDays(t) >= 7 && t.match >= 75 && t.match <= 80), sortByRecent);
      const tier4   = platFirst(list.filter(t => t.match >= 58.21 && t.match < 75), sortByAgeMC);
      const tier5   = platFirst(list.filter(t => t.match < 58.21), sortByAgeMC);
      return [...t1High, ...t1Low, ...tier2, ...tier3, ...tier4, ...tier5];
    }

    let sortedSpecial;
    const hasNameTicker = special.some(nameTickerMatch);
    const hasNameOnly   = !hasNameTicker && special.some(nameOnlyMatch);

    if (hasNameTicker) {
      const nt     = special.filter(nameTickerMatch);
      const ultra  = platFirst(nt.filter(t => t.match > 85), sortByMatchDesc);
      const rest   = platFirst(nt.filter(t => t.match <= 85), sortByRecent);
      const others = special.filter(t => !nameTickerMatch(t));
      sortedSpecial = [...ultra, ...rest, ...sortRest(others)];
    } else if (hasNameOnly) {
      const no     = special.filter(nameOnlyMatch);
      const recent = platFirst(no.filter(t => t.ageHours < 24), sortByRecent);
      const old    = platFirst(no.filter(t => t.ageHours >= 24), sortByMatchDesc);
      const others = special.filter(t => !nameOnlyMatch(t));
      sortedSpecial = [...recent, ...old, ...sortRest(others)];
    } else {
      sortedSpecial = sortRest(special);
    }

    return [...sortedSpecial, ...blues];
  }

  function getNewestBtn() {
    let best = null, bestSecs = Infinity;
    addedBtns.forEach(newBtn => {
      if (newBtn.style.display === 'none') return;
      const originalBtn = newBtn._original;
      if (!originalBtn) return;
      const row   = originalBtn.closest('[class*="max-h-[64px]"]');
      const ageEl = row?.querySelector('span[class*="pointer-events-none"]');
      const secs  = ageToSeconds(ageEl?.textContent?.trim() || '');
      if (secs < bestSecs) { bestSecs = secs; best = newBtn; }
    });
    return best;
  }

  function badgeColor(pct) {
    if (pct === null) return '#888';
    if (pct >= 75)   return '#78ffa0';
    if (pct >= 50)   return '#ffd700';
    return '#ff6b6b';
  }

  function getOrCreateBadge(newBtn) {
    let badge = newBtn.querySelector('.qb-sim-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'qb-sim-badge';
      badge.style.cssText = 'position:absolute;left:-52px;top:-18px;font-size:8px;font-weight:700;font-family:monospace;color:#fff;border-radius:4px;pointer-events:none;white-space:nowrap;z-index:10001;transition:color 0.3s;';
      newBtn.appendChild(badge);
    }
    return badge;
  }

  function updateBadge(newBtn, onDone) {
    const done        = onDone || scheduleUpdate;
    const badge       = getOrCreateBadge(newBtn);
    const originalBtn = newBtn._original;
    if (!originalBtn) { if (onDone) onDone(); return; }
    const row     = originalBtn.closest('[class*="max-h-[64px]"]');
    const coinImg = getRealImage(row);
    if (!coinImg || !coinImg.src) { badge.textContent = '—'; badge.style.color = '#888'; if (onDone) onDone(); return; }
    if (!referenceHash)           { badge.textContent = '…'; badge.style.color = '#888'; if (onDone) onDone(); return; }
    getHash(coinImg.src, (rowHash) => {
      const pct = hashSimilarity(referenceHash, rowHash);
      newBtn._matchPct = pct ?? 0;
      if (pct === null) {
        badge.textContent = '?'; badge.style.color = '#888';
      } else {
        badge.textContent       = pct.toFixed(1) + '%';
        badge.style.color       = badgeColor(pct);
        badge.style.borderColor = badgeColor(pct);
      }
      done();
    });
  }

  function updateAllBadges() {
    const btns = [...addedBtns];
    if (!btns.length) return;
    let pending = btns.length;
    const done = () => { if (--pending <= 0) scheduleUpdate(); };
    btns.forEach(btn => updateBadge(btn, done));
  }

  function getTokenName(originalBtn) {
    const row = originalBtn.closest('[class*="max-h-[64px]"]');
    if (!row) return '';
    const truncateDivs = row.querySelectorAll('div[class*="min-w-0"][class*="truncate"][class*="whitespace-nowrap"]');
    return truncateDivs[1]?.textContent?.trim() || truncateDivs[0]?.textContent?.trim() || '';
  }

  function getSearchQuery() {
    const panel = [...document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]')]
      .find(el => isSearchPanel(el));
    return panel?.querySelector('input')?.value?.trim().toLowerCase() || '';
  }

  function getOrCreateNameLabel(newBtn) {
    let label = newBtn.querySelector('.qb-name-label');
    if (!label) {
      label = document.createElement('div');
      label.className = 'qb-name-label';
      label.style.cssText = 'position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:2px;text-align:center;font-size:10px;font-weight:600;font-family:monospace;color:#ccc;background:rgba(0,0,0,0.65);border-radius:4px;padding:1px 4px;pointer-events:none;white-space:nowrap;z-index:10001;';
      newBtn.appendChild(label);
    }
    return label;
  }

  function updateNameLabel(newBtn) {
    const originalBtn = newBtn._original;
    if (!originalBtn) return;
    const name  = getTokenName(originalBtn);
    const label = getOrCreateNameLabel(newBtn);
    label.textContent = name;
    const query = getSearchQuery();
    if (query && name.toLowerCase().includes(query)) {
      label.style.color = '#ffd700'; label.style.fontWeight = '800';
    } else {
      label.style.color = '#ccc'; label.style.fontWeight = '600';
    }
  }

  function getTokenInfo(originalBtn) {
    const row = originalBtn.closest('[class*="max-h-[64px]"]');
    if (!row) return { age: '', mc: '' };
    const ageEl = row.querySelector('span[class*="pointer-events-none"]');
    const age   = ageEl?.textContent?.trim() || '';
    let mc = '';
    for (const container of row.querySelectorAll('div[class*="gap-[4px]"]')) {
      const spans     = [...container.querySelectorAll('span')];
      const labelSpan = spans.find(s => s.textContent.trim() === 'MC');
      if (labelSpan) {
        mc = spans.find(s => s !== labelSpan && s.textContent.trim())?.textContent.trim() || '';
        break;
      }
    }
    if (!mc) {
      const mcLabel = [...row.querySelectorAll('span')].find(s => s.textContent.trim() === 'MC');
      if (mcLabel) {
        let next = mcLabel.nextElementSibling;
        while (next) {
          if (next.textContent.trim() && next.textContent.trim() !== 'MC') { mc = next.textContent.trim(); break; }
          next = next.nextElementSibling;
        }
      }
    }
    return { age, mc };
  }

  function getOrCreateInfoBar(newBtn) {
    let bar = newBtn.querySelector('.qb-info-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'qb-info-bar';
      bar.style.cssText = 'position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:2px;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:4px;font-size:13px;font-weight:700;font-family:monospace;pointer-events:none;white-space:nowrap;z-index:10001;';
      newBtn.appendChild(bar);
    }
    return bar;
  }

  function updateInfoBar(newBtn) {
    const originalBtn = newBtn._original;
    if (!originalBtn) return;
    const { age, mc } = getTokenInfo(originalBtn);
    const bar = getOrCreateInfoBar(newBtn);
    bar.innerHTML = '';
    if (age) {
      const isNewest = (getNewestBtn() === newBtn);
      const ageSpan  = document.createElement('span');
      ageSpan.textContent = age;
      ageSpan.style.cssText = isNewest
        ? 'color:#ffd700;background:rgba(0,0,0,0.7);border-radius:4px;padding:1px 5px;box-shadow:0 0 6px 2px #ffd700,0 0 12px 4px rgba(255,215,0,0.4);text-shadow:0 0 6px #ffd700;'
        : 'color:#78ffa0;background:rgba(0,0,0,0.7);border-radius:4px;padding:1px 5px;';
      bar.appendChild(ageSpan);
    }
    if (mc) {
      const mcSpan = document.createElement('span');
      mcSpan.textContent = 'MC ' + mc;
      mcSpan.style.cssText = `color:${mcToNumber(mc) > 10000 ? '#ff4444' : '#5bb8ff'};background:rgba(0,0,0,0.7);border-radius:4px;padding:1px 5px;`;
      bar.appendChild(mcSpan);
    }
  }

  function navigateToMeme(row, fallbackCA) {
    const link = row?.querySelector('a[href*="/meme/"]');
    if (link) {
      const url = new URL(link.href);
      history.pushState({}, '', url.pathname + url.search);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    if (fallbackCA) {
      history.pushState({}, '', `/meme/${fallbackCA}?chain=sol`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }

  function fireClick(el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(ev => {
      el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    });
  }

  function removeButtons() {
    addedBtns.forEach(btn => {
      if (btn._original) delete btn._original.dataset.qbAdded;
      btn.remove();
    });
    addedBtns.length = 0;
    gradProxyAnchor = null;
    removeGradProxyBtns();
  }

  function removeGradProxyBtns() {
    gradProxyBtns.forEach(btn => btn.remove());
    gradProxyBtns.length = 0;
  }

  function captureAnchorPosition() {
    const visible = addedBtns.filter(b => b.style.display !== 'none')
      .slice().sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
    if (!visible.length) return null;
    const r = visible[0].getBoundingClientRect();
    const rowEl = visible[0]._original?.closest('[class*="max-h-[64px]"]');
    return {
      top0:      parseFloat(visible[0].style.top),
      left:      parseFloat(visible[0].style.left),
      btnW:      r.width  || 48,
      btnH:      r.height || 48,
      rowHeight: rowEl?.getBoundingClientRect().height ||
                 (visible.length > 1 ? Math.abs(parseFloat(visible[1].style.top) - parseFloat(visible[0].style.top)) : 64),
      startSlot: visible.length,
      refSource: visible[0]._original,
    };
  }

  function renderGradProxies() {
    removeGradProxyBtns();
    if (!gradCandidates.length) return;

    let top0, leftPos, btnW, btnH, rowHeight, startSlot, refSource;

    const anchor = gradProxyAnchor;
    if (anchor) {
      top0      = anchor.top0;
      leftPos   = anchor.left;
      btnW      = anchor.btnW;
      btnH      = anchor.btnH;
      rowHeight = anchor.rowHeight;
      startSlot = anchor.startSlot;
      refSource = anchor.refSource;
      if (isNaN(top0) || isNaN(leftPos)) return;
    } else {
      const visible = addedBtns.filter(b => b.style.display !== 'none')
        .slice().sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
      if (visible.length) {
        top0      = parseFloat(visible[0].style.top);
        leftPos   = parseFloat(visible[0].style.left);
        if (isNaN(top0) || isNaN(leftPos)) return;
        const r   = visible[0].getBoundingClientRect();
        btnW      = r.width  || 48;
        btnH      = r.height || 48;
        const rowEl = visible[0]._original?.closest('[class*="max-h-[64px]"]');
        rowHeight = rowEl?.getBoundingClientRect().height ||
                    (visible.length > 1 ? Math.abs(parseFloat(visible[1].style.top) - top0) : 64);
        startSlot = visible.length;
        refSource = visible[0]._original;
      } else {
        const firstPanelBtn = lastPanel?.querySelector('[class*="group/quickBuyButton"]');
        if (!firstPanelBtn) return;
        const r = firstPanelBtn.getBoundingClientRect();
        if (!r.width) return;
        top0      = r.top;
        leftPos   = r.left - 621.5;
        btnW      = r.width  || 48;
        btnH      = r.height || 48;
        rowHeight = 64;
        startSlot = 0;
        refSource = firstPanelBtn;
      }
    }

    const normalMemeIds = new Set(addedBtns.filter(b => b.style.display !== 'none').map(b => b._ca).filter(Boolean));

    const _eligible  = gradCandidates.filter(t => !t.ca || !normalMemeIds.has(t.ca));
    const _raydium   = _eligible.filter(t => t.platform === 'raydium' && t.match > 70).slice(0, 2);
    const _others    = _eligible.filter(t => t.platform !== 'raydium');
    [..._raydium, ..._others].slice(0, 3).forEach((token, i) => {
      const btn = refSource ? refSource.cloneNode(true) : document.createElement('button');
      delete btn.dataset.qbAdded;
      const isPumpMigrated = token.platform === 'pump' && token.isMigrated;
      const isPumpDex      = token.platform === 'pump' && token.hasDex;
      const platColor = token.platform === 'bonk'   ? '#ff8c00'
                      : token.platform === 'raydium' ? '#0033FF'
                      : isPumpMigrated               ? '#ffd700'
                      : isPumpDex                    ? '#78ffa0'
                      : '';
      const platGlow  = token.platform === 'bonk'
                      ? '0 0 10px 3px rgba(255,140,0,0.6), 0 0 20px 6px rgba(255,140,0,0.3)'
                      : token.platform === 'raydium'
                      ? '0 0 10px 3px rgba(0,51,255,0.7), 0 0 20px 6px rgba(0,51,255,0.35)'
                      : isPumpMigrated || isPumpDex
                      ? '0 0 10px 3px rgba(120,255,160,0.7), 0 0 20px 6px rgba(120,255,160,0.3)'
                      : '';
      btn.style.position  = 'fixed';
      btn.style.zIndex    = '9999';
      btn.style.overflow  = 'visible';
      btn.style.width     = btnW + 'px';
      btn.style.height    = btnH + 'px';
      btn.style.left      = leftPos + 'px';
      btn.style.top       = (top0 + (startSlot + i) * rowHeight) + 'px';
      btn.style.cursor    = 'pointer';
      btn.style.outline   = platColor ? `2px solid ${platColor}` : '';
      if (isPumpMigrated)               btn.style.setProperty('background', 'rgba(255,215,0,0.85)',  'important');
      else if (isPumpDex)               btn.style.setProperty('background', 'rgba(120,255,160,0.85)','important');
      if (token.platform === 'bonk')    btn.style.setProperty('background', 'rgba(255,140,0,0.85)', 'important');
      if (token.platform === 'raydium') btn.style.setProperty('background', 'rgba(0,51,255,0.85)',   'important');
      btn.style.boxShadow = platGlow;
      btn._isGradProxy = true;
      btn._gradToken   = token;

      if (token.imgSrc) {
        const img = document.createElement('img');
        img.src = token.imgSrc;
        img.className = 'qb-coin-img';
        img.style.cssText = 'width:60px;height:60px;border-radius:50%;object-fit:cover;flex-shrink:0;position:absolute;left:-66px;top:50%;transform:translateY(-50%);pointer-events:auto;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
        img.addEventListener('click', e => {
          e.stopPropagation(); e.preventDefault();
          if (token.ca) {
            const feedRows = document.querySelectorAll('[class*="group/pulseRow"]');
            let memeRow = null;
            for (const r of feedRows) {
              if (r.querySelector(`a[href*="${token.ca}"]`)) { memeRow = r; break; }
            }
            navigateToMeme(memeRow, token.ca);
          }
        });
        btn.appendChild(img);
      }

      const col = badgeColor(token.match);
      const badge = document.createElement('span');
      badge.className = 'qb-sim-badge';
      badge.textContent = token.match.toFixed(1) + '%';
      badge.style.cssText = `position:absolute;left:-52px;top:-18px;font-size:8px;font-weight:700;font-family:monospace;color:${col};border-radius:4px;pointer-events:none;white-space:nowrap;z-index:10001;`;
      btn.appendChild(badge);

      const label = document.createElement('div');
      label.className = 'qb-name-label';
      label.textContent = token.name || token.ticker;
      label.style.cssText = 'position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:2px;font-size:10px;font-weight:600;font-family:monospace;color:#aaf;background:rgba(0,0,0,0.65);border-radius:4px;padding:1px 4px;pointer-events:none;white-space:nowrap;z-index:10001;';
      btn.appendChild(label);

      if (token.age || token.mc) {
        const bar = document.createElement('div');
        bar.style.cssText = 'position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:2px;display:flex;flex-direction:row;gap:4px;font-size:13px;font-weight:700;font-family:monospace;pointer-events:none;white-space:nowrap;z-index:10001;';
        if (token.age) {
          const ageSpan = document.createElement('span');
          ageSpan.textContent = token.age;
          ageSpan.style.cssText = 'color:#78ffa0;background:rgba(0,0,0,0.7);border-radius:4px;padding:1px 5px;';
          bar.appendChild(ageSpan);
        }
        if (token.mc) {
          const mcSpan = document.createElement('span');
          mcSpan.textContent = 'MC ' + token.mc;
          mcSpan.style.cssText = 'color:#5bb8ff;background:rgba(0,0,0,0.7);border-radius:4px;padding:1px 5px;';
          bar.appendChild(mcSpan);
        }
        btn.appendChild(bar);
      }

      btn.addEventListener('click', e => {
        e.stopPropagation(); e.preventDefault();
        gradChannel.postMessage({ type: 'EXECUTE_BUY_GRAD', ticker: token.ticker, name: token.name, ca: token.ca });
      });

      document.body.appendChild(btn);
      gradProxyBtns.push(btn);
    });
  }

  function shouldShowButton(originalBtn) {
    const bgColor   = originalBtn.style.background || '';
    const isSpecial = bgColor.includes('255, 215, 0') || bgColor.includes('120, 255, 160');
    if (isSpecial) return true;
    return !!(lastPanel && lastPanel.isConnected && isPanelVisible);
  }

  function getCoinImage(originalBtn) {
    return getRealImage(originalBtn.closest('[class*="max-h-[64px]"]'));
  }

  let lastTopSrc = null;
  function checkTopPulseReference() {
    const topImg = getTopPulseRowImage();
    if (!topImg?.src || topImg.src === lastTopSrc) return;
    lastTopSrc = topImg.src;
    if (topImg.complete && topImg.naturalWidth > 0) {
      try {
        const hash = computeHash(topImg);
        hashCache.set(topImg.src, hash);
        referenceSource = topImg.src;
        referenceHash   = hash;
        updateAllBadges();
        scheduleUpdate();
        return;
      } catch(e) {}
    }
    setReference(topImg.src);
  }

  let clickSearchCheckTimeout = null;
  function checkClickSearchReference() {
    if (!window.axiomUserOpen) return;
    const panel = [...document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]')]
      .find(el => isSearchPanel(el));
    if (!panel) return;
    if (clickSearchCheckTimeout) clearTimeout(clickSearchCheckTimeout);
    clickSearchCheckTimeout = setTimeout(() => {
      const query = panel.querySelector('input')?.value?.trim().toLowerCase();
      if (!query) return;
      for (const row of document.querySelectorAll('[class*="group/pulseRow"]')) {
        const tickerEl = row.querySelector('div[class*="min-w-0"][class*="truncate"][class*="text-[16px]"]');
        const nameEl   = row.querySelector('div[class*="min-w-0"][class*="flex-1"][class*="overflow-hidden"]');
        if (tickerEl?.textContent.trim().toLowerCase().includes(query) ||
            nameEl?.textContent.trim().toLowerCase().includes(query)) {
          const realImg = getRealImage(row);
          if (realImg?.src) { setReference(realImg.src); break; }
        }
      }
    }, 50);
  }

  // ======= POSITION & LAYOUT =======

  function updatePositions() {
    const newPair = getNewPair();
    const visible = [];

    addedBtns.forEach(newBtn => {
      const originalBtn = newBtn._original;
      if (!originalBtn) return;
      const rect = originalBtn.getBoundingClientRect();
      if (rect.top < 50 || rect.bottom > window.innerHeight + 200 || !shouldShowButton(originalBtn)) {
        newBtn.style.display = 'none';
        return;
      }
      const data = getTokenData(newBtn);
      if (data) visible.push({ newBtn, originalBtn, rect, data });
    });

    const normalCandidates = visible;

    let sortedNormal = normalCandidates;
    if (newPair && normalCandidates.length > 0) {
      const datas     = normalCandidates.map(v => v.data);
      const sorted    = sortNormal(datas, newPair, getTopRowPlatform());
      sortedNormal    = sorted.map(d => normalCandidates.find(v => v.newBtn === d.newBtn)).filter(Boolean);
      sortedNormal = sortedNormal.slice(0, 5);
      const sortedSet = new Set(sortedNormal.map(v => v.newBtn));
      normalCandidates.forEach(({ newBtn }) => { if (!sortedSet.has(newBtn)) newBtn.style.display = 'none'; });
    } else {
      sortedNormal = sortedNormal.slice(0, 5);
    }

    if (sortedNormal.length === 0) return;

    const firstPanelBtn = lastPanel?.querySelector('[class*="group/quickBuyButton"]');
    const slot1Top  = firstPanelBtn?.getBoundingClientRect().top ?? Math.min(...sortedNormal.map(v => v.rect.top));
    const rowEl     = sortedNormal[0].originalBtn?.closest('[class*="max-h-[64px]"]');
    const rowHeight = rowEl?.getBoundingClientRect().height ||
                      (sortedNormal.length > 1 ? Math.abs(sortedNormal[1].rect.top - sortedNormal[0].rect.top) : 64);
    const leftPos   = sortedNormal[0].rect.left - 621.5;

    sortedNormal.forEach(({ newBtn, originalBtn }, i) => {
      newBtn.style.left    = leftPos + 'px';
      newBtn.style.top     = (slot1Top + i * rowHeight) + 'px';
      newBtn.style.display = '';
      newBtn.style.opacity = '1';
      if (newBtn._platform === 'raydium') {
        newBtn.style.setProperty('background', 'rgba(0,51,255,0.85)', 'important');
        newBtn.style.setProperty('outline', '2px solid #0033FF', 'important');
        newBtn.style.boxShadow = '0 0 10px 3px rgba(0,51,255,0.7), 0 0 20px 6px rgba(0,51,255,0.35)';
      } else if (newBtn._platform === 'bonk') {
        newBtn.style.setProperty('background', 'rgba(255,140,0,0.85)', 'important');
        newBtn.style.setProperty('outline', '2px solid #ff8c00', 'important');
        newBtn.style.boxShadow = '0 0 10px 3px rgba(255,140,0,0.6), 0 0 20px 6px rgba(255,140,0,0.3)';
      } else {
        newBtn.style.setProperty('outline', 'none', 'important');
        newBtn.style.boxShadow = '';
      }
      const coinImg = getCoinImage(originalBtn);
      const imgEl   = newBtn.querySelector('img.qb-coin-img');
      if (coinImg && imgEl && imgEl.src !== coinImg.src) { imgEl.src = coinImg.src; updateBadge(newBtn); }
      updateInfoBar(newBtn);
      updateNameLabel(newBtn);
    });

    renderGradProxies();
  }

  function scheduleUpdate() {
    if (updateTimeout) return;
    updateTimeout = setTimeout(() => { updatePositions(); updateTimeout = null; }, 16);
  }

  function isSearchPanel(el) {
    if (el.closest('[data-rht-toaster]')) return false;
    if (el.className.toString().includes('animate-enter-bottom')) return false;
    if (el.querySelector('input, [class*="History"], [class*="Results"]')) return true;
    if (el.querySelector('[class*="group/quickBuyButton"]')) return true;
    return false;
  }

  function expandPanel(panel) {
    if (panel.dataset.expanded) return;
    panel.dataset.expanded = 'true';
    panel.style.setProperty('max-height', '90vh', 'important');
    panel.style.setProperty('height', '90vh', 'important');
    const wrapper = panel.parentElement;
    if (wrapper) {
      const current = wrapper.style.transform;
      const match   = current.match(/translate\((.+)px,\s*(.+)px\)/);
      if (match) {
        wrapper.style.transform = `translate(${parseFloat(match[1])}px, ${parseFloat(match[2]) + 50}px)`;
      } else {
        wrapper.style.marginTop = '50px';
      }
    }
  }

  function checkPanelState(panel) {
    if (!panel) { isPanelVisible = false; hasActiveSearch = false; return; }
    const zIndex     = panel.parentElement?.style.zIndex;
    const wasVisible = isPanelVisible;
    const hadSearch  = hasActiveSearch;
    isPanelVisible   = (!zIndex || zIndex !== '-9999');
    hasActiveSearch  = (panel.querySelector('input')?.value?.trim() || '').length > 0;
    if (wasVisible !== isPanelVisible || hadSearch !== hasActiveSearch) scheduleUpdate();
  }

  document.addEventListener('click', (e) => {
    const qbImg = e.target.closest('img.qb-coin-img');
    if (qbImg) {
      const parentBtn = addedBtns.find(b => b.contains(qbImg));
      if (parentBtn?._original) {
        const row = parentBtn._original.closest('[class*="max-h-[64px]"]');
        navigateToMeme(row, parentBtn._ca);
      }
      return;
    }

    let clickedImg = e.target.closest('img[class*="object-cover"]');
    if (!clickedImg) {
      const imgWrapper = e.target.closest('[class*="h-[72px]"][class*="w-[72px]"]');
      if (imgWrapper) {
        clickedImg = Array.from(imgWrapper.querySelectorAll('img[class*="object-cover"]'))
          .find(img => !img.src.startsWith('data:') && img.src) || null;
      }
    }
    if (!clickedImg?.src || clickedImg.src.startsWith('data:')) return;
    const panel = [...document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]')]
      .find(el => isSearchPanel(el));
    if (panel && panel.contains(clickedImg)) return;
    setReference(clickedImg.src);
  }, true);

  window.addEventListener('axiomPrefetchStart', () => {
    console.log(`[T1-GRAD] axiomPrefetchStart — limpiando gradCandidates, __gradSeq actual=${window.__gradSeq ?? 'undefined'}`);
    gradCandidates = [];
    gradProxyAnchor = null;
    removeGradProxyBtns();
  });

  gradChannel.onmessage = (e) => {
    if (e.data.type !== 'GRAD_DATA') return;
    const rxSeq = e.data.seq;
    const curSeq = window.__gradSeq;
    const newTokens = e.data.tokens || [];
    console.log(`[T1-GRAD] GRAD_DATA recibido | rxSeq=${rxSeq} curSeq=${curSeq} tokens=${newTokens.length} top=${newTokens.slice(0,2).map(t=>t.ticker+'@'+Math.round((t.match||0)*100)+'%').join(', ')}`);
    if (rxSeq !== undefined && rxSeq !== curSeq) {
      console.log(`[T1-GRAD] RECHAZADO — seq mismatch (rxSeq=${rxSeq} !== curSeq=${curSeq})`);
      return;
    }
    if (newTokens.length === 0 && gradCandidates.length > 0) {
      console.log(`[T1-GRAD] IGNORADO — broadcast vacío pero ya tenemos ${gradCandidates.length} candidates`);
      return;
    }
    gradCandidates = newTokens;
    gradProxyAnchor = captureAnchorPosition();
    console.log(`[T1-GRAD] ACEPTADO | gradCandidates=${gradCandidates.length} | anchor=${gradProxyAnchor ? 'OK' : 'null'} | llamando renderGradProxies`);
    scheduleUpdate();
    setTimeout(renderGradProxies, 30); // fallback if updatePositions returns early
  };

  function addButtons() {
    const candidates = document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
    const panel      = [...candidates].find(el => isSearchPanel(el));

    if (!panel) {
      removeButtons();
      if (scrollEl) { scrollEl.removeEventListener('scroll', updatePositions); scrollEl = null; }
      lastPanel = null; isPanelVisible = false; hasActiveSearch = false;
      localStorage.removeItem('search-only-bonded');
      return;
    }

    checkPanelState(panel);

    const panelRect = panel.getBoundingClientRect();
    if (panelRect.left < 0 || panelRect.top < 0 || panelRect.width < 100) return;

    const panelInput = panel.querySelector('input');
    if (!panelInput || !panelInput.value.trim()) return;

    if (panel !== lastPanel) {
      removeButtons();
      if (scrollEl) { scrollEl.removeEventListener('scroll', updatePositions); scrollEl = null; }
      lastPanel = panel;
      expandPanel(panel);
      scrollEl = [...panel.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight) || panel;
      scrollEl.addEventListener('scroll', updatePositions);
    }

    for (let i = addedBtns.length - 1; i >= 0; i--) {
      if (!panel.contains(addedBtns[i]._original)) { addedBtns[i].remove(); addedBtns.splice(i, 1); }
    }

    const btns = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')];
    const toAdd = btns.filter(btn => !btn.dataset.qbAdded);

    // Phase 1: read all rects + build buttons (no appendChild yet — one reflow total)
    const prepared = toAdd.map(originalBtn => {
      originalBtn.dataset.qbAdded = 'true';
      const rect    = originalBtn.getBoundingClientRect();
      const coinImg = getCoinImage(originalBtn);

      const newBtn = originalBtn.cloneNode(true);
      newBtn._original = originalBtn;
      newBtn._matchPct = null;
      let _cacheRow = null;
      let el = originalBtn.parentElement;
      for (let i = 0; i < 6; i++) {
        if (el?.className?.includes('max-h-[64px]')) { _cacheRow = el; break; }
        el = el?.parentElement;
      }
      const _cacheDivs = _cacheRow ? _cacheRow.querySelectorAll('div[class*="min-w-0"][class*="truncate"][class*="whitespace-nowrap"]') : [];
      newBtn._ticker = _cacheDivs[0]?.textContent.trim() || '';
      newBtn._name   = _cacheDivs[1]?.textContent.trim() || _cacheDivs[0]?.textContent.trim() || '';
      let _ca = '';
      if (_cacheRow) {
        for (const a of _cacheRow.querySelectorAll('a[href]')) {
          const h = a.href;
          if (h.includes('pump.fun')) { const m = h.match(/\/coin\/([A-Za-z0-9]{32,})/); if (m) { _ca = m[1]; break; } }
          else if (h.includes('bonk'))  { const m = h.match(/\/([A-Za-z0-9]{32,})/);      if (m) { _ca = m[1]; break; } }
          else if (h.includes('/meme/')) { const m = h.match(/\/meme\/([A-Za-z0-9]{32,})/); if (m) _ca = m[1]; }
        }
      }
      newBtn._ca = _ca;
      newBtn._platform = _cacheRow
        ? (_cacheRow.querySelector('img[src*="bonk"]') ? 'bonk'
          : _cacheRow.querySelector('img[src*="pump-grad.svg"][alt="Raydium V4"]') ? 'raydium'
          : _cacheRow.querySelector('img[src*="pump"]') ? 'pump'
          : 'other')
        : 'other';
      newBtn._hasDex     = _cacheRow ? !!_cacheRow.querySelector('[class*="icon-dex-paid"]') : false;
      newBtn._isMigrated = _cacheRow ? !!_cacheRow.querySelector('img[src*="-grad"]') : false;
      newBtn.style.cssText  = originalBtn.style.cssText;
      newBtn.style.position = 'fixed';
      newBtn.style.zIndex   = '9999';
      newBtn.style.overflow = 'visible';
      newBtn.style.left     = (rect.left - 621.5) + 'px';
      newBtn.style.top      = rect.top + 'px';
      newBtn.style.display  = 'none';

      if (coinImg) {
        const imgEl = document.createElement('img');
        imgEl.src = coinImg.src;
        imgEl.className = 'qb-coin-img';
        imgEl.style.cssText = 'width:60px;height:60px;border-radius:50%;object-fit:cover;flex-shrink:0;position:absolute;left:-66px;top:50%;transform:translateY(-50%);pointer-events:auto;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
        newBtn.appendChild(imgEl);
      }

      if (referenceHash && coinImg && coinImg.complete && coinImg.naturalWidth > 0) {
        try {
          const hash = computeHash(coinImg);
          hashCache.set(coinImg.src, hash);
          newBtn._matchPct = hashSimilarity(referenceHash, hash) ?? 0;
        } catch(e) {}
      }

      return { originalBtn, newBtn, coinImg };
    });

    // Phase 2: batch append + wire up (no more layout reads after this)
    let pendingBadges = prepared.length;
    const onBadgeDone = () => { if (--pendingBadges <= 0) scheduleUpdate(); };

    prepared.forEach(({ originalBtn, newBtn, coinImg }) => {
      const colorSync = new MutationObserver(() => {
        newBtn.style.background = originalBtn.style.background;
        newBtn.style.color      = originalBtn.style.color;
        scheduleUpdate();
      });
      colorSync.observe(originalBtn, { attributes: true, attributeFilter: ['style'] });

      document.body.appendChild(newBtn);
      addedBtns.push(newBtn);

      newBtn.addEventListener('click', e => {
        e.stopPropagation(); e.preventDefault();
        if (e.target.closest('img.qb-coin-img')) {
          const row = originalBtn.closest('[class*="max-h-[64px]"]');
          navigateToMeme(row, newBtn._ca);
          return;
        }
        fireClick(originalBtn);
      });

      updateBadge(newBtn, onBadgeDone);
      updateInfoBar(newBtn);
      updateNameLabel(newBtn);
    });

    if (prepared.length > 0) updatePositions();
  }

  let lastTopRowKey = '';
  const observer = new MutationObserver(() => {
    const topRow = document.querySelector('[class*="group/pulseRow"]');
    if (topRow) {
      const key = topRow.querySelector('div[role="button"]')?.textContent?.trim() || '';
      if (key && key !== lastTopRowKey) {
        lastTopRowKey = key;
        gradCandidates = [];
        removeGradProxyBtns();
      }
    }
    checkClickSearchReference();
    checkTopPulseReference();
    addButtons();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(() => { checkTopPulseReference(); }, 500);

  console.log('🚀 Axiom QBuy v10.3 — Raydium V4 blue background + glow');
})();

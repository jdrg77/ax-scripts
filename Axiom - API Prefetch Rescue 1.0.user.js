// ==UserScript==
// @name         Axiom - API Prefetch Rescue
// @namespace    http://tampermonkey.net/
// @version      1.5
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20API%20Prefetch%20Rescue%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20API%20Prefetch%20Rescue%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') === 'grad') return;

  const HASH_SIZE = 32;
  const HASH_BITS = 8;
  const CACHE_MAX = 300;
  const hashCache = new Map();

  // === DCT hash ===

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

  // === Top row helpers ===

  function getTopRowImgSrc() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    if (!rows.length) return null;
    return Array.from(rows[0].querySelectorAll('img[class*="object-cover"]'))
      .find(img => img.src && !img.src.startsWith('data:'))?.src || null;
  }

  function getTopRowTokenCA() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    if (!rows.length) return null;
    const row = rows[0];
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

  function isPlaceholderImg(src) {
    if (!src) return true;
    return src.includes('/pfps/') || src.includes('axiom-assets');
  }

  // === API ===

  async function searchTokenAPI(query, onlyBonded = false) {
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
          onlyDexPaid: false,
          v: Date.now(),
        }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  // === Rescue ===

  async function rescueViaAPI({ name, refImgSrc, rowCA, graduated }) {
    if (isPlaceholderImg(refImgSrc)) {
      console.log('[Rescue] ⏭️ Placeholder img, cancelado para:', name);
      return;
    }
    console.log('[Rescue] 🚨 Iniciando:', name, '| rowCA:', rowCA?.slice(0, 8), '| graduated:', graduated);

    const [results, refHash] = await Promise.all([
      searchTokenAPI(name, graduated || false),
      new Promise(resolve => getHash(refImgSrc, resolve)),
    ]);

    if (!results || !results.length) {
      console.log('[Rescue] ❌ Sin resultados para:', name);
      return;
    }
    if (!refHash) {
      console.log('[Rescue] ❌ Sin refHash para:', name);
      return;
    }

    let best = null, bestPct = -1;

    await Promise.race([
      new Promise(resolve => {
        let pending = results.length;
        results.forEach(token => {
          const imgSrc = `https://axiomtrading.axiom-cdn.io/${token.tokenAddress}.webp`;
          getHash(imgSrc, hash => {
            const pct = hashSimilarity(refHash, hash);
            if (pct > bestPct) { bestPct = pct; best = token; }
            if (--pending === 0) resolve();
          });
        });
      }),
      new Promise(resolve => setTimeout(resolve, 8000)),
    ]);

    if (!best) {
      console.log('[Rescue] ❌ No best match para:', name);
      return;
    }

    console.log(`[Rescue] ✅ ${best.tokenTicker} ${bestPct}% | pair: ${best.pairAddress}`);

    window.dispatchEvent(new CustomEvent('axiomAPIResult', {
      detail: {
        rowCA:         best.tokenAddress,
        ca:            best.tokenAddress,
        pairAddress:   best.pairAddress,
        ticker:        best.tokenTicker || '',
        name:          best.tokenName   || '',
        imgSrc:        `https://axiomtrading.axiom-cdn.io/${best.tokenAddress}.webp`,
        matchPct:      bestPct,
        _rescuedRowCA: rowCA,
      },
    }));
  }

  // === Trigger ===

  window.addEventListener('axiomPrefetchFailed', (e) => {
    const name      = e.detail?.name;
    const refImgSrc = e.detail?.refImgSrc || getTopRowImgSrc();
    const rowCA     = e.detail?.rowCA     || getTopRowTokenCA() || localStorage.getItem('axiomNewPairCA') || '';
    const graduated = e.detail?.graduated || false;
    if (!name) return;
    rescueViaAPI({ name, refImgSrc, rowCA, graduated });
  });

  console.log('🚨 Axiom API Prefetch Rescue v1.3 loaded');

  window.__rescue__ = {
    rescueViaAPI, searchTokenAPI, getHash, hashSimilarity,
    getTopRowImgSrc, getTopRowTokenCA, hashCache,
    getState: () => currentAnalysis,
  };

})();

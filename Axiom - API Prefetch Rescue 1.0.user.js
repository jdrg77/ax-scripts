// ==UserScript==
// @name         Axiom - API Prefetch Rescue
// @namespace    http://tampermonkey.net/
// @version      1.0
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
  const hashCache = new Map();

  // === Hash (mismo algoritmo que QBuy 17.221) ===

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
      try { const hash = computeHash(img); hashCache.set(src, hash); cb(hash); }
      catch (e) { cb(null); }
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

  // === Top row image ===

  function getTopRowImgSrc() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    if (!rows.length) return null;
    return Array.from(rows[0].querySelectorAll('img[class*="object-cover"]'))
      .find(img => img.src && !img.src.startsWith('data:'))?.src || null;
  }

  // === API ===

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
          v: Date.now(),
        }),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  }

  // === Rescue ===

  async function rescueViaAPI({ name, refImgSrc, rowCA }) {
    console.log('🚨 API Rescue:', name, '| rowCA:', rowCA);

    const [results, refHash] = await Promise.all([
      searchTokenAPI(name),
      new Promise(resolve => getHash(refImgSrc, resolve)),
    ]);

    if (!results?.length || !refHash) {
      console.log('❌ API Rescue: sin resultados o sin refHash para', name);
      return;
    }

    let best = null, bestPct = -1;
    await new Promise(resolve => {
      let pending = results.length;
      results.forEach(token => {
        const imgSrc = `https://axiomtrading.axiom-cdn.io/${token.tokenAddress}.webp`;
        getHash(imgSrc, hash => {
          const pct = hashSimilarity(refHash, hash);
          if (pct > bestPct) { bestPct = pct; best = token; }
          if (--pending === 0) resolve();
        });
      });
    });

    if (!best) return;
    console.log(`✅ API Rescue: ${best.tokenTicker} ${bestPct}% | pair: ${best.pairAddress}`);

    window.dispatchEvent(new CustomEvent('axiomAPIResult', {
      detail: {
        rowCA,
        ca:          best.tokenAddress,
        pairAddress: best.pairAddress,
        ticker:      best.tokenTicker || '',
        name:        best.tokenName  || '',
        imgSrc:      `https://axiomtrading.axiom-cdn.io/${best.tokenAddress}.webp`,
        matchPct:    bestPct,
      },
    }));
  }

  // === Tracking ===

  let currentAnalysis = null;

  window.addEventListener('axiomPrefetchStart', (e) => {
    const newName = e.detail?.name;
    if (!newName) return;

    if (currentAnalysis && currentAnalysis.name !== newName) {
      rescueViaAPI(currentAnalysis);
    }

    currentAnalysis = {
      name:      newName,
      refImgSrc: getTopRowImgSrc(),
      rowCA:     localStorage.getItem('axiomNewPairCA') || '',
    };
  });

  console.log('🚨 Axiom API Prefetch Rescue v1.0 loaded');
})();

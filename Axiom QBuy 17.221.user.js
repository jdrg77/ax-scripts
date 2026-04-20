// ==UserScript==
// @name         Axiom QBuy 17.221
// @namespace    http://tampermonkey.net/
// @version      7.4
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%2017.221.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20QBuy%2017.221.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SAMPLE_SIZE = 32;
  const addedBtns     = [];
  const gradProxyBtns = [];
  let scrollEl        = null;
  let lastPanel       = null;
  let isPanelVisible  = false;
  let hasActiveSearch = false;
  let updateTimeout   = null;
  let referencePixels = null;
  let referenceSource = null;

  let frozen          = false;
  let clickQueue      = null;
  let freezeTimer     = null;
  let isScanning        = false;
  let inGraduatedView   = false;
  let scanDebounceTimer = null;
  let referenceLocked = false;

  function freezeButtons() {
    frozen = true;
    clickQueue = null;
    if (freezeTimer) clearTimeout(freezeTimer);
    // Safety net: unfreeze after 3s if scan never completes
    freezeTimer = setTimeout(() => { frozen = false; isScanning = false; flushQueue(); }, 3000);
  }

  function flushQueue() {
    frozen = false;
    if (!clickQueue) return;
    const queued = clickQueue;
    clickQueue = null;
    const orig = queued._original;
    if (orig && orig.isConnected) {
      fireClick(orig);
    } else if (lastPanel && (queued._ticker || queued._name)) {
      // Original DOM element gone after panel re-render — re-find by cached ticker/name
      for (const btn of lastPanel.querySelectorAll('[class*="group/quickBuyButton"]')) {
        const row = btn.closest('[class*="max-h-[64px]"]');
        if (!row) continue;
        const divs = row.querySelectorAll('div[class*="min-w-0"][class*="truncate"][class*="whitespace-nowrap"]');
        const t = divs[0]?.textContent.trim() || '';
        const n = divs[1]?.textContent.trim() || divs[0]?.textContent.trim() || '';
        if ((queued._ticker && t === queued._ticker) || (queued._name && n === queued._name)) {
          fireClick(btn); break;
        }
      }
    }
  }

  function getPixels(src, cb) {
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) return cb(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const raw = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
        // Blank/all-black pixels = CORS-failed canvas or placeholder → treat as null
        let totalLum = 0;
        for (let i = 0; i < raw.length; i += 4)
          totalLum += raw[i] * 0.299 + raw[i+1] * 0.587 + raw[i+2] * 0.114;
        if (totalLum / (raw.length / 4) < 3) { cb(null); return; }
        cb(raw);
      } catch (e) { cb(null); }
    };
    img.onerror = () => cb(null);
    img.src = src.includes('?') ? src : src + '?qb=1';
  }

  function extractUrlId(url) {
    if (!url) return null;
    const clean = url.split('?')[0];
    // IPFS CID in path (ipfs.io, cf-ipfs.com, pinata, gateway.ipfs.io, etc.)
    const ipfsPath = clean.match(/\/ipfs\/([A-Za-z0-9]{20,})/);
    if (ipfsPath) return ipfsPath[1];
    try {
      const u = new URL(clean);
      // CID as subdomain: {cid}.ipfs.nftstorage.link or {cid}.ipfs.dweb.link
      const parts = u.hostname.split('.');
      if (parts.length >= 3 && parts[1] === 'ipfs' && parts[0].length >= 20) return parts[0];
      // Last path segment without extension
      const last = u.pathname.split('/').filter(Boolean).pop() || '';
      return last.replace(/\.[^.]+$/, '') || null;
    } catch { return null; }
  }

  function normalizeBrightness(pixels) {
    const len = pixels.length;
    let total = 0;
    for (let i = 0; i < len; i += 4)
      total += pixels[i] * 0.299 + pixels[i+1] * 0.587 + pixels[i+2] * 0.114;
    const avg = total / (len / 4);
    if (avg < 1) return pixels;
    const scale = 128 / avg;
    const out = new Uint8ClampedArray(len);
    for (let i = 0; i < len; i += 4) {
      out[i]   = Math.min(255, pixels[i]   * scale);
      out[i+1] = Math.min(255, pixels[i+1] * scale);
      out[i+2] = Math.min(255, pixels[i+2] * scale);
      out[i+3] = pixels[i+3];
    }
    return out;
  }

  function pixelSimilarity(p1, p2) {
    if (!p1 || !p2) return null;
    const len = Math.min(p1.length, p2.length);
    let diff = 0;
    for (let i = 0; i < len; i += 4) {
      const dr = (p1[i]   - p2[i])   / 255;
      const dg = (p1[i+1] - p2[i+1]) / 255;
      const db = (p1[i+2] - p2[i+2]) / 255;
      diff += Math.abs(dr * 0.299 + dg * 0.587 + db * 0.114);
    }
    return parseFloat(((1 - diff / (len / 4)) * 100).toFixed(1));
  }

  function pHashSimilarity(p1, p2) {
    if (!p1 || !p2) return null;
    const size = SAMPLE_SIZE;
    const lum  = (d, i) => d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
    const g1 = new Float32Array(size * size);
    const g2 = new Float32Array(size * size);
    for (let i = 0; i < size * size; i++) { g1[i] = lum(p1, i*4); g2[i] = lum(p2, i*4); }
    const H = 8;
    const dct1 = new Float32Array(H * H);
    const dct2 = new Float32Array(H * H);
    const c = u => u === 0 ? 1 / Math.sqrt(size) : Math.sqrt(2 / size);
    for (let u = 0; u < H; u++) {
      for (let v = 0; v < H; v++) {
        let s1 = 0, s2 = 0;
        for (let x = 0; x < size; x++) {
          const cx = Math.cos((2*x+1)*u*Math.PI/(2*size));
          for (let y = 0; y < size; y++) {
            const cy = Math.cos((2*y+1)*v*Math.PI/(2*size));
            s1 += g1[y*size+x] * cx * cy;
            s2 += g2[y*size+x] * cx * cy;
          }
        }
        dct1[u*H+v] = c(u)*c(v)*s1;
        dct2[u*H+v] = c(u)*c(v)*s2;
      }
    }
    const vals1 = Array.from(dct1).slice(1);
    const vals2 = Array.from(dct2).slice(1);
    const med1  = [...vals1].sort((a,b)=>a-b)[Math.floor(vals1.length/2)];
    const med2  = [...vals2].sort((a,b)=>a-b)[Math.floor(vals2.length/2)];
    let hamming = 0;
    for (let i = 0; i < vals1.length; i++)
      if ((vals1[i] > med1) !== (vals2[i] > med2)) hamming++;
    return parseFloat(((1 - hamming / vals1.length) * 100).toFixed(1));
  }

  function dHashSimilarity(p1, p2) {
    if (!p1 || !p2) return null;
    const size = SAMPLE_SIZE;
    const W = 9, H = 8;
    const lum = (p, x, y) => {
      const px = Math.round(x * (size-1) / (W-1));
      const py = Math.round(y * (size-1) / (H-1));
      const i  = (py * size + px) * 4;
      return p[i] * 0.299 + p[i+1] * 0.587 + p[i+2] * 0.114;
    };
    let hamming = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W-1; x++)
        if ((lum(p1,x,y) > lum(p1,x+1,y)) !== (lum(p2,x,y) > lum(p2,x+1,y))) hamming++;
    return parseFloat(((1 - hamming / (H*(W-1))) * 100).toFixed(1));
  }

  function combinedSimilarity(p1, p2, tokenSrc) {
    // URL exact match → 100%
    if (tokenSrc && referenceSource) {
      const id1 = extractUrlId(referenceSource);
      const id2 = extractUrlId(tokenSrc);
      if (id1 && id2 && id1 === id2) return 100;
      if (id1 && id2 && id1 !== id2) console.log(`🔍 URL IDs differ: ref="${id1}" tok="${id2}"`);
    }
    if (!p1 || !p2) return null;
    const n1 = normalizeBrightness(p1);
    const n2 = normalizeBrightness(p2);
    const ps = pixelSimilarity(n1, n2);
    const ph = pHashSimilarity(n1, n2);
    const pd = dHashSimilarity(n1, n2);
    const scores = [ps, ph, pd].filter(v => v !== null);
    if (!scores.length) return null;
    // weights: pixel 15%, pHash 65%, dHash 20%
    const weights = [0.15, 0.65, 0.20];
    const active  = [ps, ph, pd];
    let sum = 0, wsum = 0;
    active.forEach((v, i) => { if (v !== null) { sum += v * weights[i]; wsum += weights[i]; } });
    return parseFloat((sum / wsum).toFixed(1));
  }

  function updateGradProxyBadges() {
    if (!referencePixels || !gradProxyBtns.length) return;
    gradProxyBtns.forEach(proxy => {
      const data = proxy._gradData;
      if (!data || !data.imgSrc) return;
      getPixels(data.imgSrc, pixels => {
        const pct = combinedSimilarity(referencePixels, pixels, data.imgSrc) ?? 0;
        data.match = pct;
        const badge = proxy.querySelector('.qb-sim-badge');
        if (badge) {
          badge.textContent = pct.toFixed(1) + '%';
          badge.style.borderColor = badgeColor(pct);
        }
        scheduleUpdate();
      });
    });
  }

  function setReference(src) {
    if (!src || src.startsWith('data:') || src === referenceSource) return;
    referenceSource = src;
    referencePixels = null;
    // Clear stale proxies from previous reference (only if no scan is building new ones)
    if (!isScanning) removeGradProxyBtns();
    getPixels(src, (pixels) => {
      referencePixels = pixels;
      updateAllBadges();
      updateGradProxyBadges();
      scheduleUpdate();
    });
  }

  function getRealImage(containerEl) {
    if (!containerEl) return null;
    return Array.from(containerEl.querySelectorAll('img[class*="object-cover"]'))
      .find(img => img.src && !img.src.startsWith('data:')) || null;
  }

  function getTopPulseRowImage() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    if (!rows.length) return null;
    return getRealImage(rows[0]);
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

    return { newBtn, ticker, name, ageHours, marketCap: mcToNumber(mc), isGold, isGreen, match: newBtn._matchPct ?? 0 };
  }

  function sortNormal(tokens, newPair) {
    const normalize       = s => (s || '').toLowerCase().trim();
    const sameName        = t => normalize(t.name)   === normalize(newPair.name);
    const sameTicker      = t => normalize(t.ticker) === normalize(newPair.ticker);
    const nameTickerMatch = t => sameName(t) && sameTicker(t);
    const nameOnlyMatch   = t => sameName(t) && !sameTicker(t);

    const sortByRecent    = (a, b) => a.ageHours - b.ageHours;
    const sortByOldest    = (a, b) => b.ageHours - a.ageHours;
    const sortByMatchDesc = (a, b) => b.match - a.match;
    const sortByAgeMC     = (a, b) => (a.ageHours !== b.ageHours ? a.ageHours - b.ageHours : b.marketCap - a.marketCap);

    // Blue = not gold, not green. Only show if exact name/ticker match AND match > 50%
    const special = tokens.filter(t => t.isGold || t.isGreen);
    const blues   = tokens
      .filter(t => !t.isGold && !t.isGreen)
      .filter(t => (sameName(t) || sameTicker(t)) && t.match > 50)
      .sort(sortByOldest);

    function sortRest(list) {
      const ageDays = t => t.ageHours / 24;
      const tier1   = list.filter(t => ageDays(t) < 7 && t.match > 72);
      const t1High  = tier1.filter(t => t.match > 92).sort(sortByRecent);
      const t1Low   = tier1.filter(t => t.match <= 92).sort(sortByMatchDesc);
      const tier2   = list.filter(t => ageDays(t) >= 7 && t.match > 80).sort(sortByRecent);
      const tier3   = list.filter(t => ageDays(t) >= 7 && t.match >= 75 && t.match <= 80).sort(sortByRecent);
      const tier4   = list.filter(t => t.match >= 58.21 && t.match < 75).sort(sortByAgeMC);
      const tier5   = list.filter(t => t.match < 58.21).sort(sortByAgeMC);
      return [...t1High, ...t1Low, ...tier2, ...tier3, ...tier4, ...tier5];
    }

    let sortedSpecial;
    const hasNameTicker = special.some(nameTickerMatch);
    const hasNameOnly   = !hasNameTicker && special.some(nameOnlyMatch);

    if (hasNameTicker) {
      const nt     = special.filter(nameTickerMatch);
      const ultra  = nt.filter(t => t.match > 85).sort(sortByMatchDesc);
      const rest   = nt.filter(t => t.match <= 85).sort(sortByRecent);
      const others = special.filter(t => !nameTickerMatch(t));
      sortedSpecial = [...ultra, ...rest, ...sortRest(others)];
    } else if (hasNameOnly) {
      const no     = special.filter(nameOnlyMatch);
      const recent = no.filter(t => t.ageHours < 24).sort(sortByRecent);
      const old    = no.filter(t => t.ageHours >= 24).sort(sortByMatchDesc);
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
      badge.style.cssText = 'position:absolute;left:-66px;top:-10px;font-size:11px;font-weight:700;font-family:monospace;color:#fff;background:rgba(0,0,0,0.72);border-radius:8px;padding:1px 5px;pointer-events:none;white-space:nowrap;border:1px solid currentColor;z-index:10001;transition:color 0.3s;';
      newBtn.appendChild(badge);
    }
    return badge;
  }

  function updateBadge(newBtn) {
    const badge       = getOrCreateBadge(newBtn);
    const originalBtn = newBtn._original;
    if (!originalBtn) return;
    const row     = originalBtn.closest('[class*="max-h-[64px]"]');
    const coinImg = getRealImage(row);
    if (!coinImg || !coinImg.src) { badge.textContent = '—'; badge.style.color = '#888'; return; }
    if (!referencePixels)         { badge.textContent = '…'; badge.style.color = '#888'; return; }
    getPixels(coinImg.src, (rowPixels) => {
      const pct = combinedSimilarity(referencePixels, rowPixels, coinImg.src);
      newBtn._matchPct = pct ?? 0;
      if (pct === null) {
        badge.textContent = '?'; badge.style.color = '#888';
      } else {
        badge.textContent       = pct.toFixed(1) + '%';
        badge.style.color       = badgeColor(pct);
        badge.style.borderColor = badgeColor(pct);
      }
      scheduleUpdate();
    });
  }

  function updateAllBadges() { addedBtns.forEach(btn => updateBadge(btn)); }

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

  function fireClick(el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(ev => {
      el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    });
  }

  function removeGradProxyBtns() {
    gradProxyBtns.forEach(btn => btn.remove());
    gradProxyBtns.length = 0;
  }

  function removeButtons() {
    addedBtns.forEach(btn => btn.remove()); addedBtns.length = 0;
    removeGradProxyBtns();
  }

  function shouldShowButton(originalBtn) {
    const bgColor = originalBtn.style.background || '';
    const isGold  = bgColor.includes('255, 215, 0');
    const isGreen = bgColor.includes('120, 255, 160');
    if (isPanelVisible && hasActiveSearch) return true;
    return isGold || isGreen;
  }

  function getCoinImage(originalBtn) {
    return getRealImage(originalBtn.closest('[class*="max-h-[64px]"]'));
  }

  let lastTopSrc = null;
  function checkTopPulseReference() {
    if (referenceLocked) return;
    const topImg = getTopPulseRowImage();
    if (topImg?.src && topImg.src !== lastTopSrc) {
      lastTopSrc = topImg.src;
      setReference(topImg.src);
    }
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
    }, 150);
  }

  // ======= GRADUATED SCAN =======

  function getGraduatedToggleBtn(panel) {
    return [...panel.querySelectorAll('button')].find(btn => btn.textContent.trim() === 'Graduated') || null;
  }

  function getRowCA(row) {
    const link = row.querySelector('a[href*="/meme/"], a[href*="pump.fun/coin/"]');
    if (link) return link.pathname.split('/').pop().split('?')[0] || null;
    const img = row.querySelector('img[src*="axiomtrading"]');
    if (img) return img.src.split('/').pop().replace('.webp', '') || null;
    return null;
  }

  function extractGradTokenInfo(originalBtn) {
    const row = originalBtn.closest('[class*="max-h-[64px]"]');
    if (!row) return null;
    const truncateDivs = row.querySelectorAll('div[class*="min-w-0"][class*="truncate"][class*="whitespace-nowrap"]');
    const ticker = truncateDivs[0]?.textContent.trim() || '';
    const name   = truncateDivs[1]?.textContent.trim() || truncateDivs[0]?.textContent.trim() || '';
    const ageEl  = row.querySelector('span[class*="pointer-events-none"]');
    const age    = ageEl?.textContent?.trim() || '';
    let mc = '';
    for (const container of row.querySelectorAll('div[class*="gap-[4px]"]')) {
      const spans = [...container.querySelectorAll('span')];
      const labelSpan = spans.find(s => s.textContent.trim() === 'MC');
      if (labelSpan) { mc = spans.find(s => s !== labelSpan && s.textContent.trim())?.textContent.trim() || ''; break; }
    }
    const coinImg = getRealImage(row);
    // Capture pixels directly from the loaded img element (synchronous, no network request)
    let directPixels = null;
    if (coinImg && coinImg.complete && coinImg.naturalWidth > 0) {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = SAMPLE_SIZE;
        c.getContext('2d').drawImage(coinImg, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        directPixels = c.getContext('2d').getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
      } catch (e) {}
    }
    // Clone the real QB button now (before panel toggles back) to preserve Axiom's internal HTML
    const btnClone = originalBtn.cloneNode(true);
    const ca = getRowCA(row);
    return { ticker, name, age, ageHours: ageToSeconds(age) / 3600, mc, imgSrc: coinImg?.src || null, directPixels, match: 0, btnClone, ca };
  }

  function computeGradSimilarities(candidates, cb) {
    if (!referencePixels || !candidates.length) { cb(candidates); return; }
    let done = 0;
    let resolved = false;
    const finish = () => { if (!resolved) { resolved = true; cb(candidates); } };
    const timeout = setTimeout(finish, 600);
    const oneDone = () => { done++; if (done === candidates.length) { clearTimeout(timeout); finish(); } };
    candidates.forEach(data => {
      if (data.directPixels) {
        data.match = combinedSimilarity(referencePixels, data.directPixels, data.imgSrc) ?? 0;
        oneDone(); return;
      }
      if (!data.imgSrc) { data.match = 0; oneDone(); return; }
      getPixels(data.imgSrc, pixels => {
        data.match = combinedSimilarity(referencePixels, pixels, data.imgSrc) ?? 0;
        oneDone();
      });
    });
  }

  function createGradProxy(data) {
    // Use the cloned real QB button as base — preserves Axiom's internal HTML/structure
    const proxy = data.btnClone || document.createElement('button');
    proxy._gradData = data;

    // Copy sizing/shape from a real added button, then override position props
    const refBtn = addedBtns[0];
    if (refBtn) proxy.style.cssText = refBtn.style.cssText;
    proxy.style.position   = 'fixed';
    proxy.style.zIndex     = '9999';
    proxy.style.overflow   = 'visible';
    proxy.style.background = 'rgb(255, 215, 0)';
    proxy.style.color      = '#000';
    proxy.style.display    = 'none';
    proxy.style.left       = '0px';
    proxy.style.top        = '0px';

    // Remove any stale qb overlays from the clone before adding fresh ones
    proxy.querySelectorAll('.qb-coin-img, .qb-name-label, .qb-sim-badge, .qb-info-bar').forEach(el => el.remove());

    if (data.imgSrc) {
      const imgEl = document.createElement('img');
      imgEl.src = data.imgSrc;
      imgEl.className = 'qb-coin-img';
      imgEl.style.cssText = 'width:60px;height:60px;border-radius:50%;object-fit:cover;flex-shrink:0;position:absolute;left:-66px;top:50%;transform:translateY(-50%);pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
      proxy.appendChild(imgEl);
    }

    const label = document.createElement('div');
    label.className = 'qb-name-label';
    label.style.cssText = 'position:absolute;bottom:100%;left:50%;transform:translateX(-50%);margin-bottom:2px;text-align:center;font-size:10px;font-weight:600;font-family:monospace;color:#000;background:rgba(255,215,0,0.85);border-radius:4px;padding:1px 4px;pointer-events:none;white-space:nowrap;z-index:10001;';
    label.textContent = data.name || data.ticker;
    proxy.appendChild(label);

    const badge = document.createElement('span');
    badge.className = 'qb-sim-badge';
    badge.style.cssText = 'position:absolute;left:-66px;top:-10px;font-size:11px;font-weight:700;font-family:monospace;color:#fff;background:rgba(0,0,0,0.72);border-radius:8px;padding:1px 5px;pointer-events:none;white-space:nowrap;border:1px solid #ffd700;z-index:10001;';
    badge.textContent = data.match.toFixed(1) + '%';
    proxy.appendChild(badge);

    const bar = document.createElement('div');
    bar.className = 'qb-info-bar';
    bar.style.cssText = 'position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:2px;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:4px;font-size:13px;font-weight:700;font-family:monospace;pointer-events:none;white-space:nowrap;z-index:10001;';
    if (data.age) {
      const ageSpan = document.createElement('span');
      ageSpan.textContent = data.age;
      ageSpan.style.cssText = 'color:#ffd700;background:rgba(0,0,0,0.7);border-radius:4px;padding:1px 5px;';
      bar.appendChild(ageSpan);
    }
    if (data.mc) {
      const mcSpan = document.createElement('span');
      mcSpan.textContent = 'MC ' + data.mc;
      mcSpan.style.cssText = 'color:#5bb8ff;background:rgba(0,0,0,0.7);border-radius:4px;padding:1px 5px;';
      bar.appendChild(mcSpan);
    }
    proxy.appendChild(bar);

    proxy.addEventListener('click', e => {
      e.stopPropagation(); e.preventDefault();
      if (isScanning) return;
      executeGradClick(data);
    });

    return proxy;
  }

  function scanGraduated() {
    if (!lastPanel) { isScanning = false; flushQueue(); return; }
    const toggleBtn = getGraduatedToggleBtn(lastPanel);
    if (!toggleBtn) { isScanning = false; flushQueue(); return; }

    const startWait = Date.now();
    const waitAndScan = () => {
      const elapsed = Date.now() - startWait;
      if (!referencePixels && elapsed < 2000) {
        setTimeout(waitAndScan, 80);
        return;
      }
      doScan();
    };

    function doScan() {
    const normalCAKeys = new Set();
    addedBtns.forEach(btn => {
      const row = btn._original?.closest('[class*="max-h-[64px]"]');
      const ca  = row ? getRowCA(row) : null;
      if (ca) normalCAKeys.add(ca);
    });

    // Always look up toggle button live from current panel — panel may have re-rendered
    // since scanGraduated() captured the outer `toggleBtn`
    const liveToggle = () => {
      const panelEl = [...document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]')]
        .find(el => isSearchPanel(el));
      if (panelEl && panelEl !== lastPanel) lastPanel = panelEl;
      return lastPanel ? getGraduatedToggleBtn(lastPanel) : null;
    };

    const tb1 = liveToggle();
    if (!tb1) { isScanning = false; flushQueue(); return; }

    isScanning = true;
    inGraduatedView = true;
    tb1.click();
    console.log('🎓 Scanning graduated...');

    setTimeout(() => {
      if (!lastPanel) { inGraduatedView = false; isScanning = false; flushQueue(); return; }

      const btns = [...lastPanel.querySelectorAll('[class*="group/quickBuyButton"]')];
      if (!btns.length) {
        inGraduatedView = false;
        const tb2 = liveToggle(); if (tb2) tb2.click();
        setTimeout(() => { isScanning = false; flushQueue(); }, 350);
        return;
      }

      const candidates = btns.map(btn => extractGradTokenInfo(btn)).filter(Boolean);

      computeGradSimilarities(candidates, (withScores) => {
        const unique = withScores.filter(d => {
          if (!d.ca) return true;
          return !normalCAKeys.has(d.ca);
        });
        // Sort graduated by same tier system as normal tokens
        const sortedGrad = (() => {
          const ageDays = d => d.ageHours / 24;
          const t1High = unique.filter(d => ageDays(d) < 7 && d.match > 92).sort((a,b) => a.ageHours - b.ageHours);
          const t1Low  = unique.filter(d => ageDays(d) < 7 && d.match > 72 && d.match <= 92).sort((a,b) => b.match - a.match);
          const tier2  = unique.filter(d => ageDays(d) >= 7 && d.match > 80).sort((a,b) => a.ageHours - b.ageHours);
          const tier3  = unique.filter(d => ageDays(d) >= 7 && d.match >= 75 && d.match <= 80).sort((a,b) => a.ageHours - b.ageHours);
          const tier4  = unique.filter(d => d.match >= 58.21 && d.match < 75).sort((a,b) => a.ageHours - b.ageHours || b.match - a.match);
          const tier5  = unique.filter(d => d.match < 58.21).sort((a,b) => a.ageHours - b.ageHours || b.match - a.match);
          return [...t1High, ...t1Low, ...tier2, ...tier3, ...tier4, ...tier5];
        })();
        console.log('🎓 Graduated:', sortedGrad.map(d => `${d.ticker} ${d.match.toFixed(1)}%`));

        inGraduatedView = false;
        const tb3 = liveToggle(); if (tb3) tb3.click();

        setTimeout(() => {
          removeGradProxyBtns();
          sortedGrad.forEach(data => {
            const proxy = createGradProxy(data);
            document.body.appendChild(proxy);
            gradProxyBtns.push(proxy);
          });

          isScanning = false;
          scheduleUpdate();
          flushQueue();
        }, 350);
      });
    }, 350);
    } // end doScan

    waitAndScan();
  }

  function executeGradClick(data) {
    if (!lastPanel) return;
    const toggleBtn = getGraduatedToggleBtn(lastPanel);
    if (!toggleBtn) return;

    frozen = true;
    isScanning = true;
    inGraduatedView = true;
    clickQueue = null;
    removeGradProxyBtns();
    if (freezeTimer) clearTimeout(freezeTimer);

    toggleBtn.click();

    setTimeout(() => {
      if (!lastPanel) { inGraduatedView = false; isScanning = false; frozen = false; return; }
      const btns = [...lastPanel.querySelectorAll('[class*="group/quickBuyButton"]')];
      let targetBtn = null;
      for (const btn of btns) {
        const row = btn.closest('[class*="max-h-[64px]"]');
        if (!row) continue;
        const truncateDivs = row.querySelectorAll('div[class*="min-w-0"][class*="truncate"][class*="whitespace-nowrap"]');
        const t = truncateDivs[0]?.textContent.trim() || '';
        const n = truncateDivs[1]?.textContent.trim() || truncateDivs[0]?.textContent.trim() || '';
        if ((data.ticker && t === data.ticker) || (data.name && n === data.name)) {
          targetBtn = btn; break;
        }
      }

      if (targetBtn) {
        fireClick(targetBtn);
        console.log('✅ Grad click:', data.ticker || data.name);
      }

      inGraduatedView = false;
      toggleBtn.click();
      setTimeout(() => { isScanning = false; frozen = false; flushQueue(); }, 350);
    }, 350);
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
        // Keep visible while frozen/scanning to avoid layout flicker
        if (!frozen && !isScanning) newBtn.style.display = 'none';
        return;
      }
      const data = getTokenData(newBtn);
      if (data) visible.push({ newBtn, originalBtn, rect, data });
    });

    // All visible buttons (gold included) go into the normal section
    const normalCandidates = visible;

    let sortedNormal = normalCandidates;
    if (newPair && normalCandidates.length > 0) {
      const datas     = normalCandidates.map(v => v.data);
      const sorted    = sortNormal(datas, newPair);
      sortedNormal    = sorted.map(d => normalCandidates.find(v => v.newBtn === d.newBtn)).filter(Boolean);
    }

    if (sortedNormal.length === 0 && gradProxyBtns.length === 0) return;

    // No normal visible but grad proxies exist — use panel's first QB button for geometry
    if (sortedNormal.length === 0) {
      const firstBtn  = lastPanel?.querySelector('[class*="group/quickBuyButton"]');
      const firstRect = firstBtn?.getBoundingClientRect();
      const rowEl2    = firstBtn?.closest('[class*="max-h-[64px]"]');
      const rowH2     = rowEl2?.getBoundingClientRect().height || 64;
      const lp2       = firstRect ? firstRect.left - 621.5 : 40;
      const top0      = firstRect ? firstRect.top : 120;
      gradProxyBtns.forEach((proxy, i) => {
        if (!proxy.isConnected) return;
        proxy.style.left    = lp2 + 'px';
        proxy.style.top     = (top0 + i * rowH2) + 'px';
        proxy.style.display = '';
        proxy.style.opacity = '1';
      });
      return;
    }

    // slot1Top = top of panel's first QB row (stack always starts at top regardless of match position)
    const firstPanelBtn = lastPanel?.querySelector('[class*="group/quickBuyButton"]');
    const slot1Top = firstPanelBtn?.getBoundingClientRect().top ?? Math.min(...sortedNormal.map(v => v.rect.top));
    const rowEl     = sortedNormal[0].originalBtn?.closest('[class*="max-h-[64px]"]');
    const rowHeight = rowEl?.getBoundingClientRect().height ||
                      (sortedNormal.length > 1 ? Math.abs(sortedNormal[1].rect.top - sortedNormal[0].rect.top) : 64);
    const leftPos   = sortedNormal[0].rect.left - 621.5;

    // Position normal buttons (sorted — includes gold)
    sortedNormal.forEach(({ newBtn, originalBtn }, i) => {
      newBtn.style.left    = leftPos + 'px';
      newBtn.style.top     = (slot1Top + i * rowHeight) + 'px';
      newBtn.style.display = '';
      newBtn.style.opacity = '1';
      const coinImg = getCoinImage(originalBtn);
      const imgEl   = newBtn.querySelector('img.qb-coin-img');
      if (coinImg && imgEl && imgEl.src !== coinImg.src) { imgEl.src = coinImg.src; updateBadge(newBtn); }
      updateInfoBar(newBtn);
      updateNameLabel(newBtn);
    });

    // Graduated proxies (from panel toggle scan only) — 1-slot gap after normal
    const proxyStart = sortedNormal.length + 1;
    gradProxyBtns.forEach((proxy, i) => {
      if (!proxy.isConnected) return;
      proxy.style.left    = leftPos + 'px';
      proxy.style.top     = (slot1Top + (proxyStart + i) * rowHeight) + 'px';
      proxy.style.display = '';
      proxy.style.opacity = '1';
    });

  }

  function scheduleUpdate() {
    if (updateTimeout) return;
    updateTimeout = setTimeout(() => { updatePositions(); updateTimeout = null; }, 50);
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
    isPanelVisible  = (!zIndex || zIndex !== '-9999');
    hasActiveSearch  = (panel.querySelector('input')?.value?.trim() || '').length > 0;
    if (!hadSearch && hasActiveSearch) referenceLocked = true;
    if (wasVisible !== isPanelVisible || hadSearch !== hasActiveSearch) scheduleUpdate();
  }

  document.addEventListener('click', (e) => {
    const qbImg = e.target.closest('img.qb-coin-img');
    if (qbImg?.src && !qbImg.src.startsWith('data:')) {
      referenceLocked = false;
      setReference(qbImg.src);
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
    referenceLocked = false;
    setReference(clickedImg.src);
  }, true);

  // On prefetch: freeze, clear grad proxies, schedule graduated scan
  window.addEventListener('axiomPrefetchStart', () => {
    referenceLocked = true;
    freezeButtons();
    removeGradProxyBtns();
    if (scanDebounceTimer) clearTimeout(scanDebounceTimer);
    scanDebounceTimer = setTimeout(() => { scanGraduated(); }, 50);
  });

  function addButtons() {
    if (inGraduatedView) return;

    const candidates = document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
    const panel      = [...candidates].find(el => isSearchPanel(el));

    if (!panel) {
      removeButtons();
      if (scrollEl) { scrollEl.removeEventListener('scroll', updatePositions); scrollEl = null; }
      lastPanel = null; isPanelVisible = false; hasActiveSearch = false;
      return;
    }

    checkPanelState(panel);

    const panelRect = panel.getBoundingClientRect();
    if (panelRect.left < 0 || panelRect.top < 0 || panelRect.width < 100) return;

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
    btns.forEach(originalBtn => {
      if (originalBtn.dataset.qbAdded) return;
      originalBtn.dataset.qbAdded = 'true';

      const newBtn = originalBtn.cloneNode(true);
      newBtn._original      = originalBtn;
      newBtn._matchPct      = null;
      // Cache ticker/name while row is still in DOM (virtual scroll may remove it later)
      const _cacheRow  = originalBtn.closest('[class*="max-h-[64px]"]');
      const _cacheDivs = _cacheRow ? _cacheRow.querySelectorAll('div[class*="min-w-0"][class*="truncate"][class*="whitespace-nowrap"]') : [];
      newBtn._ticker = _cacheDivs[0]?.textContent.trim() || '';
      newBtn._name   = _cacheDivs[1]?.textContent.trim() || _cacheDivs[0]?.textContent.trim() || '';
      newBtn.style.cssText  = originalBtn.style.cssText;
      newBtn.style.position = 'fixed';
      newBtn.style.zIndex   = '9999';
      newBtn.style.overflow = 'visible';

      const coinImg = getCoinImage(originalBtn);
      if (coinImg) {
        const imgEl     = document.createElement('img');
        imgEl.src       = coinImg.src;
        imgEl.className = 'qb-coin-img';
        imgEl.style.cssText = 'width:60px;height:60px;border-radius:50%;object-fit:cover;flex-shrink:0;position:absolute;left:-66px;top:50%;transform:translateY(-50%);pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.4);';
        newBtn.appendChild(imgEl);
      }

      const colorSync = new MutationObserver(() => {
        newBtn.style.background = originalBtn.style.background;
        newBtn.style.color      = originalBtn.style.color;
        scheduleUpdate();
      });
      colorSync.observe(originalBtn, { attributes: true, attributeFilter: ['style'] });

      const rect = originalBtn.getBoundingClientRect();
      newBtn.style.left    = (rect.left - 621.5) + 'px';
      newBtn.style.top     = rect.top + 'px';
      newBtn.style.display = shouldShowButton(originalBtn) ? '' : 'none';

      document.body.appendChild(newBtn);
      addedBtns.push(newBtn);

      newBtn.addEventListener('click', e => {
        e.stopPropagation(); e.preventDefault();
        if (frozen || isScanning) { clickQueue = newBtn; }
        else { fireClick(originalBtn); }
      });

      updateBadge(newBtn);
      updateInfoBar(newBtn);
      updateNameLabel(newBtn);
    });
  }

  const observer = new MutationObserver(() => {
    checkClickSearchReference();
    addButtons();
    checkTopPulseReference();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(() => { checkTopPulseReference(); }, 500);

})();

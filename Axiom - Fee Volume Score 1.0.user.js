// ==UserScript==
// @name         Axiom - Fee Volume Score
// @namespace    http://tampermonkey.net/
// @version      1.4
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Fee%20Volume%20Score%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Fee%20Volume%20Score%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  const _p = new URLSearchParams(location.search);
  if (_p.get('role') === 'buyer' || _p.get('tab') === 'grad') return;

  // fee / volumeK >= 0.05 -> default color, < 0.05 -> red
  const THRESHOLD = 0.05;
  // MC > $10K and fee < 0.17 SOL -> red glow (takes priority)
  const MC_GLOW_THRESHOLD    = 10000;
  const MC_GLOW_FEE_MAX      = 0.17;

  // Parse Axiom subscript notation, e.g. "0.0₂2" -> 0.0022
  function parseSubscriptNumber(str) {
    if (!str) return null;
    const subMap = {
      '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4',
      '₅':'5','₆':'6','₇':'7','₈':'8','₉':'9'
    };
    const m = str.match(/^(\d+)\.(\d*)([₀-₉])(\d+)$/);
    if (m) {
      const extraZeros = '0'.repeat(parseInt(subMap[m[3]], 10));
      return parseFloat(`${m[1]}.${m[2]}${extraZeros}${m[4]}`);
    }
    const n = parseFloat(str);
    return isFinite(n) ? n : null;
  }

  function parseVolumeK(str) {
    if (!str) return null;
    const s = str.replace(/[$,\s]/g, '');
    const n = parseFloat(s);
    if (!isFinite(n) || n <= 0) return null;
    if (s.includes('B')) return n * 1_000_000;
    if (s.includes('M')) return n * 1_000;
    if (s.includes('K')) return n;
    return n / 1000;
  }

  function parseMC(str) {
    if (!str) return null;
    const m = str.trim().match(/^\$([\d.]+)(K|M|B)?$/);
    if (!m) return null;
    let v = parseFloat(m[1]);
    if (m[2] === 'K') v *= 1_000;
    if (m[2] === 'M') v *= 1_000_000;
    if (m[2] === 'B') v *= 1_000_000_000;
    return isFinite(v) ? v : null;
  }

  function getFeeSpan(row) {
    const wrapper = row.querySelector('[class*="group/image"]');
    if (!wrapper) return null;
    const solDiv = wrapper.querySelector('img[alt="SOL"]')?.parentElement;
    if (!solDiv) return null;
    return [...solDiv.querySelectorAll('span')].find(s => /\d/.test(s.textContent)) || solDiv;
  }

  function getFee(row) {
    const el = getFeeSpan(row);
    if (!el) return null;
    return parseSubscriptNumber(el.textContent.trim());
  }

  function getVolumeK(row) {
    const vSpan = [...row.querySelectorAll('span[class*="textTertiary"]')]
      .find(s => !s.children.length && s.textContent.trim() === 'V');
    if (!vSpan) return null;
    const valSpan = [...vSpan.parentElement.querySelectorAll('span')]
      .find(s => s !== vSpan && /\d/.test(s.textContent));
    return valSpan ? parseVolumeK(valSpan.textContent.trim()) : null;
  }

  function getMC(row) {
    const mSpan = [...row.querySelectorAll('span[class*="textTertiary"]')]
      .find(s => !s.children.length && (s.textContent.trim() === 'M' || s.textContent.trim() === 'MC'));
    if (!mSpan) return null;
    const valSpan = [...mSpan.parentElement.querySelectorAll('span')]
      .find(s => s !== mSpan && /\$[\d.]/.test(s.textContent));
    return valSpan ? parseMC(valSpan.textContent.trim()) : null;
  }

  function updateRow(row) {
    const el = getFeeSpan(row);
    if (!el) return;

    const fee  = getFee(row);
    const volK = getVolumeK(row);
    const mc   = getMC(row);

    // MC glow takes priority: MC > $10K and fee < 0.17
    if (mc !== null && mc > MC_GLOW_THRESHOLD && fee !== null && fee < MC_GLOW_FEE_MAX) {
      el.style.setProperty('color', '#ef4444', 'important');
      el.style.setProperty('text-shadow', '0 0 8px rgba(239,68,68,0.95), 0 0 16px rgba(239,68,68,0.5)', 'important');
      return;
    }

    el.style.textShadow = '';

    if (fee === null || volK === null || volK === 0) {
      el.style.color = '';
      return;
    }

    if ((fee / volK) >= THRESHOLD) {
      el.style.color = '';
    } else {
      el.style.setProperty('color', '#ef4444', 'important');
    }
  }

  function scan() {
    document.querySelectorAll('[class*="group/pulseRow"]').forEach(updateRow);
  }

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 400);

  console.log('📊 Axiom Fee Volume Score v1.4 loaded (vol threshold ' + THRESHOLD + ', MC glow >' + MC_GLOW_THRESHOLD + ' fee <' + MC_GLOW_FEE_MAX + ')');
})();

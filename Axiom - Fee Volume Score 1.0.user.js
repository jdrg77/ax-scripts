// ==UserScript==
// @name         Axiom - Fee Volume Score
// @namespace    http://tampermonkey.net/
// @version      1.3
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

  // fee / volumeK >= 0.07  -> green, < 0.07 -> red
  const THRESHOLD = 0.07;

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

  function getFeeSpan(row) {
    const wrapper = row.querySelector('[class*="group/image"]');
    if (!wrapper) return null;
    const solDiv = wrapper.querySelector('img[alt="SOL"]')?.parentElement;
    if (!solDiv) return null;
    // Fee value is now wrapped in an inner span; fall back to the div if not found.
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
    // The value span no longer carries `textPrimary`; just take the sibling span with digits.
    const valSpan = [...vSpan.parentElement.querySelectorAll('span')]
      .find(s => s !== vSpan && /\d/.test(s.textContent));
    return valSpan ? parseVolumeK(valSpan.textContent.trim()) : null;
  }

  function updateRow(row) {
    const el = getFeeSpan(row);
    if (!el) return;

    const fee  = getFee(row);
    const volK = getVolumeK(row);

    if (fee === null || volK === null || volK === 0) {
      el.style.color = '';
      return;
    }

    const color = (fee / volK) >= THRESHOLD ? '#22c55e' : '#ef4444';
    el.style.setProperty('color', color, 'important');
  }

  function scan() {
    document.querySelectorAll('[class*="group/pulseRow"]').forEach(updateRow);
  }

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 400);

  console.log('📊 Axiom Fee Volume Score v1.3 loaded (threshold ' + THRESHOLD + ')');
})();

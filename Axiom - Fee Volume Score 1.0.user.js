// ==UserScript==
// @name         Axiom - Fee Volume Score
// @namespace    http://tampermonkey.net/
// @version      1.1
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

  // fee / volumeK >= 0.1 → green, < 0.1 → red
  const THRESHOLD = 0.1;

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

  function getFee(row) {
    const wrapper = row.querySelector('[class*="group/image"]');
    if (!wrapper) return null;
    const solDiv = wrapper.querySelector('img[alt="SOL"]')?.parentElement;
    if (!solDiv) return null;
    const text = [...solDiv.childNodes]
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim())
      .filter(Boolean)
      .join('');
    return parseFloat(text) || null;
  }

  function getVolumeK(row) {
    const vSpan = [...row.querySelectorAll('span[class*="textTertiary"]')]
      .find(s => !s.children.length && s.textContent.trim() === 'V');
    if (!vSpan) return null;
    const valSpan = [...vSpan.parentElement.querySelectorAll('span')]
      .find(s => s !== vSpan && s.className.includes('textPrimary'));
    return valSpan ? parseVolumeK(valSpan.textContent.trim()) : null;
  }

  function getFeeEl(row) {
    const wrapper = row.querySelector('[class*="group/image"]');
    if (!wrapper) return null;
    return wrapper.querySelector('img[alt="SOL"]')?.parentElement || null;
  }

  function updateRow(row) {
    const solDiv = getFeeEl(row);
    if (!solDiv) return;

    const fee  = getFee(row);
    const volK = getVolumeK(row);

    if (fee === null || volK === null || volK === 0) {
      solDiv.style.color = '';
      return;
    }

    solDiv.style.color = (fee / volK) >= THRESHOLD ? '#22c55e' : '#ef4444';
  }

  function scan() {
    document.querySelectorAll('[class*="group/pulseRow"]').forEach(updateRow);
  }

  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  setInterval(scan, 400);

  console.log('📊 Axiom Fee Volume Score v1.1 loaded');
})();

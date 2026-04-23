// ==UserScript==
// @name         Axiom - Tab Sync
// @namespace    http://tampermonkey.net/
// @version      2.0
// @match        https://axiom.trade/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Tab%20Sync%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Tab%20Sync%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  document.addEventListener('click', (e) => {
    const isBtn =
      e.target.closest('img.qb-coin-img') ||
      e.target.closest('img.qbm-coin-img') ||
      e.target.closest('button[style*="position: fixed"][style*="z-index: 9999"]') ||
      e.target.closest('button[data-qbm-mini]');

    if (!isBtn) return;
    const ca = localStorage.getItem('axiomNewPairCA');
    if (!ca) return;
    window.open(`https://gmgn.ai/sol/token/${ca}`, 'gmgn-tab');
  }, true);

  console.log('🔗 Axiom Tab Sync v2.0 — abre GMGN al clickear botones');
})();

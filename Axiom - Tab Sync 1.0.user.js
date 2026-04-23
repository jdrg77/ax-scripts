// ==UserScript==
// @name         Axiom - Tab Sync
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://axiom.trade/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Tab%20Sync%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Tab%20Sync%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  const ch = new BroadcastChannel('axiom-tabs');

  // Receive: navigate to token when another tab sends OPEN_TOKEN
  ch.addEventListener('message', (e) => {
    if (e.data.type !== 'OPEN_TOKEN' || !e.data.ca) return;
    history.pushState({}, '', `/meme/${e.data.ca}?chain=sol`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });

  // Send: when clicking any QBuy button or coin photo
  document.addEventListener('click', (e) => {
    const isBtn =
      e.target.closest('img.qb-coin-img') ||
      e.target.closest('img.qbm-coin-img') ||
      e.target.closest('button[style*="position: fixed"][style*="z-index: 9999"]') ||
      e.target.closest('button[data-qbm-mini]');

    if (!isBtn) return;
    const ca = localStorage.getItem('axiomNewPairCA');
    if (ca) ch.postMessage({ type: 'OPEN_TOKEN', ca });
  }, true);

  console.log('🔗 Axiom Tab Sync v1.0 — sincroniza token entre pestañas');
})();

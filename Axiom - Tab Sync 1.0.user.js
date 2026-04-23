// ==UserScript==
// @name         Axiom - Tab Sync
// @namespace    http://tampermonkey.net/
// @version      1.1
// @match        https://axiom.trade/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Tab%20Sync%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Tab%20Sync%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  const isReceiver = new URLSearchParams(location.search).get('tab') === 'sync';
  const ch = new BroadcastChannel('axiom-tabs');

  if (isReceiver) {
    // RECEIVER MODE: only on ?tab=sync
    ch.addEventListener('message', (e) => {
      if (e.data.type !== 'OPEN_TOKEN') return;
      const path = e.data.memeHref || (e.data.ca ? `/meme/${e.data.ca}?chain=sol` : null);
      if (!path) return;
      history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    const badge = document.createElement('div');
    badge.textContent = '🔗 SYNC';
    badge.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;background:#2563eb;color:#fff;font-size:11px;font-weight:bold;padding:3px 8px;border-radius:4px;pointer-events:none;';
    const attach = () => document.body?.appendChild(badge);
    document.body ? attach() : document.addEventListener('DOMContentLoaded', attach);

    console.log('🔗 Axiom Tab Sync v1.1 — modo RECEPTOR');
    return;
  }

  // SENDER MODE: any other axiom tab
  document.addEventListener('click', (e) => {
    const isBtn =
      e.target.closest('img.qb-coin-img') ||
      e.target.closest('img.qbm-coin-img') ||
      e.target.closest('button[style*="position: fixed"][style*="z-index: 9999"]') ||
      e.target.closest('button[data-qbm-mini]');

    if (!isBtn) return;
    const memeHref = localStorage.getItem('axiomNewPairMemeHref');
    const ca = localStorage.getItem('axiomNewPairCA');
    if (memeHref || ca) ch.postMessage({ type: 'OPEN_TOKEN', memeHref, ca });
  }, true);

  console.log('🔗 Axiom Tab Sync v1.1 — modo emisor');
})();

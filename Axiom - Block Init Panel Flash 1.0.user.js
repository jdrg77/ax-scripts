// ==UserScript==
// @name         Axiom - Block Init Panel Flash
// @namespace    http://tampermonkey.net/
// @version      1.3
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Block%20Init%20Panel%20Flash%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Block%20Init%20Panel%20Flash%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  let blocked = true;

  window.addEventListener('axiomPrefetchStart', () => { blocked = false; }, { once: true });

  document.addEventListener('click', e => {
    if (!blocked)    return;
    if (e.isTrusted) return;
    const searchBtn = document.querySelector('[class*="ri-search"]')?.closest('button');
    if (searchBtn && (e.target === searchBtn || searchBtn.contains(e.target))) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);

})();

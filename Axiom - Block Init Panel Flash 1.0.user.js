// ==UserScript==
// @name         Axiom - Block Init Panel Flash
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Block%20Init%20Panel%20Flash%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Block%20Init%20Panel%20Flash%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  let blocked = true;
  // Release after 2.5s — enough for page to initialize, prefetch resumes normally after
  setTimeout(() => { blocked = false; }, 2500);

  function getSearchBtn() {
    return document.querySelector('[class*="ri-search"]')?.closest('button') || null;
  }

  // Capture phase: runs before any other listener
  document.addEventListener('click', e => {
    if (!blocked)     return; // block period expired
    if (e.isTrusted)  return; // real user click — always allow
    // Programmatic click (isTrusted=false): check if it targets the search button
    const searchBtn = getSearchBtn();
    if (searchBtn && (e.target === searchBtn || searchBtn.contains(e.target))) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);

})();

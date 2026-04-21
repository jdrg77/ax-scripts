// ==UserScript==
// @name         Axiom - Block Init Panel Flash
// @namespace    http://tampermonkey.net/
// @version      1.2
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Block%20Init%20Panel%20Flash%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Block%20Init%20Panel%20Flash%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  let blocked      = true;  // active for first 5s
  let prefetchLive = false; // true only while axiomPrefetchStart just fired

  // After 5s, stop filtering entirely
  setTimeout(() => { blocked = false; }, 5000);

  // axiomPrefetchStart fires inside prefetch() BEFORE the button.click()
  // so setting prefetchLive=true here allows that specific click through
  window.addEventListener('axiomPrefetchStart', () => {
    prefetchLive = true;
    setTimeout(() => { prefetchLive = false; }, 0); // reset after the click is processed
  });

  function getSearchBtn() {
    return document.querySelector('[class*="ri-search"]')?.closest('button') || null;
  }

  document.addEventListener('click', e => {
    if (!blocked)       return; // 5s window expired — allow all
    if (e.isTrusted)    return; // real user click — always allow
    if (prefetchLive)   return; // triggered by a new pair — allow
    // Programmatic click with no new pair → block
    const searchBtn = getSearchBtn();
    if (searchBtn && (e.target === searchBtn || searchBtn.contains(e.target))) {
      e.stopPropagation();
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);

})();

// ==UserScript==
// @name         Axiom - Tab2 localStorage Isolator
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Tab2%20localStorage%20Isolator%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Tab2%20localStorage%20Isolator%201.0.user.js
// ==/UserScript==

(function () {
  if (sessionStorage.getItem('axiom-tab') !== 'grad') return;

  const KEY     = 'search-only-bonded';
  const origSet = Storage.prototype.setItem;
  const origGet = Storage.prototype.getItem;

  Storage.prototype.setItem = function (k, v) {
    if (k === KEY) return;
    origSet.call(this, k, v);
  };

  Storage.prototype.getItem = function (k) {
    if (k === KEY) return 'true';
    return origGet.call(this, k);
  };

  console.log('🔒 Axiom Tab2 Isolator v1.0 — search-only-bonded locked to graduated');
})();

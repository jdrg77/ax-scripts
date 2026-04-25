// ==UserScript==
// @name         Axiom - Pause On Hover
// @namespace    http://tampermonkey.net/
// @version      1.1
// @match        https://axiom.trade/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Pause%20On%20Hover%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Pause%20On%20Hover%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') === 'grad') return;

  function getPauseFns() {
    const scrollable = document.querySelector('.absolute.inset-0.overflow-y-auto');
    if (!scrollable) return null;
    const fk = Object.keys(scrollable).find(k => k.startsWith('__reactFiber'));
    if (!fk) return null;
    let fiber = scrollable[fk];
    for (let i = 0; i < 50; i++) {
      if (fiber?.memoizedProps?.onMouseEnter) {
        return { pause: fiber.memoizedProps.onMouseEnter, resume: fiber.memoizedProps.onMouseLeave };
      }
      fiber = fiber.return;
    }
    return null;
  }

  // Todos los elementos hovereables de QBuy y Best Match
  function getTargets() {
    return document.querySelectorAll(
      'button[style*="position: fixed"], button[style*="position:fixed"], [data-qbm-mini], img.qb-coin-img, img.qbm-coin-img'
    );
  }

  let attached = new WeakSet();

  function attachListeners() {
    getTargets().forEach(el => {
      if (attached.has(el)) return;
      attached.add(el);
      el.addEventListener('mouseenter', () => getPauseFns()?.pause());
      el.addEventListener('mouseleave', () => getPauseFns()?.resume());
    });
  }

  const observer = new MutationObserver(attachListeners);
  observer.observe(document.body, { childList: true, subtree: true });
  attachListeners();

  console.log('🚀 Axiom Pause On Hover 1.1 loaded');
})();

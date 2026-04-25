// ==UserScript==
// @name         Axiom - Pause On Hover
// @namespace    http://tampermonkey.net/
// @version      1.5
// @match        https://axiom.trade/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Pause%20On%20Hover%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Pause%20On%20Hover%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') === 'grad') return;

  function isOurElement(el) {
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.tagName === 'BUTTON' && getComputedStyle(cur).position === 'fixed') return true;
      if (cur.dataset?.qbmMini !== undefined) return true;
      if (cur.classList?.contains('qb-coin-img')) return true;
      if (cur.classList?.contains('qbm-coin-img')) return true;
      cur = cur.parentElement;
    }
    return false;
  }

  function installWrap() {
    const scrollable = document.querySelector('.absolute.inset-0.overflow-y-auto');
    if (!scrollable) return false;
    const fk = Object.keys(scrollable).find(k => k.startsWith('__reactFiber'));
    if (!fk) return false;
    const hf = scrollable[fk].return;
    if (!hf?.memoizedProps?.onMouseLeave) return false;

    // Ya está instalado
    if (hf.memoizedProps.onMouseLeave?.__pauseWrapped) return true;

    const origLeave = hf.memoizedProps.onMouseLeave;

    function wrappedLeave(e) {
      if (e.relatedTarget && isOurElement(e.relatedTarget)) return;
      origLeave(e);
    }
    wrappedLeave.__pauseWrapped = true;

    hf.memoizedProps = { ...hf.memoizedProps, onMouseLeave: wrappedLeave };
    if (hf.pendingProps) hf.pendingProps = { ...hf.pendingProps, onMouseLeave: wrappedLeave };

    return true;
  }

  // Instalar cuando el DOM esté listo
  const initInterval = setInterval(() => {
    if (installWrap()) {
      console.log('🚀 Axiom Pause On Hover 1.5 — wrap instalado');
      clearInterval(initInterval);
    }
  }, 500);

  // Re-aplicar si React re-renderiza y borra el wrap
  setInterval(() => {
    const scrollable = document.querySelector('.absolute.inset-0.overflow-y-auto');
    if (!scrollable) return;
    const fk = Object.keys(scrollable).find(k => k.startsWith('__reactFiber'));
    if (!fk) return;
    const hf = scrollable[fk].return;
    if (!hf?.memoizedProps?.onMouseLeave?.__pauseWrapped) installWrap();
  }, 2000);

})();

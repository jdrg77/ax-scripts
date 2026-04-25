// ==UserScript==
// @name         Axiom - Pause On Hover
// @namespace    http://tampermonkey.net/
// @version      1.6
// @match        https://axiom.trade/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Pause%20On%20Hover%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Pause%20On%20Hover%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') === 'grad') return;

  function isOurElement(el) {
    if (!el) return false;
    let cur = el;
    while (cur && cur !== document.body) {
      // QBuy button: position:fixed inline + zIndex 9999
      if (cur.tagName === 'BUTTON' && cur.style?.position === 'fixed' && cur.style?.zIndex === '9999') return true;
      // Best Match mini button
      if (cur.hasAttribute?.('data-qbm-mini')) return true;
      // Coin images (outside button bounds)
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
    if (hf.memoizedProps.onMouseLeave?.__pauseWrapped) return true;

    const origLeave = hf.memoizedProps.onMouseLeave;

    function wrappedLeave(e) {
      // React SyntheticEvent: relatedTarget puede estar en e o en e.nativeEvent
      const dest = e.relatedTarget || e.nativeEvent?.relatedTarget;
      if (isOurElement(dest)) return;
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
      console.log('🚀 Axiom Pause On Hover 1.6 — wrap instalado');
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
    if (hf?.memoizedProps?.onMouseLeave && !hf.memoizedProps.onMouseLeave.__pauseWrapped) {
      installWrap();
    }
  }, 2000);

})();

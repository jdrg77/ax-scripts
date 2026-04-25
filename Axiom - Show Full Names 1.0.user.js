// ==UserScript==
// @name         Axiom - Show Full Names
// @namespace    http://tampermonkey.net/
// @version      1.3
// @match        https://axiom.trade/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Show%20Full%20Names%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Show%20Full%20Names%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  function fix() {
    const names = document.querySelectorAll('div.truncate.text-left, [class*="truncate"][class*="text-left"]');

    names.forEach(name => {
      if (!name.__placeholder) {
        const ph = document.createElement('div');
        ph.style.display = 'inline-block';
        ph.style.width = name.offsetWidth + 'px';
        ph.style.height = name.offsetHeight + 'px';
        name.__placeholder = ph;
        name.parentNode.insertBefore(ph, name);
      }

      const rect = name.__placeholder.getBoundingClientRect();

      name.style.position = 'fixed';
      name.style.left = rect.left + 'px';
      name.style.top = rect.top + 'px';
      name.style.overflow = 'visible';
      name.style.textOverflow = 'clip';
      name.style.whiteSpace = 'nowrap';
      name.style.maxWidth = 'none';
      name.style.width = 'auto';
      name.style.zIndex = '2147483647';
      name.style.pointerEvents = 'none';
    });
  }

  fix();
  setInterval(fix, 200);
  window.addEventListener('scroll', fix, true);
  window.addEventListener('resize', fix);

  let syntheticFiring = false;
  document.addEventListener('click', (e) => {
    if (syntheticFiring) return;
    const names = document.querySelectorAll('div.truncate.text-left, [class*="truncate"][class*="text-left"]');
    for (const name of names) {
      if (name.style.position !== 'fixed') continue;
      const rect = name.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) continue;
      // Click dentro del name flotante — si hay imagen abajo, dejarlo pasar
      if (e.target && (e.target.tagName === 'IMG' || e.target.closest('img'))) return;
      // Sin imagen abajo — disparar click en el name para que Click Search lo capture
      syntheticFiring = true;
      name.style.pointerEvents = 'auto';
      name.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: e.clientX, clientY: e.clientY }));
      name.style.pointerEvents = 'none';
      syntheticFiring = false;
      return;
    }
  }, true);

  console.log('🚀 Axiom Show Full Names 1.3 loaded');
})();

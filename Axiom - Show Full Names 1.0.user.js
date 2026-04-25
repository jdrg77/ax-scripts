// ==UserScript==
// @name         Axiom - Show Full Names
// @namespace    http://tampermonkey.net/
// @version      1.2
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
      name.style.pointerEvents = 'auto';

      if (!name.__clickFixed) {
        name.__clickFixed = true;
        name.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          name.style.pointerEvents = 'none';
          const below = document.elementFromPoint(e.clientX, e.clientY);
          name.style.pointerEvents = 'auto';
          if (below && below !== name) {
            below.click();
          } else if (name.__placeholder) {
            const phRect = name.__placeholder.getBoundingClientRect();
            const phBelow = document.elementFromPoint(
              phRect.left + phRect.width / 2,
              phRect.top + phRect.height / 2
            );
            if (phBelow) phBelow.click();
          }
        });
      }
    });
  }

  fix();
  setInterval(fix, 200);
  window.addEventListener('scroll', fix, true);
  window.addEventListener('resize', fix);

  console.log('🚀 Axiom Show Full Names 1.2 loaded');
})();

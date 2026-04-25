// ==UserScript==
// @name         Axiom Search Panel Left
// @namespace    http://tampermonkey.net/
// @version      1.4
// @match        *://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20Search%20Panel%20Left.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20Search%20Panel%20Left.user.js
// ==/UserScript==

(function () {
  'use strict';

  const observer = new MutationObserver(() => {
    const panel = document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
    if (!panel || panel.dataset.moved) return;

    panel.dataset.moved = 'true';

    const wrapper = panel.parentElement;
    if (!wrapper) return;

    const current = wrapper.style.transform;
    const match = current.match(/translate\((\d+)px,\s*(\d+)px\)/);

    if (match) {
      const x = parseInt(match[1]) - 258;
      const y = parseInt(match[2]) - 151;
      wrapper.style.transform = `translate(${x}px, ${y}px)`;
    } else {
      wrapper.style.marginLeft = '-400px';
      wrapper.style.marginTop = '-151px';
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
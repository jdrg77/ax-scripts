// ==UserScript==
// @name         Axiom Search Panel Left
// @namespace    http://tampermonkey.net/
// @version      1.6
// @match        *://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20Search%20Panel%20Left.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20Search%20Panel%20Left.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SHIFT_X = 123;
  const SHIFT_Y = 6;
  let lastWrapper = null;

  function applyShift() {
    const panel = document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
    if (!panel) { lastWrapper = null; return; }
    const wrapper = panel.parentElement;
    if (!wrapper || wrapper === lastWrapper) return;
    lastWrapper = wrapper;

    // Double rAF: let React apply its initial transform first
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const t = getComputedStyle(wrapper).transform;
      if (t && t !== 'none') {
        const mat = new DOMMatrix(t);
        mat.e += SHIFT_X;
        mat.f += SHIFT_Y;
        wrapper.style.setProperty('transform', mat.toString(), 'important');
      } else {
        wrapper.style.setProperty('margin-left', SHIFT_X + 'px', 'important');
        wrapper.style.setProperty('margin-top',  SHIFT_Y + 'px', 'important');
      }
    }));
  }

  const observer = new MutationObserver(applyShift);
  observer.observe(document.body, { childList: true, subtree: true });
})();

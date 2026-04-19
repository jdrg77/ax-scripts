// ==UserScript==
// @name         Axiom MC Highlight
// @namespace    http://tampermonkey.net/
// @version      1.1
// @match        *://axiom.trade/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  function parseMC(text) {
    const match = text.trim().match(/^\$([\d.]+)(K|M)?$/);
    if (!match) return 0;
    let val = parseFloat(match[1]);
    if (match[2] === 'K') val *= 1000;
    if (match[2] === 'M') val *= 1000000;
    return val;
  }

  function highlightMC() {
    const panel = document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
    if (!panel) return;

    const spans = [...panel.querySelectorAll('span, div')].filter(el =>
      el.textContent.trim().match(/^\$[\d.]+[KM]?$/) && el.children.length === 0
    );

    spans.forEach(el => {
      if (el.parentElement.textContent.trim().startsWith('MC')) {
        const val = parseMC(el.textContent);
        if (val >= 100000) {
          el.style.color = '#ff3333';
          el.style.textShadow = '0 0 8px rgba(255, 50, 50, 0.9), 0 0 16px rgba(255, 50, 50, 0.5)';
        } else {
          el.style.color = '';
          el.style.textShadow = '';
        }
      }
    });
  }

  const observer = new MutationObserver(() => highlightMC());
  observer.observe(document.body, { childList: true, subtree: true });
})();
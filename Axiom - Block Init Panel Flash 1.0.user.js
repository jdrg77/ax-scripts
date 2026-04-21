// ==UserScript==
// @name         Axiom - Block Init Panel Flash
// @namespace    http://tampermonkey.net/
// @version      1.4
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Block%20Init%20Panel%20Flash%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Block%20Init%20Panel%20Flash%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  let blocked = true;

  window.addEventListener('axiomPrefetchStart', () => {
    blocked = false;
    obs.disconnect();
  }, { once: true });

  function hidePanel() {
    const panel = document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
    if (!panel) return;
    const wrapper = panel.parentElement;
    const overlay = wrapper?.parentElement;
    if (wrapper) {
      wrapper.style.setProperty('z-index',        '-9999', 'important');
      wrapper.style.setProperty('pointer-events', 'none',  'important');
      wrapper.style.setProperty('transition',     'none',  'important');
      wrapper.style.setProperty('animation',      'none',  'important');
    }
    if (overlay) {
      overlay.style.setProperty('z-index',         '-9999',       'important');
      overlay.style.setProperty('pointer-events',  'none',        'important');
      overlay.style.setProperty('background',      'transparent', 'important');
      overlay.style.setProperty('backdrop-filter', 'none',        'important');
      overlay.style.setProperty('transition',      'none',        'important');
      overlay.style.setProperty('animation',       'none',        'important');
    }
  }

  const obs = new MutationObserver(() => { if (blocked) hidePanel(); });

  document.addEventListener('DOMContentLoaded', () => {
    obs.observe(document.body, { childList: true, subtree: true });
    hidePanel();
  });

})();

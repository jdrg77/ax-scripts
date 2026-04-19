// ==UserScript==
// @name         Axiom - Click Search
// @namespace    http://tampermonkey.net/
// @version      2.4
// @match        https://axiom.trade/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Click%20Search-2.1.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Click%20Search-2.1.user.js
// ==/UserScript==

(function () {
  'use strict';

  window.open = () => null;

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[target="_blank"]');
    if (a) { a.target = '_self'; e.preventDefault(); }
  }, true);

  function openSearchWithTicker(token) {
    window.axiomUserOpen = true;
    const panel = document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
    if (!panel) {
      document.querySelector('[class*="ri-search"]')?.closest('button')?.click();
    }
    setTimeout(() => {
      const p = document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
      if (p) {
        const wrapper = p.parentElement;
        const overlay = wrapper?.parentElement;
        if (wrapper) { wrapper.style.pointerEvents = 'none'; }
        if (overlay) { overlay.style.pointerEvents = 'none'; overlay.style.background = 'none'; overlay.style.backdropFilter = 'none'; }
      }
      const input = document.querySelector('[class*="bg-backgroundTertiary"] input');
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, token);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, 100);
  }

  const handler = (e) => {
    if (e.button !== 0) return;

    const row = e.target.closest('[class*="group/pulseRow"]');
    if (!row) return;

    const tickerEl = e.target.closest('[style*="max-width"]');
    if (tickerEl) {
      const token = tickerEl.textContent.trim();
      if (!token) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openSearchWithTicker(token);
      console.log('✅ Ticker search:', token);
      return;
    }

    const nameEl = e.target.closest('div.min-w-0.overflow-hidden.truncate.whitespace-nowrap');
    if (nameEl && !nameEl.style.maxWidth) {
      const token = nameEl.textContent.trim();
      if (!token) return;
      const button = nameEl.closest('div[role="button"]');
      if (!button) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.axiomUserOpen = true;
      button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: window }));
      setTimeout(() => {
        const item = [...document.querySelectorAll('[role="menuitem"]')]
          .find(el => el.textContent?.trim() === `Search for ${token}`);
        if (item) { item.click(); console.log('✅ Name search:', token); }
      }, 10);
    }
  };

  document.addEventListener('mousedown', handler, true);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') window.axiomUserOpen = false;
  }, true);

  // Resetear axiomUserOpen cuando el panel se cierra
  const observer = new MutationObserver(() => {
    if (!document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]')) {
      window.axiomUserOpen = false;
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  console.log('🚀 Axiom Click loaded');
})();
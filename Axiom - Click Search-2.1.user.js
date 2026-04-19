// ==UserScript==
// @name         Axiom - Click Search
// @namespace    http://tampermonkey.net/
// @version      2.1
// @match        https://axiom.trade/*
// @grant        none
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
    if (panel) {
      const wrapper = panel.parentElement;
      const overlay = wrapper?.parentElement;
      if (wrapper) { wrapper.style.removeProperty('z-index'); wrapper.style.removeProperty('pointer-events'); }
      if (overlay) { overlay.style.removeProperty('z-index'); overlay.style.removeProperty('pointer-events'); overlay.style.removeProperty('background'); overlay.style.removeProperty('backdrop-filter'); }
    } else {
      document.querySelector('[class*="ri-search"]')?.closest('button')?.click();
    }
    setTimeout(() => {
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

  document.addEventListener('pointerdown', handler, true);
  document.addEventListener('mousedown', handler, true);
  document.addEventListener('click', handler, true);

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
// ==UserScript==
// @name         Axiom - Background Prefetch ONLY (SIN DELAY) 22
// @namespace    http://tampermonkey.net/
// @version      6.0
// @match        https://axiom.trade/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Background%20Prefetch%20ONLY%20(SIN%20DELAY)%2022-5.5.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Background%20Prefetch%20ONLY%20(SIN%20DELAY)%2022-5.5.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') === 'grad') return;

  const gradChannel = new BroadcastChannel('axiom-tabs');

  let userOpen = false;
  let lastPrefetched = null;
  let lastRowName = '__init__';

  function getPanel() {
    return document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
  }

  function forceHidePanelInstant() {
    if (userOpen || window.axiomUserOpen) return;
    const panel = getPanel();
    if (!panel) return;
    const wrapper = panel.parentElement;
    const overlay = wrapper?.parentElement;
    if (wrapper) {
      wrapper.style.setProperty('z-index', '-9999', 'important');
      wrapper.style.setProperty('pointer-events', 'none', 'important');
      wrapper.style.setProperty('transition', 'none', 'important');
      wrapper.style.setProperty('animation', 'none', 'important');
    }
    if (overlay) {
      overlay.style.setProperty('z-index', '-9999', 'important');
      overlay.style.setProperty('pointer-events', 'none', 'important');
      overlay.style.setProperty('background', 'transparent', 'important');
      overlay.style.setProperty('backdrop-filter', 'none', 'important');
      overlay.style.setProperty('transition', 'none', 'important');
      overlay.style.setProperty('animation', 'none', 'important');
    }
  }

  function bringToFront() {
    const panel = getPanel();
    if (!panel) return;
    const wrapper = panel.parentElement;
    const overlay = wrapper?.parentElement;
    if (wrapper) {
      wrapper.style.removeProperty('z-index');
      wrapper.style.removeProperty('pointer-events');
      wrapper.style.removeProperty('transition');
      wrapper.style.removeProperty('animation');
    }
    if (overlay) {
      overlay.style.removeProperty('z-index');
      overlay.style.removeProperty('pointer-events');
      overlay.style.removeProperty('background');
      overlay.style.removeProperty('backdrop-filter');
      overlay.style.removeProperty('transition');
      overlay.style.removeProperty('animation');
    }
  }

  function typeInPanel(name) {
    const input = getPanel()?.querySelector('input');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, name);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function getTokenName(row) {
    const button = row.querySelector('div[role="button"]');
    if (!button) return null;
    let nameSpan = button.querySelector('span[class*="text-\\[16px\\]"]');
    if (!nameSpan) nameSpan = button.querySelector('span.text-\\[16px\\]');
    if (!nameSpan) nameSpan = button.querySelectorAll('span')[0];
    return nameSpan ? nameSpan.textContent.trim() : null;
  }

  function getTopRowCA() {
    const row = document.querySelector('[class*="group/pulseRow"]');
    if (!row) return null;
    for (const a of row.querySelectorAll('a[href]')) {
      const h = a.href;
      if (h.includes('/meme/'))   { const m = h.match(/\/meme\/([A-Za-z0-9]{32,})/); if (m) return m[1]; }
      if (h.includes('pump.fun')) { const m = h.match(/\/coin\/([A-Za-z0-9]{32,})/); if (m) return m[1]; }
      if (h.includes('bonk'))     { const m = h.match(/\/([A-Za-z0-9]{32,})/);        if (m) return m[1]; }
    }
    return null;
  }

  function getTopRowMemeHref() {
    const row = document.querySelector('[class*="group/pulseRow"]');
    if (!row) return null;
    for (const a of row.querySelectorAll('a[href]')) {
      if (a.href.includes('/meme/')) {
        const url = new URL(a.href);
        return url.pathname + url.search;
      }
    }
    return null;
  }

  function getTopRowImgSrc() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    if (!rows.length) return null;
    return Array.from(rows[0].querySelectorAll('img[class*="object-cover"]'))
      .find(img => img.src && !img.src.startsWith('data:'))?.src || null;
  }

  function forceLoadImages() {
    const panel = getPanel();
    if (!panel) return;
    panel.querySelectorAll('img').forEach(img => {
      if (img.loading === 'lazy') img.loading = 'eager';
      if (img.dataset.src && !img.src) img.src = img.dataset.src;
      img.getBoundingClientRect();
    });
  }

  function prefetch(name) {
    if (!name || userOpen || window.axiomUserOpen || name === lastPrefetched) return;

    const ca = getTopRowCA();
    if (ca) localStorage.setItem('axiomNewPairCA', ca);
    const memeHref = getTopRowMemeHref();
    if (memeHref) localStorage.setItem('axiomNewPairMemeHref', memeHref);

    console.log('🔄 Prefetch:', name);
    lastPrefetched = name;

    window.dispatchEvent(new CustomEvent('axiomPrefetchStart', { detail: { name } }));
    window.__gradSeq = (window.__gradSeq || 0) + 1;
    gradChannel.postMessage({ type: 'NEW_PAIR', name, refImgSrc: getTopRowImgSrc(), seq: window.__gradSeq });

    if (!getPanel()) {
      document.querySelector('[class*="ri-search"]')?.closest('button')?.click();
      requestAnimationFrame(() => {
        forceHidePanelInstant();
        if (!userOpen && !window.axiomUserOpen) {
          typeInPanel(name);
          forceLoadImages();
        }
      });
    } else {
      forceHidePanelInstant();
      typeInPanel(name);
      forceLoadImages();
    }
  }

  document.addEventListener('click', (e) => {
    const searchBtn = e.target.closest('[class*="ri-search"]')?.closest('button');
    if (searchBtn) { userOpen = true; setTimeout(() => bringToFront(), 10); return; }
    const menuItem = e.target.closest('[role="menuitem"]');
    if (menuItem && menuItem.textContent?.includes('Search for')) {
      userOpen = true; setTimeout(() => bringToFront(), 10);
    }
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      userOpen = false;
      window.axiomUserOpen = false;
      lastPrefetched = null;
      setTimeout(() => {
        const rows = document.querySelectorAll('[class*="group/pulseRow"]');
        if (rows.length) {
          const name = getTokenName(rows[0]);
          if (name) { lastRowName = name; prefetch(name); }
        }
      }, 500);
    }
  }, true);

  const observer = new MutationObserver(() => {
    if (!userOpen && !window.axiomUserOpen) forceHidePanelInstant();

    const panelExists = !!getPanel();

    if (userOpen && !panelExists) {
      userOpen = false;
      lastPrefetched = null;
      setTimeout(() => {
        const rows = document.querySelectorAll('[class*="group/pulseRow"]');
        if (rows.length) {
          const name = getTokenName(rows[0]);
          if (name) { lastRowName = name; prefetch(name); }
        }
      }, 500);
    }

    if (!userOpen && !window.axiomUserOpen) {
      const rows = document.querySelectorAll('[class*="group/pulseRow"]');
      if (!rows.length) return;
      const name = getTokenName(rows[0]);
      if (name && name !== lastRowName) { lastRowName = name; prefetch(name); }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // On page load, immediately scan top row without waiting for DOM change
  (function tryInitialScan() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    if (rows.length) {
      const name = getTokenName(rows[0]);
      if (name && name !== lastRowName) { lastRowName = name; prefetch(name); return; }
    }
    setTimeout(tryInitialScan, 50);
  })();

  console.log('🚀 Axiom Prefetch v5.9 (SIN DELAY) — broadcasts NEW_PAIR to Tab2');
})();

// ==UserScript==
// @name         Axiom - CA Buyer Receiver
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20CA%20Buyer%20Receiver%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20CA%20Buyer%20Receiver%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  const IS_BUYER = new URLSearchParams(location.search).get('tab') === 'buyer';
  if (!IS_BUYER) return;

  const channel = new BroadcastChannel('axiom-tabs');
  let pendingCA = null;

  function getPanel() {
    return [...document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]')]
      .find(el => el.querySelector('input') || el.querySelector('[class*="group/quickBuyButton"]')) || null;
  }

  function expandPanel(panel) {
    if (panel.dataset.expanded) return;
    panel.dataset.expanded = 'true';
    panel.style.setProperty('max-height', '90vh', 'important');
    panel.style.setProperty('height', '90vh', 'important');
  }

  function ensurePanelOpen(cb) {
    const existing = getPanel();
    if (existing) { expandPanel(existing); cb(); return; }
    const searchBtn = document.querySelector('[class*="ri-search"]')?.closest('button');
    if (!searchBtn) { console.log('❌ Buyer: no search btn'); return; }
    searchBtn.click();
    const wait = setInterval(() => {
      const panel = getPanel();
      if (panel) { clearInterval(wait); expandPanel(panel); cb(); }
    }, 30);
    setTimeout(() => clearInterval(wait), 3000);
  }

  function typeInPanel(text) {
    const panel = getPanel();
    const input = panel?.querySelector('input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function fireClick(el) {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(ev =>
      el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    );
  }

  function executeBuy(ca) {
    const t0 = performance.now();
    ensurePanelOpen(() => {
      const panel = getPanel();
      if (!panel) { console.log('❌ Buyer: no panel'); return; }
      const prevBtns = new Set(panel.querySelectorAll('[class*="group/quickBuyButton"]'));
      typeInPanel(ca);
      const start = Date.now();
      const poll = () => {
        const fresh = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')]
          .filter(b => !prevBtns.has(b));
        if (fresh.length > 0) {
          fireClick(fresh[0]);
          console.log('✅ Buyer: bought', ca, 'in', (performance.now() - t0).toFixed(0), 'ms');
          return;
        }
        if (Date.now() - start > 2000) { console.log('⏰ Buyer: timeout'); return; }
        setTimeout(poll, 20);
      };
      setTimeout(poll, 30);
    });
  }

  // Pre-open panel on load
  setTimeout(() => {
    ensurePanelOpen(() => {
      console.log('✅ Buyer ready — panel pre-opened');
    });
  }, 1000);

  channel.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'EXECUTE_BUY_CA' && msg.ca) {
      console.log('📨 Buyer received CA:', msg.ca);
      window.focus();
      executeBuy(msg.ca);
    }
  };

  console.log('🛒 Axiom CA Buyer Receiver v1.0 active — waiting for EXECUTE_BUY_CA');
})();

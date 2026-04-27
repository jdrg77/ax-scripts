// ==UserScript==
// @name         Axiom Buyer Ring - Slot
// @namespace    http://tampermonkey.net/
// @version      1.1
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20Buyer%20Ring%20-%20Slot%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20Buyer%20Ring%20-%20Slot%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  if (params.get('role') !== 'buyer') return;
  const SLOT = params.get('slot');
  if (!['A', 'B', 'C'].includes(SLOT)) return;

  const channel = new BroadcastChannel('axiom-buyer-ring');
  let armedCA   = null;

  document.title = `🛒 Buyer ${SLOT}`;

  function getPanel() {
    return [...document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]')]
      .find(el => el.querySelector('input') || el.querySelector('[class*="group/quickBuyButton"]')) || null;
  }

  function expandPanel(panel) {
    panel.style.setProperty('max-height', '90vh', 'important');
    panel.style.setProperty('height', '90vh', 'important');
  }

  function ensurePanelOpen(cb, retries = 0) {
    if (retries > 50) { console.warn(`[SLOT ${SLOT}] ensurePanelOpen: max retries`); return; }
    const existing = getPanel();
    if (existing) { expandPanel(existing); cb(); return; }
    const searchBtn = document.querySelector('[class*="ri-search"]')?.closest('button');
    if (!searchBtn) { setTimeout(() => ensurePanelOpen(cb, retries + 1), 200); return; }
    searchBtn.click();
    const wait = setInterval(() => {
      const panel = getPanel();
      if (panel) { clearInterval(wait); expandPanel(panel); cb(); }
    }, 30);
    setTimeout(() => clearInterval(wait), 3000);
  }

  function clearPanel() {
    const panel = getPanel();
    const input = panel?.querySelector('input');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
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
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(ev =>
      el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, clientX: cx, clientY: cy }))
    );
  }

  function rearmWithCA(ca) {
    armedCA = ca;
    ensurePanelOpen(() => {
      const panel = getPanel();
      if (!panel) return;

      clearPanel();
      setTimeout(() => {
        if (armedCA !== ca) return; // Superseded by newer REARM
        typeInPanel(ca);

        const start = Date.now();
        const poll = () => {
          if (armedCA !== ca) return;
          const btns = panel.querySelectorAll('[class*="group/quickBuyButton"]');
          if (btns.length > 0) {
            channel.postMessage({ type: 'READY', slot: SLOT, ca });
            console.log(`[SLOT ${SLOT}] READY for ${ca.slice(0, 8)}`);
            return;
          }
          if (Date.now() - start > 3000) { console.log(`[SLOT ${SLOT}] timeout arming`); return; }
          setTimeout(poll, 30);
        };
        setTimeout(poll, 50);
      }, 50);
    });
  }

  function executeBuy(ca) {
    const panel = getPanel();
    if (!panel) { console.log(`[SLOT ${SLOT}] no panel`); return; }
    const btns = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')];
    if (!btns.length) {
      // Buttons not ready yet — retry once
      setTimeout(() => {
        const panel2 = getPanel();
        if (!panel2) return;
        const btns2 = [...panel2.querySelectorAll('[class*="group/quickBuyButton"]')];
        if (btns2.length) {
          fireClick(btns2[0]);
          console.log(`[SLOT ${SLOT}] ✅ BUY (retry) ${ca.slice(0, 8)}`);
        } else {
          console.log(`[SLOT ${SLOT}] ❌ no buttons after retry`);
        }
      }, 200);
      return;
    }
    fireClick(btns[0]);
    console.log(`[SLOT ${SLOT}] ✅ BUY ${ca.slice(0, 8)}`);
  }

  channel.onmessage = (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'REARM' && msg.slot === SLOT && msg.ca) rearmWithCA(msg.ca);
    if (msg.type === 'BUY'   && msg.slot === SLOT && msg.ca) executeBuy(msg.ca);
  };

  setTimeout(() => ensurePanelOpen(() => {
    console.log(`[SLOT ${SLOT}] panel pre-opened, ready`);
  }), 1500);

  console.log(`[SLOT ${SLOT}] Buyer Ring Slot v1.1 active`);
})();

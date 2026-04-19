// ==UserScript==
// @name         Axiom - Mark Special Tokens (Exact Match Fast)
// @namespace    http://tampermonkey.net/
// @version      9.1
// @match        *://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Mark%20Special%20Tokens%20(Exact%20Match%20Fast)-9.1.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Mark%20Special%20Tokens%20(Exact%20Match%20Fast)-9.1.user.js
// ==/UserScript==
(function () {
  'use strict';
  const specialTokens = new Map();
  const TTL = 60000;
  let scanTimeout = null;
  function getTokenName(row) {
    const truncate = row.querySelector('[class*="truncate"]');
    if (!truncate) return null;
    const name = truncate.textContent.trim();
    if (!name || name.match(/^\d+$/)) return null;
    return name;
  }
  function checkQuickBuyColor(qbButton) {
    const bgColor = qbButton.style.background || '';
    if (bgColor.includes('255, 215, 0')) return 'gold';
    if (bgColor.includes('120, 255, 160')) return 'green';
    return null;
  }
  function scanSearchPanel() {
    const searchPanel = document.querySelector('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
    if (!searchPanel || !searchPanel.querySelector('input')) return;
    const rows = searchPanel.querySelectorAll('[class*="cursor-pointer"][class*="flex-row"][class*="items-center"]');
    rows.forEach(row => {
      const tokenName = getTokenName(row);
      if (!tokenName) return;
      const qbButton = row.querySelector('[class*="group/quickBuyButton"]');
      if (!qbButton) return;
      const color = checkQuickBuyColor(qbButton);
      if (!color) return;
      const key = tokenName.toLowerCase();
      const existing = specialTokens.get(key);
      if (!existing || (existing.color === 'green' && color === 'gold')) {
        specialTokens.set(key, { color, timestamp: Date.now() });
        console.log(`✨ ${tokenName} → ${color}`);
        applyMarks();
      } else {
        existing.timestamp = Date.now();
      }
    });
  }
  function cleanExpired() {
    const now = Date.now();
    for (const [name, data] of specialTokens.entries()) {
      if (now - data.timestamp > TTL) {
        specialTokens.delete(name);
      }
    }
  }
  function applyMarks() {
    const pulseRows = document.querySelectorAll('[class*="group/pulseRow"]');
    pulseRows.forEach(row => {
      const tokenName = getTokenName(row);
      if (!tokenName) return;
      const key = tokenName.toLowerCase();
      const data = specialTokens.get(key);
      if (!data) {
        row.style.removeProperty('border-top');
        row.style.removeProperty('box-shadow');
        return;
      }
      if (data.color === 'gold') {
        row.style.setProperty('border-top', '4px solid rgb(255, 215, 0)', 'important');
        row.style.setProperty('box-shadow', '0 -5px 14px rgba(255, 215, 0, 0.6)', 'important');
      } else if (data.color === 'green') {
        row.style.setProperty('border-top', '4px solid rgb(120, 255, 160)', 'important');
        row.style.setProperty('box-shadow', '0 -5px 14px rgba(120, 255, 160, 0.6)', 'important');
      }
    });
  }
  const observer = new MutationObserver(() => {
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      scanSearchPanel();
      scanTimeout = null;
    }, 15);
  });
  observer.observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['style']
  });
  setInterval(() => applyMarks(), 1000);
  setInterval(() => { cleanExpired(); applyMarks(); }, 10000);
  setTimeout(() => { scanSearchPanel(); applyMarks(); }, 500);
  window.specialTokensDebug = {
    list: () => Array.from(specialTokens.entries()).map(([name, data]) => ({
      name, color: data.color,
      age: Math.floor((Date.now() - data.timestamp) / 1000) + 's'
    })),
    count: () => specialTokens.size,
    clear: () => { specialTokens.clear(); applyMarks(); }
  };
  console.log('🚀 Axiom Mark Special Tokens v9.1 (Case Insensitive)');
})();
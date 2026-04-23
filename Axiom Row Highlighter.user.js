// ==UserScript==
// @name         Axiom Row Highlighter
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Pump bordes, Pump+DEX full verde claro + QB verde, Bonk naranja, migrados glow + botón dorado
// @author       vos
// @match        *://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20Row%20Highlighter.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20Row%20Highlighter.user.js
// ==/UserScript==
(function () {
  'use strict';
  const style = document.createElement('style');
  style.textContent = `
    [class*="bg-backgroundTertiary"] div[style*="max-width"] {
      max-width: none !important;
      white-space: nowrap !important;
      overflow: visible !important;
    }
  `;
  document.head.appendChild(style);
  const PUMP_COLOR       = '0, 200, 80';
  const PUMP_DEX_COLOR   = '120, 255, 160'; // verde más claro
  const BONK_COLOR       = '255, 140, 0';
  const RAYDIUM_COLOR    = '0, 51, 255';
  const MIGRATED_COLOR   = '255, 240, 0';
  const QB_COLOR         = '255, 215, 0';

  function highlightRows() {
    const searchPanel = document.querySelector('[class*="bg-backgroundTertiary"]');
    if (!searchPanel) return;
    const rows = searchPanel.querySelectorAll('[class*="cursor-pointer"][class*="flex-row"][class*="items-center"]');
    rows.forEach(row => {
      // RESET
      row.style.boxShadow = '';
      row.style.borderRadius = '';
      row.style.background = '';
      row.style.border = '';
      const photoBox = row.querySelector('div.relative');
      if (photoBox) photoBox.style.boxShadow = '';
      row.querySelectorAll('button').forEach(btn => {
        btn.style.background = '';
        btn.style.color = '';
      });
      const isMigrated  = !!row.querySelector('[style*="FFD700"], [style*="ffd700"], img[src*="-grad"]');
      const isBonk      = !!row.querySelector('img[src*="bonk"]');
      const isRaydium   = !!row.querySelector('img[src*="pump-grad.svg"][alt="Raydium V4"]');
      const isPump      = !isRaydium && !!row.querySelector('img[src*="pump"]');
      const hasDex      = !!row.querySelector('[class*="icon-dex-paid"]');

      // RAYDIUM V4
      if (isRaydium) {
        row.style.borderRadius = '8px';
        row.style.background = `rgba(${RAYDIUM_COLOR}, 0.07)`;
        row.style.boxShadow = `0 0 12px rgba(${RAYDIUM_COLOR}, 0.35)`;
        const qbBtn = row.querySelector('[class*="bg-primaryBlue"]');
        if (qbBtn) {
          qbBtn.style.setProperty('background', `rgb(${RAYDIUM_COLOR})`, 'important');
          qbBtn.style.color = '#fff';
        }
      }
      // BONK
      else if (isBonk) {
        row.style.borderRadius = '8px';
        row.style.background = `rgba(${BONK_COLOR}, 0.07)`;
        row.style.boxShadow = `0 0 12px rgba(${BONK_COLOR}, 0.35)`;
      }
      // PUMP + DEX → FULL ROW + QB VERDE
      else if (isPump && !isMigrated && hasDex) {
        row.style.borderRadius = '8px';
        row.style.background = `rgba(${PUMP_DEX_COLOR}, 0.10)`;
        row.style.boxShadow = `0 0 14px rgba(${PUMP_DEX_COLOR}, 0.6)`;
        row.style.border = `1px solid rgba(${PUMP_DEX_COLOR}, 0.5)`;

        // QB VERDE CLARO
        const qbBtn = row.querySelector('[class*="bg-primaryBlue"]');
        if (qbBtn) {
          qbBtn.style.background = `rgb(${PUMP_DEX_COLOR})`;
          qbBtn.style.color = '#000';
        }
      }
      // PUMP NORMAL → SOLO BORDES
      else if (isPump && !isMigrated) {
        row.style.borderRadius = '8px';
        row.style.boxShadow = `0 0 12px rgba(${PUMP_COLOR}, 0.4)`;
        row.style.border = `1px solid rgba(${PUMP_COLOR}, 0.3)`;
      }
      // MIGRATED GLOW
      if (isMigrated && photoBox) {
        photoBox.style.boxShadow = `
          0 0 5px 1px rgba(${MIGRATED_COLOR}, 0.9),
          0 0 10px 2px rgba(${MIGRATED_COLOR}, 0.3)
        `;
      }
      // QB DORADO (para migrados)
      if (isMigrated) {
        const qbBtn = row.querySelector('[class*="bg-primaryBlue"]');
        if (qbBtn) {
          qbBtn.style.background = `rgb(${QB_COLOR})`;
          qbBtn.style.color = '#000';
        }
      }
    });
  }
  // Observer acotado al panel + debounce con RAF + takeRecords() para evitar auto-loop
  let rafPending = false;
  let currentObserver = null;
  let currentPanel = null;

  function scheduleHighlight() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      highlightRows();
      currentObserver?.takeRecords(); // descarta mutations generadas por nuestros propios cambios
    });
  }

  function attachObserver() {
    const panel = document.querySelector('[class*="bg-backgroundTertiary"]');
    if (panel === currentPanel && currentObserver) return;

    if (currentObserver) {
      currentObserver.disconnect();
      currentObserver = null;
      currentPanel = null;
    }

    if (!panel) return;

    currentPanel = panel;
    currentObserver = new MutationObserver(scheduleHighlight);
    currentObserver.observe(panel, { childList: true, subtree: true });
    scheduleHighlight();
  }

  attachObserver();
  setInterval(attachObserver, 1000); // re-attach si el panel se recrea
})();
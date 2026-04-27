// ==UserScript==
// @name         Axiom Buyer Ring - Master
// @namespace    http://tampermonkey.net/
// @version      1.1
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20Buyer%20Ring%20-%20Master%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20Buyer%20Ring%20-%20Master%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  if (params.get('role') === 'buyer' || params.get('tab') === 'grad') return;

  const channel   = new BroadcastChannel('axiom-buyer-ring');
  const SLOTS     = ['A', 'B', 'C'];
  const slotState = { A: { ca: null, ready: false }, B: { ca: null, ready: false }, C: { ca: null, ready: false } };
  let nextSlotIdx = 0;

  function getRowsWithBest() {
    const newPairsHeader = Array.from(document.querySelectorAll('*'))
      .find(el => el.children.length < 5 && el.textContent.trim() === 'New Pairs');
    if (!newPairsHeader) return [];
    const col = newPairsHeader.parentElement?.parentElement?.parentElement;
    if (!col) return [];
    const virtualList = Array.from(col.querySelectorAll('div')).find(div => {
      const s = div.getAttribute('style') || '';
      return s.includes('position: relative') &&
             div.querySelectorAll('[style*="position: absolute"]').length > 3;
    });
    if (!virtualList) return [];
    const rows = Array.from(virtualList.querySelectorAll(':scope > [style*="position: absolute"]'));

    const result = [];
    for (let i = 0; i < Math.min(6, rows.length); i++) {
      const row      = rows[i];
      const memeLink = row.querySelector('a[href*="/meme/"]');
      const pumpLink = row.querySelector('a[href*="pump.fun/coin/"]');
      const pumpMatch = pumpLink?.href.match(/\/coin\/([A-Za-z0-9]{32,})/);
      const memeMatch = memeLink?.href.match(/\/meme\/([A-Za-z0-9]{32,})/);
      const rowCA = pumpMatch?.[1] || memeMatch?.[1] || null;
      if (!rowCA) continue;

      const hasBest = window.__axiomHasBestMatch?.(rowCA) || false;
      if (!hasBest) continue;

      const miniBtn = document.querySelector(`[data-qbm-mini="${rowCA}"]`);
      const bestPair = miniBtn?.dataset?.qbmPair || null;
      const buyCA   = bestPair || rowCA;
      result.push({ rowCA, buyCA });
    }
    return result;
  }

  function reconcileSlots() {
    const bestRows = getRowsWithBest();
    if (!bestRows.length) return; // No best matches — keep existing slots unchanged

    const alreadyCovered = new Set(SLOTS.map(s => slotState[s].ca).filter(Boolean));
    const newOnes = bestRows.filter(r => !alreadyCovered.has(r.buyCA));

    for (const { buyCA } of newOnes) {
      // Only assign to empty slots — never evict existing best-match slots
      let assigned = false;
      for (let attempts = 0; attempts < SLOTS.length; attempts++) {
        const slot = SLOTS[nextSlotIdx];
        nextSlotIdx = (nextSlotIdx + 1) % SLOTS.length;
        if (!slotState[slot].ca) {
          slotState[slot].ca    = buyCA;
          slotState[slot].ready = false;
          channel.postMessage({ type: 'REARM', slot, ca: buyCA });
          console.log(`[MASTER] REARM ${slot} → ${buyCA.slice(0, 8)}`);
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        // All slots full — evict oldest (round-robin) to make room for new best match
        const slot = SLOTS[nextSlotIdx];
        nextSlotIdx = (nextSlotIdx + 1) % SLOTS.length;
        slotState[slot].ca    = buyCA;
        slotState[slot].ready = false;
        channel.postMessage({ type: 'REARM', slot, ca: buyCA });
        console.log(`[MASTER] REARM (evict) ${slot} → ${buyCA.slice(0, 8)}`);
      }
    }

    renderUI();
  }

  channel.onmessage = (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'READY' && SLOTS.includes(msg.slot) && msg.ca) {
      if (slotState[msg.slot].ca === msg.ca) {
        slotState[msg.slot].ready = true;
        renderUI();
      }
    }
    if (msg.type === 'BUY_BY_CA' && msg.ca) {
      const slot = SLOTS.find(s => slotState[s].ca === msg.ca && slotState[s].ready);
      if (!slot) { console.log(`[MASTER] BUY_BY_CA: no ready slot for ${msg.ca.slice(0, 8)}`); return; }
      channel.postMessage({ type: 'BUY', slot, ca: msg.ca });
      console.log(`[MASTER] BUY_BY_CA → ${slot} ${msg.ca.slice(0, 8)}`);
      slotState[slot].ca    = null;
      slotState[slot].ready = false;
      renderUI();
      setTimeout(reconcileSlots, 100);
    }
  };

  let ui;
  function buildUI() {
    ui = document.createElement('div');
    ui.id = 'master-ring-ui';
    ui.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:99999;' +
      'display:flex;gap:6px;background:rgba(0,0,0,0.9);padding:8px 12px;border-radius:8px;' +
      'border:1px solid #444;font-family:monospace;';
    document.body.appendChild(ui);
    renderUI();
  }

  function renderUI() {
    if (!ui) return;
    ui.innerHTML = '';
    SLOTS.forEach((slot, i) => {
      const s      = slotState[slot];
      const btn    = document.createElement('button');
      const status = s.ready ? '✅' : (s.ca ? '⏳' : '⚪');
      btn.textContent = `${status} R${i + 2}(${slot})`;
      btn.style.cssText = `background:${s.ready ? '#1a4a1a' : '#222'};color:#fff;` +
        `border:1.5px solid ${s.ready ? '#4f4' : '#555'};border-radius:6px;` +
        `padding:7px 11px;cursor:${s.ready ? 'pointer' : 'not-allowed'};font:bold 12px monospace;`;
      btn.title = s.ca || 'empty';
      btn.onclick = () => {
        if (!s.ready) return;
        const ca = s.ca;
        channel.postMessage({ type: 'BUY', slot, ca });
        console.log(`[MASTER] BUY ${slot} → ${ca.slice(0, 8)}`);
        slotState[slot].ca    = null;
        slotState[slot].ready = false;
        renderUI();
        setTimeout(reconcileSlots, 100);
      };
      ui.appendChild(btn);
    });

    const launchBtn = document.createElement('button');
    launchBtn.textContent = '🚀';
    launchBtn.title = 'Open buyer tabs A/B/C';
    launchBtn.style.cssText = 'background:#444;color:#fff;border:1px solid #666;border-radius:6px;' +
      'padding:7px 10px;cursor:pointer;font:bold 12px monospace;margin-left:8px;';
    launchBtn.onclick = () => {
      ['A', 'B', 'C'].forEach(s =>
        window.open(`${location.origin}/pulse?role=buyer&slot=${s}`, '_blank')
      );
    };
    ui.appendChild(launchBtn);
  }

  buildUI();
  setInterval(reconcileSlots, 300);
  console.log('[MASTER] Buyer Ring Master v1.1 active');
})();

// ==UserScript==
// @name         Axiom - Grad Buy Bridge
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Grad%20Buy%20Bridge%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Grad%20Buy%20Bridge%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  const IS_GRAD = new URLSearchParams(location.search).get('tab') === 'grad';

  if (IS_GRAD) {
    // T2: listen for EXECUTE_BUY_GRAD, use React onClick directly
    new BroadcastChannel('axiom-tabs').onmessage = (e) => {
      if (e.data.type !== 'EXECUTE_BUY_GRAD') return;
      const { ticker, name, ca } = e.data;

      const panel = [...document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]')]
        .find(el => el.querySelector('input') || el.querySelector('[class*="group/quickBuyButton"]'));
      if (!panel) { console.log('🌉 Bridge T2: no panel'); return; }

      const btns = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')];
      for (const btn of btns) {
        let el = btn.parentElement, row = null;
        for (let i = 0; i < 6; i++) {
          if (el?.className?.includes('max-h-[64px]')) { row = el; break; }
          el = el?.parentElement;
        }
        if (!row) continue;
        let rowCA = '';
        for (const a of row.querySelectorAll('a[href]')) {
          const h = a.href;
          if (h.includes('pump.fun')) { const m = h.match(/\/coin\/([A-Za-z0-9]{32,})/); if (m) { rowCA = m[1]; break; } }
          else if (h.includes('bonk'))  { const m = h.match(/\/([A-Za-z0-9]{32,})/);      if (m) { rowCA = m[1]; break; } }
          else if (h.includes('/meme/') && !rowCA) { const m = h.match(/\/meme\/([A-Za-z0-9]{32,})/); if (m) rowCA = m[1]; }
        }
        const matched = ca ? (rowCA && ca === rowCA) : true;
        if (!matched) continue;
        const pk = Object.keys(btn).find(k => k.startsWith('__reactProps$'));
        if (pk && btn[pk]?.onClick) {
          console.log('🌉 Bridge T2 react click:', ticker || name);
          btn[pk].onClick(new MouseEvent('click', { bubbles: true }));
        } else {
          console.log('🌉 Bridge T2 fireClick:', ticker || name);
          const r = btn.getBoundingClientRect();
          ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(ev =>
            btn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 }))
          );
        }
        break;
      }
    };
    console.log('🌉 Grad Buy Bridge T2 active');

  } else {
    // T1: capture grad proxy clicks
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn?._isGradProxy) console.log('🌉 Bridge T1 grad click:', btn._gradToken);
    }, true);
    console.log('🌉 Grad Buy Bridge T1 active');
  }
})();

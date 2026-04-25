// ==UserScript==
// @name         Axiom - GMGN Bridge
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://axiom.trade/*
// @match        https://gmgn.ai/*
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20GMGN%20Bridge%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20GMGN%20Bridge%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (location.hostname.includes('axiom.trade')) {

    function extractCAFromRow(row) {
      for (const a of row.querySelectorAll('a[href]')) {
        const h = a.href;
        let m;
        if (h.includes('pump.fun')) m = h.match(/\/coin\/([A-Za-z0-9]{32,})/);
        else if (h.includes('bonk'))   m = h.match(/\/([A-Za-z0-9]{32,})/);
        else if (h.includes('/meme/')) m = h.match(/\/meme\/([A-Za-z0-9]{32,})/);
        if (m) return m[1];
      }
      return null;
    }

    document.addEventListener('mousedown', (e) => {
      let ca = null;

      // QBuy button click — walk up looking for _ca
      let el = e.target;
      while (el) {
        if (el._ca) { ca = el._ca; break; }
        el = el.parentElement;
      }

      // Image click in pulseRow
      if (!ca) {
        const img = e.target.closest('img[class*="object-cover"]');
        if (img) {
          const row = img.closest('[class*="group/pulseRow"]');
          if (row) ca = extractCAFromRow(row);
        }
      }

      if (ca) {
        GM_setValue('axiom_gmgn_ca', JSON.stringify({ ca, t: Date.now() }));
        console.log('[GMGN Bridge] CA enviado:', ca);
      }
    }, true);

    console.log('🚀 GMGN Bridge — Axiom side loaded');
  }

  if (location.hostname.includes('gmgn.ai')) {
    GM_addValueChangeListener('axiom_gmgn_ca', (name, old_val, new_val, remote) => {
      if (!remote || !new_val) return;
      try {
        const { ca } = JSON.parse(new_val);
        if (ca) {
          console.log('[GMGN Bridge] Navegando a:', ca);
          window.location.href = `https://gmgn.ai/sol/token/${ca}`;
        }
      } catch (e) {}
    });

    console.log('🚀 GMGN Bridge — GMGN side loaded');
  }

})();

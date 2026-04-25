// ==UserScript==
// @name         Axiom - GMGN Bridge
// @namespace    http://tampermonkey.net/
// @version      1.3
// @match        https://axiom.trade/*
// @match        https://gmgn.ai/*
// @match        https://*.gmgn.ai/*
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20GMGN%20Bridge%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20GMGN%20Bridge%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';

  if (location.hostname.includes('axiom.trade')) {

    function sendCA(ca) {
      if (!ca) return;
      GM_setValue('axiom_gmgn_ca', JSON.stringify({ ca, t: Date.now() }));
      console.log('[GMGN Bridge] CA enviado:', ca);
    }

    document.addEventListener('mousedown', (e) => {
      // Best Match mini button — usa rowCA (data-qbm-mini)
      const miniBtn = e.target.closest('[data-qbm-mini]');
      if (miniBtn) {
        const rowCA = miniBtn.getAttribute('data-qbm-mini');
        if (rowCA) { sendCA(rowCA); return; }
      }

      // QBuy 17.221 button — usa newPairCA de localStorage
      let el = e.target;
      while (el && el !== document.body) {
        if (el.tagName === 'BUTTON' && el.style?.position === 'fixed' && el.style?.zIndex === '9999' && !el.getAttribute('data-qbm-mini')) {
          const newPairCA = localStorage.getItem('axiomNewPairCA');
          if (newPairCA) { sendCA(newPairCA); return; }
          break;
        }
        el = el.parentElement;
      }
    }, true);

    console.log('🚀 GMGN Bridge v1.3 — Axiom side loaded');
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

// ==UserScript==
// @name         Axiom - GMGN Bridge
// @namespace    http://tampermonkey.net/
// @version      1.2
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

    // Intercept history.pushState — catches QBuy button clicks, mini button image clicks,
    // and pulseRow image clicks that navigate to /meme/{CA}
    const origPushState = history.pushState.bind(history);
    history.pushState = function (state, title, url) {
      origPushState(state, title, url);
      const m = (url || '').toString().match(/\/meme\/([A-Za-z0-9]{32,})/);
      if (m) sendCA(m[1]);
    };

    window.addEventListener('popstate', () => {
      const m = location.pathname.match(/\/meme\/([A-Za-z0-9]{32,})/);
      if (m) sendCA(m[1]);
    });

    console.log('🚀 GMGN Bridge v1.2 — Axiom side loaded');
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

// ==UserScript==
// @name         Axiom - GMGN Bridge
// @namespace    http://tampermonkey.net/
// @version      1.7
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

  const GMGN_HOME = 'https://gmgn.ai/?chain=sol&ref=j4dra';

  if (location.hostname.includes('axiom.trade')) {

    function sendCA(ca) {
      if (!ca) return;
      GM_setValue('axiom_gmgn_ca', JSON.stringify({ ca, t: Date.now() }));
      console.log('[GMGN Bridge] CA enviado:', ca);
    }

    function sendURL(url) {
      GM_setValue('axiom_gmgn_url', JSON.stringify({ url, t: Date.now() }));
      console.log('[GMGN Bridge] URL enviada:', url);
    }

    function readTopNewPairCA() {
      const col = Array.from(document.querySelectorAll('span'))
        .find(s => s.textContent.trim() === 'New Pairs')
        ?.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
      const ca = Array.from(col?.querySelectorAll('a[href*="pump.fun/coin/"]') || [])[0]
        ?.href?.match(/pump\.fun\/coin\/([A-Za-z0-9]+)/)?.[1];
      if (ca) localStorage.setItem('axiomTopPairCA', ca);
      return ca || null;
    }

    readTopNewPairCA();
    const pairObserver = new MutationObserver(readTopNewPairCA);
    pairObserver.observe(document.body, { childList: true, subtree: true });

    document.addEventListener('mousedown', (e) => {
      // Boton Flex — abre GMGN home
      const flexBtn = e.target.closest('button[class*="text-nowrap"][class*="text-primaryBlue"]');
      if (flexBtn) { sendURL(GMGN_HOME); return; }

      // Best Match mini button — usa rowCA (data-qbm-mini)
      const miniBtn = e.target.closest('[data-qbm-mini]');
      if (miniBtn) {
        const rowCA = miniBtn.getAttribute('data-qbm-mini');
        if (rowCA) { sendCA(rowCA); return; }
      }

      // Axiom panel Buy #N buttons — usa axiomTopPairCA (seteado por readTopNewPairCA)
      const panelBtn = e.target.closest('[class*="group/quickBuyButton"]');
      if (panelBtn) {
        const ca = localStorage.getItem('axiomTopPairCA');
        if (ca) { sendCA(ca); return; }
      }

      // QBuy 17.221 button — usa axiomTopPairCA
      let el = e.target;
      while (el && el !== document.body) {
        if (el.style?.position === 'fixed' && el.style?.zIndex === '9999' && el.querySelector?.('.qb-sim-badge')) {
          const ca = localStorage.getItem('axiomTopPairCA');
          if (ca) { sendCA(ca); return; }
          break;
        }
        el = el.parentElement;
      }
    }, true);

    console.log('🚀 GMGN Bridge v1.7 — Axiom side loaded');
  }

  if (location.hostname.includes('gmgn.ai')) {
    GM_addValueChangeListener('axiom_gmgn_ca', (name, old_val, new_val, remote) => {
      if (!remote || !new_val) return;
      try {
        const { ca } = JSON.parse(new_val);
        if (ca) {
          console.log('[GMGN Bridge] Navegando a token:', ca);
          window.location.href = `https://gmgn.ai/sol/token/${ca}`;
        }
      } catch (e) {}
    });

    GM_addValueChangeListener('axiom_gmgn_url', (name, old_val, new_val, remote) => {
      if (!remote || !new_val) return;
      try {
        const { url } = JSON.parse(new_val);
        if (url) {
          console.log('[GMGN Bridge] Navegando a URL:', url);
          window.location.href = url;
        }
      } catch (e) {}
    });

    console.log('🚀 GMGN Bridge — GMGN side loaded');
  }

})();

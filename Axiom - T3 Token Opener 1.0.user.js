// ==UserScript==
// @name         Axiom - T3 Token Opener
// @namespace    http://tampermonkey.net/
// @version      1.0
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20T3%20Token%20Opener%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20T3%20Token%20Opener%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') !== 't3') return;

  const channel = new BroadcastChannel('axiom-tabs');
  channel.onmessage = (e) => {
    if (e.data.type === 'OPEN_IN_T3' && e.data.ca) {
      window.location.href = 'https://axiom.trade/meme/' + e.data.ca;
    }
  };

  console.log('📺 T3 Token Opener v1.0 active');
})();

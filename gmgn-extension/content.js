(function () {
  'use strict';

  console.log('[AX-GMGN] content script loaded');

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type !== 'AX_OPEN_GMGN' || !e.data?.ca) return;
    console.log('[AX-GMGN] postMessage recibido, CA:', e.data.ca);
    chrome.runtime.sendMessage({ type: 'OPEN_GMGN', ca: e.data.ca }, (res) => {
      if (chrome.runtime.lastError) {
        console.error('[AX-GMGN] error:', chrome.runtime.lastError.message);
      } else {
        console.log('[AX-GMGN] mensaje enviado al background OK');
      }
    });
  });
})();

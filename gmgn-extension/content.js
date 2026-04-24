(function () {
  'use strict';

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type !== 'AX_OPEN_GMGN' || !e.data?.ca) return;
    chrome.runtime.sendMessage({ type: 'OPEN_GMGN', ca: e.data.ca });
  });
})();

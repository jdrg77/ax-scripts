(function () {
  'use strict';

  function getNewPairCA() {
    return localStorage.getItem('axiomNewPairCA') || null;
  }

  function sendToGMGN() {
    const ca = getNewPairCA();
    if (!ca) return;
    chrome.runtime.sendMessage({ type: 'OPEN_GMGN', ca });
  }

  document.addEventListener('click', (e) => {
    // Coin image click (normal buttons, grad proxies, best match)
    if (e.target.closest('img.qb-coin-img') || e.target.closest('img.qbm-coin-img')) {
      sendToGMGN();
      return;
    }

    // Buy button click — any of our fixed QBuy buttons
    const fixedBtn = e.target.closest('button[style*="position: fixed"][style*="z-index: 9999"]');
    if (fixedBtn && !fixedBtn.closest('img')) {
      sendToGMGN();
      return;
    }

    // Best match mini button click
    const miniBtn = e.target.closest('button[data-qbm-mini]');
    if (miniBtn) {
      sendToGMGN();
      return;
    }
  }, true); // capture: true para interceptar antes de stopPropagation
})();

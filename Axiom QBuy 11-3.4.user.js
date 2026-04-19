// ==UserScript==
// @name         Axiom QBuy 11
// @namespace    http://tampermonkey.net/
// @version      3.4
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─── Config ───────────────────────────────────────────────────────────────
  const SAMPLE_SIZE = 16;

  // ─── State ────────────────────────────────────────────────────────────────
  const addedBtns     = [];
  let scrollEl        = null;
  let lastPanel       = null;
  let isPanelVisible  = false;
  let hasActiveSearch = false;
  let updateTimeout   = null;

  let referencePixels = null;
  let referenceSource = null;

  // ─── Pixel helpers ────────────────────────────────────────────────────────

  function getPixels(src, cb) {
    if (!src || src.startsWith('blob:')) return cb(null);
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        const canvas = document.createElement('canvas');
        canvas.width  = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const raw = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
        cb(raw);
      } catch (e) {
        cb(null);
      }
    };
    img.onerror = () => cb(null);
    img.src = src.startsWith('data:') ? src : (src.includes('?') ? src : src + '?qb=1');
  }

  function pixelSimilarity(p1, p2) {
    if (!p1 || !p2) return null;
    const len    = Math.min(p1.length, p2.length);
    const pixels = len / 4;
    let sum = 0;
    for (let i = 0; i < len; i += 4) {
      const dr = Math.abs(p1[i]     - p2[i])     / 255;
      const dg = Math.abs(p1[i + 1] - p2[i + 1]) / 255;
      const db = Math.abs(p1[i + 2] - p2[i + 2]) / 255;
      sum += (dr + dg + db) / 3;
    }
    return parseFloat(((1 - sum / pixels) * 100).toFixed(1));
  }

  // ─── Reference image ──────────────────────────────────────────────────────

  function setReference(src) {
    if (!src || src === referenceSource) return;
    referenceSource = src;
    referencePixels = null;
    getPixels(src, (pixels) => {
      referencePixels = pixels;
      updateAllBadges();
    });
  }

  function getTopPulseRowImage() {
    const rows = document.querySelectorAll('[class*="group/pulseRow"]');
    if (!rows.length) return null;
    return rows[0].querySelector('img[class*="object-cover"]') || null;
  }

  window.qbSetReference = function (src) { setReference(src); };

  // ─── Badge ────────────────────────────────────────────────────────────────

  function badgeColor(pct) {
    if (pct === null) return '#888';
    if (pct >= 75)   return '#78ffa0';
    if (pct >= 50)   return '#ffd700';
    return '#ff6b6b';
  }

  function getOrCreateBadge(newBtn) {
    let badge = newBtn.querySelector('.qb-sim-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'qb-sim-badge';
      badge.style.cssText = `
        position: absolute;
        left: -88px;
        top: -10px;
        font-size: 11px;
        font-weight: 700;
        font-family: monospace;
        color: #fff;
        background: rgba(0,0,0,0.72);
        border-radius: 8px;
        padding: 1px 5px;
        pointer-events: none;
        white-space: nowrap;
        border: 1px solid currentColor;
        z-index: 10001;
        transition: color 0.3s;
      `;
      newBtn.appendChild(badge);
    }
    return badge;
  }

  function updateBadge(newBtn) {
    const badge       = getOrCreateBadge(newBtn);
    const originalBtn = newBtn._original;
    if (!originalBtn) return;

    const coinImg = getCoinImage(originalBtn);
    if (!coinImg || !coinImg.src) {
      badge.textContent = '—';
      badge.style.color = '#888';
      return;
    }

    if (!referencePixels) {
      badge.textContent = '…';
      badge.style.color = '#888';
      return;
    }

    getPixels(coinImg.src, (rowPixels) => {
      const pct = pixelSimilarity(referencePixels, rowPixels);
      if (pct === null) {
        badge.textContent = '?';
        badge.style.color = '#888';
      } else {
        badge.textContent       = pct.toFixed(1) + '%';
        badge.style.color       = badgeColor(pct);
        badge.style.borderColor = badgeColor(pct);
      }
    });
  }

  function updateAllBadges() {
    addedBtns.forEach(btn => updateBadge(btn));
  }

  // ─── Existing helpers ─────────────────────────────────────────────────────

  function fireClick(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(ev => {
      el.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }));
    });
  }

  function removeButtons() {
    addedBtns.forEach(btn => btn.remove());
    addedBtns.length = 0;
  }

  function shouldShowButton(originalBtn) {
    const bgColor = originalBtn.style.background || '';
    const isGold  = bgColor.includes('255, 215, 0');
    const isGreen = bgColor.includes('120, 255, 160');
    if (isPanelVisible && hasActiveSearch) return true;
    return isGold || isGreen;
  }

  function getCoinImage(originalBtn) {
    const row = originalBtn.closest('[class*="max-h-[64px]"]');
    return row?.querySelector('img[class*="object-cover"]') || null;
  }

  function updatePositions() {
    addedBtns.forEach(newBtn => {
      const originalBtn = newBtn._original;
      if (!originalBtn) return;

      const rect = originalBtn.getBoundingClientRect();
      newBtn.style.left = (rect.left - 621.5) + 'px';
      newBtn.style.top  = rect.top + 'px';

      if (rect.top < 50 || rect.bottom > window.innerHeight + 200) {
        newBtn.style.display = 'none';
        return;
      }

      newBtn.style.display = shouldShowButton(originalBtn) ? '' : 'none';

      const coinImg = getCoinImage(originalBtn);
      const imgEl   = newBtn.querySelector('img.qb-coin-img');
      if (coinImg && imgEl && imgEl.src !== coinImg.src) {
        imgEl.src = coinImg.src;
        updateBadge(newBtn);
      }
    });
  }

  function scheduleUpdate() {
    if (updateTimeout) return;
    updateTimeout = setTimeout(() => {
      updatePositions();
      updateTimeout = null;
    }, 50);
  }

  function isSearchPanel(el) {
    if (el.closest('[data-rht-toaster]')) return false;
    if (el.className.toString().includes('animate-enter-bottom')) return false;
    if (el.querySelector('input, [class*="History"], [class*="Results"]')) return true;
    if (el.querySelector('[class*="group/quickBuyButton"]')) return true;
    return false;
  }

  function expandPanel(panel) {
    if (panel.dataset.expanded) return;
    panel.dataset.expanded = 'true';
    panel.style.setProperty('max-height', '90vh', 'important');
    panel.style.setProperty('height', '90vh', 'important');
    const wrapper = panel.parentElement;
    if (wrapper) {
      const current = wrapper.style.transform;
      const match   = current.match(/translate\((.+)px,\s*(.+)px\)/);
      if (match) {
        wrapper.style.transform = `translate(${parseFloat(match[1])}px, ${parseFloat(match[2]) + 50}px)`;
      } else {
        wrapper.style.marginTop = '50px';
      }
    }
  }

  function checkPanelState(panel) {
    if (!panel) {
      isPanelVisible  = false;
      hasActiveSearch = false;
      return;
    }
    const wrapper    = panel.parentElement;
    const zIndex     = wrapper?.style.zIndex;
    const wasVisible = isPanelVisible;
    const hadSearch  = hasActiveSearch;

    isPanelVisible  = (!zIndex || zIndex !== '-9999');
    const input      = panel.querySelector('input');
    const inputValue = input?.value?.trim() || '';
    hasActiveSearch  = inputValue.length > 0;

    if (wasVisible !== isPanelVisible || hadSearch !== hasActiveSearch) {
      scheduleUpdate();
    }
  }

  // ─── Click: set reference only from pulse rows outside the panel ──────────

  document.addEventListener('click', (e) => {
    const clickedImg = e.target.closest('img[class*="object-cover"]');
    if (!clickedImg?.src || clickedImg.src.startsWith('data:')) return;

    const panel = [...document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]')]
      .find(el => isSearchPanel(el));
    if (panel && panel.contains(clickedImg)) return;

    setReference(clickedImg.src);
  }, true);

  // ─── Main addButtons ──────────────────────────────────────────────────────

  function addButtons() {
    const candidates = document.querySelectorAll('[class*="bg-backgroundTertiary"][class*="pointer-events-auto"]');
    const panel      = [...candidates].find(el => isSearchPanel(el));

    if (!panel) {
      removeButtons();
      if (scrollEl) { scrollEl.removeEventListener('scroll', updatePositions); scrollEl = null; }
      lastPanel       = null;
      isPanelVisible  = false;
      hasActiveSearch = false;
      return;
    }

    checkPanelState(panel);

    const panelRect = panel.getBoundingClientRect();
    if (panelRect.left < 0 || panelRect.top < 0 || panelRect.width < 100) return;

    if (panel !== lastPanel) {
      removeButtons();
      if (scrollEl) { scrollEl.removeEventListener('scroll', updatePositions); scrollEl = null; }
      lastPanel = panel;
      expandPanel(panel);
      if (!scrollEl) {
        scrollEl = [...panel.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight) || panel;
        scrollEl.addEventListener('scroll', updatePositions);
      }
    }

    for (let i = addedBtns.length - 1; i >= 0; i--) {
      const btn = addedBtns[i];
      if (!panel.contains(btn._original)) {
        btn.remove();
        addedBtns.splice(i, 1);
      }
    }

    const btns = [...panel.querySelectorAll('[class*="group/quickBuyButton"]')];
    btns.forEach(originalBtn => {
      if (originalBtn.dataset.qbAdded) return;
      originalBtn.dataset.qbAdded = 'true';

      const newBtn = originalBtn.cloneNode(true);
      newBtn._original         = originalBtn;
      newBtn.style.cssText     = originalBtn.style.cssText;
      newBtn.style.position    = 'fixed';
      newBtn.style.zIndex      = '9999';
      newBtn.style.overflow    = 'visible';

      const coinImg = getCoinImage(originalBtn);
      if (coinImg) {
        const imgEl     = document.createElement('img');
        imgEl.src       = coinImg.src;
        imgEl.className = 'qb-coin-img';
        imgEl.style.cssText = `
          width: 80px;
          height: 80px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
          position: absolute;
          left: -88px;
          top: 50%;
          transform: translateY(-50%);
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        `;
        newBtn.appendChild(imgEl);
      }

      const colorSync = new MutationObserver(() => {
        newBtn.style.background = originalBtn.style.background;
        newBtn.style.color      = originalBtn.style.color;
        scheduleUpdate();
      });
      colorSync.observe(originalBtn, { attributes: true, attributeFilter: ['style'] });

      const rect           = originalBtn.getBoundingClientRect();
      newBtn.style.left    = (rect.left - 621.5) + 'px';
      newBtn.style.top     = rect.top + 'px';
      newBtn.style.display = shouldShowButton(originalBtn) ? '' : 'none';

      document.body.appendChild(newBtn);
      addedBtns.push(newBtn);

      newBtn.addEventListener('click', e => {
        e.stopPropagation();
        e.preventDefault();
        fireClick(originalBtn);
      });

      updateBadge(newBtn);
    });
  }

  // ─── MutationObserver ─────────────────────────────────────────────────────

  const observer = new MutationObserver(() => addButtons());
  observer.observe(document.body, { childList: true, subtree: true });

  // ─── Reference sync: only when panel is closed ───────────────────────────

  setInterval(() => {
    if (!isPanelVisible) {
      const topImg = getTopPulseRowImage();
      if (topImg?.src && !topImg.src.startsWith('data:') && topImg.src !== referenceSource) {
        setReference(topImg.src);
      }
    }
  }, 2000);

})();
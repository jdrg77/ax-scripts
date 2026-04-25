// ==UserScript==
// @name         Axiom - Pause On Hover
// @namespace    http://tampermonkey.net/
// @version      1.4
// @match        https://axiom.trade/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Pause%20On%20Hover%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Pause%20On%20Hover%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') === 'grad') return;

  function initPauseFns() {
    const scrollable = document.querySelector('.absolute.inset-0.overflow-y-auto');
    if (!scrollable) return null;
    const fk = Object.keys(scrollable).find(k => k.startsWith('__reactFiber'));
    if (!fk) return null;
    const handlerFiber = scrollable[fk].return;
    const handlerDom = handlerFiber.stateNode;

    let origLeave = null;

    return {
      pause() {
        if (origLeave) return;
        origLeave = handlerFiber.memoizedProps.onMouseLeave;
        handlerFiber.memoizedProps = { ...handlerFiber.memoizedProps, onMouseLeave: () => {} };
        if (handlerFiber.pendingProps) {
          handlerFiber.pendingProps = { ...handlerFiber.pendingProps, onMouseLeave: () => {} };
        }
      },
      resume() {
        if (!origLeave) return;
        handlerFiber.memoizedProps = { ...handlerFiber.memoizedProps, onMouseLeave: origLeave };
        if (handlerFiber.pendingProps) {
          handlerFiber.pendingProps = { ...handlerFiber.pendingProps, onMouseLeave: origLeave };
        }
        origLeave = null;
        handlerDom.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      }
    };
  }

  let pf = null;
  let attached = new WeakSet();

  function attachListeners() {
    if (!pf) pf = initPauseFns();

    const targets = document.querySelectorAll(
      'button[style*="position: fixed"], button[style*="position:fixed"], [data-qbm-mini], img.qb-coin-img, img.qbm-coin-img'
    );
    targets.forEach(el => {
      if (attached.has(el)) return;
      attached.add(el);
      el.addEventListener('mouseenter', () => { if (!pf) pf = initPauseFns(); pf?.pause(); });
      el.addEventListener('mouseleave', () => pf?.resume());
    });
  }

  const observer = new MutationObserver(attachListeners);
  observer.observe(document.body, { childList: true, subtree: true });
  attachListeners();

  console.log('🚀 Axiom Pause On Hover 1.4 loaded');
})();

// ==UserScript==
// @name         Axiom - Pause On Hover
// @namespace    http://tampermonkey.net/
// @version      1.3
// @match        https://axiom.trade/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Pause%20On%20Hover%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Pause%20On%20Hover%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') === 'grad') return;

  let pf = null;

  function initPauseFns() {
    const scrollable = document.querySelector('.absolute.inset-0.overflow-y-auto');
    if (!scrollable) return null;
    const fk = Object.keys(scrollable).find(k => k.startsWith('__reactFiber'));
    if (!fk) return null;
    const handlerFiber = scrollable[fk].return;

    // Buscar el atom de Jotai que controla el pause
    let store = null, atom = null;
    let cur = handlerFiber.return;
    for (let n = 0; n < 100 && cur; n++) {
      if (cur.tag === 0) {
        let h = cur.memoizedState, i = 0;
        while (h && i < 30) {
          const t = h.memoizedState;
          if (t && typeof t === 'object' && !Array.isArray(t) &&
              typeof t[1]?.set === 'function' && typeof t[2]?.init === 'boolean') {
            store = t[1]; atom = t[2]; break;
          }
          h = h.next; i++;
        }
      }
      if (store) break;
      cur = cur.return;
    }

    if (!store) return null;

    let origLeave = null;

    return {
      pause() {
        store.set(atom, true);
        origLeave = handlerFiber.memoizedProps.onMouseLeave;
        handlerFiber.memoizedProps = { ...handlerFiber.memoizedProps, onMouseLeave: () => {} };
      },
      resume() {
        if (origLeave) {
          handlerFiber.memoizedProps = { ...handlerFiber.memoizedProps, onMouseLeave: origLeave };
          origLeave = null;
        }
        store.set(atom, false);
      }
    };
  }

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

  console.log('🚀 Axiom Pause On Hover 1.3 loaded');
})();

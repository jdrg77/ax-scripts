// ==UserScript==
// @name         Axiom - Pause On Hover
// @namespace    http://tampermonkey.net/
// @version      1.7
// @match        https://axiom.trade/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Pause%20On%20Hover%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Pause%20On%20Hover%201.0.user.js
// ==/UserScript==

(function () {
  'use strict';
  if (new URLSearchParams(location.search).get('tab') === 'grad') return;

  function getHandlerDom() {
    const scrollable = document.querySelector('.absolute.inset-0.overflow-y-auto');
    if (!scrollable) return null;
    const fk = Object.keys(scrollable).find(k => k.startsWith('__reactFiber'));
    if (!fk) return null;
    return scrollable[fk].return.stateNode;
  }

  function attachToEl(el, handlerDom) {
    if (el.__qbMoveHooked) return;
    el.__qbMoveHooked = true;
    el.addEventListener('mouseenter', (e) => {
      handlerDom.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true,
        clientX: e.clientX, clientY: e.clientY
      }));
    });
    el.addEventListener('mousemove', (e) => {
      handlerDom.dispatchEvent(new MouseEvent('mousemove', {
        bubbles: true, cancelable: true,
        clientX: e.clientX, clientY: e.clientY
      }));
    });
  }

  function installHook() {
    const hd = getHandlerDom();
    if (!hd) return false;
    [...document.querySelectorAll('button')]
      .filter(b => b.style?.position === 'fixed')
      .forEach(b => attachToEl(b, hd));
    [...document.querySelectorAll('img.qb-coin-img, img.qbm-coin-img')]
      .forEach(b => attachToEl(b, hd));
    return true;
  }

  const mo = new MutationObserver(() => {
    const hd = getHandlerDom();
    if (!hd) return;
    [...document.querySelectorAll('button')]
      .filter(b => b.style?.position === 'fixed')
      .forEach(b => attachToEl(b, hd));
    [...document.querySelectorAll('img.qb-coin-img, img.qbm-coin-img')]
      .forEach(b => attachToEl(b, hd));
  });
  mo.observe(document.body, { childList: true, subtree: true });

  const interval = setInterval(() => {
    if (installHook()) clearInterval(interval);
  }, 500);

  console.log('✅ Axiom Pause On Hover 1.7 loaded');
})();

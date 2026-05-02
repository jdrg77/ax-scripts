// ==UserScript==
// @name         Right Click → Graduated (only if visible) 22
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Right click triggers Graduated ONLY when button is visible on screen; right click over Buy#1/2 opens the top token
// @match        *://*/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Right%20Click%20%E2%86%92%20Graduated%20(only%20if%20visible)%2022-1.5.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Right%20Click%20%E2%86%92%20Graduated%20(only%20if%20visible)%2022-1.5.user.js
// ==/UserScript==

(function () {
    'use strict';

    let overBuyBtn = false;

    function isBuyBtn(btn) {
        if (!btn) return false;
        const txt = (btn.textContent || '').replace(/\s+/g, ' ').trim();
        return /Buy\s*#[12]/i.test(txt) && btn.getBoundingClientRect().width > 0;
    }

    document.addEventListener('mouseover', e => {
        if (isBuyBtn(e.target.closest('button'))) overBuyBtn = true;
    }, true);

    document.addEventListener('mouseout', e => {
        if (isBuyBtn(e.target.closest('button'))) overBuyBtn = false;
    }, true);

    function getTopTokenHref() {
        // Top fixed QBuy button → meme href via QBuy's sessionBest
        const fixed = [...document.querySelectorAll('button')]
            .filter(b => b.style.position === 'fixed' && b._pairAddress && b.style.display !== 'none');
        if (fixed.length) {
            fixed.sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));
            const top = fixed[0];
            const ca = top._ca || top._pairAddress;
            const sb = window.__qbBM?.sessionBest;
            if (sb) {
                for (const [, v] of sb) {
                    if ((v.tokenCA === ca || v.ca === ca) && v.memeHref)
                        return 'https://axiom.trade' + v.memeHref;
                }
            }
            // Fallback: construct from pairAddress
            if (top._pairAddress)
                return 'https://axiom.trade/pulse/chain-sol?meme=' + top._pairAddress;
        }
        return null;
    }

    function isVisible(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 &&
               r.bottom > 0 && r.right > 0 &&
               r.top < window.innerHeight && r.left < window.innerWidth;
    }

    function findGraduatedButton() {
        for (const s of document.querySelectorAll('span')) {
            if (s.textContent && s.textContent.trim().toLowerCase() === 'graduated') {
                const btn = s.closest('button');
                if (btn && isVisible(btn)) return btn;
            }
        }
        return null;
    }

    document.addEventListener('contextmenu', (e) => {
        if (!e.isTrusted) return;

        if (overBuyBtn) {
            const href = getTopTokenHref();
            if (href) {
                e.preventDefault();
                e.stopPropagation();
                window.open(href, '_blank');
                console.log('[RightClick] open token:', href);
                return;
            }
        }

        const btn = findGraduatedButton();
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        btn.click();
        console.log('✅ Graduated clicked via right click');
    }, true);
})();

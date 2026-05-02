// ==UserScript==
// @name         Right Click → Graduated (only if visible) 22
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Right click triggers Graduated ONLY when button is visible on screen
// @match        *://*/*
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Right%20Click%20%E2%86%92%20Graduated%20(only%20if%20visible)%2022-1.5.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Right%20Click%20%E2%86%92%20Graduated%20(only%20if%20visible)%2022-1.5.user.js
// ==/UserScript==

(function () {
    'use strict';

    function isVisible(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return (
            r.width > 0 &&
            r.height > 0 &&
            r.bottom > 0 &&
            r.right > 0 &&
            r.top < window.innerHeight &&
            r.left < window.innerWidth
        );
    }

    function findGraduatedButton() {
        const spans = document.querySelectorAll('span');
        for (const s of spans) {
            if (s.textContent && s.textContent.trim().toLowerCase() === 'graduated') {
                const btn = s.closest('button');
                if (btn && isVisible(btn)) return btn;
            }
        }
        return null;
    }

    document.addEventListener('contextmenu', (e) => {
        if (!e.isTrusted) return; // ignorar eventos artificiales
        const btn = findGraduatedButton();
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        btn.click();
        console.log('✅ Graduated clicked via right click');
    }, true);
})();

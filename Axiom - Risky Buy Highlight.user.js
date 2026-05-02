// ==UserScript==
// @name         Axiom - Risky Buy Highlight
// @namespace    https://github.com/jdrg77/ax-scripts
// @version      1.2
// @description  Pinta de rojo los botones Buy #1 cuando el primer New Pair tiene perfil (>=2 ri-user-line)
// @match        https://axiom.trade/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Risky%20Buy%20Highlight.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Risky%20Buy%20Highlight.user.js
// ==/UserScript==

(function(){
  'use strict';

  if (window.__axiomRiskyHL){
    try{clearInterval(window.__axiomRiskyHL.tLoop);}catch(e){}
    try{window.__axiomRiskyHL._observer && window.__axiomRiskyHL._observer.disconnect();}catch(e){}
    try{window.__axiomRiskyHL._style && window.__axiomRiskyHL._style.remove();}catch(e){}
    document.querySelectorAll('button[data-axiom-risky]').forEach(b=>b.removeAttribute('data-axiom-risky'));
  }

  const styleEl=document.createElement('style');
  styleEl.textContent='button[data-axiom-risky]{background:#b91c1c!important;border-color:#7f1d1d!important;color:#fff!important}';
  document.head.appendChild(styleEl);

  const state={ _style:styleEl, _observer:null, tLoop:null, lastRisky:null };
  window.__axiomRiskyHL=state;

  function getNewPairsCol(){
    const heads=[...document.querySelectorAll('*')].filter(e=>e.children.length===0 && /^\s*New Pairs\s*$/i.test(e.textContent||''));
    for (const h of heads){
      let n=h;
      for (let i=0;i<10;i++){
        n=n.parentElement; if(!n) break;
        const links=n.querySelectorAll('a[href*="/meme/"],a[href*="pump.fun"]');
        const txt=n.textContent||'';
        if (links.length>=3 && !/Final Stretch/i.test(txt) && !/Migrated/i.test(txt)) return n;
      }
    }
    return null;
  }

  function getFirstRow(col){
    if (!col) return null;
    const vl=[...col.querySelectorAll('div')].find(div=>{
      const st=div.getAttribute('style')||'';
      if (!/position:\s*relative/i.test(st)) return false;
      return div.querySelectorAll(':scope > [style*="position: absolute"], :scope > [style*="position:absolute"]').length>3;
    });
    if (!vl) return null;
    const children=[...vl.querySelectorAll(':scope > [style*="position: absolute"], :scope > [style*="position:absolute"]')];
    children.sort((a,b)=>{
      const ta=parseFloat((a.getAttribute('style')||'').match(/top:\s*([-\d.]+)/)?.[1]||'0');
      const tb=parseFloat((b.getAttribute('style')||'').match(/top:\s*([-\d.]+)/)?.[1]||'0');
      return ta-tb;
    });
    return children[0]||null;
  }

  function firstRowHasProfile(){
    const col=getNewPairsCol();
    const row=getFirstRow(col);
    if (!row) return false;
    return row.querySelectorAll('[class*="ri-user-line"]').length >= 2;
  }

  function findBuy1Buttons(){
    return [...document.querySelectorAll('button')].filter(b=>{
      const t=(b.textContent||'').replace(/\s+/g,' ').trim();
      if (!/Buy\s*#1/i.test(t)) return false;
      const r=b.getBoundingClientRect();
      return r.width>0 && r.height>0;
    });
  }

  function apply(){
    const risky=firstRowHasProfile();
    if (risky===state.lastRisky){
      if (risky){
        for (const b of findBuy1Buttons()){
          if (!b.hasAttribute('data-axiom-risky')) b.setAttribute('data-axiom-risky','1');
        }
      }
      return;
    }
    state.lastRisky=risky;
    const btns=findBuy1Buttons();
    for (const b of btns){
      if (risky) b.setAttribute('data-axiom-risky','1');
      else b.removeAttribute('data-axiom-risky');
    }
  }

  state.tLoop=setInterval(apply, 250);
  apply();
  console.log('[RiskyHL] Axiom Risky Buy Highlight v1.2 loaded');
})();

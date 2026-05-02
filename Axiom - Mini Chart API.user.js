// ==UserScript==
// @name         Axiom - Mini Chart API (Buy#1)
// @namespace    https://github.com/jdrg77/ax-scripts
// @version      1.5
// @description  Mini chart API del primer New Pair, a la derecha de Buy #1, fondo 50%
// @match        https://axiom.trade/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Mini%20Chart%20API.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Mini%20Chart%20API.user.js
// ==/UserScript==

(function(){
  'use strict';
  if(window.__axiomMiniChart){
    try{clearInterval(window.__axiomMiniChart.tPos);}catch(e){}
    try{clearInterval(window.__axiomMiniChart.tFetch);}catch(e){}
    try{clearInterval(window.__axiomMiniChart.tFast);}catch(e){}
    try{window.__axiomMiniChart._observer&&window.__axiomMiniChart._observer.disconnect();}catch(e){}
    try{window.__axiomMiniChart.canvas.remove();}catch(e){}
  }

  const W_PX=85, H_PX=50;
  const canvas=document.createElement('canvas');
  canvas.width=W_PX*2; canvas.height=H_PX*2;
  canvas.style.cssText=`position:fixed;left:0;top:0;width:${W_PX}px;height:${H_PX}px;z-index:99999;pointer-events:none;background:rgba(0,0,0,0.5);border-radius:3px;display:none;`;
  document.body.appendChild(canvas);

  const s={canvas,bars:[],lastToken:null,pairAddress:null,tokenAddress:null,W_PX,H_PX,tPos:null,tFetch:null,tFast:null,_observer:null};
  window.__axiomMiniChart=s;

  // Token comes from the topmost visible QBuy button — same one ⚡/⏸ would buy
  function getTopQBuyToken(){
    const btns=[...document.querySelectorAll('button')]
      .filter(b=>b.style.position==='fixed' && b._pairAddress && b.style.display!=='none');
    if(!btns.length) return null;
    btns.sort((a,b)=>parseFloat(a.style.top)-parseFloat(b.style.top));
    return btns[0]._pairAddress||btns[0]._ca||null;
  }

  function findBuy1(){
    const all=Array.from(document.querySelectorAll('button'));
    let btn=all.find(b=>/Buy\s*#1/i.test((b.textContent||'').trim()) && /⚡/.test(b.textContent||''));
    if(!btn) btn=all.find(b=>/Buy\s*#1/i.test((b.textContent||'').trim()));
    return btn||null;
  }

  s._draw=function(){
    try{
      const c=s.canvas,ctx=c.getContext('2d');
      const W=c.width,H=c.height;
      ctx.clearRect(0,0,W,H);
      const bars=s.bars||[];if(!bars.length)return;
      const N=Math.min(bars.length,80);
      const view=bars.slice(0,N);
      let lo=Infinity,hi=-Infinity;
      for(const b of view){const l=b[3],h=b[2];if(l<lo)lo=l;if(h>hi)hi=h;}
      if(!isFinite(lo)||!isFinite(hi))return;
      const span=Math.max(hi-lo,hi*0.0001);
      const pad=span*0.05;
      const newLo=lo-pad,newHi=hi+pad;
      const padY=2,pxH=H-2*padY;
      const cw=4;
      const bodyW=Math.max(1.5,cw*0.7);
      const maxFit=Math.floor(W/cw);
      const draw=view.slice(0,maxFit);
      for(let i=0;i<draw.length;i++){
        const b=draw[i],o=b[1],hi2=b[2],lo2=b[3],cl=b[4];
        const xC=i*cw+cw/2+1;
        const yO =padY+(1-(o  -newLo)/(newHi-newLo))*pxH;
        const yCl=padY+(1-(cl -newLo)/(newHi-newLo))*pxH;
        const yH =padY+(1-(hi2-newLo)/(newHi-newLo))*pxH;
        const yL =padY+(1-(lo2-newLo)/(newHi-newLo))*pxH;
        const up=cl>=o;
        ctx.strokeStyle=up?'#22c55e':'#ef4444';
        ctx.fillStyle  =up?'#22c55e':'#ef4444';
        ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(xC,yH);ctx.lineTo(xC,yL);ctx.stroke();
        const yTop=Math.min(yO,yCl),yBot=Math.max(yO,yCl);
        ctx.fillRect(xC-bodyW/2,yTop,bodyW,Math.max(1,yBot-yTop));
      }
    }catch(e){}
  };

  async function resolvePairInfo(token){
    try{
      const r=await fetch('https://api3.axiom.trade/clipboard-pair-info?address='+token,{credentials:'include'});
      const j=await r.json();
      if(s.lastToken!==token) return;
      s.pairAddress=j.pairAddress;
      s.tokenAddress=j.tokenAddress||token;
    }catch(e){}
  }

  async function fetchBars(forToken){
    if(!s.pairAddress) return;
    const now=Date.now();
    const params=new URLSearchParams({
      pairAddress:s.pairAddress,
      from:String(now-300000),to:String(now),
      currency:'USD',interval:'1s',countBars:'300',
      showOutliers:'false',needData:'true',v:String(now)
    });
    try{
      const r=await fetch('https://api6.axiom.trade/pair-chart-v2?'+params.toString(),{credentials:'include'});
      const j=await r.json();
      if(forToken && s.lastToken!==forToken) return;
      if(j && Array.isArray(j.bars)){s.bars=j.bars;s._draw();}
    }catch(e){}
  }

  let busy=false;
  async function checkAndSwitch(){
    if(busy)return; busy=true;
    try{
      const tk=getTopQBuyToken();
      if(!tk) return;
      if(tk!==s.lastToken){
        s.lastToken=tk; s.bars=[]; s.pairAddress=null; s._draw();
        await resolvePairInfo(tk);
        if(s.lastToken===tk) await fetchBars(tk);
      }
    } finally { busy=false; }
  }
  s._checkAndSwitch=checkAndSwitch;

  s.tFetch=setInterval(()=>fetchBars(s.lastToken),1000);
  s.tFast =setInterval(checkAndSwitch,80);

  // Observer on body to catch QBuy button changes
  (function attachObserver(){
    try{s._observer&&s._observer.disconnect();}catch(e){}
    const obs=new MutationObserver(()=>checkAndSwitch());
    obs.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style']});
    s._observer=obs;
  })();

  // posicionar a la derecha de '⚡ Buy #1'
  s.tPos=setInterval(()=>{
    try{
      const btn=findBuy1();
      if(!btn){s.canvas.style.display='none';return;}
      const r=btn.getBoundingClientRect();
      if(r.width===0){s.canvas.style.display='none';return;}
      s.canvas.style.display='block';
      s.canvas.style.left=(r.right+8)+'px';
      s.canvas.style.top =(r.top+(r.height-s.H_PX)/2)+'px';
      s.canvas.style.width=s.W_PX+'px';
      s.canvas.style.height=s.H_PX+'px';
    }catch(e){}
  },150);

  checkAndSwitch();
})();

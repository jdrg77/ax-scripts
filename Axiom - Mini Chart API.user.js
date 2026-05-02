// ==UserScript==
// @name         Axiom - Mini Chart API (Buy#1)
// @namespace    https://github.com/jdrg77/ax-scripts
// @version      1.11
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
    try{clearInterval(window.__axiomMiniChart.tDiff);}catch(e){}
    try{window.__axiomMiniChart._observer&&window.__axiomMiniChart._observer.disconnect();}catch(e){}
    try{window.__axiomMiniChart.canvas.remove();}catch(e){}
    try{window.__axiomMiniChart.diffLabel.remove();}catch(e){}
    try{window.__axiomMiniChart.mcLabel.remove();}catch(e){}
    try{window.__axiomMiniChart.tradesPanel.remove();}catch(e){}
  }

  const W_PX=85, H_PX=50, MAX_BARS=30;

  const canvas=document.createElement('canvas');
  canvas.width=W_PX*2; canvas.height=H_PX*2;
  canvas.style.cssText=`position:fixed;left:0;top:0;width:${W_PX}px;height:${H_PX}px;z-index:99999;pointer-events:none;background:rgba(0,0,0,0.5);border-radius:3px;display:none;`;
  document.body.appendChild(canvas);

  const diffLabel=document.createElement('div');
  diffLabel.style.cssText='position:fixed;z-index:99999;pointer-events:none;display:none;'+
    'font:bold 11px monospace;color:rgb(255,255,255);text-shadow:0 0 4px rgba(255,255,255,0.8);white-space:nowrap;';
  document.body.appendChild(diffLabel);

  const mcLabel=document.createElement('div');
  mcLabel.style.cssText='position:fixed;z-index:99999;pointer-events:none;display:none;'+
    'font:bold 10px monospace;color:rgb(91,184,255);white-space:nowrap;';
  document.body.appendChild(mcLabel);

  const tradesPanel=document.createElement('div');
  tradesPanel.style.cssText=[
    'position:fixed','z-index:99999','display:none',
    'background:#0b0d13','border:1px solid #1e2131','border-radius:8px',
    'width:292px',
    'font-family:GeistMono,ui-monospace,"Cascadia Code","Source Code Pro",Menlo,Consolas,monospace',
    'font-size:12px','color:#c1c5dc','pointer-events:none','overflow:hidden',
  ].join(';');
  document.body.appendChild(tradesPanel);

  const s={canvas,diffLabel,mcLabel,tradesPanel,bars:[],lastToken:null,pairAddress:null,tokenAddress:null,
           diffValue:null,recentBuys:[],W_PX,H_PX,tPos:null,tFetch:null,tFast:null,tDiff:null,_observer:null};
  window.__axiomMiniChart=s;

  const TG_SRV=['https://api2.axiom.trade','https://api3.axiom.trade','https://api6.axiom.trade'];
  const SOL_ICON='<img src="https://axiom-assets.axiom-cdn.io/images/sol-fill.svg" style="width:10px;height:10px;margin-right:2px;vertical-align:middle;display:inline"/>';
  const BAR_MAX_REF=33;

  function getTopQBuyBtn(){
    const btns=[...document.querySelectorAll('button')]
      .filter(b=>b.style.position==='fixed' && b._pairAddress && b.style.display!=='none');
    if(!btns.length) return null;
    btns.sort((a,b)=>parseFloat(a.style.top)-parseFloat(b.style.top));
    return btns[0];
  }

  function findBuy1(){
    const all=Array.from(document.querySelectorAll('button'));
    let btn=all.find(b=>/Buy\s*#1/i.test((b.textContent||'').trim()) && /⚡/.test(b.textContent||''));
    if(!btn) btn=all.find(b=>/Buy\s*#1/i.test((b.textContent||'').trim()));
    return btn||null;
  }

  function fmtAge(date){
    const s=Math.floor((Date.now()-date.getTime())/1000);
    if(s<60) return s+'s';
    if(s<3600) return Math.floor(s/60)+'m';
    return Math.floor(s/3600)+'h';
  }
  function fmtSol(n){
    if(n>=10) return n.toFixed(2);
    if(n>=1)  return n.toFixed(3);
    return n.toFixed(4);
  }
  function fmtMC(liquiditySol,priceSol,priceUsd){
    if(!priceSol||!priceUsd) return '—';
    const solPrice=priceUsd/priceSol;
    const mc=liquiditySol*2*solPrice;
    if(mc>=1e6) return '$'+(mc/1e6).toFixed(1)+'M';
    if(mc>=1e3) return '$'+(mc/1e3).toFixed(1)+'K';
    return '$'+mc.toFixed(0);
  }
  function fmtWallet(addr){
    if(!addr||addr.length<3) return addr||'?';
    return addr.slice(-3);
  }
  function calcBarWidth(amount){
    if(amount<1) return 0;
    return Math.min(100,Math.max(1,Math.pow(amount/BAR_MAX_REF,2/3)*100));
  }

  function renderTradesPanel(){
    const buys=s.recentBuys;
    if(!buys.length){ tradesPanel.style.display='none'; return; }
    const header='<div style="display:flex;align-items:center;padding:4px 16px;border-bottom:1px solid #1e2131;color:#777a8c;font-size:12px;line-height:16px;min-height:24px;box-sizing:border-box">'
      +'<span style="flex:1">Amount</span>'
      +'<span style="flex:1">MC</span>'
      +'<span style="flex:1">Trader</span>'
      +'<span style="max-width:32px;flex:1;text-align:right">Age</span>'
      +'</div>';
    const rows=buys.map(t=>{
      const bw=calcBarWidth(t.totalSol);
      const bar=bw>0?'<div style="position:absolute;left:0;top:0;height:100%;pointer-events:none;background:linear-gradient(to right,#2FC2E300,#2fe3ac);opacity:0.15;width:'+bw.toFixed(2)+'%"></div>':'';
      return '<div style="position:relative;display:flex;align-items:center;height:24px;padding:0 16px;box-sizing:border-box">'
        +bar
        +'<div style="position:relative;z-index:1;display:flex;flex:1;align-items:center">'
        +'<span style="flex:1;display:flex;align-items:center;color:#2fe3ac">'+SOL_ICON+fmtSol(t.totalSol)+'</span>'
        +'<span style="flex:1;color:#c1c5dc">'+fmtMC(t.liquiditySol,t.priceSol,t.priceUsd)+'</span>'
        +'<span style="flex:1;color:#c1c5dc">'+fmtWallet(t.makerAddress)+'</span>'
        +'<span style="max-width:32px;flex:1;text-align:right;color:#777a8c">'+fmtAge(t.createdAt)+'</span>'
        +'</div></div>';
    }).join('');
    tradesPanel.innerHTML=header+'<div>'+rows+'</div>';
  }

  s._draw=function(){
    try{
      const c=s.canvas,ctx=c.getContext('2d');
      const W=c.width,H=c.height;
      ctx.clearRect(0,0,W,H);
      const bars=s.bars||[];if(!bars.length)return;
      const view=bars.slice(0,MAX_BARS);
      let lo=Infinity,hi=-Infinity;
      for(const b of view){const l=b[3],h=b[2];if(l<lo)lo=l;if(h>hi)hi=h;}
      if(!isFinite(lo)||!isFinite(hi))return;
      const span=Math.max(hi-lo,hi*0.0001);
      const pad=span*0.05;
      const newLo=lo-pad,newHi=hi+pad;
      const padY=2,pxH=H-2*padY;
      const cw=Math.floor(W/MAX_BARS),bodyW=Math.max(1.5,cw*0.7);
      for(let i=0;i<view.length;i++){
        const b=view[i],o=b[1],hi2=b[2],lo2=b[3],cl=b[4];
        const xC=i*cw+cw/2+1;
        const yO =padY+(1-(o  -newLo)/(newHi-newLo))*pxH;
        const yCl=padY+(1-(cl -newLo)/(newHi-newLo))*pxH;
        const yH =padY+(1-(hi2-newLo)/(newHi-newLo))*pxH;
        const yL =padY+(1-(lo2-newLo)/(newHi-newLo))*pxH;
        const up=cl>=o;
        ctx.strokeStyle=ctx.fillStyle=up?'#22c55e':'#ef4444';
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

  async function fetchDiff(){
    if(!s.pairAddress) return;
    const srv=TG_SRV[Math.floor(Math.random()*TG_SRV.length)];
    try{
      const r=await fetch(srv+'/transactions-feed-v3',{
        method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({pairAddress:s.pairAddress,orderBy:'DESC'}),
      });
      if(!r.ok) return;
      const data=await r.json();
      const raw=Array.isArray(data)?data:[];
      const now=Date.now();
      const decoded=raw.map(row=>({
        type:row[2],createdAt:new Date(row[3]),
        liquiditySol:row[4],makerAddress:row[6],
        priceSol:row[7],priceUsd:row[8],
        totalSol:row[10]||0,totalUsd:row[11],
      }));
      const recent=decoded.filter(t=>now-t.createdAt.getTime()<5*60000);
      if(!recent.length){s.diffValue=null;s.recentBuys=[];renderTradesPanel();return;}
      const buys=recent.filter(t=>t.type==='buy');
      const sells=recent.filter(t=>t.type==='sell');
      s.diffValue=buys.reduce((a,t)=>a+t.totalSol,0)-sells.reduce((a,t)=>a+t.totalSol,0);
      s.recentBuys=buys.slice(0,3);
      renderTradesPanel();
    }catch(e){}
  }

  let busy=false;
  async function checkAndSwitch(){
    if(busy)return; busy=true;
    try{
      const topBtn=getTopQBuyBtn();
      if(!topBtn) return;
      const tk=topBtn._pairAddress||topBtn._ca||null;
      if(!tk) return;
      if(tk!==s.lastToken){
        s.lastToken=tk; s.bars=[]; s.pairAddress=null; s.diffValue=null; s.recentBuys=[]; s._draw();
        renderTradesPanel();
        await resolvePairInfo(tk);
        if(s.lastToken===tk){ await fetchBars(tk); await fetchDiff(); }
      }
    } finally { busy=false; }
  }
  s._checkAndSwitch=checkAndSwitch;

  s.tFetch=setInterval(()=>fetchBars(s.lastToken),1000);
  s.tDiff =setInterval(fetchDiff,500);
  s.tFast =setInterval(checkAndSwitch,80);

  (function attachObserver(){
    try{s._observer&&s._observer.disconnect();}catch(e){}
    const obs=new MutationObserver(()=>checkAndSwitch());
    obs.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['style']});
    s._observer=obs;
  })();

  s.tPos=setInterval(()=>{
    try{
      const topBtn=getTopQBuyBtn();
      const buy1=findBuy1();
      if(!topBtn||!buy1){
        canvas.style.display='none';
        diffLabel.style.display='none';
        mcLabel.style.display='none';
        tradesPanel.style.display='none';
        return;
      }
      const r=buy1.getBoundingClientRect();
      if(r.width===0){
        canvas.style.display='none';
        diffLabel.style.display='none';
        mcLabel.style.display='none';
        tradesPanel.style.display='none';
        return;
      }

      const cy=r.top+r.height/2;

      // MC from .__tgLbl already on the QBuy button — no extra API call
      const tgTxt=topBtn.querySelector('.__tgLbl')?.textContent||'';
      const mcIdx=tgTxt.indexOf('$');
      const mcTxt=mcIdx!==-1?tgTxt.slice(mcIdx):'';

      // Diff label right of ⚡ Buy #1
      let canvasLeft=r.right+8;
      if(s.diffValue!==null && s.diffValue!==undefined){
        const txt=(s.diffValue>=0?'+':'')+s.diffValue.toFixed(2);
        if(diffLabel.textContent!==txt) diffLabel.textContent=txt;
        diffLabel.style.left=(r.right+8)+'px';
        diffLabel.style.top=cy+'px';
        diffLabel.style.transform='translateY(-50%)';
        diffLabel.style.display='block';
        const dlW=diffLabel.offsetWidth||50;
        canvasLeft=r.right+8+dlW+8;

        if(mcTxt){
          if(mcLabel.textContent!==mcTxt) mcLabel.textContent=mcTxt;
          mcLabel.style.left=(r.right+8)+'px';
          mcLabel.style.top=(cy+9)+'px';
          mcLabel.style.transform='translateY(-50%)';
          mcLabel.style.display='block';
        } else {
          mcLabel.style.display='none';
        }
      } else {
        diffLabel.style.display='none';
        mcLabel.style.display='none';
      }

      canvas.style.left=canvasLeft+'px';
      canvas.style.top=(cy-H_PX/2)+'px';
      canvas.style.width=W_PX+'px';
      canvas.style.height=H_PX+'px';
      canvas.style.display='block';

      // Trades panel right of canvas
      if(s.recentBuys.length){
        const panelLeft=canvasLeft+W_PX+8;
        tradesPanel.style.left=panelLeft+'px';
        tradesPanel.style.top=(cy-H_PX/2)+'px';
        tradesPanel.style.display='block';
      } else {
        tradesPanel.style.display='none';
      }
    }catch(e){}
  },150);

  checkAndSwitch();
})();

// ==UserScript==
// @name         Axiom - Mini Chart
// @namespace    https://github.com/jdrg77/ax-scripts
// @version      2.9
// @description  Mini candlestick chart top New Pair (escala 5.8K, ATH+inicio marcados, pill de precio actual)
// @match        https://axiom.trade/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Mini%20Chart%201.0.user.js
// @downloadURL  https://raw.githubusercontent.com/jdrg77/ax-scripts/main/Axiom%20-%20Mini%20Chart%201.0.user.js
// ==/UserScript==

(function(){
  'use strict';
  if (window.__axMiniChart && window.__axMiniChart.stop) window.__axMiniChart.stop();
  document.querySelectorAll('canvas[data-axmini="1"]').forEach(c=>c.remove());

  const NUM_SLOTS=1;
  const W_PX=85, AXIS_W=22, CANVAS_W=W_PX+AXIS_W;
  const H_PX=50;
  const BUCKET_MS=1000, SAMPLE_MS=100, REPOS_MS=150;
  const BASE_CANDLE_W=4;
  const COLOR_UP='#22c55e', COLOR_DOWN='#ef4444';
  const BG_COLOR='rgba(0,0,0,0.4)';
  const TEXT_WHITE='#ffffff';
  const ATH_COLOR='rgba(229,231,235,0.85)';
  const START_COLOR='rgba(148,163,184,0.85)';
  const SEED_MC=2360, INIT_YMAX=5800;
  const OFFSET_X=40, OFFSET_Y=27;

  if (location.search.includes('tab=grad')) return;

  function formatMC(v){
    if (v==null||!isFinite(v)) return '';
    const a=Math.abs(v);
    if (a<1000) return Math.round(v).toString();
    if (a<1e6) {const k=v/1000; return (k>=100?Math.round(k):k.toFixed(k<10?2:1)).toString().replace(/\.?0+$/,'')+'K';}
    if (a<1e9) {const m=v/1e6; return (m>=100?Math.round(m):m.toFixed(m<10?2:1)).toString().replace(/\.?0+$/,'')+'M';}
    const b=v/1e9; return (b>=100?Math.round(b):b.toFixed(b<10?2:1)).toString().replace(/\.?0+$/,'')+'B';
  }

  function makeCanvas(){
    const c=document.createElement('canvas');
    c.dataset.axmini='1';
    c.style.cssText='position:fixed;z-index:99999;pointer-events:none;display:none;';
    c.width=CANVAS_W*2; c.height=H_PX*2;
    c.style.width=CANVAS_W+'px'; c.style.height=H_PX+'px';
    document.body.appendChild(c);
    const cx=c.getContext('2d'); cx.scale(2,2);
    return {canvas:c, ctx:cx};
  }

  const canvases=[];
  for (let i=0;i<NUM_SLOTS;i++) canvases.push(makeCanvas());
  const engines=new Map();

function makeEngine(firstMC){
    const eng={candles:[], lastPrice:null, yMin:SEED_MC, yMax:INIT_YMAX, startPrice:firstMC};
    const bStart=Math.floor(Date.now()/BUCKET_MS)*BUCKET_MS;
    const o=SEED_MC, c=firstMC;
    eng.candles.push({t:bStart,o:o,h:Math.max(o,c),l:Math.min(o,c),c:c});
    eng.lastPrice=c;
    if (c>eng.yMax) eng.yMax=c;
    if (c<eng.yMin) eng.yMin=c;
    return eng;
  }

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
  function getRows(col, max){
    if(!col) return [];
    return [...col.querySelectorAll('div[class*="border-b-[1px]"]')]
      .filter(d=>{const r=d.getBoundingClientRect(); return r.height>=80 && r.height<=180 && r.width>300;})
      .slice(0,max);
  }
  function getCAFromRow(row){
    const a=row.querySelector('a[href*="/meme/"],a[href*="/coin/"]');
    if(!a) return null;
    const m=a.getAttribute('href').match(/\/(?:meme|coin)\/([^?#/]+)/);
    return m?m[1]:null;
  }
  function parseMC(s){
    if(!s) return null;
    const m=String(s).replace(/[\s,]/g,'').match(/\$?([\d.]+)([KMBkmb]?)/);
    if(!m) return null;
    let v=parseFloat(m[1]); const u=(m[2]||'').toLowerCase();
    if(u==='k') v*=1e3; else if(u==='m') v*=1e6; else if(u==='b') v*=1e9;
    return isFinite(v)?v:null;
  }
  function getMCFromRow(row){
    const leaves=[...row.querySelectorAll('*')].filter(e=>e.children.length===0);
    for (let i=0;i<leaves.length;i++){
      const t=(leaves[i].textContent||'').trim();
      if (t==='MC'){
        for (let j=i+1;j<Math.min(i+6,leaves.length);j++){
          const v=parseMC((leaves[j].textContent||'').trim());
          if (v!=null) return v;
        }
      }
    }
    for (const e of leaves){
      const t=(e.textContent||'').trim();
      if (/^\$[\d.]+[KMBkmb]?$/.test(t)){ const v=parseMC(t); if(v!=null) return v; }
    }
    return null;
  }
  function findFeeRect(row){
    const spans=[...row.querySelectorAll('span,div')].filter(e=>e.children.length===0);
    for (const s of spans){
      if ((s.textContent||'').trim()==='F'){
        let p=s.parentElement;
        for (let i=0;i<4 && p;i++){
          if ((p.className||'').toString().includes('group/image')) return p.getBoundingClientRect();
          p=p.parentElement;
        }
      }
    }
    return null;
  }

  function onTick(eng, price){
    if (price==null) return;
    if (price===eng.lastPrice) return;
    const bStart=Math.floor(Date.now()/BUCKET_MS)*BUCKET_MS;

    if (eng.candles.length===0){
      eng.candles.push({t:bStart,o:SEED_MC,h:Math.max(SEED_MC,price),l:Math.min(SEED_MC,price),c:price});
    } else {
      const cur=eng.candles[eng.candles.length-1];
      if (cur.t===bStart){
        cur.c=price;
        if (price>cur.h) cur.h=price;
        if (price<cur.l) cur.l=price;
      } else if (price!==cur.c){
        const o=cur.c;
        eng.candles.push({t:bStart,o:o,h:Math.max(o,price),l:Math.min(o,price),c:price});
      }
    }
    eng.lastPrice=price;
    if (eng.candles.length>60) eng.candles.shift();
    if (price>eng.yMax) eng.yMax=price;
    if (price<eng.yMin) eng.yMin=price;
  }

  function draw(ctx, eng){
    ctx.clearRect(0,0,CANVAS_W,H_PX);
    ctx.fillStyle=BG_COLOR;
    ctx.fillRect(0,0,CANVAS_W,H_PX);

    if (!eng) return;

    const n=eng.candles.length;
    let lo=eng.yMin, hi=eng.yMax;
    if (hi<=lo) hi=lo+1;
    const pad=(hi-lo)*0.05; lo-=pad; hi+=pad;
    const yOf=v=>H_PX-((v-lo)/(hi-lo))*H_PX;

    const slotW = (n*BASE_CANDLE_W <= W_PX) ? BASE_CANDLE_W : (W_PX / n);
    const bodyW = Math.max(1, slotW*0.7);

    for (let i=0;i<n;i++){
      const k=eng.candles[i];
      const x = i*slotW + (slotW-bodyW)/2;
      const cx = x + bodyW/2;
      const up = k.c>=k.o;
      ctx.strokeStyle=ctx.fillStyle = up?COLOR_UP:COLOR_DOWN;
      ctx.beginPath();
      ctx.moveTo(cx, yOf(k.h));
      ctx.lineTo(cx, yOf(k.l));
      ctx.lineWidth=1;
      ctx.stroke();
      const yo=yOf(k.o), yc=yOf(k.c);
      const top=Math.min(yo,yc), bot=Math.max(yo,yc);
      if (Math.abs(yc-yo)<0.5) ctx.fillRect(x, top-0.5, bodyW, 1);
      else ctx.fillRect(x, top, bodyW, bot-top);
    }

    const yAth = Math.max(0.5, Math.min(H_PX-0.5, yOf(eng.yMax)));
    ctx.strokeStyle=ATH_COLOR;
    ctx.lineWidth=1;
    ctx.beginPath();
    ctx.moveTo(W_PX, yAth);
    ctx.lineTo(CANVAS_W-2, yAth);
    ctx.stroke();

    if (eng.startPrice!=null){
      const yS = Math.max(0.5, Math.min(H_PX-0.5, yOf(eng.startPrice)));
      ctx.strokeStyle=START_COLOR;
      ctx.beginPath();
      ctx.moveTo(W_PX, yS);
      ctx.lineTo(CANVAS_W-2, yS);
      ctx.stroke();
    }

    if (eng.yMax > INIT_YMAX){
      ctx.fillStyle=ATH_COLOR;
      ctx.font='9px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign='right';
      ctx.textBaseline='top';
      ctx.fillText(formatMC(eng.yMax), CANVAS_W-2, 1);
    }

    const last=eng.candles[n-1];
    const up = last.c>=last.o;
    const pillColor = up?COLOR_UP:COLOR_DOWN;
    const pillW = AXIS_W-1;
    const pillH = 11;
    let yL = yOf(eng.lastPrice);
    let pillTop = yL - pillH/2;
    pillTop = Math.max(0, Math.min(H_PX-pillH, pillTop));
    const pillX = W_PX;
    ctx.fillStyle=pillColor;
    ctx.fillRect(pillX, pillTop, pillW, pillH);
    ctx.fillStyle=TEXT_WHITE;
    ctx.font='bold 9px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText(formatMC(eng.lastPrice), pillX + pillW/2, pillTop + pillH/2 + 0.5);
  }

  function step(){
    const col=getNewPairsCol();
    const rows=getRows(col, NUM_SLOTS);
    const visibleCAs=new Set();

    for (let i=0;i<NUM_SLOTS;i++){
      const cv=canvases[i];
      const fr=rows[i];
      if (!fr){ cv.canvas.style.display='none'; continue; }
      const ca=getCAFromRow(fr);
      if (!ca){ cv.canvas.style.display='none'; continue; }
      visibleCAs.add(ca);

      let eng=engines.get(ca);
      if (!eng){
        const firstMC=getMCFromRow(fr);
        if (firstMC!=null){ eng=makeEngine(firstMC); engines.set(ca, eng); }
      }
      if (eng){
        const mc=getMCFromRow(fr);
        if (mc!=null) onTick(eng, mc);
      }

      const feeR=findFeeRect(fr);
      if (!feeR){ cv.canvas.style.display='none'; continue; }
      cv.canvas.style.display='block';
      cv.canvas.style.left=(feeR.left - CANVAS_W - 2 + OFFSET_X)+'px';
      cv.canvas.style.top =(feeR.top + (feeR.height - H_PX)/2 + OFFSET_Y)+'px';

      draw(cv.ctx, eng);
    }

    for (const ca of [...engines.keys()]){
      if (!visibleCAs.has(ca)) engines.delete(ca);
    }
  }

  function reposLoop(){
    const col=getNewPairsCol();
    const rows=getRows(col, NUM_SLOTS);
    const cv=canvases[0]; const fr=rows[0];
    if (!fr){ cv.canvas.style.display='none'; return; }
    const feeR=findFeeRect(fr);
    if (!feeR){ cv.canvas.style.display='none'; return; }

    const cLeft=feeR.left - CANVAS_W - 2 + OFFSET_X;
    const cTop =feeR.top + (feeR.height - H_PX)/2 + OFFSET_Y;
    cv.canvas.style.display='block';
    cv.canvas.style.left=cLeft+'px';
    cv.canvas.style.top =cTop+'px';

  }

  const idR=setInterval(reposLoop, REPOS_MS);
  const idS=setInterval(step, SAMPLE_MS);
  window.__axMiniChart={
    stop(){clearInterval(idR);clearInterval(idS);canvases.forEach(c=>c.canvas.remove());engines.clear();},
    state(){const o={};engines.forEach((e,k)=>{o[k]={candles:e.candles.slice(),yMin:e.yMin,yMax:e.yMax,lastPrice:e.lastPrice,startPrice:e.startPrice};});return o;}
  };
})();

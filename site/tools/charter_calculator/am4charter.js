/* AM4 Charter Calculator – the most profitable charter lines from your charter hubs
 * Page: globalairall.net/tools/am4chartercalc.html (website repository, Bootstrap Studio)
 * Needs: ../shared_resources/am4.js (aircraft list, game data, charter data, formatting) loaded first.
 * All visible texts generated here come from AM4.strings() – the page can override (and
 * Linguise can translate) every text via <div id="am4-strings">.
 *
 * Charter mechanics (in-game help, forum guides, checked in the game, October 2026):
 * - one cycle = one flight (hub → destination or back); 2, 4, 6, 8 or 10 cycles per departure
 * - the charter demand (Y and J only) is a weekly amount; every flight uses seats from it
 * - the whole revenue of a departure is paid at departure; fuel, CO₂ and maintenance per flight
 */
(function(){
'use strict';
if(!window.AM4){console.error('AM4 Charter Calculator: shared_resources/am4.js is missing');return}
const {AIRCRAFT,nf,num,money,esc,tpl}=AM4;
const $=id=>document.getElementById(id);

const S=AM4.strings({
  pickCountry:'– Select country –',
  pickCountryFirst:'– select country first –',
  pickAirport:'– Select airport –',
  unavailable:'unavailable',
  dataError:'Game data could not be loaded. Please reload the page.',
  hubHint:'Add the airports where you have a charter base (up to {max}).',
  hubCount:'{n} of {max} charter hubs',
  hubFull:'The maximum of {max} charter hubs is reached.',
  hubDouble:'{hub} is already in the list.',
  remove:'Remove',
  runway:'Runway',
  errHubTitle:'No charter hub',
  errHubText:'Add at least one airport where you have a charter base.',
  errCapitalTitle:'Capital missing',
  errCapitalText:'Enter your available capital in $ or tick “Any amount”.',
  errDemandTitle:'Charter data unavailable',
  errDemandText:'The charter demand of a hub could not be loaded. Reload the page and try again.',
  noRouteTitle:'No profitable charter line found',
  noRouteText:'No charter aircraft can be operated profitably from the selected hubs with {cap} of capital. Enter more capital or add other hubs.',
  anyCapital:'any capital',
  planTitleOne:'🛫 Charter plan: 1 aircraft on 1 line',
  planTitle:'🛫 Charter plan: {n} aircraft on {n} lines',
  planShort:'Only {n} profitable lines fit your capital (you asked for {want}).',
  perHubHead:'Best lines per hub',
  perHubHint:'Each hub on its own, with all your aircraft and your whole capital.',
  hubPlan:'📍 {hub}: {n} aircraft on {n} lines',
  hubPlanOne:'📍 {hub}: 1 aircraft on 1 line',
  hubNoLine:'{hub}: no profitable charter line',
  allHubsHead:'Best lines over all hubs',
  profitWeek:'Profit/Week',
  revenueWeek:'Revenue/Week',
  investment:'Investment',
  remaining:'Remaining Capital',
  invPayback:'Investment Payback',
  payback:'Payback',
  staff:'Staff',
  maintenance:'Maintenance',
  fuel:'Fuel',
  co2:'CO₂',
  colHub:'Hub',
  colDest:'Destination',
  colAircraft:'Aircraft',
  colConfig:'Config Y/J',
  colCycles:'Cycles per Departure',
  colFlights:'Flights/Week',
  colRev:'Revenue/Week',
  colCost:'Costs/Week',
  colProfit:'Profit/Week',
  colPrice:'A/C Price',
  total:'Σ Total',
  nAircraft:'{n} aircraft',
  lessThanDay:'< 1 day',
  oneDay:'{n} day',
  nDays:'{n} days',
  listInfo:'{p} profitable charter lines (of {t} charter destinations from {h} hubs)',
  listMatches:' · {n} matches',
  noMatch:'No matches. Change the search term.',
  noProfitList:'No profitable charter line. Enter more capital.',
  more:'Show more lines ({n} of {m})',
  detail:'Per week with {ac}: {f} flights of {h} h each ({u} h of 168 h in use).',
  demandUse:'Charter demand used per week: {y} of {dy} Y · {j} of {dj} J',
  alternatives:'Alternatives',
  colDep:'Departures/Week'
});

// Fixed assumptions (shown on the page)
const FUEL_PRICE=500, CO2_PRICE=140;                    // $ per 1000 lbs / per 1000 quotas
const SAL={pilot:217,crew:164,eng:265,tech:239};        // $ per day
const WEEK_H=168, MAX_HUBS=10, MAX_AC=20, MAX_CYCLES=10, PAGE=100;

let AP=null, CH=null, CHAR_AC=[], gameMode='realism';
let hubs=[], lines=[], listSort={k:'profit',asc:false}, shown=PAGE, openRow=null;

// ---------- Formatting ----------
const cfgTags=r=>`<span class="tag tag-y">${r.sY}Y</span> <span class="tag tag-j">${r.sJ}J</span>`;
function paybackTxt(days){
  if(!isFinite(days))return '–';
  if(days<1)return esc(S.lessThanDay);
  return esc(tpl(Math.round(days)===1?S.oneDay:S.nDays,{n:nf(days)}));
}
// Split the flights per week into departures of 2…10 cycles, as even as possible: 14 → "8 + 6"
function cyclePlan(f){
  const k=Math.ceil(f/MAX_CYCLES),parts=[];
  let left=f;
  for(let i=k;i>0;i--){const c=Math.ceil(left/i/2)*2;parts.push(c);left-=c}
  return parts;
}

// ---------- Game formulas (according to abc8747/am4, as in the Hub Planner) ----------
function ticketPrices(d,easy){
  return easy
    ?{y:Math.floor(1.10*(0.4*d+170))-2,j:Math.floor(1.08*(0.8*d+560))-2}
    :{y:Math.floor(1.10*(0.3*d+150))-2,j:Math.floor(1.08*(0.6*d+500))-2};
}

// One week of charter flights of one aircraft type on one line.
// f = flights per week (even, the aircraft always returns to the hub); every flight uses
// seats of the weekly demand. Config: J (2 seat units) and Y; empty seats are possible.
function evalWeek(ac,ln,p,f,c){
  const sJ=c.sJ,sY=c.sY;
  const pY=Math.min(f*sY,ln.y),pJ=Math.min(f*sJ,ln.j);
  if(pY+pJ<1)return null;
  const rev=pY*ln.prices.y+pJ*ln.prices.j;
  const fuel=f*ln.dist*ac.fuel*p.fuelP/1000;
  const co2=(ln.dist*ac.co2*(pY+2*pJ)+f*(sY+sJ))*p.co2P/1000;
  const maint=f*(ac.checkCost*(p.easy?1:2)*Math.ceil(ln.tripH(ac)*(p.easy?1.5:1))/ac.maint+ac.cost/1000*0.0075);
  const staff=7*(ac.pilots*p.sP+ac.crew*p.sC+ac.eng*p.sE+ac.tech*p.sT);
  const cost=fuel+co2+maint+staff;
  return{ac,ln,f,sY,sJ,pY,pJ,rev,fuel,co2,maint,staff,cost,profit:rev-cost};
}

// Best number of flights per week and seat configuration for one aircraft type
function evalAc(ac,ln,p){
  const tripH=ln.tripH(ac);
  const maxF=Math.floor(WEEK_H/tripH/2)*2;
  if(maxF<2)return null;
  // Candidates: as many flights as fit into the week, and the numbers around the point where
  // the weekly demand is used up (more flights would fly with empty seats)
  const full=(ln.y+2*ln.j)/ac.cap, cand=new Set([maxF]);
  for(let x=Math.floor(full/2)*2-4;x<=Math.ceil(full/2)*2+4;x+=2)if(x>=2&&x<=maxF)cand.add(x);
  let best=null;
  for(const f of cand){
    // J first (pays more per seat unit up to ~14,000 km) or Y first; remaining seats as Y
    const j1=Math.min(Math.floor(ln.j/f),Math.floor(ac.cap/2));
    const y2=Math.min(Math.floor(ln.y/f),ac.cap),j2=Math.min(Math.floor(ln.j/f),Math.floor((ac.cap-y2)/2));
    for(const c of [{sJ:j1,sY:ac.cap-2*j1},{sJ:j2,sY:ac.cap-2*j2}]){
      const r=evalWeek(ac,ln,p,f,c);
      if(r&&(!best||r.profit>best.profit))best=r;
    }
  }
  if(best){best.tripH=tripH;best.cycles=cyclePlan(best.f);best.payback=best.profit>0?ac.cost/(best.profit/7):Infinity}
  return best;
}

function lineOptions(ln,p){
  const out=[];
  for(const ac of CHAR_AC){
    if(ac.range<ln.d||ac.rwy>ln.rwyLimit||(!p.anyCap&&ac.cost>p.cap))continue;
    const r=evalAc(ac,ln,p);
    if(r&&r.profit>0)out.push(r);
  }
  return out.sort((a,b)=>b.profit-a.profit);
}

// ---------- Choice of the lines ----------
// Without capital limit: the X most profitable lines (one aircraft each).
// With capital: knapsack – at most one aircraft type per line, sum of prices ≤ capital, ≤ X aircraft.
function planLines(cands,p){
  const X=p.nAc;
  if(p.anyCap)return cands.map(ln=>ln.best).sort((a,b)=>b.profit-a.profit).slice(0,X);
  const groups=cands.map(ln=>{
    // Pareto front per line: cheaper or more profitable than all others
    const o=ln.opts.slice().sort((a,b)=>a.ac.cost-b.ac.cost||b.profit-a.profit),front=[];let bp=-Infinity;
    for(const r of o)if(r.profit>bp){front.push(r);bp=r.profit}
    return front;
  }).filter(g=>g.length);
  if(!groups.length)return[];
  const nOpts=groups.reduce((s,g)=>s+g.length,0);
  const B=Math.max(200,Math.min(4000,Math.floor(1.5e8/(nOpts*X)),Math.floor(6e7/(groups.length*(X+1)))));
  const W=B+1,Sz=(X+1)*W,unit=p.cap/B,wOf=r=>Math.max(1,Math.ceil(r.ac.cost/unit-1e-9));
  let dp=new Float64Array(Sz).fill(-Infinity),nd=new Float64Array(Sz);
  for(let c=0;c<W;c++)dp[c]=0;
  const choice=groups.map(()=>new Uint16Array(Sz));
  groups.forEach((g,gi)=>{
    nd.set(dp);
    const ch=choice[gi];
    g.forEach((r,oi)=>{
      const w=wOf(r);if(w>B)return;
      for(let k=X;k>=1;k--){
        const bo=(k-1)*W,bn=k*W;
        for(let c=B;c>=w;c--){const v=dp[bo+c-w]+r.profit;if(v>nd[bn+c]){nd[bn+c]=v;ch[bn+c]=oi+1}}
      }
    });
    [dp,nd]=[nd,dp];
  });
  let k=0;for(let x=1;x<=X;x++)if(dp[x*W+B]>dp[k*W+B])k=x;
  const pick=[];let c=B;
  for(let gi=groups.length-1;gi>=0&&k>0;gi--){
    const ch=choice[gi][k*W+c];
    if(ch){const r=groups[gi][ch-1];pick.push(r);c-=wOf(r);k--}
  }
  // Fill rounding remainders with exact prices
  let left=p.cap-pick.reduce((s,r)=>s+r.ac.cost,0);
  const used=new Set(pick.map(r=>r.ln.key));
  while(pick.length<X){
    let best=null;
    for(const g of groups){if(used.has(g[0].ln.key))continue;for(const r of g)if(r.ac.cost<=left&&(!best||r.profit>best.profit))best=r}
    if(!best)break;
    pick.push(best);used.add(best.ln.key);left-=best.ac.cost;
  }
  return pick.sort((a,b)=>b.profit-a.profit);
}

// ---------- Calculation ----------
function getParams(){
  const anyCap=$('anyCapital').checked;
  return{easy:gameMode==='easy',anyCap,cap:anyCap?Infinity:AM4.parseAmount($('capital').value),
    nAc:Math.min(MAX_AC,Math.max(1,Math.floor(+$('nAircraft').value||1))),
    fuelP:FUEL_PRICE,co2P:CO2_PRICE,sP:SAL.pilot,sC:SAL.crew,sE:SAL.eng,sT:SAL.tech};
}

function buildLines(hub,dv,p){
  const out=[];
  CH.dest.forEach((di,k)=>{
    if(di===hub.i)return;
    const {y,j}=AM4.charterDemand(dv,k);
    if(y+j===0)return;
    const b=AP[di],d=AM4.distance(hub,b);
    const mult=p.easy?1.5:1;
    out.push({key:hub.i+'-'+di,hub,ap:b,d,dist:Math.ceil(d*100)/100,y,j,
      rwyLimit:p.easy?Infinity:Math.min(hub.rwy,b.rwy),prices:ticketPrices(d,p.easy),
      tripH:ac=>d/(ac.speed*mult)});
  });
  return out;
}

async function calculate(){
  if(!hubs.length){$('summary').innerHTML=errCard(S.errHubTitle,S.errHubText);return}
  const p=getParams();
  if(!p.anyCap&&p.cap<=0){$('summary').innerHTML=errCard(S.errCapitalTitle,S.errCapitalText);return}
  const btn=$('calcBtn');btn.disabled=true;btn.classList.add('is-busy');
  try{
    const dvs=await Promise.all(hubs.map(h=>AM4.loadCharterDemand(h.i)));
    await new Promise(r=>setTimeout(r,20)); // let the display update
    const all=[];
    hubs.forEach((h,i)=>all.push(...buildLines(h,dvs[i],p)));
    for(const ln of all){ln.opts=lineOptions(ln,p);ln.best=ln.opts[0]||null}
    lines=all;
    renderSummary(all.filter(ln=>ln.best),p);
    listSort={k:'profit',asc:false};shown=PAGE;openRow=null;
    renderList();
    $('listArea').hidden=false;
  }catch(e){
    console.error(e);
    $('summary').innerHTML=errCard(S.errDemandTitle,S.errDemandText);
  }finally{btn.disabled=false;btn.classList.remove('is-busy')}
}

// ---------- Output ----------
function errCard(t,m){return`<div class="am4-card err-card"><h2>⚠️ ${esc(t)}</h2><p>${esc(m)}</p></div>`}
function costBlock(staff,maint,fuel,co2){
  return`<div class="costs">
    <div><b>${money(staff)}</b>${esc(S.staff)}</div>
    <div><b>${money(maint)}</b>${esc(S.maintenance)}</div>
    <div><b>${money(fuel)}</b>${esc(S.fuel)}</div>
    <div><b>${money(co2)}</b>${esc(S.co2)}</div>
  </div>`;
}
const cyc=r=>r.cycles.join(' + ');
const apCell=a=>`${esc(a.iata)} · ${esc(a.name)}<small>${esc(a.country)}</small>`;

// With several hubs: first the best plan for every hub on its own, then the best plan over all hubs
function renderSummary(cands,p){
  const el=$('summary');
  const cards=[];
  if(hubs.length>1){
    cards.push(`<h2 class="plan-head">${esc(S.perHubHead)}</h2><p class="hint">${esc(S.perHubHint)}</p>`);
    for(const h of hubs){
      const plan=planLines(cands.filter(ln=>ln.hub===h),p);
      cards.push(plan.length?planCard(tpl(plan.length===1?S.hubPlanOne:S.hubPlan,{hub:h.iata+' '+h.name,n:nf(plan.length)}),plan,p,false)
        :errCard(tpl(S.hubNoLine,{hub:h.iata+' '+h.name}),tpl(S.noRouteText,{cap:p.anyCap?S.anyCapital:money(p.cap)})));
    }
    cards.push(`<h2 class="plan-head">${esc(S.allHubsHead)}</h2>`);
  }
  const plan=planLines(cands,p);
  cards.push(plan.length?planCard(tpl(plan.length===1?S.planTitleOne:S.planTitle,{n:nf(plan.length)}),plan,p,true)
    :errCard(S.noRouteTitle,tpl(S.noRouteText,{cap:p.anyCap?S.anyCapital:money(p.cap)})));
  el.innerHTML=cards.join('');
}

function planCard(title,plan,p,main){
  const sum=k=>plan.reduce((s,r)=>s+(typeof k==='function'?k(r):r[k]),0);
  const profit=sum('profit'),inv=sum(r=>r.ac.cost);
  return`<div class="am4-card plan-card${main?'':' hub-plan'}">
    <h2>${esc(title)}</h2>
    ${plan.length<p.nAc?`<p class="hint">${esc(tpl(S.planShort,{n:nf(plan.length),want:nf(p.nAc)}))}</p>`:''}
    <div class="stats">
      <div class="stat"><div class="val pos">${money(profit)}</div><div class="lbl">${esc(S.profitWeek)}</div></div>
      <div class="stat"><div class="val">${money(sum('rev'))}</div><div class="lbl">${esc(S.revenueWeek)}</div></div>
      <div class="stat"><div class="val">${money(inv)}</div><div class="lbl">${esc(S.investment)}</div></div>
      ${p.anyCap?'':`<div class="stat"><div class="val">${money(p.cap-inv)}</div><div class="lbl">${esc(S.remaining)}</div></div>`}
      <div class="stat"><div class="val">${paybackTxt(profit>0?inv/(profit/7):Infinity)}</div><div class="lbl">${esc(S.invPayback)}</div></div>
    </div>
    ${costBlock(sum('staff'),sum('maint'),sum('fuel'),sum('co2'))}
    <div class="table-wrap"><table class="am4-table">
      <thead><tr><th>${esc(S.colHub)}</th><th>${esc(S.colDest)}</th><th>km</th><th>${esc(S.colAircraft)}</th><th>${esc(S.colConfig)}</th><th>${esc(S.colCycles)}</th><th>${esc(S.colFlights)}</th><th>${esc(S.colRev)}</th><th>${esc(S.colCost)}</th><th>${esc(S.colProfit)}</th><th>${esc(S.colPrice)}</th></tr></thead>
      <tbody>${plan.map(r=>`<tr>
        <td class="t">${esc(r.ln.hub.iata)}</td>
        <td class="t">${apCell(r.ln.ap)}</td>
        <td>${nf(r.ln.d)}</td>
        <td class="t">${esc(r.ac.name)}</td>
        <td>${cfgTags(r)}</td>
        <td>${cyc(r)}</td>
        <td>${nf(r.f)}</td>
        <td>${money(r.rev)}</td><td>${money(r.cost)}</td><td class="pos">${money(r.profit)}</td><td>${money(r.ac.cost)}</td>
      </tr>`).join('')}
      <tr class="total"><td class="t">${esc(S.total)}</td><td></td><td></td><td class="t">${esc(tpl(S.nAircraft,{n:nf(plan.length)}))}</td><td></td><td></td><td>${nf(sum('f'))}</td>
        <td>${money(sum('rev'))}</td><td>${money(sum('cost'))}</td><td class="pos">${money(profit)}</td><td>${money(inv)}</td></tr>
      </tbody></table></div>
  </div>`;
}

// ---------- Line list ----------
const SORTERS={
  hub:ln=>ln.hub.iata,dest:ln=>ln.ap.iata,d:ln=>ln.d,dem:ln=>ln.y+2*ln.j,ac:ln=>ln.best.ac.name,
  f:ln=>ln.best.f,rev:ln=>ln.best.rev,cost:ln=>ln.best.cost,profit:ln=>ln.best.profit,
  price:ln=>ln.best.ac.cost,payback:ln=>ln.best.payback
};
function renderList(){
  const q=$('search').value.trim().toLowerCase();
  let list=lines.filter(ln=>ln.best);
  if(q)list=list.filter(ln=>[ln.hub.iata,ln.ap.iata,ln.ap.name,ln.ap.full,ln.ap.country,ln.best.ac.name,ln.best.ac.sn].some(s=>s.toLowerCase().includes(q)));
  const f=SORTERS[listSort.k],dir=listSort.asc?1:-1;
  list.sort((a,b)=>{const va=f(a),vb=f(b);return(typeof va==='string'?va.localeCompare(vb):va-vb)*dir});
  document.querySelectorAll('#lineTable th.s').forEach(th=>th.classList.toggle('sorted',th.dataset.k===listSort.k));
  $('listInfo').textContent=tpl(S.listInfo,{p:nf(lines.filter(ln=>ln.best).length),t:nf(lines.length),h:nf(hubs.length)})+(q?tpl(S.listMatches,{n:nf(list.length)}):'');
  const tb=$('tbody');
  if(!list.length){tb.innerHTML=`<tr><td colspan="13" class="empty">${esc(q?S.noMatch:S.noProfitList)}</td></tr>`;$('moreBtn').hidden=true;return}
  tb.innerHTML=list.slice(0,shown).map(ln=>{
    const b=ln.best;
    return`<tr class="rt" tabindex="0" data-k="${ln.key}">
      <td class="t">${esc(ln.hub.iata)}</td><td class="t">${apCell(ln.ap)}</td><td>${nf(ln.d)}</td>
      <td><span class="tag tag-y">${nf(ln.y)}</span> <span class="tag tag-j">${nf(ln.j)}</span></td>
      <td class="t">${esc(b.ac.name)}</td><td>${cfgTags(b)}</td><td>${cyc(b)}</td><td>${nf(b.f)}</td>
      <td>${money(b.rev)}</td><td>${money(b.cost)}</td><td class="pos">${money(b.profit)}</td>
      <td>${money(b.ac.cost)}</td><td>${paybackTxt(b.payback)}</td></tr>`+(openRow===ln.key?detailRow(ln):'');
  }).join('');
  $('moreBtn').hidden=list.length<=shown;
  $('moreBtn').textContent=tpl(S.more,{n:nf(Math.min(PAGE,list.length-shown)),m:nf(list.length-shown)});
}
function detailRow(ln){
  const b=ln.best;
  return`<tr class="detail"><td colspan="13">
    <b>${esc(ln.hub.full)} → ${esc(ln.ap.full)}</b> · ${esc(ln.ap.iata)}/${esc(ln.ap.icao)}<br>
    ${esc(tpl(S.detail,{ac:b.ac.name,f:nf(b.f),h:num(b.tripH,1),u:num(b.f*b.tripH,1)}))}<br>
    ${esc(tpl(S.demandUse,{y:nf(b.pY),dy:nf(ln.y),j:nf(b.pJ),dj:nf(ln.j)}))}
    ${costBlock(b.staff,b.maint,b.fuel,b.co2)}
    <table class="am4-table alt"><thead><tr><th>${esc(S.alternatives)}</th><th>${esc(S.colConfig)}</th><th>${esc(S.colCycles)}</th><th>${esc(S.colProfit)}</th><th>${esc(S.colPrice)}</th><th>${esc(S.payback)}</th></tr></thead><tbody>
    ${ln.opts.slice(0,6).map(o=>`<tr><td class="t">${esc(o.ac.name)}</td><td>${cfgTags(o)}</td><td>${cyc(o)}</td><td class="pos">${money(o.profit)}</td><td>${money(o.ac.cost)}</td><td>${paybackTxt(o.payback)}</td></tr>`).join('')}
    </tbody></table>
  </td></tr>`;
}

// ---------- Charter hubs ----------
function renderHubs(){
  const el=$('hubList');
  el.innerHTML=hubs.map((h,i)=>`<span class="hub-chip" title="${esc(h.full)} · ${esc(S.runway)} ${nf(h.rwy)} ft">✈️ <b>${esc(h.iata)}</b> ${esc(h.name)}<button type="button" data-i="${i}" aria-label="${esc(S.remove)}">×</button></span>`).join('');
  $('hubInfo').textContent=hubs.length?tpl(S.hubCount,{n:nf(hubs.length),max:MAX_HUBS}):tpl(S.hubHint,{max:MAX_HUBS});
  $('addHub').disabled=$('hubAirport').value===''||hubs.length>=MAX_HUBS;
  $('calcBtn').disabled=!hubs.length;
}
function addHub(){
  const v=$('hubAirport').value;if(v==='')return;
  const h=AP[+v];
  if(hubs.length>=MAX_HUBS){$('hubInfo').textContent=tpl(S.hubFull,{max:MAX_HUBS});return}
  if(hubs.some(x=>x.i===h.i)){$('hubInfo').textContent=tpl(S.hubDouble,{hub:h.iata});return}
  hubs.push(h);renderHubs();
  AM4.loadCharterDemand(h.i).catch(()=>{});
}

$('hubCountry').addEventListener('change',()=>{
  const c=$('hubCountry').value,s=$('hubAirport');
  if(!c){s.replaceChildren(AM4.option('',S.pickCountryFirst));s.disabled=true}
  else AM4.fillAirports(s,AP,c,S.pickAirport);
  renderHubs();
});
$('hubAirport').addEventListener('change',renderHubs);
$('addHub').addEventListener('click',addHub);
$('hubList').addEventListener('click',e=>{const b=e.target.closest('button[data-i]');if(!b)return;hubs.splice(+b.dataset.i,1);renderHubs()});

$('gameToggle').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
  $('gameToggle').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));gameMode=b.dataset.v});
const capEl=$('capital');
capEl.value=nf(AM4.parseAmount(capEl.value));
capEl.addEventListener('blur',()=>{const n=AM4.parseAmount(capEl.value);if(n>0)capEl.value=nf(n)});
$('anyCapital').addEventListener('change',()=>{capEl.disabled=$('anyCapital').checked});
$('nAircraft').addEventListener('change',()=>{const e=$('nAircraft');e.value=Math.min(MAX_AC,Math.max(1,Math.floor(+e.value||1)))});
$('calcBtn').addEventListener('click',calculate);
$('search').addEventListener('input',()=>{shown=PAGE;renderList()});
$('moreBtn').addEventListener('click',()=>{shown+=PAGE;renderList()});
document.querySelectorAll('#lineTable th.s').forEach(th=>th.addEventListener('click',()=>{
  const k=th.dataset.k;
  listSort=listSort.k===k?{k,asc:!listSort.asc}:{k,asc:['hub','dest','ac','payback'].includes(k)};
  renderList();
}));
function toggleRow(tr){const k=tr.dataset.k;openRow=openRow===k?null:k;renderList()}
$('tbody').addEventListener('click',e=>{const tr=e.target.closest('tr.rt');if(tr)toggleRow(tr)});
$('tbody').addEventListener('keydown',e=>{const tr=e.target.closest('tr.rt');if(tr&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggleRow(tr)}});

Promise.all([AM4.loadAirports(),AM4.loadCharter()]).then(([ap,ch])=>{
  AP=ap;CH=ch;
  CHAR_AC=AIRCRAFT.filter(a=>ch.aircraft.has(a.id));
  AM4.fillCountries($('hubCountry'),AP,S.pickCountry);
  renderHubs();
}).catch(()=>{
  $('hubCountry').replaceChildren(AM4.option('',S.unavailable));
  $('hubInfo').className='hint warn no-translate';
  $('hubInfo').textContent=S.dataError;
});

// For tests (node): pure calculation functions
window.AM4Charter={ticketPrices,evalAc,evalWeek,cyclePlan,planLines};
})();

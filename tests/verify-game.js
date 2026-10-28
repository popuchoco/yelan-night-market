const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'dist', 'app.js'), 'utf8');
class Classes { add(){} remove(){} toggle(){} }
class Element {
  constructor(id='') { this.id=id; this.dataset={}; this.style={}; this.classList=new Classes(); this.hidden=false; this.textContent=''; this.innerHTML=''; this.listeners={}; this.width=1000; this.height=660; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  getContext() { return ctx; }
  getBoundingClientRect() { return {left:0,top:0,width:1000,height:660}; }
  setPointerCapture(){}
  focus(){}
  closest(sel) { return sel==='[data-action]' ? this : null; }
}
const no=()=>{};
const ctx=new Proxy({createLinearGradient:()=>({addColorStop:no}),createRadialGradient:()=>({addColorStop:no}),measureText:()=>({width:50})},{get:(o,k)=>k in o?o[k]:no,set:(o,k,v)=>(o[k]=v,true)});
const elements = new Map();
const ids=['worldCanvas','saveLabel','toast','dayValue','coinsValue','fameValue','regularValue','phaseLabel','panelPhase','worldState','worldStateText','mainAction','panelHeading','panelContent','orderKicker','orderTitle','orderMeta','orderQuote','orderChoices','orderModal','cameraLabel'];
for(const id of ids) elements.set(id,new Element(id));
elements.get('worldCanvas').getContext=()=>ctx;
const tabs=['ops','stock','equipment','staff','journal'].map(tab=>{const e=new Element();e.dataset={tab};return e;});
const worldTitle=new Element('world-title');
const closeOrder=new Element(); closeOrder.dataset.action='close-order';
const docListeners={};
const document={
  getElementById:id=>elements.get(id) || (elements.set(id,new Element(id)),elements.get(id)),
  querySelectorAll:s=>s==='.panel-tab'?tabs:[],
  querySelector:s=>s==='.world-title'?worldTitle:(s==='[data-action="close-order"]'?closeOrder:new Element()),
  addEventListener:(type,fn)=>(docListeners[type] ||= []).push(fn)
};
const win={devicePixelRatio:1,innerWidth:1200,innerHeight:800,addEventListener:no};
const storage=new Map();
const localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
let pendingFrame;
const raf=fn=>{pendingFrame=fn;};
new Function('document','window','localStorage','requestAnimationFrame','performance','clearTimeout','setTimeout',source)(document,win,localStorage,raf,{now:()=>1000},clearTimeout,setTimeout);
function act(action, data={}) {
  const button=new Element(); button.dataset={action,...data};
  const evt={target:{closest:()=>button},stopImmediatePropagation:no};
  for(const fn of docListeners.click||[]) fn(evt);
}
function state(){ return JSON.parse(storage.get('ye-lan-night-market-iso-v2')); }
act('panel-tab',{tab:'stock'});
if(!elements.get('panelContent').innerHTML.includes('補貨')) throw Error('備料面板未渲染');
const before=state().coins;
act('buy-stock',{id:'chicken'});
if(state().stock.chicken<5 || state().coins>=before) throw Error('進貨未扣款或未增加庫存');
act('panel-tab',{tab:'equipment'});
act('panel-tab',{tab:'staff'});
act('main-action');
if(state().phase!=='service' || !state().ledger) throw Error('營業/固定成本帳本未初始化');
act('call-next');
if(elements.get('orderModal').hidden) throw Error('顧客點餐 modal 未打開');
act('serve-dish',{id:'pepper-soup'});
if(state().customerIndex!==1 || state().stock.chicken!==4) throw Error('出餐未消耗庫存或未推進顧客');
if(typeof pendingFrame!=='function') throw Error('遊戲主畫格未啟動');
pendingFrame(1016);
console.log(JSON.stringify({phase:state().phase,coins:state().coins,chicken:state().stock.chicken,customerIndex:state().customerIndex,canvasFrame:'ok'}));

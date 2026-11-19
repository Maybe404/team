/**
 * [team 二开] 注入到 HTML 嵌入块 srcDoc 里的脚本。
 * iframe 是沙箱（没有 allow-same-origin），父页面读不到里面的 DOM，所以量元素位置的事只能在 iframe 里做，
 * 再用 postMessage 把结果告诉父页面：
 *   父 → 子  {loom:1, t:"focus", sel, follow, hold, limit}   开始盯住某个元素（follow=true 时把它附近弹出的下拉、浮层也算进去；hold=true 时锁住文档滚动，免得看到的区域漂走）
 *            {loom:1, t:"unfocus"}              不再盯
 *            {loom:1, t:"pick", on:true|false}  进入/退出点选元素模式（作者在原型里点一下就选中）
 *            {loom:1, t:"pickkey", key}         键盘焦点在编辑器里时，把 ArrowUp / ArrowDown / Escape 转发给点选模式
 *   子 → 父  {loom:1, t:"ready"}                页面脚本已就位
 *            {loom:1, t:"rect", found, x,y,w,h, fb, vw,vh}  被盯元素（含浮层）在 iframe 视口里的位置；fb 是浮层的最低边（没有浮层为 0）
 *            {loom:1, t:"picked", sel, tag, text}       点选结果，sel 是生成好的唯一 CSS 选择器
 *            {loom:1, t:"pick-cancel"}                  按 Esc 取消点选
 */

// srcDoc 页面里的 <a href="#/xx"> 会按父页面地址解析，点了会让 iframe 跳去加载 Loom 本身而被拒绝（refused to connect）。
// 把页内锚点改成只改自己的 location.hash，单页应用的 tab、路由就能正常切换。
const HASH_FIX = String.raw`document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href]');if(!a)return;var h=a.getAttribute('href');if(h&&h.charAt(0)==='#'&&!e.defaultPrevented){e.preventDefault();if(h.length>1){location.hash=h.slice(1);var t=document.getElementById(decodeURIComponent(h.slice(1)));if(t&&t.scrollIntoView)t.scrollIntoView();}else{location.hash='';}}},true);`;

const FOCUS = String.raw`
(function(){
var P=window.parent,sel="",follow=true,hold=true,limit=false,on=false,baseline=null,last="",raf=0,timer=0,found0=0,mo=null,ro=null;
function post(m){m.loom=1;try{P.postMessage(m,"*");}catch(e){}}
function q(s){try{return s?document.querySelector(s):null;}catch(e){return null;}}
function visible(el){var s=getComputedStyle(el);return s.display!=="none"&&s.visibility!=="hidden"&&parseFloat(s.opacity)>0;}
function box(el){var r=el.getBoundingClientRect();return r.width>0&&r.height>0?{l:r.left,t:r.top,r:r.right,b:r.bottom}:null;}
function merge(a,b){return{l:Math.min(a.l,b.l),t:Math.min(a.t,b.t),r:Math.max(a.r,b.r),b:Math.max(a.b,b.b)};}
function near(a,b,d){return a.l<b.r+d&&a.r>b.l-d&&a.t<b.b+d&&a.b>b.t-d;}
function floating(el){var s=getComputedStyle(el);return(s.position==="fixed"||s.position==="absolute")&&s.display!=="none"&&s.visibility!=="hidden"&&parseFloat(s.opacity)>0;}
function floaters(target,rect){
  var out=[],all=document.body?document.body.getElementsByTagName("*"):[],n=Math.min(all.length,4000),vw=window.innerWidth,vh=window.innerHeight;
  for(var i=0;i<n;i++){
    var el=all[i];
    if(el===target||el.contains(target)||!floating(el))continue;
    var inside=target.contains(el);
    // fresh：开始盯之后才出现的（点开的下拉、弹出的浮层）；一直在那的定位元素（吸底栏、容器里固定位置的按钮）不是 fresh
    var fresh=!(baseline&&baseline.has(el));
    if(!inside&&!fresh)continue;
    var b=box(el);
    if(!b)continue;
    // 铺满整个视口的遮罩层不算：它不是被讲的那一块
    if((b.r-b.l)>=vw*0.9&&(b.b-b.t)>=vh*0.9)continue;
    if(!near(b,rect,360))continue;
    out.push({b:b,fresh:fresh});
  }
  return out;
}
function snapshot(target){
  baseline=new WeakSet();
  var all=document.body?document.body.getElementsByTagName("*"):[],n=Math.min(all.length,4000);
  for(var i=0;i<n;i++){var el=all[i];if(el!==target&&!el.contains(target)&&floating(el)&&box(el))baseline.add(el);}
}
function report(){
  raf=0;
  if(!on)return;
  var t=q(sel);
  if(!t){var m="n";if(m!==last){last=m;post({t:"rect",found:false});}return;}
  var r=box(t);
  if(!r){var m2="h";if(m2!==last){last=m2;post({t:"rect",found:false});}return;}
  if(!baseline){snapshot(t);}
  var u=r;
  var fb=0;
  if(follow){var fl=floaters(t,r);for(var i=0;i<fl.length;i++){u=merge(u,fl[i].b);if(fl[i].fresh&&fl[i].b.b>fb)fb=fl[i].b.b;}}
  var th=Math.round(r.b-r.t);
  var m3=[th,u.l,u.t,u.r,u.b,fb,window.innerWidth,window.innerHeight].map(function(v){return Math.round(v);}).join(",");
  if(m3===last)return;
  last=m3;
  post({t:"rect",found:true,x:u.l,y:u.t,w:u.r-u.l,h:u.b-u.t,fb:fb,th:th,vw:window.innerWidth,vh:window.innerHeight});
}
// 不用 requestAnimationFrame：跨域 iframe 滚出视口后浏览器会暂停它的渲染，rAF 不触发，位置就一直报不上来
function schedule(){if(!raf)raf=setTimeout(report,30);}
function later(){schedule();setTimeout(schedule,80);setTimeout(schedule,320);}
function reveal(){
  var t=q(sel);if(!t)return false;
  var r=t.getBoundingClientRect(),vh=window.innerHeight;
  if(r.top<0||r.bottom>vh){try{t.scrollIntoView({block:r.height>vh?"start":"nearest",inline:"nearest"});}catch(e){}}
  return true;
}
// 选中的元素比视口还高：允许在它自己的上下边界之间滚动，到头就停住，不滚进相邻的区块
function clampScroll(){
  if(!on||!limit)return;
  var t=q(sel);if(!t)return;
  var r=t.getBoundingClientRect(),y=window.pageYOffset||0,vh=window.innerHeight;
  var top=r.top+y,bot=r.bottom+y,max=Math.max(top,bot-vh);
  var ny=Math.min(Math.max(y,top),max);
  if(Math.abs(ny-y)>0.5)window.scrollTo(window.pageXOffset||0,ny);
}
function start(){
  on=true;last="";baseline=null;found0=0;
  // 只看一块时不要让整个文档自己滚走，否则看到的区域会跟着漂
  var d=document.documentElement;d.style.overflow=hold?"hidden":"";if(document.body)document.body.style.overflow=hold?"hidden":"";
  if(!mo){
    mo=new MutationObserver(schedule);
    mo.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
    if(window.ResizeObserver){ro=new ResizeObserver(schedule);ro.observe(document.documentElement);}
    ["click","input","change","focus","transitionend","animationend","scroll","resize","keyup","mouseup"].forEach(function(n){window.addEventListener(n,later,true);});
    window.addEventListener("scroll",clampScroll,true);
    timer=setInterval(function(){if(on){if(!found0&&reveal())found0=1;schedule();}},400);
  }
  reveal();later();
}
function stop(){
  on=false;baseline=null;last="";
  var d=document.documentElement;d.style.overflow="";if(document.body)document.body.style.overflow="";
}

// ---- 点选元素 ----
var pk=null,hover=null,stack=[];
function esc(s){return window.CSS&&CSS.escape?CSS.escape(s):String(s).replace(/[^\w-]/g,"\\$&");}
function uniq(s,el){try{var l=document.querySelectorAll(s);return l.length===1&&l[0]===el;}catch(e){return false;}}
var STATEY=/^(is|has|active|open|opened|show|shown|hidden|selected|current|disabled|hover|focus|on|off|visible|expanded|collapsed)([-_A-Z0-9]|$)/i;
function selectorOf(el){
  var keys=["data-focus","data-testid","data-test","data-id","data-name","name","id"];
  for(var i=0;i<keys.length;i++){
    var v=el.getAttribute(keys[i]);
    if(!v)continue;
    var s=keys[i]==="id"?"#"+esc(v):"["+keys[i]+'="'+String(v).replace(/"/g,'\\"')+'"]';
    if(uniq(s,el))return s;
  }
  var cl=el.classList;
  for(var j=0;j<cl.length;j++){
    if(!/^[a-zA-Z][\w-]{1,30}$/.test(cl[j])||STATEY.test(cl[j]))continue;
    var c1="."+esc(cl[j]);if(uniq(c1,el))return c1;
    var c2=el.tagName.toLowerCase()+c1;if(uniq(c2,el))return c2;
  }
  var path=[],cur=el;
  while(cur&&cur.nodeType===1&&cur!==document.documentElement){
    var part=cur.tagName.toLowerCase(),id=cur.getAttribute("id");
    if(id&&uniq("#"+esc(id),cur)){path.unshift("#"+esc(id));if(uniq(path.join(" > "),el))return path.join(" > ");break;}
    var p=cur.parentElement;
    if(p){var k=1,sb=cur;while((sb=sb.previousElementSibling))k++;part+=":nth-child("+k+")";}
    path.unshift(part);
    if(uniq(path.join(" > "),el))return path.join(" > ");
    cur=p;
  }
  return path.join(" > ");
}
function labelOf(el){var t=(el.innerText||el.textContent||"").replace(/\s+/g," ").trim();return t.length>24?t.slice(0,24)+"…":t;}
function mark(el){
  hover=el;
  if(!pk)return;
  if(!el){pk.style.display="none";return;}
  var r=el.getBoundingClientRect();
  pk.style.display="block";
  pk.style.left=r.left+"px";pk.style.top=r.top+"px";pk.style.width=r.width+"px";pk.style.height=r.height+"px";
  pk.firstChild.textContent=el.tagName.toLowerCase()+(el.classList[0]?"."+el.classList[0]:"")+"  ↑上一层  Esc取消";
}
function pointAt(e){var el=document.elementFromPoint(e.clientX,e.clientY);if(el===pk||(pk&&pk.contains(el)))return hover;return el;}
function onMove(e){var el=pointAt(e);if(el&&el!==hover){stack=[];mark(el);}}
function onClick(e){
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  var el=hover||pointAt(e);if(!el)return;
  var s=selectorOf(el);
  endPick();
  post({t:"picked",sel:s,tag:el.tagName.toLowerCase(),text:labelOf(el)});
}
function swallow(e){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();}
function onKey(e){
  if(e.key==="Escape"){swallow(e);endPick();post({t:"pick-cancel"});}
  else if(e.key==="ArrowUp"&&hover&&hover.parentElement&&hover.parentElement!==document.documentElement){swallow(e);stack.push(hover);mark(hover.parentElement);}
  else if(e.key==="ArrowDown"&&stack.length){swallow(e);mark(stack.pop());}
}
function beginPick(){
  if(pk)return;
  pk=document.createElement("div");
  pk.setAttribute("data-loom-pick","1");
  pk.style.cssText="position:fixed;z-index:2147483647;pointer-events:none;display:none;box-sizing:border-box;border:2px solid #2563eb;background:rgba(37,99,235,.14);border-radius:3px";
  var lb=document.createElement("div");
  lb.style.cssText="position:absolute;left:-2px;top:-22px;background:#2563eb;color:#fff;font:12px/20px system-ui,sans-serif;padding:0 6px;border-radius:3px;white-space:nowrap";
  pk.appendChild(lb);
  document.documentElement.appendChild(pk);
  document.documentElement.style.cursor="crosshair";
  window.addEventListener("mousemove",onMove,true);
  window.addEventListener("click",onClick,true);
  ["mousedown","mouseup","pointerdown","pointerup","touchstart","submit","dblclick","contextmenu"].forEach(function(n){window.addEventListener(n,swallow,true);});
  window.addEventListener("keydown",onKey,true);
}
function endPick(){
  if(!pk)return;
  window.removeEventListener("mousemove",onMove,true);
  window.removeEventListener("click",onClick,true);
  ["mousedown","mouseup","pointerdown","pointerup","touchstart","submit","dblclick","contextmenu"].forEach(function(n){window.removeEventListener(n,swallow,true);});
  window.removeEventListener("keydown",onKey,true);
  if(pk.parentNode)pk.parentNode.removeChild(pk);
  pk=null;hover=null;stack=[];
  document.documentElement.style.cursor="";
}

window.addEventListener("message",function(e){
  var d=e.data;
  if(e.source!==P||!d||d.loom!==1)return;
  if(d.t==="focus"){sel=String(d.sel||"");follow=d.follow!==false;hold=d.hold!==false;limit=!!d.limit;if(sel)start();else stop();}
  else if(d.t==="unfocus"){stop();}
  else if(d.t==="pick"){if(d.on)beginPick();else endPick();}
  else if(d.t==="pickkey"&&pk){var nop=function(){};onKey({key:String(d.key||""),preventDefault:nop,stopPropagation:nop,stopImmediatePropagation:nop});}
});
function ready(){post({t:"ready"});}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ready);else ready();
})();
`;

const SCRIPT = `<script>${HASH_FIX}${FOCUS}</script>`;

/** 把注入脚本放到 <head> 最前面，保证先于页面自己的脚本就位 */
export const withInject = (html: string) => {
  const m = /<head[^>]*>/i.exec(html) ?? /<html[^>]*>/i.exec(html) ?? /<!doctype[^>]*>/i.exec(html);
  if (!m) return SCRIPT + html;
  const i = m.index + m[0].length;
  return html.slice(0, i) + SCRIPT + html.slice(i);
};

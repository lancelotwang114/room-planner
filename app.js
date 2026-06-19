'use strict';
/* 房屋家具配置工具 v2 — vanilla JS + SVG。viewBox 以公分為座標 → 比例尺自動成立。
   多分頁文件、框選群組、四角縮放、牆編輯、門開向、自訂家具。 */

/* ---------- 內建家具目錄（台灣常見預設 寬×深 cm） ---------- */
const CATALOG = [
  {cat:'床',   color:'#c7d2fe', items:[['單人床',90,190],['雙人床',152,190]]},
  {cat:'客廳', color:'#bbf7d0', items:[['沙發',200,90],['茶几',120,60],['電視櫃',150,40]]},
  {cat:'餐廚', color:'#fed7aa', items:[['餐桌',120,80],['冰箱',70,70],['流理台',180,60]]},
  {cat:'收納', color:'#fde68a', items:[['衣櫃',120,60],['書桌',120,60]]},
  {cat:'衛浴', color:'#a5f3fc', items:[['馬桶',40,60],['浴缸',160,75]]},
  {cat:'開口', color:'#e5e7eb', items:[['門',90,10],['窗',120,10]]},
];
const TYPE = {};   // 內建 type -> {w,d,color}
CATALOG.forEach(g => g.items.forEach(([n,w,d]) => TYPE[n] = {w,d,color:g.color}));
const CUSTOM_COLOR = '#ddd6fe';
const PYEONG_CM2 = 33058;          // 1 坪 ≈ 3.3058 m² = 33058 cm²
const WALL_THICK = 10;             // 後備牆厚（實際 = 格線值，填滿一格）
function marginCm(){ return Math.max(60, state.grid + 20); }   // 畫布外留白，容納外牆外推

/* ---------- 狀態 ---------- */
const LS = 'roomplanner_v2';
let doc, state, view = null, fitW = 0, mode = 'select', nextId = 1;
let selected = [];                 // [{kind,id}]  多選
let spaceDown = false;
let showAreas = false;             // 顯示房間面積（不存檔）
let roomsCache = {key:null, rooms:[]};
let measure = null;                // 量測線 {x1,y1,x2,y2}（暫態，不存檔）

function blankLayout(name){
  return { name, area:{w:600,h:500}, grid:10, snap:true, walls:[], furniture:[], texts:[], customTypes:[] };
}
function blankDoc(){ return { version:2, active:0, tabs:[ blankLayout('格局 1') ] }; }
function setActive(i){ doc.active = i; state = doc.tabs[i]; }
function uid(){ return 'i' + (nextId++); }
function fixIds(){
  let max = 0;
  doc.tabs.forEach(L => [...L.walls, ...L.furniture, ...L.texts].forEach(o => {
    const n = +String(o.id||'').replace(/\D/g,''); if(n>max) max=n;
  }));
  nextId = max + 1;
}
function typeInfo(t){ return TYPE[t] || state.customTypes.find(c => c.n === t) && {w:0,d:0,color:CUSTOM_COLOR, ...state.customTypes.find(c=>c.n===t)} || {w:60,d:60,color:CUSTOM_COLOR}; }
function typeColor(t){ const c = state.customTypes.find(c=>c.n===t); return c ? CUSTOM_COLOR : (TYPE[t]||{}).color || '#e2e8f0'; }
function isDoor(f){ return f.type === '門'; }

/* ---------- DOM ---------- */
const svg = document.getElementById('board');
const toast = document.getElementById('toast');
const $ = id => document.getElementById(id);

/* ---------- 工具函式 ---------- */
function esc(s){ return String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function snap(v){ return state.snap ? Math.round(v/state.grid)*state.grid : Math.round(v); }
function clampArea(){ state.area.w = Math.max(100, Math.min(3000, state.area.w)); state.area.h = Math.max(100, Math.min(3000, state.area.h)); }
function rot2(vx,vy,deg){ const r=deg*Math.PI/180,c=Math.cos(r),s=Math.sin(r); return {x:vx*c-vy*s, y:vx*s+vy*c}; }
function center(o){ return {x:o.x+o.w/2, y:o.y+o.d/2}; }
function toSvg(ev){
  const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
  const m = svg.getScreenCTM(); if(!m) return {x:0,y:0};
  const p = pt.matrixTransform(m.inverse()); return {x:p.x, y:p.y};
}
function showToast(msg){
  toast.textContent = msg; toast.classList.add('show');
  clearTimeout(showToast._t); showToast._t = setTimeout(()=>toast.classList.remove('show'), 1600);
}
let H_CM = 6;   // 控制點半徑（公分，依縮放換算成 ~9px）
function calcHandleSize(){ H_CM = (view.w / (svg.clientWidth||800)) * 9; }

/* ---------- 縮放 / 平移 ---------- */
function fitView(){ const M=marginCm(); view = { x:-M, y:-M, w:state.area.w+2*M, h:state.area.h+2*M }; fitW = view.w; }
function applyView(){
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  const lbl = $('zoomLabel'); if(lbl) lbl.textContent = Math.round((fitW||view.w)/view.w*100) + '%';
}
function zoomBy(f, cx, cy){
  if(!view) fitView();
  if(cx == null){ cx = view.x+view.w/2; cy = view.y+view.h/2; }
  let nw = view.w/f; nw = Math.max(40, Math.min(state.area.w*4, nw));
  const af = view.w/nw;
  view.x = cx-(cx-view.x)/af; view.y = cy-(cy-view.y)/af;
  view.w /= af; view.h /= af;
  applyView();
}

/* ---------- 復原 / 重做 / 存檔 ---------- */
let undoStack = [], redoStack = [], saveTimer;
function snapshot(){ return JSON.stringify(doc); }
function commit(prev){
  if(prev !== undefined && prev !== snapshot()){
    undoStack.push(prev); if(undoStack.length>80) undoStack.shift(); redoStack = [];
  }
  save();
}
function applyDoc(o, refit){
  doc = o; setActive(Math.min(doc.active||0, doc.tabs.length-1)); fixIds();
  selected = []; if(refit || !view) fitView();
  render(); renderTabs(); renderCatalog(); syncInputs(); save();
}
function undo(){ if(!undoStack.length) return; redoStack.push(snapshot()); applyDoc(JSON.parse(undoStack.pop())); }
function redo(){ if(!redoStack.length) return; undoStack.push(snapshot()); applyDoc(JSON.parse(redoStack.pop())); }
function save(){ clearTimeout(saveTimer); saveTimer = setTimeout(()=>{ try{ localStorage.setItem(LS, snapshot()); }catch(e){} }, 400); }

/* ---------- 選取模型（多選） ---------- */
function findObj(s){
  const arr = s.kind==='furniture' ? state.furniture : s.kind==='wall' ? state.walls : state.texts;
  return arr.find(o => o.id === s.id) || null;
}
function selObjs(){ return selected.map(findObj).filter(Boolean); }
function isSel(kind,id){ return selected.some(s => s.kind===kind && s.id===id); }
function setSel(list){ selected = list.slice(); }
function addSel(s){ if(!isSel(s.kind,s.id)) selected.push(s); }
function toggleSel(s){ const i=selected.findIndex(x=>x.kind===s.kind&&x.id===s.id); if(i>=0) selected.splice(i,1); else selected.push(s); }
function clearSel(){ selected = []; }
function single(){                       // 恰好選 1 個 → {kind,obj}
  if(selected.length !== 1) return null;
  const o = findObj(selected[0]); return o ? {kind:selected[0].kind, o} : null;
}

/* ---------- SVG 片段 ---------- */
function gridSvg(){
  const {w,h} = state.area, g = state.grid; let s = '<g class="grid">';
  for(let x=0; x<=w; x+=g){ const M=x%100===0; s += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${M?'#cbd5e1':'#eef2f7'}" stroke-width="${M?0.7:0.3}"/>`; }
  for(let y=0; y<=h; y+=g){ const M=y%100===0; s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${M?'#cbd5e1':'#eef2f7'}" stroke-width="${M?0.7:0.3}"/>`; }
  for(let x=0; x<=w; x+=100) s += `<text class="dim" x="${x+2}" y="13" font-size="11" fill="#90a4b5">${x/100}m</text>`;
  for(let y=100; y<=h; y+=100) s += `<text class="dim" x="3" y="${y-3}" font-size="11" fill="#90a4b5">${y/100}m</text>`;
  s += `<rect x="0" y="0" width="${w}" height="${h}" fill="none" stroke="#94a3b8" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
  return s + '</g>';
}
// 牆填滿一格：厚度=格線。內牆往 +側填（兩面落格線）；外牆往外填（不吃室內）。
function wallDisp(wl){
  let {x1,y1,x2,y2} = wl; const t = state.grid, A = state.area, h = t/2;
  if(x1===x2){ const cx = x1<=0 ? x1-h : x1>=A.w ? x1+h : x1+h; x1=x2=cx; }
  else if(y1===y2){ const cy = y1<=0 ? y1-h : y1>=A.h ? y1+h : y1+h; y1=y2=cy; }
  return {x1,y1,x2,y2,t};
}
function wallSvg(wl){
  const sel = isSel('wall', wl.id);
  const d = wallDisp(wl);
  const len = Math.round(Math.hypot(wl.x2-wl.x1, wl.y2-wl.y1));
  const mx=(d.x1+d.x2)/2, my=(d.y1+d.y2)/2;
  let h = '';
  if(single() && single().kind==='wall' && single().o.id===wl.id){
    h = `<circle class="wend" data-id="${wl.id}" data-end="1" cx="${wl.x1}" cy="${wl.y1}" r="${H_CM}"/>`
      + `<circle class="wend" data-id="${wl.id}" data-end="2" cx="${wl.x2}" cy="${wl.y2}" r="${H_CM}"/>`;
  }
  return `<g class="wall" data-id="${wl.id}">
    <line x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}" stroke="transparent" stroke-width="${d.t*2.4}" stroke-linecap="round"/>
    <line x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}" stroke="${sel?'#2563eb':'#334155'}" stroke-width="${d.t}" stroke-linecap="round"/>
    <text class="dim" x="${mx}" y="${my-d.t}" font-size="13" text-anchor="middle" fill="#15324A" paint-order="stroke" stroke="#fff" stroke-width="3">${len}</text>
    ${h}</g>`;
}
function doorSvg(f){
  const L=f.w, t=f.d, x=f.x, y=f.y, sw=f.swing||0;
  const left = (sw===0||sw===3), down = (sw===0||sw===1);
  const Hx = x + (left?0:L), Cx = x + (left?L:0), Hy = y, Cy = y;
  const Ox = Hx, Oy = y + (down?L:-L);
  const sweep = (left === down) ? 1 : 0;
  return `<rect x="${x}" y="${y}" width="${L}" height="${t}" fill="#e5e7eb" stroke="#475569" stroke-width="1" vector-effect="non-scaling-stroke"/>
    <line x1="${Hx}" y1="${Hy}" x2="${Ox}" y2="${Oy}" stroke="#94a3b8" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <path d="M ${Ox} ${Oy} A ${L} ${L} 0 0 ${sweep} ${Cx} ${Cy}" fill="none" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="6 6" vector-effect="non-scaling-stroke"/>`;
}
function handlesSvg(f){          // 單選家具：四角 + 旋轉
  const hs = H_CM, ro = H_CM*3.2;
  const cx = f.x+f.w/2;
  const corner = (cn,px,py) => `<rect class="handle" data-id="${f.id}" data-cn="${cn}" x="${px-hs}" y="${py-hs}" width="${hs*2}" height="${hs*2}"/>`;
  return corner('tl',f.x,f.y) + corner('tr',f.x+f.w,f.y) + corner('br',f.x+f.w,f.y+f.d) + corner('bl',f.x,f.y+f.d)
    + `<line x1="${cx}" y1="${f.y}" x2="${cx}" y2="${f.y-ro}" stroke="#2563eb" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`
    + `<circle class="handle rot" data-id="${f.id}" data-rot="1" cx="${cx}" cy="${f.y-ro}" r="${hs}"/>`;
}
/* 家具線稿 glyph：在 footprint(x,y,w,d) 內畫外形細節（描邊，不含底色 rect） */
const bed = (x,y,w,d,dbl) => {
  const m=Math.min(w,d)*0.07, ph=d*0.2;
  let s=`<rect x="${x+m}" y="${y+m}" width="${w-2*m}" height="${ph}" rx="${ph*0.25}"/>`;
  s+=`<line x1="${x+m}" y1="${y+ph+m*1.3}" x2="${x+w-m}" y2="${y+ph+m*1.3}"/>`;
  if(dbl) s+=`<line x1="${x+w/2}" y1="${y+m}" x2="${x+w/2}" y2="${y+ph+m}"/>`;
  return s;
};
const sofa = (x,y,w,d) => {
  const back=d*0.26, arm=w*0.07;
  let s=`<rect x="${x+arm}" y="${y+back}" width="${w-2*arm}" height="${d-back-d*0.05}" rx="${Math.min(w,d)*0.06}"/>`;
  const n=Math.max(2,Math.round((w-2*arm)/65));
  for(let i=1;i<n;i++){const cx=x+arm+(w-2*arm)*i/n; s+=`<line x1="${cx}" y1="${y+back}" x2="${cx}" y2="${y+d*0.93}"/>`;}
  return s;
};
const table = (x,y,w,d) => `<rect x="${x+w*0.12}" y="${y+d*0.12}" width="${w*0.76}" height="${d*0.76}" rx="2"/>`;
const wardrobe = (x,y,w,d) => `<line x1="${x+w/2}" y1="${y+d*0.1}" x2="${x+w/2}" y2="${y+d*0.9}"/><circle cx="${x+w/2-w*0.06}" cy="${y+d/2}" r="${Math.min(w,d)*0.035}"/><circle cx="${x+w/2+w*0.06}" cy="${y+d/2}" r="${Math.min(w,d)*0.035}"/>`;
const fridge = (x,y,w,d) => `<line x1="${x+w*0.12}" y1="${y+d*0.36}" x2="${x+w*0.88}" y2="${y+d*0.36}"/><line x1="${x+w*0.8}" y1="${y+d*0.14}" x2="${x+w*0.8}" y2="${y+d*0.28}"/><line x1="${x+w*0.8}" y1="${y+d*0.46}" x2="${x+w*0.8}" y2="${y+d*0.78}"/>`;
const toilet = (x,y,w,d) => `<rect x="${x+w*0.12}" y="${y+d*0.03}" width="${w*0.76}" height="${d*0.22}" rx="2"/><ellipse cx="${x+w/2}" cy="${y+d*0.62}" rx="${w*0.33}" ry="${d*0.3}"/>`;
const bath = (x,y,w,d) => `<rect x="${x+w*0.08}" y="${y+d*0.12}" width="${w*0.84}" height="${d*0.76}" rx="${Math.min(w,d)*0.22}"/><circle cx="${x+w*0.85}" cy="${y+d/2}" r="${Math.min(w,d)*0.045}"/>`;
const counter = (x,y,w,d) => `<circle cx="${x+w*0.3}" cy="${y+d/2}" r="${Math.min(w,d)*0.24}"/><line x1="${x+w*0.3}" y1="${y+d*0.18}" x2="${x+w*0.3}" y2="${y+d*0.06}"/>`;
const cabinet = (x,y,w,d) => {let s='';const n=Math.max(2,Math.round(w/60));for(let i=1;i<n;i++){const cx=x+w*i/n;s+=`<line x1="${cx}" y1="${y+d*0.15}" x2="${cx}" y2="${y+d*0.85}"/>`;}return s;};
const shelf = (x,y,w,d) => {let s='';const n=Math.max(2,Math.round(d/30));for(let i=1;i<n;i++){const cy=y+d*i/n;s+=`<line x1="${x+w*0.1}" y1="${cy}" x2="${x+w*0.9}" y2="${cy}"/>`;}return s;};
const win = (x,y,w,d) => `<line x1="${x}" y1="${y+d/2}" x2="${x+w}" y2="${y+d/2}"/>`;
const GLYPH = {
  '單人床':(x,y,w,d)=>bed(x,y,w,d,false), '雙人床':(x,y,w,d)=>bed(x,y,w,d,true),
  '沙發':sofa, '茶几':table, '電視櫃':cabinet,
  '餐桌':table, '冰箱':fridge, '流理台':counter,
  '衣櫃':wardrobe, '書桌':table, '書櫃':shelf,
  '馬桶':toilet, '浴缸':bath, '窗':win,
};
function furnSvg(f){
  const cx=f.x+f.w/2, cy=f.y+f.d/2;
  const sel = isSel('furniture', f.id);
  let body;
  if(isDoor(f)){ body = doorSvg(f); }
  else {
    const glyph = GLYPH[f.type];
    const rect = `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.d}" rx="3" fill="${typeColor(f.type)}"
      stroke="${sel?'#2563eb':'#475569'}" stroke-width="${sel?2.5:1}" vector-effect="non-scaling-stroke"/>`;
    if(glyph){
      const art = `<g stroke="#42566b" stroke-width="1.4" fill="none" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round">${glyph(f.x,f.y,f.w,f.d)}</g>`;
      const fs = Math.max(7, Math.min(11, Math.min(f.w,f.d)/6));
      const label = `<text x="${cx}" y="${f.y+f.d-fs*0.5}" font-size="${fs}" text-anchor="middle" fill="#46586b">${esc(f.label||f.type)}</text>`;
      body = rect + art + label;
    } else {
      const fs = Math.max(8, Math.min(14, Math.min(f.w,f.d)/5));
      body = rect + `<text x="${cx}" y="${cy}" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="#1e293b">${esc(f.label||f.type)}</text>`;
    }
  }
  const sh = (single() && single().kind==='furniture' && single().o.id===f.id) ? handlesSvg(f) : '';
  const dsel = (isDoor(f) && sel) ? `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.d}" fill="none" stroke="#2563eb" stroke-width="2.5" vector-effect="non-scaling-stroke"/>` : '';
  return `<g class="furn" data-id="${f.id}" transform="rotate(${f.rot} ${cx} ${cy})">${body}${dsel}${sh}</g>`;
}
function textSvg(t){
  const sel = isSel('text', t.id);
  return `<g class="txt" data-id="${t.id}">
    <text x="${t.x}" y="${t.y}" font-size="${t.size}" fill="${sel?'#2563eb':'#0f172a'}" font-weight="500"
      paint-order="stroke" stroke="#fff" stroke-width="3">${esc(t.t)}</text></g>`;
}
/* ---------- ① 房間面積：格點 flood-fill ---------- */
function computeRooms(){
  const key = JSON.stringify({a:state.area, g:state.grid, w:state.walls});
  if(roomsCache.key === key) return roomsCache.rooms;
  const A=state.area, cell=Math.max(5, Math.min(state.grid, 20));
  const cols=Math.ceil(A.w/cell), rows=Math.ceil(A.h/cell), N=cols*rows;
  const blocked=new Uint8Array(N);
  state.walls.forEach(wl=>{
    const d=wallDisp(wl), t=d.t;
    const x0=Math.min(d.x1,d.x2)-t/2, x1=Math.max(d.x1,d.x2)+t/2;
    const y0=Math.min(d.y1,d.y2)-t/2, y1=Math.max(d.y1,d.y2)+t/2;
    const c0=Math.max(0,Math.floor(x0/cell)), c1=Math.min(cols-1,Math.floor(x1/cell));
    const r0=Math.max(0,Math.floor(y0/cell)), r1=Math.min(rows-1,Math.floor(y1/cell));
    for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){
      const px=(c+0.5)*cell, py=(r+0.5)*cell;
      if(px>=x0&&px<=x1&&py>=y0&&py<=y1) blocked[r*cols+c]=1;
    }
  });
  // 房屋＝area 範圍（格邊界當外牆）；非阻擋的連通區即房間，不另淹外部
  const seen=new Uint8Array(N);
  const rooms=[];
  for(let i=0;i<N;i++){
    if(seen[i]||blocked[i]) continue;
    let cnt=0,sx=0,sy=0; const st=[i]; seen[i]=1;
    while(st.length){ const j=st.pop(); const c=j%cols, r=(j-c)/cols;
      cnt++; sx+=(c+0.5)*cell; sy+=(r+0.5)*cell;
      const nb=[j-1,j+1,j-cols,j+cols];
      if(c>0&&!seen[j-1]&&!blocked[j-1]){seen[j-1]=1;st.push(j-1);}
      if(c<cols-1&&!seen[j+1]&&!blocked[j+1]){seen[j+1]=1;st.push(j+1);}
      if(r>0&&!seen[j-cols]&&!blocked[j-cols]){seen[j-cols]=1;st.push(j-cols);}
      if(r<rows-1&&!seen[j+cols]&&!blocked[j+cols]){seen[j+cols]=1;st.push(j+cols);}
    }
    const area=cnt*cell*cell;
    if(area>=10000) rooms.push({cx:sx/cnt, cy:sy/cnt, area});  // >1 m²
  }
  roomsCache={key, rooms}; return rooms;
}
function roomsSvg(){
  return computeRooms().map(r=>{
    const py=(r.area/PYEONG_CM2).toFixed(1), m2=(r.area/10000).toFixed(1);
    return `<g class="roomlbl" pointer-events="none"><text class="dim" x="${r.cx}" y="${r.cy}" font-size="15" text-anchor="middle" fill="#0E7FB8" paint-order="stroke" stroke="#fff" stroke-width="4" font-weight="600">${py} 坪</text>`
      + `<text class="dim" x="${r.cx}" y="${r.cy+18}" font-size="11" text-anchor="middle" fill="#5A6B7B" paint-order="stroke" stroke="#fff" stroke-width="3">${m2} m²</text></g>`;
  }).join('');
}
/* ---------- ② 量測線 + 家具間距 ---------- */
function measureSvg(){
  if(!measure) return '';
  const len=Math.round(Math.hypot(measure.x2-measure.x1, measure.y2-measure.y1));
  const mx=(measure.x1+measure.x2)/2, my=(measure.y1+measure.y2)/2;
  return `<g pointer-events="none"><line x1="${measure.x1}" y1="${measure.y1}" x2="${measure.x2}" y2="${measure.y2}" stroke="#0E7FB8" stroke-width="1.5" stroke-dasharray="8 5" vector-effect="non-scaling-stroke"/>`
    + `<circle cx="${measure.x1}" cy="${measure.y1}" r="${H_CM*0.7}" fill="#0E7FB8"/><circle cx="${measure.x2}" cy="${measure.y2}" r="${H_CM*0.7}" fill="#0E7FB8"/>`
    + `<text class="dim" x="${mx}" y="${my-6}" font-size="15" text-anchor="middle" fill="#0E7FB8" paint-order="stroke" stroke="#fff" stroke-width="4" font-weight="600">${len} cm</text></g>`;
}
function gapDimsSvg(f){
  if(f.rot%90!==0) return '';
  const horiz=f.rot%180===0, fw=horiz?f.w:f.d, fh=horiz?f.d:f.w;
  const L=f.x+(f.w-fw)/2, R=L+fw, T=f.y+(f.d-fh)/2, B=T+fh, midX=(L+R)/2, midY=(T+B)/2;
  const vx=[0,state.area.w], hy=[0,state.area.h];
  state.walls.forEach(w=>{const d=wallDisp(w);
    if(d.x1===d.x2){ const y1=Math.min(d.y1,d.y2),y2=Math.max(d.y1,d.y2); if(B>y1&&T<y2){ vx.push(d.x1-d.t/2,d.x1+d.t/2); } }
    else if(d.y1===d.y2){ const x1=Math.min(d.x1,d.x2),x2=Math.max(d.x1,d.x2); if(R>x1&&L<x2){ hy.push(d.y1-d.t/2,d.y1+d.t/2); } }
  });
  const dim=(x1,y1,x2,y2,val)=>{ const mx=(x1+x2)/2,my=(y1+y2)/2;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#0E7FB8" stroke-width="1" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/>`
      + `<text class="dim" x="${mx}" y="${my-3}" font-size="11" text-anchor="middle" fill="#0E7FB8" paint-order="stroke" stroke="#fff" stroke-width="3">${Math.round(val)}</text>`; };
  let s='';
  const lf=Math.max(...vx.filter(x=>x<=L+0.5)); if(isFinite(lf)&&L-lf>1) s+=dim(lf,midY,L,midY,L-lf);
  const rf=Math.min(...vx.filter(x=>x>=R-0.5)); if(isFinite(rf)&&rf-R>1) s+=dim(R,midY,rf,midY,rf-R);
  const tf=Math.max(...hy.filter(y=>y<=T+0.5)); if(isFinite(tf)&&T-tf>1) s+=dim(midX,tf,midX,T,T-tf);
  const bf=Math.min(...hy.filter(y=>y>=B-0.5)); if(isFinite(bf)&&bf-B>1) s+=dim(midX,B,midX,bf,bf-B);
  return s ? `<g pointer-events="none">${s}</g>` : '';
}
function innerSvg(){
  let s = gridSvg();
  state.walls.forEach(w => s += wallSvg(w));
  if(showAreas) s += roomsSvg();
  state.furniture.forEach(f => s += furnSvg(f));
  state.texts.forEach(t => s += textSvg(t));
  const sg = single();
  if(sg && sg.kind==='furniture') s += gapDimsSvg(sg.o);
  s += measureSvg();
  return s;
}

/* ---------- 主渲染 ---------- */
function render(){
  clampArea();
  if(!view) fitView();
  calcHandleSize();
  svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
  svg.className.baseVal = '';
  svg.classList.toggle('mode-wall', mode==='wall');
  svg.classList.toggle('mode-measure', mode==='measure');
  svg.classList.toggle('mode-pan', mode==='pan' || spaceDown);
  svg.innerHTML = innerSvg();
  bindShapes();
  renderEditor();
  updatePyeong();
  const empty = !state.walls.length && !state.furniture.length && !state.texts.length;
  const eh = $('emptyHint'); if(eh) eh.hidden = !empty;
  const lbl = $('zoomLabel'); if(lbl) lbl.textContent = Math.round((fitW||view.w)/view.w*100) + '%';
}
function updatePyeong(){
  const p = (state.area.w * state.area.h / PYEONG_CM2);
  const el = $('pyeong'); if(el) el.textContent = `${p.toFixed(1)} 坪 · ${(state.area.w*state.area.h/10000).toFixed(1)} m²`;
}

function bindShapes(){
  // 控制點（最高優先，stopPropagation）
  svg.querySelectorAll('.handle').forEach(el => el.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    const f = state.furniture.find(o => o.id === el.dataset.id); if(!f) return;
    if(el.dataset.rot) startRotate(e, f); else startCornerResize(e, f, el.dataset.cn);
  }));
  svg.querySelectorAll('.wend').forEach(el => el.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    const w = state.walls.find(o => o.id === el.dataset.id); if(!w) return;
    startWallEnd(e, w, el.dataset.end);
  }));
  if(mode !== 'select') return;
  svg.querySelectorAll('g.furn, g.txt, g.wall').forEach(g => {
    g.addEventListener('pointerdown', e => {
      if(spaceDown || e.button===1){ return; }   // 交給 svg 平移
      e.stopPropagation();
      const kind = g.classList.contains('furn') ? 'furniture' : g.classList.contains('txt') ? 'text' : 'wall';
      const s = {kind, id:g.dataset.id};
      if(e.shiftKey){ toggleSel(s); render(); return; }
      if(!isSel(kind, s.id)) setSel([s]);
      render(); startGroupDrag(e);
    });
  });
}

/* ---------- 平移 ---------- */
function startPan(e){
  e.preventDefault();
  const sx=e.clientX, sy=e.clientY, inv=svg.getScreenCTM().inverse(), vx0=view.x, vy0=view.y;
  function mv(ev){ const dx=ev.clientX-sx, dy=ev.clientY-sy;
    view.x = vx0-(inv.a*dx+inv.c*dy); view.y = vy0-(inv.b*dx+inv.d*dy); applyView(); }
  function up(){ window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); }
  window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
}

/* ---------- 框選 ---------- */
function startMarquee(e){
  const a = toSvg(e); const add = e.shiftKey;
  const NS='http://www.w3.org/2000/svg'; const r = document.createElementNS(NS,'rect');
  r.setAttribute('class','marquee'); svg.appendChild(r);
  function box(b){ return {x:Math.min(a.x,b.x), y:Math.min(a.y,b.y), w:Math.abs(b.x-a.x), h:Math.abs(b.y-a.y)}; }
  function mv(ev){ const bx=box(toSvg(ev)); r.setAttribute('x',bx.x); r.setAttribute('y',bx.y); r.setAttribute('width',bx.w); r.setAttribute('height',bx.h); }
  function up(ev){
    window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); r.remove();
    const bx = box(toSvg(ev));
    if(bx.w<2 && bx.h<2){ if(!add) clearSel(); render(); return; }   // 視為點空白
    const hits = [];
    const inBox = (x,y,w,h) => x < bx.x+bx.w && x+w > bx.x && y < bx.y+bx.h && y+h > bx.y;
    state.furniture.forEach(f => { if(inBox(f.x,f.y,f.w,f.d)) hits.push({kind:'furniture',id:f.id}); });
    state.texts.forEach(t => { if(t.x>=bx.x && t.x<=bx.x+bx.w && t.y>=bx.y && t.y<=bx.y+bx.h) hits.push({kind:'text',id:t.id}); });
    state.walls.forEach(w => { const x=Math.min(w.x1,w.x2),y=Math.min(w.y1,w.y2); if(inBox(x,y,Math.abs(w.x2-w.x1),Math.abs(w.y2-w.y1))) hits.push({kind:'wall',id:w.id}); });
    if(add) hits.forEach(addSel); else setSel(hits);
    render();
  }
  window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
}

/* ---------- 量測：拖一條線 ---------- */
function startMeasure(e){
  e.preventDefault();
  const a=toSvg(e); measure={x1:a.x,y1:a.y,x2:a.x,y2:a.y}; render();
  function mv(ev){ const p=toSvg(ev); measure.x2=p.x; measure.y2=p.y; render(); }
  function up(){ window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); render(); }
  window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
}

/* ---------- 群組拖移（家具/文字/牆，只改 transform，放開才重繪） ---------- */
function startGroupDrag(e){
  e.preventDefault();
  const prev = snapshot(); const start = toSvg(e);
  const items = selected.map(s => {
    const o = findObj(s); if(!o) return null;
    const g = svg.querySelector(`g[data-id="${o.id}"]`);
    const base = (s.kind==='furniture') ? `rotate(${o.rot} ${o.x+o.w/2} ${o.y+o.d/2})` : '';
    const orig = s.kind==='wall' ? {x1:o.x1,y1:o.y1,x2:o.x2,y2:o.y2} : {x:o.x,y:o.y};
    return {s,o,g,base,orig};
  }).filter(Boolean);
  let moved = false;
  function mv(ev){
    const p = toSvg(ev); let dx=p.x-start.x, dy=p.y-start.y; moved = true;
    items.forEach(it => { if(it.g) it.g.setAttribute('transform', `translate(${dx} ${dy}) ${it.base}`); });
  }
  function up(ev){
    window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up);
    if(!moved){ render(); return; }
    const p = toSvg(ev); let dx = snap(p.x-start.x) , dy = snap(p.y-start.y);
    if(!state.snap){ dx = Math.round(p.x-start.x); dy = Math.round(p.y-start.y); }
    else { dx = Math.round((p.x-start.x)/state.grid)*state.grid; dy = Math.round((p.y-start.y)/state.grid)*state.grid; }
    items.forEach(it => {
      if(it.s.kind==='wall'){ it.o.x1=it.orig.x1+dx; it.o.y1=it.orig.y1+dy; it.o.x2=it.orig.x2+dx; it.o.y2=it.orig.y2+dy; }
      else { it.o.x=it.orig.x+dx; it.o.y=it.orig.y+dy; }
    });
    if(items.length===1 && items[0].s.kind==='furniture') snapToWalls(items[0].o);
    commit(prev); render();
  }
  window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
}

// 家具邊緣吸附牆內面（用 wallDisp 後的牆位＝外牆已外推，內面對齊房界）
function snapToWalls(f){
  const TH = 8; const horiz = (f.rot%180===0);
  const fw = horiz ? f.w : f.d, fd = horiz ? f.d : f.w;       // 視覺寬高
  const L=f.x+(f.w-fw)/2, R=L+fw, T=f.y+(f.d-fd)/2, B=T+fd;   // 視覺外框
  let dx=0, dy=0;
  state.walls.forEach(w => {
    const d = wallDisp(w), h = d.t/2;
    if(d.x1===d.x2){ // 垂直牆
      const wx=d.x1, y1=Math.min(d.y1,d.y2), y2=Math.max(d.y1,d.y2);
      if(B>y1 && T<y2){
        if(Math.abs(L-(wx+h))<TH) dx = (wx+h)-L;
        else if(Math.abs(R-(wx-h))<TH) dx = (wx-h)-R;
      }
    } else if(d.y1===d.y2){ // 水平牆
      const wy=d.y1, x1=Math.min(d.x1,d.x2), x2=Math.max(d.x1,d.x2);
      if(R>x1 && L<x2){
        if(Math.abs(T-(wy+h))<TH) dy = (wy+h)-T;
        else if(Math.abs(B-(wy-h))<TH) dy = (wy-h)-B;
      }
    }
  });
  f.x += dx; f.y += dy;
}

/* ---------- 四角縮放（支援旋轉角） ---------- */
function cornerWorld(o,cn){
  const off = {tl:[-o.w/2,-o.d/2], tr:[o.w/2,-o.d/2], br:[o.w/2,o.d/2], bl:[-o.w/2,o.d/2]}[cn];
  const c = center(o); const v = rot2(off[0],off[1],o.rot); return {x:c.x+v.x, y:c.y+v.y};
}
function startCornerResize(e, o, cn){
  const prev = snapshot();
  const opp = {tl:'br', tr:'bl', br:'tl', bl:'tr'}[cn];
  const fixed = cornerWorld(o, opp);
  function mv(ev){
    const p = toSvg(ev);
    const loc = rot2(p.x-fixed.x, p.y-fixed.y, -o.rot);
    let nw = Math.max(10, Math.abs(loc.x)), nd = Math.max(10, Math.abs(loc.y));
    if(state.snap){ nw = Math.max(state.grid, Math.round(nw/state.grid)*state.grid); nd = Math.max(state.grid, Math.round(nd/state.grid)*state.grid); }
    else { nw = Math.round(nw); nd = Math.round(nd); }
    o.w = nw; o.d = nd;
    const off = {tl:[-nw/2,-nd/2], tr:[nw/2,-nd/2], br:[nw/2,nd/2], bl:[-nw/2,nd/2]}[opp];
    const rv = rot2(off[0],off[1],o.rot);
    o.x = (fixed.x-rv.x) - nw/2; o.y = (fixed.y-rv.y) - nd/2;
    render();
  }
  function up(){ window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); commit(prev); render(); }
  window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
}
function startRotate(e, o){
  const prev = snapshot(); const c = center(o);
  function mv(ev){
    const p = toSvg(ev);
    let ang = Math.atan2(p.y-c.y, p.x-c.x)*180/Math.PI + 90;   // 控制點在上方
    if(!ev.shiftKey) ang = Math.round(ang/15)*15;
    o.rot = ((ang%360)+360)%360; render();
  }
  function up(){ window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); commit(prev); render(); }
  window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
}

/* ---------- 牆：畫 / 端點拖曳 ---------- */
function startWallDraw(e){
  e.preventDefault();
  const a = {x:snap(toSvg(e).x), y:snap(toSvg(e).y)};
  const NS='http://www.w3.org/2000/svg'; const line = document.createElementNS(NS,'line');
  Object.entries({x1:a.x,y1:a.y,x2:a.x,y2:a.y,stroke:'#2563eb','stroke-width':WALL_THICK,'stroke-linecap':'round','stroke-dasharray':'14 8',opacity:'0.7'}).forEach(([k,v])=>line.setAttribute(k,v));
  svg.appendChild(line);
  function mv(ev){ const b={x:snap(toSvg(ev).x),y:snap(toSvg(ev).y)}; line.setAttribute('x2',b.x); line.setAttribute('y2',b.y); }
  function up(ev){
    window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up);
    const b={x:snap(toSvg(ev).x),y:snap(toSvg(ev).y)}; line.remove();
    if(Math.hypot(b.x-a.x,b.y-a.y) >= 5){ const prev=snapshot(); state.walls.push({id:uid(),x1:a.x,y1:a.y,x2:b.x,y2:b.y,t:WALL_THICK}); commit(prev); render(); }
  }
  window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
}
function startWallEnd(e, w, end){
  const prev = snapshot();
  function mv(ev){ const p={x:snap(toSvg(ev).x),y:snap(toSvg(ev).y)};
    if(end==='1'){ w.x1=p.x; w.y1=p.y; } else { w.x2=p.x; w.y2=p.y; } render(); }
  function up(){ window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); commit(prev); render(); }
  window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
}

/* ---------- 新增 / 編輯動作 ---------- */
function addFurniture(type, cx, cy){
  const t = typeInfo(type); const prev = snapshot();
  const f = { id:uid(), type, x:snap(cx-t.w/2), y:snap(cy-t.d/2), w:t.w, d:t.d, rot:0, label:'' };
  if(type==='門') f.swing = 0;
  state.furniture.push(f); setSel([{kind:'furniture',id:f.id}]); commit(prev); render();
}
function addText(){
  const prev = snapshot();
  const t = { id:uid(), x:Math.round(view.x+view.w/2), y:Math.round(view.y+view.h/2), t:'文字', size:Math.max(12, Math.round(state.area.w/40)) };
  state.texts.push(t); setSel([{kind:'text',id:t.id}]); commit(prev); setMode('select'); render();
}
function deleteSel(){
  if(!selected.length) return; const prev = snapshot();
  selected.forEach(s => { const arr = s.kind==='furniture'?state.furniture:s.kind==='wall'?state.walls:state.texts;
    const o = arr.find(x=>x.id===s.id); if(o) arr.splice(arr.indexOf(o),1); });
  clearSel(); commit(prev); render();
}
function rotateSel(){ const s=single(); if(!s||s.kind!=='furniture') return; const p=snapshot(); s.o.rot=(s.o.rot+90)%360; commit(p); render(); }
function cycleDoor(){ const s=single(); if(!s||s.kind!=='furniture'||!isDoor(s.o)) return; const p=snapshot(); s.o.swing=((s.o.swing||0)+1)%4; commit(p); render(); }
function nudge(dx,dy){
  if(!selected.length) return; const p=snapshot();
  selObjs().forEach((o,i) => { const k=selected[i].kind;
    if(k==='wall'){ o.x1+=dx; o.y1+=dy; o.x2+=dx; o.y2+=dy; } else { o.x+=dx; o.y+=dy; } });
  commit(p); render();
}

/* ---------- 左側編輯面板 ---------- */
function restoreCaret(id){ const el=$(id); if(el){ el.focus(); const v=el.value; el.setSelectionRange(v.length,v.length); } }
function renderEditor(){
  const box = $('editor');
  if(!selected.length){ box.innerHTML = '<p class="hint">點選畫布上的家具／牆／文字來編輯。</p>'; return; }
  if(selected.length > 1){
    box.innerHTML = `<div class="selrow"><span class="seltitle">已選 ${selected.length} 個物件</span></div>
      <div class="selrow"><span class="hint">拖曳任一可一起移動</span></div>
      <div class="selrow"><button class="del" id="edDel">刪除全部</button></div>`;
    $('edDel').onclick = deleteSel; return;
  }
  const {kind, o} = single();
  if(kind==='wall'){
    box.innerHTML = `<div class="selrow"><span class="seltitle">牆</span><span class="hint">長度 ${Math.round(Math.hypot(o.x2-o.x1,o.y2-o.y1))} cm・厚 ${state.grid} cm</span></div>
      <div class="selrow"><span class="hint">厚度＝格線；牆面對齊格線，家具會自動貼齊。</span></div>
      <div class="selrow"><button class="del" id="edDel">刪除</button></div>`;
    $('edDel').onclick = deleteSel; return;
  }
  if(kind==='text'){
    box.innerHTML = `<div class="selrow"><span class="seltitle">文字</span></div>
      <div class="selrow"><input type="text" id="edTxt" value="${esc(o.t)}" placeholder="輸入文字"></div>
      <div class="selrow"><label>字級 <input type="number" id="edSize" value="${o.size}" min="6" max="200" step="2"> cm</label></div>
      <div class="selrow"><button class="del" id="edDel">刪除</button></div>`;
    $('edTxt').oninput  = e => { const p=snapshot(); o.t=e.target.value; commit(p); render(); restoreCaret('edTxt'); };
    $('edSize').onchange= e => { const p=snapshot(); o.size=Math.max(6,+e.target.value||12); commit(p); render(); };
    $('edDel').onclick  = deleteSel; return;
  }
  // furniture
  const doorBtn = isDoor(o) ? `<div class="selrow"><button id="edDoor">開門方向（${(o.swing||0)+1}/4）</button></div>` : '';
  box.innerHTML = `<div class="selrow"><span class="seltitle">${esc(o.type)}</span><span class="hint">${o.w}×${o.d} cm・${Math.round(o.rot)}°</span></div>
    <div class="selrow"><label>寬 <input type="number" id="edW" value="${o.w}" min="10" max="3000" step="5"></label>
      <label>深 <input type="number" id="edD" value="${o.d}" min="10" max="3000" step="5"></label></div>
    <div class="selrow"><input type="text" id="edLbl" value="${esc(o.label)}" placeholder="自訂標籤（留空顯示名稱）"></div>
    <div class="selrow"><button id="edRot">旋轉 90°</button></div>
    ${doorBtn}
    <div class="selrow"><button class="del" id="edDel">刪除</button></div>`;
  $('edW').onchange  = e => { const p=snapshot(); o.w=Math.max(10,+e.target.value||10); commit(p); render(); };
  $('edD').onchange  = e => { const p=snapshot(); o.d=Math.max(10,+e.target.value||10); commit(p); render(); };
  $('edLbl').oninput = e => { const p=snapshot(); o.label=e.target.value; commit(p); render(); restoreCaret('edLbl'); };
  $('edRot').onclick = rotateSel;
  if(isDoor(o)) $('edDoor').onclick = cycleDoor;
  $('edDel').onclick = deleteSel;
}

/* ---------- 目錄（內建 + 自訂） ---------- */
function renderCatalog(){
  const box = $('catalog');
  const custom = state.customTypes.length
    ? `<div class="cat-group"><p class="cat-title">自訂</p><div class="cat-items">${state.customTypes.map(c =>
        `<div class="furn-chip" data-type="${esc(c.n)}"><div class="swatch" style="background:${CUSTOM_COLOR}"></div><span class="nm">${esc(c.n)}</span><span class="dim">${c.w}×${c.d}</span></div>`).join('')}</div></div>`
    : '';
  box.innerHTML = CATALOG.map(g => `<div class="cat-group"><p class="cat-title">${g.cat}</p>
    <div class="cat-items">${g.items.map(([n,w,d]) =>
      `<div class="furn-chip" data-type="${n}"><div class="swatch" style="background:${g.color}"></div><span class="nm">${n}</span><span class="dim">${w}×${d}</span></div>`).join('')}</div></div>`).join('')
    + custom
    + `<button class="toolwide" id="addCustom" style="margin-top:4px"><svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5v14"/></svg><span>自訂家具</span></button>`;
  box.querySelectorAll('.furn-chip').forEach(chip => chip.addEventListener('pointerdown', e => startPaletteDrag(e, chip)));
  $('addCustom').onclick = addCustomType;
}
function addCustomType(){
  const n = (prompt('家具名稱？') || '').trim(); if(!n) return;
  const w = parseInt(prompt('寬度 cm？', '60'), 10), d = parseInt(prompt('深度 cm？', '60'), 10);
  if(!(w>0) || !(d>0)){ showToast('尺寸需為正整數'); return; }
  const prev = snapshot();
  state.customTypes = state.customTypes.filter(c => c.n !== n);
  state.customTypes.push({n, w, d}); commit(prev); renderCatalog(); showToast('已新增自訂家具');
}
function startPaletteDrag(e, chip){
  e.preventDefault();
  const type = chip.dataset.type;
  const ghost = chip.cloneNode(true); ghost.className = 'furn-chip drag-ghost'; document.body.appendChild(ghost);
  const place = (x,y) => { ghost.style.left=x+'px'; ghost.style.top=y+'px'; };
  place(e.clientX, e.clientY);
  function mv(ev){ place(ev.clientX, ev.clientY); }
  function up(ev){
    window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); ghost.remove();
    const r = svg.getBoundingClientRect();
    if(ev.clientX>=r.left && ev.clientX<=r.right && ev.clientY>=r.top && ev.clientY<=r.bottom){ const p=toSvg(ev); addFurniture(type, p.x, p.y); }
  }
  window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
}

/* ---------- 分頁 ---------- */
function renderTabs(){
  const bar = $('tabbar');
  const xIcon = '<svg viewBox="0 0 24 24"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>';
  bar.innerHTML = doc.tabs.map((L,i) =>
    `<div class="tab ${i===doc.active?'active':''}" data-i="${i}"><span class="tabname">${esc(L.name)}</span>${doc.tabs.length>1?`<button class="tabx" data-del="${i}" title="刪除分頁" aria-label="刪除分頁">${xIcon}</button>`:''}</div>`).join('')
    + `<button class="tabbtn" id="tabAdd" title="新增空白分頁" aria-label="新增分頁"><svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5v14"/></svg></button>`
    + `<button class="tabbtn" id="tabDup" title="複製目前分頁"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>複製</button>`;
  bar.querySelectorAll('.tab').forEach(t => {
    t.querySelector('.tabname').addEventListener('click', () => switchTab(+t.dataset.i));
    t.querySelector('.tabname').addEventListener('dblclick', () => renameTab(+t.dataset.i));
    const x = t.querySelector('.tabx'); if(x) x.addEventListener('click', ev => { ev.stopPropagation(); delTab(+x.dataset.del); });
  });
  $('tabAdd').onclick = addTab;
  $('tabDup').onclick = dupTab;
}
function switchTab(i){ if(i===doc.active) return; setActive(i); clearSel(); fitView(); render(); renderTabs(); renderCatalog(); syncInputs(); save(); }
function addTab(){ const prev=snapshot(); doc.tabs.push(blankLayout('格局 '+(doc.tabs.length+1))); setActive(doc.tabs.length-1); clearSel(); fitView(); commit(prev); render(); renderTabs(); renderCatalog(); syncInputs(); }
function dupTab(){
  const prev=snapshot(); const copy = JSON.parse(JSON.stringify(state)); copy.name = state.name + ' 複本';
  doc.tabs.splice(doc.active+1, 0, copy); setActive(doc.active+1); fixIds();   // 重編 id 避免衝突
  clearSel(); fitView(); commit(prev); render(); renderTabs(); renderCatalog(); syncInputs();
}
function renameTab(i){ const n=(prompt('分頁名稱？', doc.tabs[i].name)||'').trim(); if(!n) return; const p=snapshot(); doc.tabs[i].name=n; commit(p); renderTabs(); }
function delTab(i){ if(doc.tabs.length<=1) return; if(!confirm(`刪除分頁「${doc.tabs[i].name}」？`)) return;
  const prev=snapshot(); doc.tabs.splice(i,1); setActive(Math.max(0, doc.active>=i?doc.active-1:doc.active));
  clearSel(); fitView(); commit(prev); render(); renderTabs(); renderCatalog(); syncInputs(); }

/* ---------- 模式 ---------- */
function setMode(m){
  mode = m;
  ['Select','Pan','Wall','Measure'].forEach(x => { const b=$('mode'+x); if(b) b.classList.toggle('active', mode===x.toLowerCase()); });
  $('modeHint').textContent = m==='wall' ? '按住拖曳畫一道牆，端點吸附格線。'
    : m==='pan' ? '拖曳畫布平移；滾輪縮放。'
    : m==='measure' ? '拖一條線量距離（cm）；Esc 清除。'
    : '拖曳家具移動；拖空白處框選多個；Shift 點擊加選。';
  render();
}

/* ---------- 存檔 / 讀取 / 輸出 ---------- */
function buildStandaloneSvg(forCanvas){
  const _sel = selected; selected = [];   // 不畫選取高亮/控制點
  const inner = innerSvg(); selected = _sel;
  const {w,h} = state.area, M = marginCm(), vw = w+2*M, vh = h+2*M;
  const size = forCanvas ? `width="${Math.round(vw*1.6)}" height="${Math.round(vh*1.6)}"` : 'width="100%" height="auto"';
  return `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="${-M} ${-M} ${vw} ${vh}"><rect x="${-M}" y="${-M}" width="${vw}" height="${vh}" fill="#ffffff"/>${inner}</svg>`;
}
function viewerHTML(){
  const blocks = doc.tabs.map((L,i) => {
    const _a = state; state = L;          // 暫切 state 讓片段函式用對的 layout
    const _sel = selected; selected = [];
    const inner = innerSvg(); selected = _sel; state = _a;
    const _g=state; state=L; const M=marginCm(); state=_g; const vw=L.area.w+2*M, vh=L.area.h+2*M;
    return `<section><h2>${esc(L.name)}（${L.area.w}×${L.area.h} cm ・ ${(L.area.w*L.area.h/PYEONG_CM2).toFixed(1)} 坪）</h2>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="${-M} ${-M} ${vw} ${vh}"><rect x="${-M}" y="${-M}" width="${vw}" height="${vh}" fill="#fff"/>${inner}</svg></section>`;
  }).join('');
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>房屋家具配置</title>
<style>body{margin:0;background:#f1f5f9;font-family:"Noto Sans TC",system-ui,sans-serif}
.wrap{max-width:1000px;margin:0 auto;padding:18px}h1{font-size:18px}h2{font-size:14px;color:#334155;margin:18px 0 6px}
svg{width:100%;height:auto;background:#fff;border:1px solid #cbd5e1;border-radius:10px;box-shadow:0 4px 20px rgba(15,23,42,.06)}
.tip{font-size:12px;color:#64748b}</style></head>
<body><div class="wrap"><h1>🏠 房屋家具配置</h1>${blocks}
<p class="tip">此檔由「房屋家具配置工具」產生，可拖回工具讀取續編。</p></div>
<script type="application/json" id="floorplan-data">${snapshot()}</script></body></html>`;
}
function download(filename, text, mime){
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text],{type:mime})); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
}
function saveFile(){ download('房屋配置.html', viewerHTML(), 'text/html'); showToast('已存檔（自含 HTML，含所有分頁）'); }
function loadFromText(txt){
  let o = null;
  try{ o = JSON.parse(txt); }catch(e){
    const m = txt.match(/<script[^>]*id=["']floorplan-data["'][^>]*>([\s\S]*?)<\/script>/i);
    if(m){ try{ o = JSON.parse(m[1]); }catch(_){} }
  }
  if(!o){ showToast('檔案格式不符'); return; }
  if(!o.tabs){ o = migrate(o); }                       // 舊 v1 單一格局 → 包成分頁
  if(o.tabs && o.tabs[0] && o.tabs[0].area){ undoStack=[]; redoStack=[]; applyDoc(o, true); showToast('已讀取'); }
  else showToast('檔案格式不符');
}
function migrate(o){
  const L = blankLayout('格局 1');
  Object.assign(L, {area:o.area||L.area, grid:o.grid||10, snap:o.snap!==false, walls:o.walls||[], furniture:o.furniture||[], texts:o.texts||[], customTypes:o.customTypes||[]});
  return { version:2, active:0, tabs:[L] };
}
async function copyImage(){
  const url = URL.createObjectURL(new Blob([buildStandaloneSvg(true)],{type:'image/svg+xml;charset=utf-8'}));
  const img = new Image();
  img.onload = async () => {
    const cv = document.createElement('canvas'); const M=marginCm();
    cv.width=Math.round((state.area.w+2*M)*1.6); cv.height=Math.round((state.area.h+2*M)*1.6);
    const ctx = cv.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,cv.width,cv.height); ctx.drawImage(img,0,0); URL.revokeObjectURL(url);
    cv.toBlob(async blob => {
      try{ if(navigator.clipboard && window.ClipboardItem){ await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]); showToast('已複製圖片，可貼到 LINE／Discord'); } else throw 0; }
      catch(e){ download('房屋配置.png', blob, 'image/png'); showToast('瀏覽器不支援複製，已改下載 PNG'); }
    }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); showToast('產生圖片失敗'); };
  img.src = url;
}

/* ---------- ④ 分享連結 / 列印 ---------- */
async function gzipB64(str){
  if(!window.CompressionStream) return null;
  const cs=new CompressionStream('gzip');
  const blob=await new Response(new Blob([str]).stream().pipeThrough(cs)).blob();
  const buf=new Uint8Array(await blob.arrayBuffer()); let bin='';
  for(let i=0;i<buf.length;i++) bin+=String.fromCharCode(buf[i]);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function ungzipB64(enc){
  const bin=atob(enc.replace(/-/g,'+').replace(/_/g,'/'));
  const buf=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
  const ds=new DecompressionStream('gzip');
  const blob=await new Response(new Blob([buf]).stream().pipeThrough(ds)).blob();
  return await blob.text();
}
async function shareLink(){
  const enc=await gzipB64(snapshot());
  if(!enc){ showToast('瀏覽器不支援，請改用存檔分享'); return; }
  const url=location.origin+location.pathname+'#d='+enc;
  if(url.length>14000){ showToast('格局太大，請改用存檔分享'); return; }
  try{ await navigator.clipboard.writeText(url); showToast('已複製分享連結'); }
  catch(e){ prompt('複製此連結分享：', url); }
}
function printPlan(){
  const w=window.open('', '_blank');
  if(!w){ showToast('請允許彈出視窗後再試'); return; }
  w.document.write(viewerHTML()); w.document.close();
  setTimeout(()=>{ try{ w.focus(); w.print(); }catch(e){} }, 500);
}

/* ---------- 工具列輸入 ---------- */
function syncInputs(){ $('areaW').value=state.area.w; $('areaH').value=state.area.h; $('gridSel').value=state.grid; $('snapChk').checked=state.snap; updatePyeong(); }

function bindUI(){
  $('areaW').onchange = e => { const p=snapshot(); state.area.w=+e.target.value||600; clampArea(); fitView(); commit(p); render(); syncInputs(); };
  $('areaH').onchange = e => { const p=snapshot(); state.area.h=+e.target.value||500; clampArea(); fitView(); commit(p); render(); syncInputs(); };
  $('gridSel').onchange= e => { const p=snapshot(); state.grid=+e.target.value; commit(p); render(); };
  $('snapChk').onchange= e => { const p=snapshot(); state.snap=e.target.checked; commit(p); };

  $('modeSelect').onclick = () => setMode('select');
  $('modePan').onclick    = () => setMode('pan');
  $('modeWall').onclick   = () => setMode('wall');
  $('modeMeasure').onclick= () => setMode('measure');
  $('addText').onclick    = addText;
  $('areaChk').onchange   = e => { showAreas=e.target.checked; render(); };

  $('btnUndo').onclick = undo; $('btnRedo').onclick = redo;
  $('btnExample').onclick = loadExample; $('btnSave').onclick = saveFile; $('btnCopy').onclick = copyImage;
  $('btnShare').onclick = shareLink; $('btnPrint').onclick = printPlan;
  $('btnLoad').onclick = () => $('fileInput').click();
  $('fileInput').onchange = e => { const f=e.target.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>loadFromText(String(rd.result||'')); rd.readAsText(f); e.target.value=''; };
  $('btnClear').onclick = () => {
    if(!confirm('確定清空目前分頁？')) return;
    const p=snapshot(); const L=blankLayout(state.name); L.area=state.area; L.grid=state.grid; L.snap=state.snap; L.customTypes=state.customTypes;
    doc.tabs[doc.active]=L; setActive(doc.active); clearSel(); fitView(); commit(p); render(); renderCatalog();
  };

  // 縮放
  svg.addEventListener('wheel', e => { e.preventDefault(); const c=toSvg(e); zoomBy(e.deltaY<0?1.15:1/1.15, c.x, c.y); }, {passive:false});
  $('zoomIn').onclick=()=>zoomBy(1.25); $('zoomOut').onclick=()=>zoomBy(1/1.25);
  $('zoomFit').onclick=()=>{fitView();applyView();}; $('zoomLabel').onclick=()=>{fitView();applyView();};

  // 畫布背景 pointerdown
  svg.addEventListener('pointerdown', e => {
    if(spaceDown || e.button===1){ startPan(e); return; }
    if(mode==='wall'){ startWallDraw(e); return; }
    if(mode==='measure'){ startMeasure(e); return; }
    if(mode==='pan'){ startPan(e); return; }
    if(e.target===svg){ startMarquee(e); }
  });

  // 鍵盤
  window.addEventListener('keydown', e => {
    if(e.code==='Space' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)){ spaceDown=true; svg.classList.add('mode-pan'); }
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if(e.key==='Escape'){ measure=null; clearSel(); render(); return; }
    if(typing) return;
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z'){ e.preventDefault(); e.shiftKey?redo():undo(); return; }
    if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='y'){ e.preventDefault(); redo(); return; }
    if(e.key==='Delete'||e.key==='Backspace'){ e.preventDefault(); deleteSel(); return; }
    if(e.key.toLowerCase()==='r'){ rotateSel(); return; }
    const step = e.shiftKey ? 1 : state.grid;
    if(e.key==='ArrowLeft'){ e.preventDefault(); nudge(-step,0); }
    else if(e.key==='ArrowRight'){ e.preventDefault(); nudge(step,0); }
    else if(e.key==='ArrowUp'){ e.preventDefault(); nudge(0,-step); }
    else if(e.key==='ArrowDown'){ e.preventDefault(); nudge(0,step); }
  });
  window.addEventListener('keyup', e => { if(e.code==='Space'){ spaceDown=false; svg.classList.toggle('mode-pan', mode==='pan'); } });
  window.addEventListener('resize', () => { if(view) applyView(); });
}

/* ---------- 範例：三房兩廳 ---------- */
function loadExample(){
  const prev = snapshot();
  const L = blankLayout('三房兩廳'); L.area = {w:1000, h:800};
  let n=1; const nid=()=>'x'+(n++);
  const W=(x1,y1,x2,y2)=>L.walls.push({id:nid(),x1,y1,x2,y2});
  const F=(type,x,y,rot,swing)=>{ const t=TYPE[type]; const f={id:nid(),type,x,y,w:t.w,d:t.d,rot:rot||0,label:''}; if(type==='門') f.swing=swing||0; L.furniture.push(f); };
  const T=(x,y,t,size)=>L.texts.push({id:nid(),x,y,t,size});
  W(0,0,1000,0); W(1000,0,1000,800); W(0,800,1000,800); W(0,0,0,800);
  W(0,350,1000,350); W(400,0,400,350); W(700,0,700,350); W(650,350,650,800); W(820,350,820,800);
  F('雙人床',30,30); F('衣櫃',260,30); T(120,210,'主臥',30);
  F('單人床',420,30); F('書桌',560,270); T(490,210,'次臥',26);
  F('單人床',720,30); F('衣櫃',860,30); T(810,210,'次臥',26);
  F('沙發',40,390); F('茶几',60,510); F('電視櫃',40,740); T(150,660,'客廳',30);
  F('餐桌',420,450); T(430,640,'餐廳',26);
  F('流理台',690,410,90); F('冰箱',700,640); T(690,560,'廚房',24);
  F('浴缸',830,390); F('馬桶',850,520); T(870,470,'衛浴',24);
  F('門',150,345,0,0); F('門',520,345,0,0); F('門',860,345,0,0); F('門',710,345,0,0); F('門',870,345,0,0); F('門',460,790,0,3);
  doc.tabs.push(L); setActive(doc.tabs.length-1); fixIds(); clearSel(); fitView();
  commit(prev); render(); renderTabs(); renderCatalog(); syncInputs(); showToast('已新增「三房兩廳」分頁');
}

/* ---------- 啟動 ---------- */
async function init(){
  doc = null;
  if(location.hash.startsWith('#d=')){          // 分享連結
    try{ const o=JSON.parse(await ungzipB64(location.hash.slice(3))); if(o&&o.tabs) doc=o; }catch(e){}
    history.replaceState(null,'',location.pathname+location.search);
  }
  if(!doc){
    try{ const raw=localStorage.getItem(LS); doc = raw ? JSON.parse(raw) : blankDoc(); }catch(e){ doc = blankDoc(); }
  }
  if(!doc || !doc.tabs){ doc = doc && doc.area ? migrate(doc) : blankDoc(); }
  setActive(doc.active||0); fixIds(); fitView();
  bindUI(); renderTabs(); renderCatalog(); syncInputs(); setMode('select');
}
init();

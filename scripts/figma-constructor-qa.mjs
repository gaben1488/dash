/**
 * Local contract and smoke execution of the editable Dash Figma constructor.
 * Runs without Figma credentials, network access, or a mock procurement server.
 * This is NOT native Figma rendering QA; MCP/Figma manual acceptance remains.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dir=resolve(root,'docs/superpowers/mockups/dash-design-lab/figma-constructor');
const src=readFileSync(resolve(dir,'code.js'),'utf8');
const html=readFileSync(resolve(dir,'ui.html'),'utf8');
const manifest=JSON.parse(readFileSync(resolve(dir,'manifest.json'),'utf8'));
assert.equal(manifest.main,'code.js');
assert.equal(manifest.ui,'ui.html');
assert.deepEqual(manifest.networkAccess.allowedDomains,['none']);
assert.match(html,/Текущий \+ целевой/);
assert.match(html,/материал/iu);
assert.doesNotMatch(src,/\bfetch\(|\.remove\(\)|\.delete\(\)/);

/* The generated Figma builder must stay byte-for-byte aligned with the source
 * palettes, surfaces and finishes already maintained by the real Kit lab. */
const catalog=readFileSync(resolve(root,'packages/web/src/pages/design-lab/catalog.ts'),'utf8');
function sourceArray(name){
 const token='export const '+name+' = ';
 const i=catalog.indexOf(token);
 assert.ok(i>=0,name+' missing');
 const start=i+token.length,end=catalog.indexOf('] as const;',start);
 return JSON.parse(catalog.slice(start,end+1));
}
const begin=src.indexOf('const DATA=')+'const DATA='.length;
const finish=src.indexOf(';\nconst HOME=',begin);
assert.ok(begin>12&&finish>begin,'Figma builder data not found');
const embedded=JSON.parse(src.slice(begin,finish));
assert.deepEqual(embedded.palettes,sourceArray('ORIGINAL_FAMILIES'));
assert.deepEqual(embedded.surfaces,sourceArray('EXPERIMENTAL_SURFACES'));
assert.deepEqual(embedded.finishes,sourceArray('FINISHES'));
assert.equal(embedded.routes.length,13);
assert.deepEqual(embedded.routes.map(x=>x.id),[
 'dashboard','report','svod','data','unfunded','yearlong','monitoring',
 'economy','competition','discipline','analytics','quality','settings'
]);
assert.equal(embedded.palettes.reduce((n,f)=>n+f.sections.length,0),39);


let serial=1;
function node(type){
  const result={
    id:'TEST:'+serial++,type,children:[],name:'',width:0,height:0,
    x:0,y:0,characters:'',fills:[],effects:[],strokes:[],
    resize(w,h){this.width=w;this.height=h;},
    appendChild(child){this.children.push(child);child.parent=this;},
  };
  return result;
}
const pages=['01 · DASH / Основы, история и решения',
  '02 · DASH / Компоненты и лаборатория',
  '03 · DASH / Экраны и приёмка'].map(name=>{const p=node('PAGE');p.name=name;return p;});
const messages=[];
const figma={
  root:{children:pages},
  ui:{onmessage:null,postMessage(msg){messages.push(msg)}},
  showUI(markup,args){assert.equal(typeof markup,'string');assert.ok(args.width>=400);},
  createFrame(){return node('FRAME')},
  createComponent(){const n=node('COMPONENT');n.addComponentProperty=(name,type,value)=>name+'#TEST';n.createInstance=()=>node('INSTANCE');return n;},
  combineAsVariants(components,parent){const set=node('COMPONENT_SET');set.resizeWithoutConstraints=set.resize;for(const c of components)set.appendChild(c);parent.appendChild(set);return set;},
  createRectangle(){return node('RECTANGLE')},
  createText(){return node('TEXT')},
  createEllipse(){return node('ELLIPSE')},
  async loadFontAsync(){},
  async setCurrentPageAsync(page){this.currentPage=page},
};
vm.runInNewContext(src,{figma,__html__:'<div/>',console},{filename:'figma-constructor/code.js',timeout:3000});
assert.equal(typeof figma.ui.onmessage,'function');
const props={screen:'all',version:'both',viewport:'1440',family:'cosmos',
  surface:'heritage',finish:'glass',mode:'dark',density:'comfortable'};
await figma.ui.onmessage({kind:'screens',...props});
assert.ok(!messages.at(-1).error,JSON.stringify(messages.at(-1)));
const screens=pages[2].children.filter(x=>x.name.startsWith('DASH / '));
assert.equal(screens.length,26,'13 current + 13 target frames');
assert.equal(new Set(screens.map(x=>x.name)).size,26);
const walk=(n)=>[n,...n.children.flatMap(walk)];
for(const screen of screens){
  const text=walk(screen).filter(x=>x.type==='TEXT').map(x=>x.characters).join(' ');
  assert.ok(text.includes('СОХРАНИТЬ')||text.includes('Сохранить')||text.includes('Источник'),screen.name);
  assert.ok(!/Демо-позиция.+₽/.test(text),'placeholder named production money');
  assert.ok(!text.includes('Три элемента сводки'),'old generic layout leaked');
  assert.ok(walk(screen).some(n=>n.name==='ПОДРАЗДЕЛЫ / каждый имеет собственную рабочую сцену'),'route tabs lack independent content');
}
const report=screens.find(x=>x.name.includes(' / report / ')&&x.name.includes(' / target / '));
const reportStrings=walk(report).map(x=>x.name);
assert.ok(reportStrings.some(x=>x.toLowerCase().includes('оглавление отчёта')));
assert.ok(!reportStrings.some(x=>x.includes('Исходный OrgStrip')));
const monitoring=screens.find(x=>x.name.includes(' / monitoring / ')&&x.name.includes(' / target / '));
const mtext=walk(monitoring).filter(x=>x.type==='TEXT').map(x=>x.characters).join(' ');
for(const label of ['В работе','Реестр','Обзор','Связи','Справочники'])assert.ok(mtext.includes(label),label);
assert.equal(walk(monitoring).filter(n=>n.name.startsWith('РЕАЛЬНЫЙ РЕЖИМ / ')).length,5);
const quality=screens.find(x=>x.name.includes(' / quality / ')&&x.name.includes(' / target / '));
const qtext=walk(quality).filter(x=>x.type==='TEXT').map(x=>x.characters).join(' ');
for(const label of ['Сверка','Качество заполнения','Замечания','Оценка управлений','Рекомендации','Журнал'])assert.ok(qtext.includes(label),label);
assert.equal(walk(quality).filter(n=>n.name.startsWith('РЕАЛЬНЫЙ РЕЖИМ / ')).length,6);
// Full route-specific coverage is a structural requirement, not a palette-only mock.
const allTabs=screens.reduce((n,screen)=>n+walk(screen).filter(x=>x.name.startsWith('РЕАЛЬНЫЙ РЕЖИМ / ')||x.name.startsWith('ПРОЕКТНАЯ СЦЕНА / ')).length,0);
assert.equal(allTabs,84,'missing editable screens/scenes');
const realCount=screens.reduce((n,screen)=>n+walk(screen).filter(x=>x.name.startsWith('РЕАЛЬНЫЙ РЕЖИМ / ')).length,0);
assert.equal(realCount,44,'confirmed navigation modes must be 22 × Current/Target, not invented');
assert.equal(allTabs-realCount,40,'nonexistent tabs must be marked as conceptual scenes');
for(const entry of embedded.routes){
 const target=screens.find(x=>x.name.includes(' / '+entry.id+' / ')&&x.name.includes(' / target / '));
 assert.ok(target,entry.id+' target missing');
 const texts=walk(target).filter(x=>x.type==='TEXT').map(x=>x.characters).join(' ');
 const layout=walk(target).filter(x=>x.name.includes('Таблица / уникальная схема '+entry.id));
 assert.equal(layout.length,1,'route-specific table missing: '+entry.id);
 assert.ok(texts.includes(entry.goal),'business purpose missing '+entry.id);
}
const guard=screens[0].children.find(x=>x.name==='Решение · provenance / запреты');
if(!guard)throw Error('provenance marker missing');
guard.customManualEdit='Сохранить';
await figma.ui.onmessage({kind:'screens',...props});
assert.equal(pages[2].children.length,26,'rerun must never clone/overwrite existing');
assert.equal(guard.customManualEdit,'Сохранить');
await figma.ui.onmessage({kind:'screens',...props,version:'target',screen:'report',viewport:'390'});
assert.equal(pages[2].children.length,27);
const mobile=pages[2].children.at(-1);
const mobileText=walk(mobile).filter(x=>x.type==='TEXT').map(x=>x.characters).join(' ');
assert.ok(mobileText.includes('Оглавление отчёта'));
await figma.ui.onmessage({kind:'materials',...props});
assert.ok(!messages.at(-1).error,JSON.stringify(messages.at(-1)));
assert.equal(pages[1].children.filter(x=>x.name.startsWith('DASH / Материал')).length,6);
const nativeSets=pages[1].children.filter(x=>x.type==='COMPONENT_SET');
assert.equal(nativeSets.length,5,'need five distinct real Figma component sets');
assert.equal(nativeSets.reduce((n,x)=>n+x.children.length,0),25,'need 25 edit-ready variants');
assert.ok(nativeSets.every(set=>set.children.every(n=>n.type==='COMPONENT')));
await figma.ui.onmessage({kind:'materials',...props});
assert.equal(pages[1].children.filter(x=>x.name.startsWith('DASH / Материал')).length,6);
assert.equal(pages[1].children.filter(x=>x.type==='COMPONENT_SET').length,5,'rerun duplicated sets');
await figma.ui.onmessage({kind:'all',...props});
assert.ok(!messages.at(-1).error,JSON.stringify(messages.at(-1)));
const homeFrames=pages[0].children.filter(x=>x.name.startsWith('DASH / INDEX /'));
assert.equal(homeFrames.length,1,'one-click build must enrich the existing Foundations page');
assert.ok(homeFrames[0].x<1400,'foundations map must stack below, not widen the canvas');
assert.ok(walk(homeFrames[0]).filter(x=>x.type==='TEXT').some(x=>x.characters.includes('13 реальных маршрутов')||x.characters.includes('НАСТОЯЩИЙ БАРАБАН')),'home cannot remain only color swatches');
assert.equal(pages[1].children.filter(x=>x.type==='COMPONENT_SET').length,5,'all call duplicated component sets');
assert.equal(pages[2].children.filter(x=>x.name.startsWith('DASH / ')).length,27,'all call duplicated existing screens');
await figma.ui.onmessage({kind:'all',...props});
assert.equal(pages[0].children.filter(x=>x.name.startsWith('DASH / INDEX /')).length,1,'rerun duplicated home');
const allTexts=walk(pages[2]).filter(x=>x.type==='TEXT').map(x=>x.characters);
assert.ok(allTexts.some(x=>/неделя/iu.test(x)));
console.log(JSON.stringify({result:'PASS (stubbed Figma Plugin API; NOT in-editor rendering)',
  initialScreens:26,mobileExtra:1,materials:6,foundationHomes:1,allTabScenes:84,realModeScenes:44,conceptScenes:40,duplicateAfterRerun:0,
  routeCount:13,componentSets:5,componentVariants:25,subtabScenes:embedded.routes.reduce((n,r)=>n+r.tabs.length,0),notes:'Native Figma Starter editing and visual acceptance still required'},null,2));

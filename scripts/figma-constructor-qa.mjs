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
assert.match(html,/Материалы/);
assert.doesNotMatch(src,/\bfetch\(|\.remove\(\)|\.delete\(\)/);

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
}
const report=screens.find(x=>x.name.includes(' / report / ')&&x.name.includes(' / target / '));
const reportStrings=walk(report).map(x=>x.name);
assert.ok(reportStrings.some(x=>x.includes('Оглавление отчёта')));
assert.ok(!reportStrings.some(x=>x.includes('Исходный OrgStrip')));
const monitoring=screens.find(x=>x.name.includes(' / monitoring / ')&&x.name.includes(' / target / '));
const mtext=walk(monitoring).filter(x=>x.type==='TEXT').map(x=>x.characters).join(' ');
for(const label of ['В работе','Реестр','Обзор','Связи','Справочники'])assert.ok(mtext.includes(label),label);
const quality=screens.find(x=>x.name.includes(' / quality / ')&&x.name.includes(' / target / '));
const qtext=walk(quality).filter(x=>x.type==='TEXT').map(x=>x.characters).join(' ');
for(const label of ['Сверка','Качество заполнения','Замечания','Оценка управлений','Рекомендации','Журнал'])assert.ok(qtext.includes(label),label);
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
await figma.ui.onmessage({kind:'materials',...props});
assert.equal(pages[1].children.filter(x=>x.name.startsWith('DASH / Материал')).length,6);
const allTexts=walk(pages[2]).filter(x=>x.type==='TEXT').map(x=>x.characters);
assert.ok(allTexts.some(x=>x.includes('Неделя')));
console.log(JSON.stringify({result:'PASS (stubbed Figma Plugin API; NOT in-editor rendering)',
  initialScreens:26,mobileExtra:1,materials:6,duplicateAfterRerun:0,
  routeCount:13,notes:'Native Figma Starter editing and visual acceptance still required'},null,2));

import palettes from './palettes.json';
import { useStore } from '../store';

/* QA-only toolbar: use the real router and actual visible DOM controls. */
const ROUTES = [
 ['dashboard','Пульс'],['report','Отчёт'],['svod','Свод'],
 ['data','Реестр'],['unfunded','Не обеспеченные'],
 ['yearlong','В течение года'],['monitoring','Мониторинг'],
 ['economy','Экономия'],['competition','Конкуренция'],
 ['discipline','Дисциплина'],['analytics','Аналитика'],
 ['quality','Контроль'],['settings','Система'],
] as const;
const INNER:Record<string,string[]> = {
 report:['В прямом эфире','Архив недели','Рекомендации ↓','Что изменилось ↓'],
 data:['Просмотр','Редактор таблиц'],
 unfunded:['Просмотр','Редактор таблиц'],
 yearlong:['Просмотр','Редактор таблиц'],
 monitoring:['В работе','Реестр','Обзор','Связи','Справочники'],
 quality:['Сверка','Качество заполнения','Замечания','Оценка управлений','Рекомендации','Журнал'],
 settings:['Источники данных','Соответствие ячеек','Подключение'],
};
const state={family:'Космос',finish:'candy',collapsed:true};
let routeHost:HTMLElement,innerHost:HTMLElement,messageHost:HTMLElement,coverageHost:HTMLElement;
let themeHost:HTMLElement,finishHost:HTMLElement,drawer:HTMLElement;
function inform(s:string){if(messageHost)messageHost.textContent=s;}
function realButton(label:string):HTMLButtonElement|undefined{
 const list=[...document.querySelectorAll<HTMLButtonElement>('#main-content button')];
 return list.find(b=>(b.innerText||b.textContent||'').replace(/\s+/g,' ').trim()===label && b.getClientRects().length>0)
   ?? list.find(b=>(b.innerText||b.textContent||'').replace(/\s+/g,' ').trim().startsWith(label+' ') && b.getClientRects().length>0);
}
function toggleTab(name:string){
 const target=realButton(name);
 if(!target){inform('Внутренняя кнопка пока недоступна: '+name+' — нужен сценарий/API');return;}
 target.click();target.scrollIntoView({block:'nearest'});
 inform('Открыт реальный элемент: '+name+'.');
}
function button(text:string,callback:()=>void,active=false){
 const b=document.createElement('button');b.type='button';b.textContent=text;
 b.className='dash-qa-choice'+(active?' dash-qa-choice--active':'');b.onclick=callback;return b;
}
function renderColors(){
 document.documentElement.dataset.previewFamily=state.family;
 document.documentElement.dataset.previewFinish=state.finish;
 const pack=palettes.find(f=>f.name===state.family);
 if(!pack)return;
 for(const node of document.querySelectorAll<HTMLButtonElement>('.np-btn')){
   const title=node.querySelector<HTMLElement>('.np-label')?.textContent?.trim();
   const pair=pack.tabs.find(p=>p.name===title);if(!pair)continue;
   if(node.style.getPropertyValue('--np-color')!==pair.top)node.style.setProperty('--np-color',pair.top);
   if(node.style.getPropertyValue('--np-color-light')!==pair.bottom)node.style.setProperty('--np-color-light',pair.bottom);
   if(node.style.getPropertyValue('--qa-ink')!==pair.ink)node.style.setProperty('--qa-ink',pair.ink);
 }
 const match=ROUTES.find(v=>v[0]===useStore.getState().page);
 const pair=pack.tabs.find(t=>t.name===match?.[1]);
 if(pair)document.documentElement.style.setProperty('--qa-current-top',pair.top);
}
function paint(){
 if(!routeHost)return;
 routeHost.replaceChildren();
 const page=useStore.getState().page;
 for(const [id,label]of ROUTES){
   routeHost.append(button(label,()=>{
     useStore.getState().setPage(id);
     inform('Открыта исходная страница: '+label);
     requestAnimationFrame(paint);
   },id===page));
 }
 innerHost.replaceChildren();
 for(const name of INNER[page]??[])innerHost.append(button(name,()=>toggleTab(name)));
 if(!(INNER[page]??[]).length){
   const p=document.createElement('p');p.className='dash-qa-muted';
   p.textContent='Вложенные управления остаются на самой исходной странице.';innerHost.append(p);
 }
 renderColors();coverage();
}
function coverage(){
 if(!coverageHost)return;
 const missed=(globalThis as any).__DASH_PREVIEW_MISSING__ as Set<string>|undefined;
 const requests=(globalThis as any).__DASH_PREVIEW_REQUESTS__ as Set<string>|undefined;
 coverageHost.textContent='API: '+(requests?.size??0)+' маршрутов запрошено; не обеспечено: '+(missed?.size??0)+'.';
 coverageHost.dataset.incomplete=missed?.size?'true':'false';
 coverageHost.title=[...(missed??[])].join(', ')||'Только синтетические ответы';
}
export function installDesignControls(){
 if(document.getElementById('dash-qa'))return;
 document.documentElement.dataset.previewFamily=state.family;
 document.documentElement.dataset.previewFinish=state.finish;
 drawer=document.createElement('aside');drawer.id='dash-qa';drawer.className='dash-qa';
 drawer.setAttribute('aria-label','Контроль макета');
 drawer.innerHTML=[
  '<div class="dash-qa-head"><div><strong>Dash · дизайн-гейт</strong>',
  '<small>Реальные компоненты · данные синтетические</small></div>',
  '<button id="qa-toggle" aria-expanded="false">Открыть</button></div>',
  '<div id="qa-body" class="dash-qa-body" hidden>',
  '<p class="dash-qa-caution">Непринятый облик поверх настоящего фронтенда.',
  'Рабочие страницы и линейка организаций не подменены.</p>',
  '<h3>Цветовое семейство</h3><div id="qa-families" class="dash-qa-group"></div>',
  '<h3>Отделка</h3><div id="qa-finishes" class="dash-qa-group"></div>',
  '<h3>13 существующих страниц</h3><div id="qa-routes" class="dash-qa-group"></div>',
  '<h3>Реальные подразделы</h3><div id="qa-inner" class="dash-qa-group"></div>',
  '<div id="qa-coverage" class="dash-qa-status"></div>',
  '<p id="qa-message" class="dash-qa-muted"></p>',
  '<p class="dash-qa-muted">Это не production-приёмка. Пустые и ошибочные состояния,',
  'выгрузки, связки, клавиатура и адаптивность требуют отдельных проверок.</p></div>',
 ].join('');
 document.body.append(drawer);
 const toggle=drawer.querySelector<HTMLButtonElement>('#qa-toggle')!;
 const body=drawer.querySelector<HTMLElement>('#qa-body')!;
 toggle.onclick=()=>{
   state.collapsed=!state.collapsed;body.hidden=state.collapsed;
   toggle.textContent=state.collapsed?'Открыть':'Свернуть';
   toggle.setAttribute('aria-expanded',state.collapsed?'false':'true');
   if(!state.collapsed)paint();
 };
 routeHost=drawer.querySelector<HTMLElement>('#qa-routes')!;
 innerHost=drawer.querySelector<HTMLElement>('#qa-inner')!;
 themeHost=drawer.querySelector<HTMLElement>('#qa-families')!;
 finishHost=drawer.querySelector<HTMLElement>('#qa-finishes')!;
 coverageHost=drawer.querySelector<HTMLElement>('#qa-coverage')!;
 messageHost=drawer.querySelector<HTMLElement>('#qa-message')!;
 for(const label of ['Исходная','Космос','Камчатка','Минералы']){
   const id=label==='Исходная'?'original':label;
   themeHost.append(button(label,()=>{
     state.family=id;renderColors();
     themeHost.querySelectorAll('button').forEach(b=>b.classList.toggle('dash-qa-choice--active',b.textContent===label));
     inform('Палитра: '+label+'. Действующая логика страниц не изменилась.');
   },id===state.family));
 }
 for(const [id,label] of [['candy','Кэнди'],['metal','Металлик'],['pearl','Перламутр'],
   ['xirallic','Ксираллик'],['matte','Мат'],['glass','Стекло']]){
   finishHost.append(button(label,()=>{
     state.finish=id;document.documentElement.dataset.previewFinish=id;
     finishHost.querySelectorAll('button').forEach(b=>b.classList.toggle('dash-qa-choice--active',b.textContent===label));
   },id===state.finish));
 }
 const mount=document.getElementById('root');
 if(mount)new MutationObserver(records=>{
   if(records.some(r=>r.type==='childList'))requestAnimationFrame(renderColors);
 }).observe(mount,{subtree:true,childList:true});
 useStore.subscribe((next,previous)=>{if(next.page!==previous.page)paint();});
 setInterval(coverage,2500);
 paint();
}

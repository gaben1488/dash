/** Synthetic-only QA harness. Header markup/state remain the production components. */
import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';
import '../src/index.css';
import './navigation-qa.css';
import {Header, NAV_ITEMS} from '../src/components/Header';
import {useStore, type Page} from '../src/store';
import {pageDawnStyle, useTheme, useThemeInit} from '../src/components/ThemeProvider';
import {TooltipProvider} from '../src/components/ui/tooltip';
import {Toaster} from '../src/components/ui/toast';
import {summarizeChanges, type ChangeEntry} from '@aemr/core';
import {zipStored} from '../../../scripts/navigation-qa-zip.mjs';

declare const __QA_PROVENANCE__: {sha:string;digest:string;sources:Record<string,string>;syntheticOnly:true};
const QA_BOOK='Учебная книга';
const at='2026-10-13T06:00:00';
const events:ChangeEntry[]=[{id:'qa-event-1',book:QA_BOOK,sheet:'УЧЕБНЫЙ',rowSeq:'QA-001',sheetRow:4,column:'N',columnLabel:'Плановая дата',kind:'dates',before:'01.10.2026',after:'01.11.2026',author:'Учебный автор',at,atMs:Date.parse(at+'Z'),subject:'Учебное событие',subordinate:null,origin:'book-journal'}, {id:'qa-event-2',book:QA_BOOK,sheet:'УЧЕБНЫЙ',rowSeq:'QA-001',sheetRow:4,column:'K',columnLabel:'Учебное число',kind:'money',before:'10',after:'12',author:'Учебный автор',at,atMs:Date.parse(at+'Z'),subject:'Учебное событие',subordinate:null,origin:'book-journal'}];
let mode='available',revision=0;
const response=(value:unknown,status=200)=>Promise.resolve(new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}}));
// Never delegate to native fetch, including unknown URLs or mutation requests.
window.fetch=((input:RequestInfo|URL)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,'https://qa.invalid');
 if(mode==='offline')return response({error:'SYNTHETIC_OFFLINE'},503);
 if(url.pathname==='/api/events')return response({error:'NO_LIVE_STREAM_IN_OFFLINE_QA'},503);
 if(url.pathname==='/api/change-story'){
  const entries=mode==='empty'?[]:events;
  return response({since:'2026-10-08',digest:summarizeChanges(entries,[]),gaps:[],deletionsUnobservable:true,note:'Только учебные события',comparison:null,facets:{books:[{book:QA_BOOK,count:entries.length}],authors:[{author:'Учебный автор',count:entries.length}]},total:entries.length,shown:entries.length,entries});
 }
 if(url.pathname==='/api/comments')return response({total:0,shown:0,comments:[],witnesses:[{id:'qa-note',book:QA_BOOK,kind:'cell_note',readAt:at+'Z',evidence:{sheet:'УЧЕБНЫЙ',cell:'M4',content:'Учебная заметка. Автор не устанавливается по тексту.',author:null,sourceRevision:null}},{id:'qa-thread',book:QA_BOOK,kind:'native_thread',readAt:at+'Z',evidence:{sheet:'УЧЕБНЫЙ',cell:'M4',content:'Учебное обсуждение',author:'Учебный автор',raw:{status:mode==='closed'?'RESOLVED':'OPEN',headPost:{createTime:at+'Z'},replies:[{postId:'qa-reply',content:'Учебный ответ',createTime:at+'Z'}]},posts:[{id:'qa-reply',author:'Учебный автор',content:'Учебный ответ',raw:{createTime:at+'Z'}}]}}]});
 if(url.pathname==='/api/sources')return response(mode==='malformed'?{}:{refresh:{workWindowLabel:'Учебный режим: без источников',withinWorkWindow:true,autoRefreshMinutes:1,webhookConfigured:false}});
 if(url.pathname==='/api/health')return response({status:'ok',timestamp:at+'Z',service:'offline-synthetic-qa',snapshotId:'qa-snapshot'});
 if(url.pathname==='/api/refresh')return response({success:true});
 if(url.pathname==='/api/registry/buckets')return response({asOf:at+'Z',source:'snapshot',unfunded:{rows:3,planSum:0},yearlong:{rows:2,planSum:0}});
 if(url.pathname==='/api/dashboard')return response({year:2026,lastRefreshed:at+'Z',snapshot:{id:'qa-snapshot',createdAt:at+'Z'},departments:[],summary:{},metrics:[],recentIssues:[]});
 if(url.pathname.startsWith('/api/rows/'))return response({rows:Array.from({length:12},(_,i)=>({planDate:`2026-${String(i+1).padStart(2,'0')}-15`,factDate:null,planDateRaw:`2026-${String(i+1).padStart(2,'0')}-15`,factDateRaw:'',planSum:1,factSum:0})),pagination:{page:1,limit:1000,total:12,totalPages:1}});
 return response({error:'UNSUPPORTED_SYNTHETIC_ENDPOINT'},501);
}) as typeof fetch;
const persistedPage=document.documentElement.dataset.qaPage;
useStore.setState({page:NAV_ITEMS.some(p=>p.id===persistedPage)?persistedPage as Page:'dashboard',year:2026,loading:false,error:null,isDemo:false,bucketCounts:{unfunded:3,yearlong:2},lastRefreshed:at+'Z'});
useTheme.setState({theme:document.documentElement.dataset.qaTheme==='light'?'light':'dark'});
function download(zip:boolean){
 const html='<!doctype html>\n'+document.documentElement.outerHTML;
 const blob=zip?new Blob([zipStored('navigation-qa.html',new TextEncoder().encode(html))],{type:'application/zip'}):new Blob([html],{type:'text/html;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=zip?'navigation-qa.zip':'navigation-qa.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function clickJournal(tab?:string){
 document.querySelector<HTMLButtonElement>('.uf-trigger[aria-expanded=false]')?.click();
 if(tab)setTimeout(()=>{Array.from(document.querySelectorAll<HTMLButtonElement>('[role=tab]')).find(b=>b.textContent===tab)?.click();},0);
}
function Qa(){
 useThemeInit();const page=useStore(s=>s.page),theme=useTheme(s=>s.theme);const [preset,setPreset]=useState('Журнал готов');
 useEffect(()=>{document.documentElement.dataset.qaPage=page;document.documentElement.dataset.qaTheme=theme;},[page,theme]);
 const scenario=(name:string)=>{
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  mode=name==='API недоступен'?'offline':name==='Журнал пуст'?'empty':name==='Неполный паспорт'?'malformed':name==='Закрыто в Google'?'closed':'available';
  setPreset(name);useStore.getState().resetAllFilters();
  useStore.setState({loading:false,error:null,lastRefreshed:new Date(Date.parse(at+'Z')+(++revision)*1000).toISOString()});
  if(name==='Отбор'){useStore.getState().toggleMethod('single');useStore.getState().setSearchQuery('Учебный пример');}
  if(name==='Журнал'||name==='API недоступен'||name==='Журнал пуст')setTimeout(()=>clickJournal('Изменения'),0);
  if(name==='Обсуждения'||name==='Закрыто в Google')setTimeout(()=>clickJournal('Комментарии'),0);
  if(name==='Источники'||name==='Неполный паспорт')setTimeout(()=>clickJournal('Источники'),0);
 };
 return <TooltipProvider><Header/><main className="qa-main page-context" style={pageDawnStyle(page)}>
  <p className="qa-watermark">Только учебные данные · нет подключения к Google/VPS · источник журналов имитирован</p>
  <h1>{NAV_ITEMS.find(p=>p.id===page)?.label}</h1>
  <p>Палитра выбранного раздела меняет настоящий Header. Барабан навигации листается колесом и стрелками; журнал находится справа сверху.</p>
  <section aria-label="Палитры разделов" className="qa-palettes">{NAV_ITEMS.map(p=><button key={p.id} type="button" aria-pressed={page===p.id} onClick={()=>useStore.getState().setPage(p.id)} style={{...pageDawnStyle(p.id),background:'linear-gradient(180deg,var(--page-sky),var(--page-horizon))'}}>{p.label}</button>)}</section>
  <section aria-label="Интерактивные состояния" className="qa-presets">{['Журнал','Отбор','Обсуждения','Закрыто в Google','Источники','Журнал пуст','API недоступен','Неполный паспорт'].map(name=><button type="button" key={name} onClick={()=>scenario(name)} aria-pressed={preset===name}>{name}</button>)}</section>
  <p role="status">Учебный сценарий: {preset}. Изображения не подменяют интерактивные элементы.</p>
  <details className="qa-proof"><summary>Версия исходников и способ воспроизведения</summary><p>Git-база: {__QA_PROVENANCE__.sha}</p><p>SHA-256 набора исходников и конфигурации: {__QA_PROVENANCE__.digest}</p><p>Сборка: node scripts/build-navigation-qa.mjs. Журналы, обсуждения и числа выше полностью учебные.</p></details>
  <div className="qa-download"><button type="button" onClick={()=>download(false)}>Скачать HTML</button><button type="button" onClick={()=>download(true)}>Скачать ZIP</button></div>
 </main><Toaster/></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Qa/>);

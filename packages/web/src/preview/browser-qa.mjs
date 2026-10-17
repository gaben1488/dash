import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_CORE_PATH || '/tmp/dash-qa/node_modules/playwright-core');
const out='/tmp/dash-browser-qa';
mkdirSync(out,{recursive:true});
const url=process.env.DASH_QA_URL || 'http://127.0.0.1:4173/preview.html';
const bin=process.env.CHROME_BIN || '/usr/bin/google-chrome';
const routes=[
 ['dashboard','Пульс'],['report','Отчёт'],['svod','Свод'],['data','Реестр'],
 ['unfunded','Не обеспеченные'],['yearlong','В течение года'],['monitoring','Мониторинг'],
 ['economy','Экономия'],['competition','Конкуренция'],['discipline','Дисциплина'],
 ['analytics','Аналитика'],['quality','Контроль'],['settings','Система'],
];
const report={url,routes:[],subtabs:[],screenshots:[],missing:[],pageErrors:[],consoleErrors:[],hardFailures:[]};
const browser=await chromium.launch({headless:true,executablePath:bin,args:['--no-sandbox','--disable-dev-shm-usage']});
let page;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const fail=(reason)=>report.hardFailures.push(reason);
const openRoute=async(id,label)=>{
 try{
   const node=page.locator('.dash-source-navigation input[data-route="'+id+'"]');
   if(await node.count()!==1){fail('Missing/duplicate original route '+label);return false;}
   const list=page.locator('.source-nav-list');
   if(!await list.count())await page.locator('.source-nav-keys button[aria-label="Все 13 разделов"]').click();
   const button=page.locator('.source-nav-list button').filter({hasText:label});
   if(await button.count()!==1){fail('Cannot find original route '+label+' in full list');return false;}
   await button.click({timeout:8000});
   await delay(350);
   const state=await page.evaluate(()=>({
     main:(document.getElementById('main-content')?.innerText??'').slice(0,300),
     isBoundary:(document.getElementById('main-content')?.innerText??'').includes('Этот раздел не открылся'),
     strip:!!document.querySelector('.ob-strip'),
   }));
   if(state.isBoundary)fail('ErrorBoundary in '+label+': '+state.main);
   if(id==='report' && state.strip)fail('OrgStrip was incorrectly inserted into Report');
   if(id!=='report' && !state.strip)fail('OrgStrip disappeared from '+label);
   if(!state.main.trim())fail('Empty original page: '+label);
   report.routes.push({id,label,mainExcerpt:state.main,orgStrip:state.strip,boundary:state.isBoundary});
   return true;
 }catch(e){fail('Cannot open '+label+': '+String(e));return false;}
};
const checkSubtabs=async(id,label,names,selector)=>{
 if(!await openRoute(id,label))return;
 const nav=page.locator(selector);
 const count=await nav.count();
 report.subtabs.push({id,expected:names,rendered:count});
 if(count<names.length)fail(id+': expected '+names.length+' subtabs, saw '+count);
 for(const name of names){
   const item=nav.filter({hasText:new RegExp(name)});
   if(!await item.count()){fail(id+': subtab '+name+' missing');continue;}
   try{await item.first().click({timeout:4000});await delay(250);
     const crashed=await page.locator('#main-content').innerText();
     if(crashed.includes('Этот раздел не открылся')){fail(id+' subtab '+name+' crashed: '+crashed.slice(0,290));break;}
   }
   catch(e){fail(id+': cannot activate '+name+': '+String(e));}
 }
};
try{
 page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
 page.on('pageerror',e=>report.pageErrors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error' && /ErrorBoundary|TypeError|Uncaught/.test(m.text())) report.consoleErrors.push(m.text().slice(0,2200));});
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:40000});
 await page.locator('.dash-source-navigation input[data-route]').first().waitFor({state:'attached',timeout:30000});
 await delay(1100);
 const topCount=await page.locator('.dash-source-navigation input[data-route]').count();
 if(topCount!==13)fail('Expected 13 original nav buttons; rendered '+topCount);
 const navQuality=await page.evaluate(()=>{
   const nav=document.querySelector('.dash-source-navigation');
   const labels=[...document.querySelectorAll('.dash-source-navigation .vkladka-telo>span')].map(x=>{
     const css=getComputedStyle(x),r=x.getBoundingClientRect();
     return {text:x.textContent?.trim(),whiteSpace:css.whiteSpace,break:css.overflowWrap,height:r.height,lineHeight:css.lineHeight};
   });
   return {layout:document.documentElement.dataset.previewNav,navClient:nav?.clientWidth,
     navScroll:nav?.scrollWidth,labels};
 });
 report.nav=navQuality;
 // Historic Header is shown as baseline only; its wrapping is a known design debt.
 // Do not approve or reject target navigation until original 3-row drum is integrated.
 const navGeometry=await page.evaluate(()=>{
   const root=document.querySelector('.dash-source-navigation');
   const groups=[...(root?.querySelectorAll('.vkladki-stroka')??[])];
   const visible=groups.filter(x=>getComputedStyle(x).opacity!=='0' && x.getAttribute('aria-hidden')==='false');
   const checked=[...(root?.querySelectorAll('input[name=razdel]:checked')??[])];
   return {rows:groups.length,visible:visible.length,chosen:checked.map(x=>x.dataset.route),
     fullList:root?.querySelectorAll('input[name=razdel]').length,
     geometry:root?.getBoundingClientRect().width};
 });
 report.navSource=navGeometry;
 if(navGeometry.rows!==4 || navGeometry.visible!==3 || navGeometry.fullList!==13)
   fail('Original 3-row cylinder not functioning: '+JSON.stringify(navGeometry));
 // Browser gate for the real animated circular drum, not just a modulo helper.
 const navGroups=['Обзор','Реестры','Разборы','Надзор'];
 const centerLabel=async()=>(await page.locator('.dash-source-navigation .vkladki-stroka--centr .vkladki-imya-gruppy').innerText()).trim();
 const initialGroup=await centerLabel();
 const start=navGroups.indexOf(initialGroup);
 if(start<0)fail('Unknown initial source navigation centre: '+initialGroup);
 else{
   const next=page.locator('.source-nav-keys button[aria-label="Следующие группы"]');
   const previous=page.locator('.source-nav-keys button[aria-label="Предыдущие группы"]');
   const loop=[];
   for(let step=1;step<=4;step++){
     await next.click();await delay(280);
     const actual=await centerLabel(),expected=navGroups[(start+step)%4];
     loop.push({direction:'down',actual,expected});
     if(actual!==expected)fail('Drum forward wrap step '+step+': '+actual+' instead of '+expected);
   }
   for(let step=1;step<=4;step++){
     await previous.click();await delay(280);
     const actual=await centerLabel(),expected=navGroups[(start-step+4)%4];
     loop.push({direction:'up',actual,expected});
     if(actual!==expected)fail('Drum reverse wrap step '+step+': '+actual+' instead of '+expected);
   }
   const cylinder=page.locator('.dash-source-navigation .баран-навигации');
   await cylinder.hover();await page.mouse.wheel(0,-90);await delay(280);
   if(await centerLabel()!==navGroups[(start+3)%4])fail('Wheel did not wrap to previous group');
   await cylinder.focus();await page.keyboard.press('ArrowDown');await delay(280);
   if(await centerLabel()!==initialGroup)fail('Keyboard could not traverse the wheel boundary');
   report.navLoop=loop;
   const after=await page.evaluate(()=>{
     const root=document.querySelector('.dash-source-navigation');
     const radios=[...(root?.querySelectorAll('input[name="razdel"]')??[])];
     return {rows:root?.querySelectorAll('.vkladki-stroka').length,
       visible:root?.querySelectorAll('.vkladki-stroka[aria-hidden="false"]').length,
       routes:radios.map(r=>r.dataset.route),
       selected:radios.filter(r=>r.checked).map(r=>r.dataset.route)};
   });
   if(after.rows!==4 || after.visible!==3 || after.routes.length!==13 || new Set(after.routes).size!==13
      || after.selected.length!==1 || after.selected[0]!==navGeometry.chosen[0])
     fail('Drum wrap lost route/selection/accessibility identity: '+JSON.stringify(after));
 }

 await page.screenshot({path:out+'/00-initial-desktop.png',fullPage:true});
 report.screenshots.push('00-initial-desktop.png');
 for(const [id,label]of routes){
   if(await openRoute(id,label) && ['report','data','monitoring','quality','settings'].includes(id)){
     await page.screenshot({path:out+'/'+id+'.png',fullPage:true});
     report.screenshots.push(id+'.png');
   }
 }
 // Production report switches by buttons and does not use OrgStrip.
 await openRoute('report','Отчёт');
 for(const label of ['В прямом эфире','Архив недели']){
   const b=page.locator('#main-content button').filter({hasText:label});
   if(!await b.count())fail('Report mode missing '+label);
   else await b.first().click({timeout:5000});
 }
 await openRoute('data','Реестр');
 const registryTabs=page.locator('#main-content [role=tab]');
 if(await registryTabs.count()<2)fail('Registry browse/editor tabs missing');
 else {await registryTabs.nth(1).click();await delay(300);await registryTabs.nth(0).click();}
 await checkSubtabs('monitoring','Мониторинг',
   ['В работе','Реестр','Обзор','Связи','Справочники'],
   '#main-content nav[aria-label="Разделы мониторинга процедур"] button');
 await checkSubtabs('quality','Контроль',
   ['Сверка','Качество заполнения','Замечания','Оценка управлений','Рекомендации','Журнал'],
   '#main-content [role=tab]');
 await checkSubtabs('settings','Система',
   ['Источники данных','Соответствие ячеек','Подключение'],
   '#main-content [role=tab]');
 await page.locator('#qa-toggle').click();
 const family=page.locator('#qa-families button');
 if(await family.count()!==4)fail('Design A/B palette controls missing');
 const themeSurfaces=[];
 for(const name of ['Исходная','Минералы','Космос']){
   const btn=family.filter({hasText:name});
   await btn.click();
   await delay(180); // wait for theme material and React style propagation
   const actual=await page.evaluate(()=>document.documentElement.dataset.previewFamily);
   if(actual!==(name==='Исходная'?'original':name))fail('Palette control not applied: '+name);
   const details=await page.evaluate(()=>({
     background:getComputedStyle(document.querySelector('#root > div')).backgroundColor,
     rootSurface:getComputedStyle(document.documentElement).getPropertyValue('--surface-page').trim(),
     rootTheme:document.documentElement.className,
     family:document.documentElement.dataset.previewFamily,
   }));
   themeSurfaces.push({name,...details});
 }
 report.themeSurfaces=themeSurfaces;
 if(new Set(themeSurfaces.map(x=>x.background)).size<3)
   fail('Palette selector changes state but not visible app surfaces: '+JSON.stringify(themeSurfaces));
 // Test both actual themes using the application's existing ThemeProvider.
 const lightToggle=page.getByRole('button',{name:'Включить светлую тему'});
 if(await lightToggle.count()!==1) fail('Production light-theme toggle missing');
 else {
   await lightToggle.click();
   const isDark=await page.evaluate(()=>document.documentElement.classList.contains('dark'));
   if(isDark)fail('Light theme did not apply');
   const darkToggle=page.getByRole('button',{name:'Включить тёмную тему'});
   if(await darkToggle.count()!==1)fail('Dark-theme return control missing');
   else {
     await darkToggle.click();
     if(!await page.evaluate(()=>document.documentElement.classList.contains('dark')))
       fail('Dark theme did not restore');
   }
 }

 // Unlike the earlier demo, finish selectors must visibly affect the complete
 // chrome family (original source drum, week/year drum, method drum, corner).
 await openRoute('dashboard','Пульс');
 const finishes=page.locator('#qa-finishes button');
 if(await finishes.count()!==6)fail('Expected exactly six physical materials');
 const samples=[];
 for(const title of ['Кэнди','Металлик','Перламутр','Ксираллик','Мат','Стекло']){
   const button=finishes.filter({hasText:title});
   if(await button.count()!==1){fail('Missing material '+title);continue;}
   await button.click();await delay(160);
   const sample=await page.evaluate(()=>{
     const selectors=['.dash-source-navigation .баран-навигации','.hbar .tg-drum','.hbar .vf-drum','.dash-source-axis-toggle'];
     const nodes=selectors.map(selector=>{
       const node=document.querySelector(selector);
       if(!node)return{selector,missing:true};
       const style=getComputedStyle(node),r=node.getBoundingClientRect();
       return{selector,image:style.backgroundImage,shadow:style.boxShadow,backdrop:style.backdropFilter,
         border:style.borderColor,width:Math.round(r.width),height:Math.round(r.height)};
     });
     return {finish:document.documentElement.dataset.previewFinish,nodes};
   });
   samples.push({title,...sample});
 }
 report.materialSamples=samples;
 const signatures=samples.map(x=>x.nodes[0]?.image+'|'+x.nodes[0]?.shadow);
 if(new Set(signatures).size<5)fail('Six material choices do not produce distinct visible chrome: '+JSON.stringify(samples));
 if(samples.some(x=>x.nodes.filter(n=>!n.missing).length<3))
   fail('Material recipe fails to cover at least three real chrome elements');
 const matte=samples.find(x=>x.title==='Мат'),glass=samples.find(x=>x.title==='Стекло');
 if(matte?.nodes[0]?.backdrop===glass?.nodes[0]?.backdrop)
   fail('Matte and Liquid Glass have indistinguishable backdrop treatment');
 const put=await page.evaluate(()=>fetch('/api/rows/uo/5/field',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({field:'A',value:'DANGER'})}).then(r=>r.status));
 if(put!==409)fail('Writes not blocked: PUT returned '+put);
 for(const label of ['Пульс','Отчёт','Мониторинг']){
   const id=routes.find(r=>r[1]===label)[0];
   await openRoute(id,label);
 }
 const coverage=await page.evaluate(()=>({
   missing:[...((globalThis).__DASH_PREVIEW_MISSING__??[])],
   requests:[...((globalThis).__DASH_PREVIEW_REQUESTS__??[])],
 }));
 report.missing=coverage.missing;
 report.requests=coverage.requests;
 // Synthetic demo may lack optional diagnostics, but never fake a green gate.
 if(report.missing.length)fail('Uncovered API contracts: '+report.missing.join(', '));
 const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
 mobile.on('pageerror',e=>report.pageErrors.push('mobile '+String(e)));
 await mobile.goto(url,{waitUntil:'domcontentloaded',timeout:40000});
 await mobile.locator('.dash-source-navigation input[data-route]').first().waitFor({state:'attached',timeout:30000});
 await delay(900);
 await mobile.screenshot({path:out+'/mobile-before-org.png',fullPage:false});
 report.screenshots.push('mobile-before-org.png');
 const beforeMobile=await mobile.evaluate(()=>{
   const main=document.querySelector('#main-content');
   const content=main?.firstElementChild;
   const rect=main?.getBoundingClientRect(),childRect=content?.getBoundingClientRect();
   return {mainHeight:rect?.height,mainTop:rect?.top,mainWidth:rect?.width,
     mainScrollTop:main?.scrollTop,mainScrollLeft:main?.scrollLeft, mainScrollWidth:main?.scrollWidth,
     text:(main?.textContent??'').slice(0,350),
     childHeight:childRect?.height,childTop:childRect?.top,childLeft:childRect?.left};
 });
 report.mobileBefore=beforeMobile;
 if((beforeMobile.mainHeight??0)<180 || !beforeMobile.text.trim())
   fail('Mobile main content missing before opening organizations: '+JSON.stringify(beforeMobile));
 const mobilePicker=mobile.locator('.dash-org-mobile-toggle');
 if(await mobilePicker.count()!==1)fail('Mobile lost the organization selector toggle');
 else{
   const visible=await mobilePicker.isVisible();
   if(!visible)fail('Mobile org picker button is hidden');
   else{
     await mobilePicker.click({timeout:5000});
     const drawer=mobile.locator('.dash-org-container-open .ob-strip');
     if(await drawer.count()!==1)fail('Mobile picker did not open the same production OrgStrip');
     if(await drawer.locator('.ob-dept-btn').count()!==8)fail('Mobile picker lacks eight real organization groups');
     await mobile.locator('.dash-org-mobile-head button').click();
   }
 }
 const mainWidth=await mobile.locator('#main-content').evaluate(el=>el.getBoundingClientRect().width);
 report.mobileMainWidth=mainWidth;
 if(mainWidth<350)fail('Mobile main area still narrowed by OrgStrip: '+mainWidth);
 const widths=await mobile.evaluate(()=>{
  const nodes=[...document.querySelectorAll('body *')].map(el=>{
    const r=el.getBoundingClientRect();const cs=getComputedStyle(el);
    return {tag:el.tagName,cls:typeof el.className==='string'?el.className.slice(0,110):'',right:Math.round(r.right),left:Math.round(r.left),width:Math.round(r.width),position:cs.position,overflowX:cs.overflowX};
  }).filter(x=>x.right>window.innerWidth+4&&x.width>20).sort((a,b)=>b.right-a.right).slice(0,15);
  const table=document.querySelector('#main-content table');
  const ancestry=[];let current=table;
  while(current && current!==document.documentElement){
    const rect=current.getBoundingClientRect(),computed=getComputedStyle(current);
    ancestry.push({tag:current.tagName,cls:typeof current.className==='string'?current.className.slice(0,115):'',
      clientWidth:current.clientWidth,scrollWidth:current.scrollWidth,
      rectWidth:Math.round(rect.width),rectRight:Math.round(rect.right),
      overflowX:computed.overflowX,minWidth:computed.minWidth,maxWidth:computed.maxWidth,display:computed.display});
    current=current.parentElement;
  }
  const initialX=window.scrollX;
  window.scrollTo({left:9999,top:0,behavior:'instant'});
  const viewportScrolled=window.scrollX;
  window.scrollTo({left:initialX,top:0,behavior:'instant'});
  const localTableScroller=ancestry.find(x=>x.overflowX==='auto' && x.scrollWidth>x.clientWidth);
  return {client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
    bodyScroll:document.body.scrollWidth,viewportScrolled,
    localScroller:localTableScroller??null,nodes,ancestry};
 });
 report.mobile=widths;
 if(widths.viewportScrolled>2){
   report.mobileExperiments=await mobile.evaluate(()=>{
     const trialRules=[
       '#main-content .overflow-x-auto:has(>table){contain:paint!important;}',
       '#main-content section:has(.overflow-x-auto > table){contain:paint!important;}',
       '#main-content{contain:paint!important;}',
       '#root{contain:paint!important;}',
       '.flex.flex-1.overflow-hidden{contain:paint!important;}',
       'body{contain:paint!important;}',
       'html{overflow-x:clip!important;}',
       'body{overflow-x:clip!important;}',
     ];
     const out=[];
     for(const css of trialRules){
       const node=document.createElement('style');node.textContent=css;document.head.append(node);
       window.scrollTo(9999,0);
       out.push({css,scrollWidth:document.documentElement.scrollWidth,viewportScrolled:window.scrollX,
         body:document.body.scrollWidth});
       window.scrollTo(0,0);node.remove();
     }
     return out;
   });
   console.log('MOBILE_CLIP_EXPERIMENTS '+JSON.stringify(report.mobileExperiments));
 }
 // The root is a clipped fullscreen app: programmatic window.scrollTo
 // reports overflow from inner tables, even though touch/trackpad navigation
 // must stay fixed. Test the user's real gesture separately.
 await mobile.mouse.move(4, Math.min(780,widths.client));
 await mobile.mouse.wheel(450,0);
 await delay(180);
 const gestureScrollX=await mobile.evaluate(()=>window.scrollX);
 const mainScrollX=await mobile.locator('#main-content').evaluate(el=>el.scrollLeft);
 report.mobile.gestureScrollX=gestureScrollX;
 report.mobile.mainGestureScrollX=mainScrollX;
 if(gestureScrollX>2 || mainScrollX>2 || widths.bodyScroll>widths.client+2){
   fail('Mobile page shifts horizontally on gesture: '+JSON.stringify({gestureScrollX,widths}));
 }
 if(!widths.localScroller)fail('Full procurement table lacks internal horizontal scrolling: '+JSON.stringify(widths));
 await mobile.screenshot({path:out+'/mobile-pult.png',fullPage:true});
 report.screenshots.push('mobile-pult.png');
 await mobile.close();

 // Shipped HTML must be readable even inside an iOS viewer that blocks JS.
 const noJS=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
 const noJSPage=await noJS.newPage();
 await noJSPage.goto(url,{waitUntil:'domcontentloaded',timeout:40000});
 const fallback=noJSPage.locator('.dash-boot-fallback');
 const noJSVisible=await fallback.count()===1 && await fallback.isVisible();
 const noJSText=await noJSPage.locator('body').innerText();
 report.noJS={visible:noJSVisible,hasBrowserLink:noJSText.includes('Открыть интерактивный Dash в браузере'),
   textExcerpt:noJSText.slice(0,260)};
 if(!noJSVisible || !report.noJS.hasBrowserLink)
   fail('Standalone HTML is blank when JS is blocked: '+JSON.stringify(report.noJS));
 await noJSPage.screenshot({path:out+'/no-js-viewer-fallback.png',fullPage:false});
 report.screenshots.push('no-js-viewer-fallback.png');
 await noJS.close();

 // Direct file:// open is a different scenario from HTTPS (and from
 // iOS Quick Look). Record separately rather than calling it tested.
 if(process.env.DASH_QA_FILE_URL){
   const filePage=await browser.newPage({viewport:{width:1280,height:800}});
   filePage.on('pageerror',e=>report.pageErrors.push('local-file '+String(e)));
   try{
     await filePage.goto(process.env.DASH_QA_FILE_URL,{waitUntil:'domcontentloaded',timeout:40000});
     await filePage.locator('.dash-source-navigation input[data-route]').first().waitFor({state:'attached',timeout:20000});
     report.fileOpen={interactive:true,buttons:await filePage.locator('.dash-source-navigation input[data-route]').count()};
   }catch(e){report.fileOpen={interactive:false,error:String(e).slice(0,500)};}
   await filePage.close();
 }
 if(report.pageErrors.length)fail('Unhandled browser errors: '+report.pageErrors.join(' | ').slice(0,900));
} catch(e){
 if(page) {const dom=await page.evaluate(()=>({body:document.body.innerText.slice(0,900),inputCount:document.querySelectorAll('.dash-source-navigation input').length,headerCount:document.querySelectorAll('header').length})).catch(()=>null);report.bootstrapDiagnostic=dom;}
 fail('Browser audit failed: '+String(e));
}
finally {
 writeFileSync(out+'/qa-summary.json',JSON.stringify(report,null,2));
 await browser.close();
}
console.log('DASH_BROWSER_QA_RESULT '+JSON.stringify({
 pages:report.routes.length,
 subtabs:report.subtabs,
 screens:report.screenshots,
 missing:report.missing,
 hardFailures:report.hardFailures,
 pageErrors:report.pageErrors,
 consoleErrors:report.consoleErrors.slice(0,5),
 mobile:report.mobile,
 noJS:report.noJS,
 fileOpen:report.fileOpen,
 materialSamples:report.materialSamples?.map(x=>({name:x.title,finish:x.finish,chrome:x.nodes.filter(n=>!n.missing).length,navBackground:x.nodes[0]?.image.slice(0,120)})),
 themeSurfaces:report.themeSurfaces,
}));
if(report.hardFailures.length)process.exitCode=1;

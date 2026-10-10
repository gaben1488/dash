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
const report={url,routes:[],subtabs:[],screenshots:[],missing:[],pageErrors:[],hardFailures:[]};
const browser=await chromium.launch({headless:true,executablePath:bin,args:['--no-sandbox','--disable-dev-shm-usage']});
let page;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const fail=(reason)=>report.hardFailures.push(reason);
const openRoute=async(id,label)=>{
 try{
   const button=page.locator('.np-btn').filter({has:page.locator('.np-label',{hasText:label})});
   if(await button.count()!==1){fail('Missing/duplicate real route '+label);return false;}
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
   try{await item.first().click({timeout:4000});await delay(180);}
   catch(e){fail(id+': cannot activate '+name+': '+String(e));}
 }
};
try{
 page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
 page.on('pageerror',e=>report.pageErrors.push(String(e)));
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:40000});
 await page.locator('.np-btn').first().waitFor({timeout:30000});
 await delay(1100);
 const topCount=await page.locator('.np-btn').count();
 if(topCount!==13)fail('Expected 13 original nav buttons; rendered '+topCount);
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
 for(const name of ['Исходная','Минералы','Космос']){
   const btn=family.filter({hasText:name});
   await btn.click();
   const actual=await page.evaluate(()=>document.documentElement.dataset.previewFamily);
   if(actual!==(name==='Исходная'?'original':name))fail('Palette control not applied: '+name);
 }
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
 await mobile.locator('.np-btn').first().waitFor({timeout:30000});
 await delay(700);
 const widths=await mobile.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
 report.mobile=widths;
 if(widths.scroll>widths.client+2)fail('Mobile page overflows: '+JSON.stringify(widths));
 await mobile.screenshot({path:out+'/mobile-pult.png',fullPage:true});
 report.screenshots.push('mobile-pult.png');
 await mobile.close();
 if(report.pageErrors.length)fail('Unhandled browser errors: '+report.pageErrors.join(' | ').slice(0,900));
} catch(e){fail('Browser audit failed: '+String(e));}
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
 mobile:report.mobile,
}));
if(report.hardFailures.length)process.exitCode=1;

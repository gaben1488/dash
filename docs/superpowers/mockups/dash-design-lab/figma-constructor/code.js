/* Конструктор Dash · источник данных: действующий каталог PR #88.
 * Настоящие редактируемые слои, НЕ фото и НЕ точный снимок React.
 * Нет сети, API закупок, удаления и перезаписи ручных правок.
 */
const DATA={"palettes":[{"id":"cosmos","label":"Космос","origin":"zarya-vystavka.html","sections":[{"name":"Пульс","motif":"полярное сияние, зелёные волны","top":"#2f7a50","bottom":"#1f5236","ink":"#ffffff"},{"name":"Отчёт","motif":"Сатурн, золото колец","top":"#8a6a1f","bottom":"#5f470f","ink":"#ffffff"},{"name":"Свод","motif":"небесный свод, густая синь","top":"#35479b","bottom":"#242f6e","ink":"#ffffff"},{"name":"Реестр","motif":"Плеяды, каталог звёзд","top":"#4a6da6","bottom":"#324b78","ink":"#ffffff"},{"name":"Не обеспеченные","motif":"пояс астероидов","top":"#71604a","bottom":"#4b3f2f","ink":"#ffffff"},{"name":"В течение года","motif":"орбита Земли, один оборот","top":"#2e6f7d","bottom":"#1e4c57","ink":"#ffffff"},{"name":"Мониторинг","motif":"Полярная звезда, дозор","top":"#677585","bottom":"#4c5866","ink":"#ffffff"},{"name":"Экономия","motif":"Уран, ледяной изумруд","top":"#438177","bottom":"#2d5a53","ink":"#ffffff"},{"name":"Конкуренция","motif":"метеорный поток, гонка","top":"#91582f","bottom":"#613819","ink":"#ffffff"},{"name":"Дисциплина","motif":"Меркурий, точный круг","top":"#857049","bottom":"#5b4c2f","ink":"#ffffff"},{"name":"Контроль","motif":"Марс, красная стража","top":"#883527","bottom":"#5a2015","ink":"#ffffff"},{"name":"Аналитика","motif":"туманность, синее свечение","top":"#665ca9","bottom":"#46407e","ink":"#ffffff"},{"name":"Система","motif":"обратная сторона Луны","top":"#524c47","bottom":"#34302c","ink":"#ffffff"}]},{"id":"kamchatka","label":"Камчатка","origin":"zarya-vystavka.html","sections":[{"name":"Пульс","motif":"гейзер, пар на рассвете","top":"#f2e8d8","bottom":"#d8c7ac","ink":"#1b170f"},{"name":"Отчёт","motif":"золотая тундра осенью","top":"#e8c56a","bottom":"#c9a144","ink":"#1b170f"},{"name":"Свод","motif":"Тихий океан, гладь","top":"#93b7c9","bottom":"#6c95ab","ink":"#1b170f"},{"name":"Реестр","motif":"берёзовая роща, ряды стволов","top":"#dce8c4","bottom":"#b7c795","ink":"#1b170f"},{"name":"Не обеспеченные","motif":"сухая осока на ветру","top":"#e4d5a8","bottom":"#c2ae76","ink":"#1b170f"},{"name":"В течение года","motif":"год на сопках: зелень в золото","top":"#adc98c","bottom":"#c3ad6e","ink":"#1b170f"},{"name":"Мониторинг","motif":"ясное небо, видимость","top":"#bcd9ef","bottom":"#8fb8d9","ink":"#1b170f"},{"name":"Экономия","motif":"хвоя кедрового стланика","top":"#a9c9a4","bottom":"#7fa878","ink":"#1b170f"},{"name":"Конкуренция","motif":"прибой, пена волн","top":"#aedcd6","bottom":"#79b8ae","ink":"#1b170f"},{"name":"Дисциплина","motif":"кипрейный мёд","top":"#d29a4f","bottom":"#b2803a","ink":"#1b170f"},{"name":"Контроль","motif":"лава под коркой","top":"#e08f76","bottom":"#c46f55","ink":"#1b170f"},{"name":"Аналитика","motif":"сумерки над кальдерой","top":"#b5b9e3","bottom":"#8d97cc","ink":"#1b170f"},{"name":"Система","motif":"серый базальт, галька","top":"#c6cbc0","bottom":"#9aa192","ink":"#1b170f"}]},{"id":"minerals","label":"Минералы","origin":"zarya-vystavka.html","sections":[{"name":"Пульс","motif":"янтарь, тёплая смола","top":"#96591b","bottom":"#66390d","ink":"#ffffff"},{"name":"Отчёт","motif":"самородное золото","top":"#8d6c15","bottom":"#614a0c","ink":"#ffffff"},{"name":"Свод","motif":"лазурит, небесный камень","top":"#4257ad","bottom":"#2b3a7c","ink":"#ffffff"},{"name":"Реестр","motif":"аквамарин, прозрачная вода","top":"#37789e","bottom":"#24506c","ink":"#ffffff"},{"name":"Не обеспеченные","motif":"пирит, обманное золото","top":"#6e6134","bottom":"#49401f","ink":"#ffffff"},{"name":"В течение года","motif":"жадеит, вечная зелень","top":"#55796a","bottom":"#395247","ink":"#ffffff"},{"name":"Мониторинг","motif":"соколиный глаз, дозор","top":"#3c5069","bottom":"#283749","ink":"#ffffff"},{"name":"Экономия","motif":"малахит, слои копилки","top":"#1d7a48","bottom":"#125230","ink":"#ffffff"},{"name":"Конкуренция","motif":"бирюза, живой цвет","top":"#178086","bottom":"#0e5458","ink":"#ffffff"},{"name":"Дисциплина","motif":"тигровый глаз, ровные полосы","top":"#7a5424","bottom":"#523712","ink":"#ffffff"},{"name":"Контроль","motif":"рубин, строгий кармин","top":"#8f2438","bottom":"#611424","ink":"#ffffff"},{"name":"Аналитика","motif":"сапфир, глубина взгляда","top":"#3c3579","bottom":"#28234f","ink":"#ffffff"},{"name":"Система","motif":"платина, тёплый металл","top":"#6b675f","bottom":"#47443d","ink":"#ffffff"}]}],"surfaces":[{"id":"heritage","label":"Тёплый графит","intent":"Базовая спокойная ткань для длинных реестров","dark":{"bg":"#1d1c19","card":"#282620","raised":"#343026","ink":"#f4efe4","muted":"#c5baa7","line":"#60584a"},"light":{"bg":"#f7f4ed","card":"#fffdf8","raised":"#e9e2d6","ink":"#26231e","muted":"#625c52","line":"#beb2a1"}},{"id":"basalt","label":"Базальт","intent":"Сдержанный рельеф для аналитических панелей","dark":{"bg":"#201f1d","card":"#302d29","raised":"#3d3832","ink":"#f6eee2","muted":"#c9bdad","line":"#655c50"},"light":{"bg":"#eae7e1","card":"#f9f7f3","raised":"#ddd7cd","ink":"#282521","muted":"#605950","line":"#b9aea1"}},{"id":"ocean","label":"Тихий океан","intent":"Прохладная нейтраль для широких сводок","dark":{"bg":"#18262a","card":"#24343a","raised":"#30444a","ink":"#f3f6f3","muted":"#bdcece","line":"#5a7477"},"light":{"bg":"#eef5f4","card":"#ffffff","raised":"#dcebea","ink":"#1b3337","muted":"#50686b","line":"#a2bcc0"}},{"id":"parchment","label":"Архивный крем","intent":"Мягкая бумажная подача документов и отчётов","dark":{"bg":"#29241e","card":"#383127","raised":"#453a2c","ink":"#f6ebd4","muted":"#cabb9f","line":"#6c5d45"},"light":{"bg":"#f7efe1","card":"#fff9ee","raised":"#eaddc5","ink":"#31281d","muted":"#695b46","line":"#beaf91"}},{"id":"frost","label":"Северный иней","intent":"Холодная ясность: много статусов, мало декора","dark":{"bg":"#1d242c","card":"#29323b","raised":"#35424f","ink":"#f3f5f8","muted":"#c0cad4","line":"#596b7c"},"light":{"bg":"#f1f5f8","card":"#ffffff","raised":"#e3ebf1","ink":"#25303d","muted":"#52616f","line":"#b1bfcb"}},{"id":"platinum","label":"Тёплая платина","intent":"Сдержанный премиальный язык управляющих приборов","dark":{"bg":"#242320","card":"#33312d","raised":"#413d36","ink":"#f1eee8","muted":"#c9c2b7","line":"#6e675c"},"light":{"bg":"#f2f0ea","card":"#fcfaf6","raised":"#e5e1d8","ink":"#2b2925","muted":"#605b52","line":"#bbb3a5"}},{"id":"ink","label":"Чёрные чернила","intent":"Максимум внимания к содержанию и типографике","dark":{"bg":"#111111","card":"#1e1e1e","raised":"#2e2e2e","ink":"#ffffff","muted":"#c6c6c6","line":"#626262"},"light":{"bg":"#fafafa","card":"#ffffff","raised":"#eeeeee","ink":"#181818","muted":"#555555","line":"#bbbbbb"}}],"finishes":[{"id":"matte","label":"Мат","role":"Массивы текста, таблицы, поля — умолчание","avoid":"Не имитировать лак на строках реестра"},{"id":"candy","label":"Кэнди","role":"Активная вкладка и редкое ключевое действие","avoid":"Не заливать им длинные документы"},{"id":"metallic","label":"Металлик","role":"Щит, приборы и физические рамки","avoid":"Не накладывать на текст таблицы"},{"id":"pearl","label":"Перламутр","role":"Небольшие карточки и второстепенные предметы","avoid":"Не использовать ради украшения ошибок"},{"id":"xirallic","label":"Ксираллик","role":"Единичный акцент премиального прибора","avoid":"Не размножать частицы на 13 вкладках"},{"id":"glass","label":"Жидкое стекло","role":"Контейнер барабанов и стенды","avoid":"Не накладывать поверх другого лака"}],"routes":[{"id":"dashboard","label":"Пульс","owner":"Dashboard.tsx","goal":"Понять ситуацию за выбранный период, раскрыть число и найти исходную строку","protects":["Взаимозависимые фильтры и период","Многомерный круг и журнал разрезов","Достоверность показателей и источники"],"opportunity":"Вернуть крупный круг как ведущий предмет страницы; барабаны, щит и выбор подведов не заменять.","tabs":["Обзор","Детали","Источники"]},{"id":"report","label":"Отчёт","owner":"Report.tsx","goal":"Сформировать и проверить воспроизводимый отчёт, сохранив источники расчётов","protects":["Word-выгрузки и тот же расчёт","Период и версия данных","Формулы, ссылки и контур рекомендаций"],"opportunity":"Сгруппировать подготовку, объяснения и выпуск по стадиям; не переизобретать генератор.","tabs":["В прямом эфире","Архив недели","Рекомендации","Что изменилось"]},{"id":"svod","label":"Свод","owner":"SvodView.tsx","goal":"Сверить показатели с официальными источниками и открыть основание расхождения","protects":["Официальные и пересчитанные значения раздельно","Единицы измерения","Применимость периоду"],"opportunity":"Один читаемый узел сверки «наша сумма / официальная / расхождение / источник».","tabs":["Обзор","Детали","Источники"]},{"id":"data","label":"Реестр","owner":"DataBrowser.tsx","goal":"Найти закупку, понять исходные поля и проверить действие без потери контекста","protects":["№ п/п не равен устойчивому ID","Адрес и формула исходной ячейки","Сортировка, выгрузка, виртуализация"],"opportunity":"Инспектор закупки сбоку только с возвратом фокуса и прежним отбором.","tabs":["Просмотр","Редактор таблиц"]},{"id":"unfunded","label":"Не обеспеченные","owner":"DataBrowser.tsx","goal":"Показать отсутствие финансирования в рамках той же закупочной модели","protects":["Собственная корзина, не новый источник","Нельзя переносить колонку как дефект без доказательства","Сохранение выбранного года"],"opportunity":"Показать причину включения строки в корзину рядом с её адресом и доступным шагом.","tabs":["Просмотр","Редактор таблиц"]},{"id":"yearlong","label":"В течение года","owner":"DataBrowser.tsx","goal":"Работать с сериями закупок в течение года, не объявляя их нарушениями","protects":["«В течение года» — стадия, не сигнал нарушения","Составной номер сохраняется строкой","Не выдавать число без периода"],"opportunity":"Отдельное объяснение стадии, продолжения и группировки без дополнительных штрафных бейджей.","tabs":["Просмотр","Редактор таблиц"]},{"id":"monitoring","label":"Мониторинг","owner":"Monitoring.tsx","goal":"Отследить ход определения поставщика, связь с источником и следующую работу","protects":["Отдельная процедурная книга и её периоды","Исходные деньги в рублях","Связь процедуры и основной строки"],"opportunity":"Свести действия к контексту одной процедуры без дополнительной псевдосущности.","tabs":["В работе","Реестр","Обзор","Связи","Справочники"]},{"id":"economy","label":"Экономия","owner":"Economy.tsx","goal":"Отличить подтверждённую экономию, плановый резерв и невыясненную сумму","protects":["AD-gate и суммы по ФБ/КБ/МБ","Не экономия = план − факт","Подтверждённость метода расчёта"],"opportunity":"Крупный блок «итог, основание, статус подтверждения» без лишнего рейтинга.","tabs":["Обзор","Детали","Источники"]},{"id":"competition","label":"Конкуренция","owner":"Competition.tsx","goal":"Сравнить закупочные способы и увидеть обоснование, без ложных выводов","protects":["ЕП ≠ автоматически нарушение","ЕП и КП не перекрашивать цветом бюджета","Разрезы должны иметь единую базу"],"opportunity":"Больше визуального веса сопоставлению двух методов и одному проверяемому выводу.","tabs":["Обзор","Детали","Источники"]},{"id":"discipline","label":"Дисциплина","owner":"Discipline.tsx","goal":"Найти просрочки и узнать применимый период, статус и ответственное действие","protects":["Ненаступивший период не просрочка","Факт и прогноз разные","Двойной адрес до строки"],"opportunity":"Показывать серьёзность вместе с причиной и следующей операцией.","tabs":["Обзор","Детали","Источники"]},{"id":"quality","label":"Контроль","owner":"Quality.tsx","goal":"Разобрать проблему, происхождение, доверие, замечание и журнал решения","protects":["Замечание, сигнал, рекомендация и факт не одно и то же","Без доказательства нет нарушения","Исторические решения и комментарии не теряются"],"opportunity":"Один понятный рабочий маршрут «обнаружено → доказательство → решение → проверка».","tabs":["Сверка","Качество заполнения","Замечания","Оценка управлений","Рекомендации","Журнал"]},{"id":"analytics","label":"Аналитика","owner":"Analytics.tsx","goal":"Проверить гипотезу на данных с известными базой, временем и неопределённостью","protects":["Процент требует подтверждённого знаменателя","Прогноз не равен факту","Доступ к первичным строкам"],"opportunity":"Пояснения и границы метода сделать доступными без лишней плотности текста.","tabs":["Обзор","Детали","Источники"]},{"id":"settings","label":"Система","owner":"Settings.tsx","goal":"Понять работоспособность источника, изменить настройку с реальным сохранением","protects":["Конфигурация runtime ≠ записана на диск","Ошибочный persist ≠ успех","Недостаток доступа требует конкретной причины"],"opportunity":"Сгруппировать сохранение, подтверждённую версию и шаг восстановления.","tabs":["Источники данных","Соответствие ячеек","Подключение"]}]};
const SCREENS='03 · DASH / Экраны и приёмка',MATERIALS='02 · DASH / Компоненты и лаборатория';
figma.showUI(__html__,{width:424,height:760});
const rgb=h=>({r:parseInt(h.slice(1,3),16)/255,g:parseInt(h.slice(3,5),16)/255,b:parseInt(h.slice(5,7),16)/255});
const fill=h=>[{type:'SOLID',color:rgb(h)}];
function block(parent,name,w,d='VERTICAL',c=null,g=8,p=10){
 const x=figma.createFrame();x.name=name;x.resize(Math.max(w,80),70);x.layoutMode=d;
 x.primaryAxisSizingMode=d==='VERTICAL'?'AUTO':'FIXED';
 x.counterAxisSizingMode=d==='VERTICAL'?'FIXED':'AUTO';
 x.itemSpacing=g;x.paddingLeft=x.paddingRight=x.paddingTop=x.paddingBottom=p;
 x.counterAxisAlignItems='MIN';x.primaryAxisAlignItems='MIN';x.cornerRadius=10;x.clipsContent=false;
 x.fills=c?fill(c):[];parent.appendChild(x);return x;
}
function label(parent,s,w=240,size=12,color='#e5effa',weight='Regular'){
 const x=figma.createText();x.name=String(s).slice(0,50);x.fontName={family:'Inter',style:weight};
 x.fontSize=size;x.resize(Math.max(60,w),24);x.textAutoResize='HEIGHT';
 x.characters=String(s).slice(0,1000);x.fills=fill(color);
 parent.appendChild(x);return x;
}
function setup(cfg){
 const family=DATA.palettes.find(p=>p.id===cfg.family)||DATA.palettes[0];
 const surface=DATA.surfaces.find(p=>p.id===cfg.surface)||DATA.surfaces[0];
 return{family,surface:surface[cfg.mode==='light'?'light':'dark']};
}
function chip(parent,text,w,palette,colors,active,finish){
 const c=block(parent,'Кнопка / '+text,w,'HORIZONTAL',active?palette.top:colors.raised,5,7);
 c.strokes=[{type:'SOLID',color:rgb(palette.top),opacity:active?1:.3}];c.strokeWeight=1;
 if(finish==='glass')c.effects=[{type:'BACKGROUND_BLUR',radius:12,visible:true}];
 if(finish==='metallic'||finish==='pearl')c.effects=[{type:'DROP_SHADOW',color:{...rgb(palette.top),a:.22},offset:{x:0,y:3},radius:8,spread:0,visible:true}];
 label(c,text,w-16,12,active?palette.ink:colors.ink,active?'Semi Bold':'Medium');return c;
}
function textRow(parent,caption,w,color,bg){
 const row=block(parent,'Строка / '+caption,w,'VERTICAL',bg,3,8);
 label(row,caption,w-16,12,color);return row;
}
function buildScreen(page,r,cfg,phase){
 const w=Number(cfg.viewport),mobile=w<700,theme=setup(cfg),s=theme.surface,sections=theme.family.sections;
 const pair=sections.find(x=>x.name===r.label)||sections[0];
 const key='DASH / '+phase+' / '+r.id+' / '+w+' / '+cfg.family+' / '+cfg.surface+' / '+cfg.finish+' / '+cfg.mode+' / '+cfg.density;
 if(page.children.some(x=>x.name===key))return false;
 const root=block(page,key,w,'VERTICAL',s.bg,cfg.density==='compact'?7:12,mobile?10:16);
 root.x=phase==='current'?110:1650;
 root.y=100+page.children.filter(x=>x!==root&&x.name.startsWith('DASH / '+phase+' /'))
   .reduce((last,x)=>Math.max(last,x.y+x.height+90),0);
 label(root,(phase==='current'?'ТЕКУЩИЙ · СХЕМА':'ЦЕЛЕВОЙ · ПРЕДЛОЖЕНИЕ')+' / '+r.label,w-32,mobile?16:21,s.ink,'Semi Bold');
 label(root,r.goal,w-32,12,s.muted);
 const shell=block(root,'Шапка / щит · исходный 3-рядный барабан · фильтры',w-32,'VERTICAL',s.card,7,9);
 const top=block(shell,'Навигация и состояние',w-54,'HORIZONTAL',null,5,4);
 chip(top,'DASH',92,pair,s,true,cfg.finish);
 label(top,'Источник: исходные HTML; страница '+r.label,w-180,11,s.muted);
 const drum=block(shell,'Барабан навигации (3 видимых ряда)',Math.min(760,w-54),'VERTICAL',s.raised,3,5);
 const groups=[['Обзор',[0,1,2]],['Реестры',[3,4,5,6]],['Разборы',[7,8,9]],['Надзор',[10,11,12]]];
 const index=DATA.routes.findIndex(x=>x.id===r.id),group=index<3?0:index<7?1:index<10?2:3;
 const focus=Math.min(2,Math.max(1,group));
 for(let j=focus-1;j<=focus+1;j++){
  const row=block(drum,'Ряд / '+groups[j][0],Math.min(730,w-70),'HORIZONTAL',j===focus?s.card:s.raised,4,3);
  label(row,groups[j][0],mobile?50:70,10,s.muted);
  for(const t of (w<650?groups[j][1].filter((n,k)=>k<2||n===index):groups[j][1])){
   const item=DATA.routes[t],p=sections.find(x=>x.name===item.label)||sections[0];
   chip(row,item.label,Math.max(95,Math.min(151,item.label.length*7+35)),p,s,t===index,cfg.finish);
  }
 }
 label(shell,'Год · квартал · месяцы · неделя     КП/ЕП · ПМ/ТД · ФБ/КБ/МБ     Ставка · единицы · угол отбора',w-56,11,s.muted);
 const body=block(root,'Рабочее место / '+r.owner,w-32,mobile?'VERTICAL':'HORIZONTAL',null,9,0);
 if(!mobile){
  const side=block(body,r.id==='report'?'Собственное оглавление отчёта':'Исходный OrgStrip',194,'VERTICAL',s.card,8,10);
  label(side,r.id==='report'?'Оглавление документа':'Управления и подведы',172,12,s.ink,'Semi Bold');
  for(const n of ['УЭР','УИО','УАГЗО','УФБП','УД','УДТХ','УКСиМП','УО'])label(side,n,172,11,s.muted);
 }else label(body,r.id==='report'?'Оглавление отчёта: собственный выбор раздела':'Организации: выдвижной выбор',w-35,11,s.ink,'Medium');
 const mainW=mobile?w-40:w-240,main=block(body,'Содержимое / '+r.label,mainW,'VERTICAL',null,9,0);
 const tabs=block(main,'Действительные подразделы',mainW,'HORIZONTAL',null,5,0);
 for(const t of r.tabs.slice(0,mobile?2:6))chip(tabs,t,Math.max(95,Math.min(175,35+t.length*7)),pair,s,t===r.tabs[0],cfg.finish);
 const stats=block(main,'Три элемента сводки',mainW,'HORIZONTAL',null,8,0);
 for(const k of ['Исполнение','Источник','Основание']){
  const tile=block(stats,'Карточка '+k,Math.floor((mainW-20)/3),'VERTICAL',s.card,5,12);
  label(tile,k,Math.floor((mainW-20)/3)-24,12,s.ink,'Semi Bold');
  label(tile,'— · тестовые данные',Math.floor((mainW-20)/3)-24,11,s.muted);
 }
 if(r.id==='dashboard'){
  const pie=block(main,phase==='target'?'Крупный ведущий круг · пример':'Существующий круг · пример',mainW,'VERTICAL',s.card,8,12);
  label(pie,'Четыре меры · ГРБС / подведы / бюджеты / время',mainW-24,11,s.ink);
  const ellipse=figma.createEllipse();ellipse.name='Редактируемый круг · НЕ расчёт';
  const size=Math.min(mainW-40,phase==='target'?300:155);
  ellipse.resize(size,size);ellipse.fills=fill(pair.top);pie.appendChild(ellipse);
 }
 const table=block(main,'Основная таблица или аналитический узел',mainW,'VERTICAL',s.card,7,11);
 label(table,r.goal,mainW-26,14,s.ink,'Semi Bold');
 const cols=block(table,'Заголовки таблицы',mainW-22,'HORIZONTAL',s.raised,5,5);
 for(const n of ['№','Предмет / показатель','Статус','Источник'])label(cols,n,Math.max(65,(mainW-40)/4),10,s.ink,'Medium');
 for(const [n,text] of [['173/1','Нужно проверить'],['173/2','Исходник неизвестен']]){
  const row=block(table,'Учебный пример '+n,mainW-22,'HORIZONTAL',null,5,5);
  for(const v of [n,'Демо-позиция',text,'Адрес'])label(row,v,Math.max(65,(mainW-40)/4),11,s.muted);
 }
 const foot=block(root,'Решение · provenance / запреты',w-32,'VERTICAL',s.card,5,10);
 label(foot,'НЕ УТВЕРЖДЕНО: редактируемая схема, НЕ 1:1 фотография React.',w-52,11,s.ink,'Semi Bold');
 label(foot,'Исходник: '+r.owner+' · '+r.opportunity,w-52,10,s.muted);
 for(const q of r.protects.slice(0,3))label(foot,'Сохранить: '+q,w-52,10,s.muted);
 return true;
}
function buildMaterials(page,cfg){
 const t=setup(cfg),s=t.surface,p=t.family.sections.find(x=>x.name==='Реестр'),count=[];
 for(const finish of DATA.finishes){
  const name='DASH / Материал / '+finish.label+' / '+cfg.family+' / '+cfg.surface+' / '+cfg.mode;
  if(page.children.some(x=>x.name===name))continue;
  const f=block(page,name,780,'VERTICAL',s.bg,12,20);
  f.x=120;f.y=100+page.children.filter(x=>x!==f&&x.name.startsWith('DASH / Материал'))
    .reduce((m,x)=>Math.max(m,x.y+x.height+55),0);
  label(f,finish.label+' — '+finish.role,730,18,s.ink,'Semi Bold');
  const line=block(f,'Один материал на четырёх предметах',740,'HORIZONTAL',null,10,0);
  for(const title of ['Барабан','Период','Фильтры','Угол'])chip(line,title,169,p,s,title==='Барабан',finish.id);
  label(f,'Изменяйте заливки и эффекты руками. Данные и Word-документы не покрывать лаком.',730,11,s.muted);
  count.push(f.id);
 }
 return count;
}
figma.ui.onmessage=async cfg=>{
 if(!cfg||!['screens','materials'].includes(cfg.kind))return;
 try{
  await Promise.all(['Regular','Medium','Semi Bold'].map(style=>figma.loadFontAsync({family:'Inter',style})));
  const page=figma.root.children.find(x=>x.name===(cfg.kind==='screens'?SCREENS:MATERIALS));
  if(!page)throw Error('Не обнаружена существующая страница Figma');
  await figma.setCurrentPageAsync(page);
  if(cfg.kind==='materials'){
   const ids=buildMaterials(page,cfg);
   figma.ui.postMessage({message:'Добавлено '+ids.length+' образцов; остальные сохранены. Все слои редактируются в Figma.'});
  }else{
   const chosen=cfg.screen==='all'?DATA.routes:DATA.routes.filter(x=>x.id===cfg.screen);
   if(!chosen.length)throw Error('Неизвестный раздел');
   const phases=cfg.version==='both'?['current','target']:[cfg.version];
   let made=0,kept=0;
   for(const phase of phases)for(const r of chosen)buildScreen(page,r,cfg,phase)?made++:kept++;
   figma.ui.postMessage({message:'Создано '+made+' схем Current/Target; '+kept+' ручных вариантов сохранено. Для точного 1:1 нужен поэкранный браузерный образец.'});
  }
 }catch(e){figma.ui.postMessage({error:true,message:'Отказ: '+String(e?.message||e)+'. Другие кадры не удалены.'});}
};
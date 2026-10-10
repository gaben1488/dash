#!/usr/bin/env node
/**
 * Static full-repository UI dependency inventory, not a runtime acceptance.
 * TypeScript AST: every JSX node, control event, import, store key, CSS token,
 * literal API locator, and the 13 current Header routes. No live API access.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(path.join(root, 'packages/web/package.json'))('typescript');
const unix = p => p.replaceAll(path.sep, '/');
const web = 'packages/web/src/';
const server = 'packages/server/src/routes/';
const ignore = p => /(?:^|\/)(?:__fixtures__|__mocks__|node_modules|dist)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(p);
function collect(dir) {
  const result=[];
  function visit(p) {
    for(const e of fs.readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const f=path.join(p,e.name),rel=unix(path.relative(root,f));
      if(ignore(rel)) continue;
      if(e.isDirectory())visit(f);
      else if(/\.(?:tsx?|css)$/.test(rel))result.push(rel);
    }
  }
  visit(path.join(root,dir));return result;
}
const files=collect(web).concat(collect(server)),fileSet=new Set(files);
function line(ast,node){return ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1;}
function resolve(from,spec){
  let base;
  if(spec.startsWith('@/'))base=web+spec.slice(2);
  else if(spec.startsWith('.'))base=unix(path.normalize(path.join(path.dirname(from),spec)));
  else return null;
  return [base,base+'.tsx',base+'.ts',base+'.css',base+'/index.tsx',base+'/index.ts'].find(x=>fileSet.has(x))??null;
}
const records={};
for(const filename of files) {
  if(!/\.[jt]sx?$/.test(filename))continue;
  const text=fs.readFileSync(path.join(root,filename),'utf8');
  const ast=ts.createSourceFile(filename,text,ts.ScriptTarget.Latest,true,filename.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const imports=[],jsx=[],store=[],api=[],tokens=[];
  function visit(n){
    if(ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier)){
      const target=resolve(filename,n.moduleSpecifier.text);
      if(target)imports.push({path:target,file:filename,line:line(ast,n)});
    }
    if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){
      const tag=n.tagName.getText(ast),attributes=[];
      for(const prop of n.attributes.properties){
        if(!ts.isJsxAttribute(prop))continue;
        const name=prop.name.getText(ast);
        if(/^on[A-Z]/.test(name)||/^(className|title|role|aria-[\w-]+|data-[\w-]+|value|id|unit|scope|source|emptyReason|disabled|metric)$/.test(name)){
          attributes.push({name,file:filename,line:line(ast,prop),
            literal:prop.initializer&&ts.isStringLiteral(prop.initializer)?prop.initializer.text.slice(0,120):undefined});
        }
      }
      jsx.push({tag,file:filename,line:line(ast,n),kind:/^[A-Z]/.test(tag)?'component':'native',attributes});
    }
    if(ts.isCallExpression(n)){
      const fn=n.expression.getText(ast),arg=n.arguments[0];
      if(/^(useStore|useOrgScope|useTheme|useDensity|useFilteredData|useMultiDimMetrics|useDashboardData)$/.test(fn)){
        if(arg&&(ts.isArrowFunction(arg)||ts.isFunctionExpression(arg))){
          const parameter=arg.parameters[0]?.name?.getText(ast);
          function traverse(x){
            if(ts.isPropertyAccessExpression(x)&&x.expression.getText(ast)===parameter){
              store.push({hook:fn,key:x.name.text,file:filename,line:line(ast,x)});
            }
            ts.forEachChild(x,traverse);
          }
          traverse(arg.body);
        } else store.push({hook:fn,key:'(whole state / external context)',file:filename,line:line(ast,n)});
      }
      if(arg&&(ts.isStringLiteral(arg)||ts.isNoSubstitutionTemplateLiteral(arg))&&arg.text.startsWith('/api/')){
        api.push({endpoint:arg.text,evidence:'literal only',file:filename,line:line(ast,n),call:fn});
      } else if(/^(fetch|apiFetch|apiGet|apiPost)$/.test(fn)){
        api.push({endpoint:'(computed at runtime)',evidence:'not resolved',file:filename,line:line(ast,n),call:fn});
      }
    }
    ts.forEachChild(n,visit);
  }
  visit(ast);
  for(const m of text.matchAll(/var\((--[\w-]+)/g))
    tokens.push({name:m[1],file:filename,line:text.slice(0,m.index).split('\n').length});
  records[filename]={file:filename,lines:text.split('\n').length,imports,jsx,store,api,tokens};
}
const routes=[
 ['dashboard','Пульс','Dashboard.tsx'],['report','Отчёт','Report.tsx'],
 ['svod','Свод','SvodView.tsx'],['data','Реестр','DataBrowser.tsx'],
 ['unfunded','Не обеспеченные','DataBrowser.tsx'],
 ['yearlong','В течение года','DataBrowser.tsx'],
 ['monitoring','Мониторинг','Monitoring.tsx'],
 ['economy','Экономия','Economy.tsx'],
 ['competition','Конкуренция','Competition.tsx'],
 ['discipline','Дисциплина','Discipline.tsx'],
 ['quality','Контроль','Quality.tsx'],
 ['analytics','Аналитика','Analytics.tsx'],
 ['settings','Система','Settings.tsx'],
];
const headCode=fs.readFileSync(path.join(root,web+'components/Header.tsx'),'utf8');
const headAst=ts.createSourceFile('Header.tsx',headCode,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const navigation=[];
function navWalk(node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(headAst)==='NAV_ITEMS'&&node.initializer&&ts.isArrayLiteralExpression(node.initializer)){
    for(const item of node.initializer.elements){
      if(!ts.isObjectLiteralExpression(item))continue;
      const found={};
      for(const p of item.properties)if(ts.isPropertyAssignment(p)&&ts.isStringLiteral(p.initializer)){
        const name=p.name.getText(headAst);
        if(name==='id'||name==='label')found[name]=p.initializer.text;
      }
      if(found.id)navigation.push(found);
    }
  }
  ts.forEachChild(node,navWalk);
}
navWalk(headAst);
if(navigation.length!==13)throw Error('Expected 13 actual Header.NAV_ITEMS, found '+navigation.length);
function dependencies(p){
  const seen=new Set(),pending=[p];
  while(pending.length){
    const current=pending.pop();
    if(seen.has(current)||!records[current])continue;
    seen.add(current);
    for(const edge of records[current].imports)pending.push(edge.path);
  }
  return [...seen].sort();
}
const coverage=routes.map(([id,label,owner])=>{
  const entry=web+'pages/'+owner;
  if(!records[entry])throw Error('Missing page owner '+entry);
  if(!navigation.some(x=>x.id===id))throw Error('Missing Header route '+id);
  const deps=dependencies(entry),flat=key=>deps.flatMap(x=>records[x]?.[key]??[]);
  const nodes=flat('jsx'),store=flat('store'),api=flat('api'),token=flat('tokens');
  const actions=nodes.flatMap(n=>n.attributes.filter(a=>/^on[A-Z]/.test(a.name))
    .map(a=>({component:n.tag,control:n.file+':'+n.line,event:a.name})));
  return {id,label,owner:entry,files:deps.length,jsx:nodes.length,
    controlActions:actions.length,
    storeKeys:new Set(store.map(x=>x.hook+':'+x.key)).size,
    staticApi:api.filter(x=>x.evidence==='literal only').length,
    dynamicApi:api.filter(x=>x.evidence!=='literal only').length,
    cssTokens:new Set(token.map(x=>x.name)).size,
    dependencies:deps,actions:actions.slice(0,60),
    api:api.slice(0,160),store:store.slice(0,240),
    componentAddresses:nodes.filter(x=>x.kind==='component').slice(0,75).map(x=>x.file+':'+x.line+' '+x.tag)};
});
const all=Object.values(records),jsxTotal=all.reduce((n,x)=>n+x.jsx.length,0);
const report={schema:'dash-ui-atom-map-v1',sha:process.env.GITHUB_SHA??'(local)',
  generated:new Date().toISOString(),
  limitation:'Static TypeScript AST; call paths, dynamic API, actual Sheet data, computed CSS, permissions and conditional runtime branches require E2E/manual evidence.',
  scanned:{sourceFiles:files.length,parsedFiles:all.length,jsx:jsxTotal},
  navigation,coverage,files:records};
const rows=[
'# Dash — атомарная карта интерфейса и связей','',
'> Автоматический исходниковый срез '+report.sha+'; '+report.generated+'. Ссылка на полное машинное доказательство: ui-atoms.json в артефакте CI. Не является runtime-аттестацией.',
'',
'- Прочитано '+files.length+' TS/TSX/CSS; разобрано AST '+all.length+' файлов; найдено '+jsxTotal+' элементов JSX.',
'- Список 13 вкладок проверен по Header.NAV_ITEMS; все 13 привязаны к реальным файлам-владельцам.',
'- Источники, фильтры, права, условные состояния и координаты в браузере требуют отдельного E2E/readback.',
'',
'| Вкладка | Реальный файл | Зависимостей | JSX | Действий в компонентах | store-ключей | API литералов |',
'|---|---|---:|---:|---:|---:|---:|'];
for(const p of coverage)rows.push('| '+p.label.replaceAll('|','/')+' | '+p.owner+' | '+p.files+' | '+p.jsx+' | '+p.controlActions+' | '+p.storeKeys+' | '+p.staticApi+' |');
rows.push('','## Инварианты перед переплавкой','',
'- Реестр/Не обеспеченные/В течение года делят DataBrowser.tsx, но различают собственную семантику отбора.',
'- Header/OrgStrip/барабаны/фильтры являются частью реального App и не заменяются скриншотом учебной лаборатории.',
'- Круг DrillPieChart сохраняет стек разрезов, статистическую семантику, периоды, единицы, контроль полноты и точки возврата.',
'- Цвета данных, бюджеты и сигнал опасности нельзя менять вместе с цветом выбранной вкладки.',
'- Путь к исходной ячейке, формула, примечание, обсуждение, момент чтения и правка — отдельные данные; наличие кнопки Origin само по себе не доказывает полноту.',
'','## Как пользоваться','',
'1. Запустить node scripts/dash-ui-atom-inventory.mjs и открыть ui-atoms.json из папки artifacts/dash-ui-atom-inventory.',
'2. По компоненту найти files[path].jsx/store/api/imports и coverage[].dependencies, затем составить матрицу до/после.',
'3. Любую замену принять только после E2E на настоящем срезе и браузерных проверок 390/768/1280/200% + отказ/пустота/клавиатура.',
'');
const markdown=rows.join('\n');
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=path.resolve(process.argv[2]??'artifacts/dash-ui-atom-inventory');
  fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'ui-atoms.json'),JSON.stringify(report,null,2));
  fs.writeFileSync(path.join(output,'ui-atoms.md'),markdown);
  console.log('Dash UI atomic map: '+files.length+' files / '+jsxTotal+' JSX / '+coverage.length+' routes');
}
export { report, rows };

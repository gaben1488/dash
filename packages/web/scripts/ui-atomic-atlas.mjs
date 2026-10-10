/**
 * Read-only AST audit. Do not feed it Google Sheets or production data.
 * JSX addresses: code path + line, not persistent IDs for public records.
 * Run from packages/web with Node 22 and local TypeScript dependency.
 */
import ts from 'typescript';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';

const self = fileURLToPath(import.meta.url);
const web = path.resolve(path.dirname(self), '..');
const root = path.join(web, 'src');
const slash = x => x.split(path.sep).join('/');
const short = (s, limit = 170) => String(s ?? '').replace(/\s+/g,' ').trim().slice(0,limit);

async function walk(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes:true })) {
    if (['dist','node_modules'].includes(entry.name)) continue;
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await walk(filename));
    else if (/\.[jt]sx?$/.test(entry.name)) output.push(filename);
  }
  return output.sort();
}
function resolveImport(file, source) {
  if (source.startsWith('@/')) return 'packages/web/src/' + source.slice(2);
  if (source.startsWith('.')) return 'packages/web/' + slash(path.relative(web,path.resolve(path.dirname(file),source)));
  return source;
}
function attributesOf(node, ast) {
  const attrs = [];
  for (const a of node.attributes.properties) {
    if (!ts.isJsxAttribute(a)) { attrs.push({key:'spread',value:short(a.getText(ast))}); continue; }
    let value = 'true';
    if (a.initializer && ts.isStringLiteral(a.initializer)) value = a.initializer.text;
    else if (a.initializer && ts.isJsxExpression(a.initializer)) value = short(a.initializer.expression?.getText(ast),240);
    attrs.push({key:a.name.text,value});
  }
  return attrs;
}
function ownership(node, fallback) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
     (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return node.name.text;
  return fallback;
}
function inspect(file, code) {
  const fileName = 'packages/web/' + slash(path.relative(web,file));
  const ast = ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const imports=[],atoms=[],owners=new Set(),components=new Set(),tokens=new Set();
  for (const m of code.matchAll(/var\((--[a-zA-Z0-9_-]+)/g)) tokens.add(m[1]);
  function visit(node, owner) {
    const current = ownership(node, owner);
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const mod = node.moduleSpecifier.text, bindings=node.importClause?.namedBindings;
      imports.push({source:mod,to:resolveImport(file,mod),
        symbols:bindings && ts.isNamedImports(bindings)?bindings.elements.map(e=>e.name.text):[]});
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag=node.tagName.getText(ast),line=ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1;
      const attrs=attributesOf(node,ast),d=Object.fromEntries(attrs.map(a=>[a.key,a.value]));
      const event=attrs.filter(a=>/^on[A-Z]/.test(a.key) || ['href','to'].includes(a.key));
      const bindings=attrs.filter(a=>['dataKey','metric','value','scope','unit','label','title','aria-label','role','page','href','rows','data','onClick','onChange','onSelect'].includes(a.key));
      const parent=node.parent;
      const text=parent && ts.isJsxElement(parent)
        ? short(parent.children.filter(ts.isJsxText).map(x=>x.getText(ast)).join(' ')) : '';
      const kind=/^[a-z]/.test(tag)?(/^(svg|path|rect|circle|line|text|linearGradient|stop|defs|g)$/.test(tag)?'svg':'html'):'component';
      atoms.push({
        address:fileName+':'+line,order:atoms.length+1,line,owner:current,
        kind,tag,text,css:short(d.className,260),
        aria:{label:d['aria-label']??'',role:d.role??'',expanded:d['aria-expanded']??'',pressed:d['aria-pressed']??''},
        event,bindings,
      });
      owners.add(current);
      if(kind==='component')components.add(tag);
    }
    ts.forEachChild(node, child=>visit(child,current));
  }
  visit(ast,'module');
  return {path:fileName,atoms,imports,owners:[...owners].sort(),components:[...components].sort(),
    tokens:[...tokens].sort(),eventCount:atoms.filter(a=>a.event.length>0).length};
}
function graphOf(files) {
  const known=new Map(files.map(f=>[f.path.replace(/\.[jt]sx?$/,''),f.path]));
  const edges=[],backlinks=new Map();
  for(const f of files) for(const x of f.imports) {
    const to=known.get(x.to)??known.get(x.to+'/index')??x.to;
    edges.push({from:f.path,to,source:x.source,symbols:x.symbols,known:known.has(x.to)||known.has(x.to+'/index')});
    if(!backlinks.has(to)) backlinks.set(to,new Set());
    backlinks.get(to).add(f.path);
  }
  return {edges,inbound:[...backlinks.entries()].map(([file,callers])=>({file,callers:[...callers].sort()}))
    .sort((a,b)=>b.callers.length-a.callers.length)};
}
function human(atlas) {
  const q=String.fromCharCode(96), md=[
    '# Живой атомарный атлас React-интерфейса Dash',
    '',
    'Вычисляется из актуальных TSX/JSX без запросов к Google Sheets, API и БД. Адрес file:line — место в коде, а не идентификатор закупки.',
    '',
    '## Измеренное покрытие',
    '',
    'Просмотрено файлов: '+atlas.summary.files+'; с JSX: '+atlas.summary.jsxFiles+'; атомов JSX: '+atlas.summary.atoms+'; обработчиков/ссылок: '+atlas.summary.interactive+'; граф связей: '+atlas.graph.edges.length+'.',
    '',
    '| Исходный файл | Элементов | С действиями | Теги компонентов |',
    '|---|---:|---:|---|',
  ];
  for (const f of atlas.files.filter(f=>f.path.startsWith('packages/web/src/pages/')&&f.atoms.length)
    .sort((a,b)=>b.atoms.length-a.atoms.length)) {
    md.push('| '+q+f.path+q+' | '+f.atoms.length+' | '+f.eventCount+' | '+f.components.slice(0,8).join(', ')+' |');
  }
  md.push('', '## Самые связанные компоненты',
    '', '| Исходник | Сколько других файлов импортирует |','|---|---:|');
  for(const row of atlas.graph.inbound.slice(0,28)) md.push('| '+q+row.file+q+' | '+row.callers.length+' |');
  md.push('', '## Что находится в подробном JSON', '',
    'Каждый JSX-тег по адресу файла/строки, владеющая функция, текст, aria, обработчики, выражения значений/метрик, CSS-класс; список прямых импортов и граф вызывающих.',
    '',
    'Скрипт является источником актуального инвентаря. Не редактировать сгенерированный JSON руками и не считать наличием элемента доказательство его работы в браузере.',
    'Для миграций сверять с живыми картами в docs/superpowers/audits/2026-08-20-cards-map и мандатом: задача человека → данные → событие → переход → строка-основание → сохранность контекста → визуальная регрессия.',
    '',
    'Автоматическая эвристика НЕ подтверждает серверный provenance, тему порталов, настоящий keyboard focus, 200% масштаб и считываемость. Этим занимается browser QA.',
  );
  return md.join('\n')+'\n';
}
export async function buildAtlas() {
  const files=[];
  for(const file of await walk(root)) files.push(inspect(file,await readFile(file,'utf8')));
  const graph=graphOf(files);
  const summary={files:files.length,jsxFiles:files.filter(f=>f.atoms.length).length,
    atoms:files.reduce((n,f)=>n+f.atoms.length,0),interactive:files.reduce((n,f)=>n+f.eventCount,0)};
  for(const name of ['Dashboard.tsx','Report.tsx','DataBrowser.tsx','Monitoring.tsx','Quality.tsx',
    'Header.tsx','OrgStrip.tsx','DrillPieChart.tsx']) {
    if(!files.some(f=>f.path.endsWith('/'+name)&&f.atoms.length)) throw Error('Missing UI owner '+name);
  }
  if(summary.atoms<700 || summary.jsxFiles<40) throw Error('Incomplete UI tree '+JSON.stringify(summary));
  return {schema:1,summary,graph,files};
}
async function main() {
  const result=await buildAtlas();
  const target=process.argv[2]?path.resolve(process.argv[2]):path.join(web,'artifacts','ui-atomic-atlas');
  await mkdir(path.dirname(target),{recursive:true});
  await Promise.all([
    writeFile(target+'.json',JSON.stringify(result,null,2)+'\n','utf8'),
    writeFile(target+'.md',human(result),'utf8'),
  ]);
  console.log('UI_ATLAS_PASS '+JSON.stringify({...result.summary,output:target}));
}
if(process.argv[1] && path.resolve(process.argv[1])===self) main().catch(e=>{console.error(e);process.exitCode=1;});

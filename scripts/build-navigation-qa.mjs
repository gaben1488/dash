/** Offline, synthetic-only fixture builder. No HTTP or application API calls. */
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join,extname} from 'node:path';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {zipStored} from './navigation-qa-zip.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const web=join(root,'packages/web');
const arg=process.argv.indexOf('--out');
const out=arg<0?join(web,'navigation-qa.html'):resolve(process.argv[arg+1]);
if(extname(out)!=='.html')throw Error('OFFLINE_QA_OUTPUT_REQUIRES_HTML');
const req=createRequire(join(web,'package.json'));
const {build}=await import(req.resolve('vite'));
const sources=['scripts/build-navigation-qa.mjs','scripts/navigation-qa-zip.mjs','packages/web/scripts/navigation-qa-entry.tsx','packages/web/scripts/navigation-qa.css','packages/web/src/components/Header.tsx','packages/web/src/components/ThemeProvider.tsx','packages/web/src/components/live/ProvenanceHub.tsx','packages/web/src/components/live/UpdateFeed.tsx','packages/web/src/store.ts','packages/web/src/index.css','packages/web/tailwind.config.ts','packages/web/postcss.config.js','packages/web/package.json','pnpm-lock.yaml'];
async function sourceFiles(dir){
 const entries=await readdir(join(root,dir),{withFileTypes:true});
 return (await Promise.all(entries.map(entry=>entry.isDirectory()?sourceFiles(dir+'/'+entry.name):[dir+'/'+entry.name]))).flat();
}
sources.push(...(await Promise.all(['packages/web/src','packages/shared/src','packages/core/src'].map(sourceFiles))).flat());
const uniqueSources=[...new Set(sources)].sort();
const hashes=Object.fromEntries(await Promise.all(uniqueSources.map(async name=>[name,createHash('sha256').update(await readFile(join(root,name))).digest('hex')])));
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const digest=createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
const provenance={sha,digest,sources:hashes,syntheticOnly:true};
process.chdir(web); // Tailwind uses the existing workspace config/content paths.
const result=await build({configFile:false,root:web,publicDir:false,logLevel:'error',resolve:{alias:{'@':join(web,'src'),'@aemr/shared':join(root,'packages/shared/src/index.ts'),'@aemr/core':join(root,'packages/core/src/index.ts')}},esbuild:{jsx:'automatic'},define:{'process.env.NODE_ENV':'"production"','__QA_PROVENANCE__':JSON.stringify(provenance)},build:{write:false,assetsInlineLimit:Infinity,cssCodeSplit:false,minify:'esbuild',lib:{entry:join(web,'scripts/navigation-qa-entry.tsx'),formats:['iife'],name:'DashNavigationQA'},rollupOptions:{output:{inlineDynamicImports:true}}}});
const output=Array.isArray(result)?result.flatMap(r=>r.output):result.output;
const chunks=output.filter(x=>x.type==='chunk');
if(chunks.length!==1)throw Error('OFFLINE_QA_REQUIRES_SINGLE_BUNDLE');
const assets=new Map(output.filter(x=>x.type==='asset').map(x=>[x.fileName,x.source]));
let css=output.filter(x=>x.type==='asset'&&extname(x.fileName)==='.css').map(x=>String(x.source)).join('\n');
for(const [name,data] of assets){if(extname(name)==='.woff2'){const uri='data:font/woff2;base64,'+Buffer.from(data).toString('base64');css=css.split('/'+name).join(uri).split('./'+name).join(uri).split(name).join(uri);}}
if(/url\((?:["']?)(?:https?:|\/assets\/)/u.test(css))throw Error('OFFLINE_QA_EXTERNAL_ASSET');
const safe=v=>v.replaceAll('</script','<\\/script');
const html=`<!doctype html><html lang="ru" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="dash-source-sha" content="${sha}"><meta name="dash-source-digest" content="${digest}"><title>Dash — интерактивная линейка</title><style>${css}</style></head><body><div id="root"></div><script id="qa-provenance" type="application/json">${safe(JSON.stringify(provenance))}</script><script>${safe(chunks[0].code)}</script></body></html>`;
await mkdir(dirname(out),{recursive:true});await writeFile(out,html);
await writeFile(out.replace(/\.html$/u,'.zip'),zipStored('navigation-qa.html',Buffer.from(html)));
console.log(JSON.stringify({html:out,bytes:Buffer.byteLength(html),sourceSha:sha,sourceDigest:digest,syntheticOnly:true}));

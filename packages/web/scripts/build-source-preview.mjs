/**
 * Pack the Vite bundle of the REAL Dash app into a self-contained HTML file.
 * Never substitute preview pages, synthetic text-based copies or remote CDN.
 * Run only after a successful Vite preview build.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const dir=resolve('packages/web/dist-preview');
const entry=resolve(dir,'preview.html');
const out=resolve('docs/superpowers/mockups/dash-source-parity/Dash-source-bound-preview.html');
let html=readFileSync(entry,'utf8');
let css=0,js=0;
const safe=(rel)=>{
  const path=resolve(dir,rel.replace(/^\.\//,''));
  if(!path.startsWith(dir+'/'))throw new Error('Bundled path escapes dist-preview: '+rel);
  return path;
};
// Vite 6 emits these attributes around the single CSS & single JS asset.
html=html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g,(tag)=>{
  const href=tag.match(/\bhref="([^"]+)"/)?.[1];
  if(!href)throw new Error('Stylesheet link missing href: '+tag);
  if(!href.endsWith('.css'))throw new Error('Unexpected non-CSS stylesheet: '+href);
  css++;
  return '<style data-bundle="dash-real-pages">\n'+readFileSync(safe(href),'utf8')+'\n</style>';
});
html=html.replace(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,(_all,src)=>{
  if(!src.endsWith('.js'))throw new Error('Unexpected module script: '+src);
  js++;
  return '<script type="module" data-bundle="dash-real-pages">\n'+
    readFileSync(safe(src),'utf8').replace(/<\/script/gi,'<\\/script')+'\n</script>';
});
// Modulepreload is unnecessary after everything is inlined.
html=html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g,'');
if(css!==1 || js!==1)throw new Error('Expected one production CSS and JS bundle; got CSS='+css+', JS='+js);
if(/(?:src|href)="\.\/assets\//.test(html))throw new Error('Non-inlined Vite assets remain in standalone HTML');
// The preview must explicitly retain the entire production application entry.
if(!html.includes('data-bundle="dash-real-pages"'))throw new Error('Missing embedded real frontend');
mkdirSync(dirname(out),{recursive:true});
writeFileSync(out,html,'utf8');
const bytes=statSync(out).size;
console.log(JSON.stringify({output:out,bytes,css,js,entry:'packages/web/src/preview/entry.ts',
  pages:'packages/web/src/App.tsx (real source)',backend:'synthetic/GET-only'},null,2));

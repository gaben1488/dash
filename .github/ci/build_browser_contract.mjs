/** Bundle the reviewed browser consumers, not the installed server's old schema. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { appendFile } from 'node:fs/promises';
import { brotliCompressSync, constants } from 'node:zlib';
const require = createRequire(import.meta.url);
const vite = require.resolve('vite/package.json', {paths:[resolve('packages/web')]});
const {build} = createRequire(vite)('esbuild');
const bundled=await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
export {aggregateNodeTotals} from './packages/web/src/lib/selectors/totals-aggregation';
export {SelectedReportReleaseStatusSchema} from './packages/shared/src/schemas';
export {parseRefreshPassport} from './packages/web/src/pages/Settings.logic';
export {digestLines,entryAddress,entryChangeLine,entryWhoWhen} from './packages/web/src/components/live/change-story-text';
`},bundle:true,platform:'node',format:'esm',minify:true,write:false});
const encoded=brotliCompressSync(bundled.outputFiles[0].contents,{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).toString('base64');
if(encoded.length>280000)throw Error('BROWSER_CONTRACT_TRANSPORT_TOO_LARGE');
// Each environment value stays below Linux's per-argument limit. Only reviewed
// public code is transported; no API response or production credential.
for(let i=0;i<4;i++)await appendFile(process.env.GITHUB_ENV,`BROWSER_CONTRACT_BR_${i}=${encoded.slice(i*70000,(i+1)*70000)}\n`);
console.log('candidate_browser_contract=BUNDLED bytes='+encoded.length);

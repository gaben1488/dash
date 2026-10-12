/** Bundle the reviewed browser consumers, not the installed server's old schema. */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { writeFile, appendFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
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
const packed=brotliCompressSync(bundled.outputFiles[0].contents,{params:{[constants.BROTLI_PARAM_QUALITY]:11}});
// Transfer only reviewed public code as a file. Remote sshd passes its whole
// command to sh -c; embedding the bundle exceeds Linux's single-argument limit.
await writeFile('.github/ci/_browser-contract.br',packed);
console.log('candidate_browser_contract=BUNDLED bytes='+packed.length);
if(process.env.GITHUB_ENV) {
 const probe=await readFile('.github/ci/header_api_probe.mjs');
 await appendFile(process.env.GITHUB_ENV,`HEADER_PROBE_SHA256=${createHash('sha256').update(probe).digest('hex')}\nBROWSER_CONTRACT_SHA256=${createHash('sha256').update(packed).digest('hex')}\n`);
}

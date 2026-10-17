import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('builds one offline actual-Header artifact with source provenance and no static gallery',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dash-navigation-build-'));
 try {
  const out=join(dir,'navigation-qa.html');
  const result=spawnSync(process.execPath,['scripts/build-navigation-qa.mjs','--out',out],{encoding:'utf8',timeout:60000});
  assert.equal(result.status,0,result.stderr);
  const html=await readFile(out,'utf8');
  assert.match(html,/name="dash-source-sha" content="[a-f0-9]{40}"/);
  assert.match(html,/name="dash-source-digest" content="[a-f0-9]{64}"/);
  assert.ok(html.length<9*1024*1024,'single actual-Header build should not embed static PNG gallery');
  assert.doesNotMatch(html,/__qaGallery|data:image\/png|<script[^>]+src=/);
  assert.match(html,/data:font\/woff2;base64,/);
  assert.match(html,/id="qa-provenance"/);
  const provenance=JSON.parse(html.match(/<script id="qa-provenance" type="application\/json">(.*?)<\/script>/s)[1]);
  for(const consumer of ['packages/web/src/components/live/CommentFeed.tsx','packages/web/src/api.ts','packages/core/src/pipeline/signals.ts','packages/shared/src/index.ts'])assert.ok(provenance.sources[consumer],consumer);
  assert.ok((await readFile(join(dir,'navigation-qa.zip'))).length>1000);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('refuses ambiguous output paths instead of overwriting HTML with ZIP',()=>{
 const result=spawnSync(process.execPath,['scripts/build-navigation-qa.mjs','--out','/tmp/qa-without-extension'],{encoding:'utf8',timeout:60000});
 assert.notEqual(result.status,0);assert.match(result.stderr,/OFFLINE_QA_OUTPUT_REQUIRES_HTML/);
});

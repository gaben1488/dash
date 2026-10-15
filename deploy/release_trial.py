#!/usr/bin/env python3
"""Independent one-clone native compatibility and actual full recovery trial."""
import argparse
import json
import os
import shutil
import sys
import tempfile
import types
from pathlib import Path

import release_recovery as recovery

CLONE = Path('/var/lib/aemr/release-trial-clone')
NODE_UID = 1000
SOURCE_GATE = Path('/usr/local/libexec/aemr/source_ci_gate.py')
# Docker --env-file is line based; preserve the captured Compose environment
# through private stdin instead. exec keeps the actual native program as PID1,
# and only its bounded original stdin is forwarded after environment decoding.
NATIVE_LAUNCHER = r'''import json,os,sys
body=sys.stdin.buffer.read(1048577)
if len(body)>1048576:raise ValueError('NATIVE_ENV_PAYLOAD_TOO_LARGE')
payload=json.loads(body)
forward=payload['stdin'].encode('utf-8')
if len(forward)>4096:raise ValueError('NATIVE_STDIN_TOO_LARGE')
os.environ.update(payload['environment'])
reader,writer=os.pipe()
with os.fdopen(writer,'wb') as stream:stream.write(forward)
os.dup2(reader,0)
os.close(reader)
os.execvpe(sys.argv[1],sys.argv[1:],os.environ)
'''

NATIVE_PROGRAM = r'''(async()=>{
const fs=await import('node:fs');const crypto=await import('node:crypto');
const {spawnSync}=await import('node:child_process');
const binding=JSON.parse(fs.readFileSync(0,'utf8'));const candidate=process.argv[1]==='candidate';
if(!process.env.AEMR_API_KEY)throw Error('auth');
const {createApp}=await import('./src/app.ts');const app=await createApp({logger:false});
try {
 const headers={authorization:'Bearer '+process.env.AEMR_API_KEY};
 const health=await app.inject({method:'GET',url:'/api/health',headers});if(health.statusCode!==200)throw Error('health');
 const status=await app.inject({method:'GET',url:'/api/report-releases',headers});
 if(status.statusCode!==200||status.rawPayload.length>32*1024*1024)throw Error('status');
 const value=JSON.parse(status.payload);if(!value.latest)throw Error('latest');
 if(candidate){
  const shared=await import('@aemr/shared');
  if(!shared.ReportReleaseStatusSchema.safeParse(value).success)throw Error('schema');
  function visit(root){
   if(!fs.existsSync(root))throw Error('history');
   if(fs.lstatSync(root).isSymbolicLink())throw Error('symlink');
   for(const entry of fs.readdirSync(root,{withFileTypes:true})){
    const file=root+'/'+entry.name;if(entry.isSymbolicLink())throw Error('symlink');
    if(entry.isDirectory())visit(file);
    else if(entry.isFile()&&entry.name==='report_model.json'){
     if(fs.statSync(file).size>134217728)throw Error('size');
     const model=JSON.parse(fs.readFileSync(file,'utf8'));
     if(model.automation_assurance!==undefined&&!shared.ReportAssuranceSchema.safeParse(model.automation_assurance).success)throw Error('historyschema');
    }
   }
  }
  visit('/app/packages/server/data/reports/published/releases');
  const archives='/app/packages/server/data/reports/archives';
  for(const name of fs.readdirSync(archives))if(name.startsWith('WEEKLY-'))visit(archives+'/'+name);
 }
 for(const view of ['main','supplement','operational']){
  const response=await app.inject({method:'GET',url:'/api/report-releases/'+binding.release_id+'/'+view+'.docx',headers});
  const body=response.rawPayload;if(response.statusCode!==200||body.length>33554432)throw Error('word');
  const checked=spawnSync('/opt/report-env/bin/python',['-c',"import io,sys,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));assert z.testzip() is None and 'word/document.xml' in z.namelist()"],{input:body,timeout:20000,stdio:['pipe','pipe','pipe']});
  if(checked.status!==0||crypto.createHash('sha256').update(body).digest('hex')!==binding.sha256[view])throw Error('word');
 }
}finally{await app.close();}
console.log(candidate?'CANDIDATE_TRIAL_PASS':'PREVIOUS_TRIAL_PASS');
process.exit(0);
})().catch(error=>{
 const code=['auth','health','status','latest','schema','history','symlink','size','historyschema','word'].includes(error?.message)?error.message:'runtime';
 console.error('NATIVE_TRIAL_FAILURE='+code);
 process.exit(2);
});'''


def check_source_ci(plan):
    body = recovery.read_owned(recovery.RUNTIME_DIR / 'source-ci.json')
    value = json.loads(body)
    module = types.ModuleType('aemr_source_ci_gate')
    code = recovery.read_owned(SOURCE_GATE, private=False)
    exec(compile(code, str(SOURCE_GATE), 'exec'), module.__dict__)  # noqa: S102 - fixed root-owned gate
    if (not isinstance(value, dict) or set(value) != {'run', 'jobs', 'candidate_image_binding'}
            or not module.source_ci_passed(value['run'], value['jobs'], plan['release_sha'])
            or value['candidate_image_binding'] != {'source_sha': plan['release_sha'], 'images': plan['candidate_images']}):
        recovery.fail('RELEASE_SOURCE_CI_INVALID')
    return recovery.digest(body)


def module_digest(path):
    return recovery.digest(recovery.read_owned(Path(path), private=False))


def native_environment(plan, kind):
    name = 'candidate-compose.json' if kind == 'candidate' else 'compose.json'
    body = recovery.read_owned(recovery.RUNTIME_DIR / name)
    if recovery.digest(body) != plan['config_sha256'][name]:
        recovery.fail('RELEASE_CONFIG_CHANGED')
    resolved = json.loads(body)
    environment = resolved['services']['server'].get('environment', {})
    if (not isinstance(environment, dict) or not isinstance(environment.get('AEMR_API_KEY'), str)
            or not environment['AEMR_API_KEY']):
        recovery.fail('RELEASE_TRIAL_AUTH_UNAVAILABLE')
    for key, value in environment.items():
        if (not isinstance(key, str) or not key or any(char in key for char in ('=', '\n', '\r', '\0'))
                or not isinstance(value, str) or '\0' in value):
            recovery.fail('RELEASE_TRIAL_ENV_INVALID')
    return {**environment, 'SOURCE_AUTO_REFRESH_MINUTES': '0'}


class ReleaseTrial:
    def __init__(self, command=recovery.docker):
        self.command = command

    def _absent_container(self, name):
        if self.command(['ps', '--all', '--quiet', '--no-trunc', '--filter', f'name=^/{name}$']).strip():
            recovery.fail('RELEASE_TRIAL_CONTAINER_PRESENT')

    def run(self, plan):
        plan = recovery.validate_plan(plan)
        source_ci_sha256 = check_source_ci(plan)
        executor = recovery.ReleaseRecovery(self.command)
        backup, _ = executor._files(plan)
        environments = {kind: native_environment(plan, kind) for kind in ('candidate', 'previous')}
        recovery.private_directory(CLONE.parent)
        if not CLONE.is_dir() or any(path.is_symlink() for path in (CLONE, *CLONE.parents)):
            recovery.fail('RELEASE_TRIAL_CLONE_UNSAFE')
        name = 'aemr-release-trial-' + plan['release_sha']
        self._absent_container(name)
        for image in set(plan['images'].values()) | set(plan['candidate_images'].values()):
            record = json.loads(self.command(['image', 'inspect', image]))[0]
            if record.get('Id') != image:
                recovery.fail('RELEASE_TRIAL_IMAGE_UNAVAILABLE')
        files = json.loads((backup/'manifest.json').read_bytes())['files']
        if any(type(info.get('bytes')) is not int or info['bytes']<0 for info in files.values()):
            recovery.fail('RELEASE_CHECKPOINT_CHANGED')
        scratch_budget = max(128*1024**2,2*sum(info['bytes'] for path,info in files.items()
            if path.startswith('reports/published/publications.sqlite')))
        if shutil.disk_usage(CLONE.parent).free<sum(info['bytes'] for info in files.values())+scratch_budget+1024**3:
            recovery.fail('RELEASE_TRIAL_STORAGE_INSUFFICIENT')
        # Exact full clone once; the second restore below exercises real recovery
        # after BOTH runtimes have used this same clone, never a second 24GiB copy.
        initial = executor.backup_tool.restore_state(backup, CLONE, plan['manifest_sha256'])
        recovery.validate_restore_proof(initial)
        os.chown(CLONE, NODE_UID, NODE_UID)
        os.chmod(CLONE, 0o700)
        common = ['run', '--rm', '--name', name, '--network', 'none', '--read-only', '--user', '1000:1000',
                  '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m', '--mount',
                  f'type=bind,src={CLONE},dst=/app/packages/server/data',
                  '--env', 'SOURCE_AUTO_REFRESH_MINUTES=0', '--workdir', '/app/packages/server']
        self.command([*common, '-i', '--entrypoint', '/opt/report-env/bin/python', plan['candidate_images']['server'],
                      '-c', NATIVE_LAUNCHER, '/opt/report-env/bin/proc-report',
                      'initialize-publication-readers', '--state', '/app/packages/server/data/reports'], timeout=120,
                     input=json.dumps({'environment': environments['candidate'], 'stdin': ''}))
        for kind, image, expected in [('candidate', plan['candidate_images']['server'], 'CANDIDATE_TRIAL_PASS'),
                                      ('previous', plan['images']['server'], 'PREVIOUS_TRIAL_PASS')]:
            self._absent_container(name)
            selected = common
            scratch = None
            if kind=='previous':
                # Prior production has disk-backed /tmp. Its unchanged reader
                # must not be tested under the candidate's new 128 MiB ceiling.
                if shutil.disk_usage(CLONE.parent).free<scratch_budget+1024**3:
                    recovery.fail('RELEASE_TRIAL_STORAGE_INSUFFICIENT')
                scratch = Path(tempfile.mkdtemp(prefix='previous-native-',dir=CLONE.parent))
                os.chown(scratch,NODE_UID,NODE_UID)
                selected = common.copy();index = selected.index('--tmpfs');del selected[index:index+2]
                selected += ['--mount',f'type=bind,src={scratch},dst=/tmp']
            value = self.command([*selected, '-i', '--entrypoint', '/opt/report-env/bin/python', image,
                                  '-c', NATIVE_LAUNCHER, './node_modules/.bin/tsx', '--eval', NATIVE_PROGRAM, kind], timeout=180,
                                 input=json.dumps({'environment': environments[kind], 'stdin': json.dumps(plan['word'])}))
            self._absent_container(name)
            if scratch is not None:
                # On a failed/timed-out child retain private scratch with the
                # full clone until the ephemeral runner is disposed. Never erase
                # files beneath a potentially still-running Docker process.
                shutil.rmtree(scratch)
            if value.strip() != expected:
                recovery.fail('RELEASE_NATIVE_TRIAL_FAILED')
        self._absent_container(name)
        restored = executor.backup_tool.restore_state(backup, CLONE, plan['manifest_sha256'])
        recovery.validate_restore_proof(restored)
        binding = {key: plan[key] for key in ('release_sha', 'manifest_sha256', 'images', 'candidate_images', 'config_sha256', 'tool_sha256')}
        return {'state': 'TRUSTED_RELEASE_TRIAL_PASS', **binding,
                'plan_sha256': recovery.digest(json.dumps(plan, sort_keys=True, separators=(',', ':')).encode()),
                'source_ci_sha256': source_ci_sha256, 'trial_module_sha256': module_digest(__file__),
                'recovery_module_sha256': module_digest(recovery.__file__),
                'native_program_sha256': recovery.digest(NATIVE_PROGRAM.encode()),
                'full_restore': initial, 'in_place_restore': restored,
                'candidate_native': 'CANDIDATE_TRIAL_PASS', 'previous_native': 'PREVIOUS_TRIAL_PASS'}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args(argv)
    try:
        body = sys.stdin.buffer.read(65537)
        if len(body) > 65536:
            recovery.fail('RELEASE_RECEIPT_INVALID')
        result = ReleaseTrial().run(json.loads(body))
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:  # noqa: BLE001 - no source/credential/Docker error details leave trial
        print('RELEASE_NATIVE_TRIAL_FAILED', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

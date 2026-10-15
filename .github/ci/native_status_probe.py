"""Bounded diagnostic on a private catalog/latest copy; never release evidence."""
import fcntl
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import uuid
from contextlib import closing
from pathlib import Path


def files(root):
    result = {}
    for path in root.rglob('*'):
        if path.is_symlink() or not (path.is_file() or path.is_dir()):
            raise ValueError('PROBE_UNSAFE_FILE')
        if path.is_file():
            with path.open('rb') as stream:result[str(path.relative_to(root))] = hashlib.file_digest(stream,'sha256').hexdigest()
    return result


def build_capsule(source, target):
    source, target = Path(source), Path(target)
    if any(p.is_symlink() for p in (source,*source.parents,target,*target.parents)):
        raise ValueError('PROBE_UNSAFE_PATH')
    target.mkdir(mode=0o700)
    reports = target/'reports';published = reports/'published';published.mkdir(parents=True,mode=0o700)
    catalog = source/'published/publications.sqlite'
    if any(p.is_symlink() for p in (catalog,*catalog.parents)):raise ValueError('PROBE_UNSAFE_CATALOG')
    with closing(sqlite3.connect(catalog.as_uri()+'?mode=ro',uri=True)) as live, \
         closing(sqlite3.connect(published/'publications.sqlite')) as copy:
        live.backup(copy)
        row = next((json.loads(receipt),json.loads(saved)) for receipt,saved in copy.execute(
            'SELECT receipt,files FROM publications ORDER BY report_date DESC,cutoff_at DESC,release_id DESC')
            if 'archive_origin' not in json.loads(receipt) and json.loads(receipt).get('replay_available') is not False)
    record, expected = row
    if not re.fullmatch(r'REL-[a-f0-9]{64}',record['release_id']):raise ValueError('PROBE_RELEASE_INVALID')
    release = source/'published/releases'/record['release_id']
    if release.is_symlink() or files(release)!=expected:raise ValueError('PROBE_UNSAFE_OR_CHANGED_RELEASE')
    destination = published/'releases'/record['release_id']
    destination.parent.mkdir(mode=0o700)
    shutil.copytree(release,destination,symlinks=False)
    if files(destination)!=expected:raise ValueError('PROBE_COPY_CHANGED')
    for name in ('status.json','report-health.json'):
        path = source/name
        if path.is_symlink():raise ValueError('PROBE_UNSAFE_FILE')
        if path.exists():
            if path.stat().st_size>32*1024**2:raise ValueError('PROBE_STATUS_TOO_LARGE')
            shutil.copy2(path,reports/name)


PROGRAM = r'''(async()=>{
const fs=await import('node:fs');const cp=await import('node:child_process');const {promisify}=await import('node:util');
const originalFile=cp.execFile;const original=promisify(originalFile);const failures=[];
function observed(...args){return Reflect.apply(originalFile,this,args);}
Object.defineProperty(observed,promisify.custom,{value:async(...args)=>{
 try{return await original(...args);}catch(error){
  if(args[1]?.[0]==='read-publication')failures.push({code:error.code,killed:error.killed,signal:error.signal,stderr:(Buffer.isBuffer(error.stderr)?error.stderr.toString('utf8'):String(error.stderr??'')).slice(-65536),message:String(error.message??'').slice(-65536)});
  throw error;
 }
}});
cp.default.execFile=observed;const {syncBuiltinESMExports}=await import('node:module');syncBuiltinESMExports();
const {createApp}=await import('./src/app.ts');const app=await createApp({logger:false});
try{
const started=Date.now();const response=await app.inject({method:'GET',url:'/api/report-releases',headers:{authorization:'Bearer '+process.env.AEMR_API_KEY}});
const summary={elapsed_ms:Date.now()-started,http_status:response.statusCode,bytes:response.rawPayload.length,backend_failures:failures.length};
if(process.env.PROBE_HISTORY==='1'){
 const shared=await import('@aemr/shared');const history={models:0,invalid:0};
 function visit(root){
  if(fs.lstatSync(root).isSymbolicLink())throw Error('UNSAFE_HISTORY');
  for(const entry of fs.readdirSync(root,{withFileTypes:true})){
   const file=root+'/'+entry.name;if(entry.isSymbolicLink())throw Error('UNSAFE_HISTORY');
   if(entry.isDirectory())visit(file);
   else if(entry.isFile()&&entry.name==='report_model.json'){
    if(fs.statSync(file).size>134217728)throw Error('HISTORY_TOO_LARGE');
    const model=JSON.parse(fs.readFileSync(file,'utf8'));history.models++;
    if(model.automation_assurance!==undefined&&!shared.ReportAssuranceSchema.safeParse(model.automation_assurance).success)history.invalid++;
   }
  }
 }
 visit('/probe-history/releases');
 for(const name of fs.readdirSync('/probe-history/archives'))if(name.startsWith('WEEKLY-'))visit('/probe-history/archives/'+name);
 summary.history=history;
 summary.envelope_valid=shared.ReportReleaseStatusSchema.safeParse(JSON.parse(response.payload)).success;
}
fs.writeFileSync('/app/packages/server/data/probe-private.json',JSON.stringify({summary,failures}),{mode:0o600});
console.log('NATIVE_STATUS_PROBE='+JSON.stringify(summary));
}finally{await app.close();}process.exit(0);
})().catch(error=>{console.error(error?.stack??'PROBE_RUNTIME_FAILED');process.exit(2);});'''


def public_summary(outcomes):
    allowed = {'PUBLISHED_BUNDLE_CORRUPT','PUBLICATION_READER_LEASE_UNINITIALIZED','PUBLICATION_MAINTENANCE_ACTIVE',
        'PUBLICATION_RETENTION_RECOVERY_REQUIRED','PUBLICATION_DATA_OWNER_MISMATCH','PUBLICATION_RETENTION_UNSAFE'}
    codes = sorted({line for failure in outcomes.get('failures',[]) for line in str(failure.get('stderr','')).splitlines() if line in allowed})
    bodies = '\n'.join(str(f.get('stderr','')) for f in outcomes.get('failures',[]))
    python_errors = [code for code in ('PermissionError','ValueError','OperationalError','JSONDecodeError','TypeError',
        'FileNotFoundError','NameError','AttributeError','ImportError','ModuleNotFoundError') if re.search(r'^(?:sqlite3\.|json\.decoder\.)?'+code+':',bodies,re.MULTILINE)]
    system_codes = [f['code'] for f in outcomes.get('failures',[]) if f.get('code') in
        {'ENOENT','EACCES','ETIMEDOUT','ERR_CHILD_PROCESS_STDIO_MAXBUFFER','ENOBUFS'}]
    disk_full = 'sqlite3.OperationalError: database or disk is full' in bodies
    return {'module_override_sha256':outcomes.get('module_override_sha256'),'sqlite_disk_full':disk_full,'diagnostic_only':True,'initializer_exit':outcomes.get('initializer',{}).get('returncode'),
        'native_exit':outcomes.get('native',{}).get('returncode'),'summary':outcomes.get('summary'),
        'backend_codes':codes,'backend_exits':[f.get('code') if type(f.get('code')) is int else None for f in outcomes.get('failures',[])],
        'backend_killed':[f.get('killed') is True for f in outcomes.get('failures',[])],
        'python_errors':python_errors,'system_codes':system_codes,'timed_out':outcomes.get('timed_out') is True,
        'previous_summary':outcomes.get('previous_summary')}


def main():
    assert os.geteuid()==0
    os.umask(0o077)
    base = Path('/root/codex-fixes/release-38727198402')
    assert base.is_dir() and not any(p.is_symlink() for p in (base,*base.parents))
    with Path('/run/lock/aemr-maintenance.lock').open('r+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        assert not any((Path('/var/lib/aemr')/name).exists() for name in ('pending-release.json','release-recovery-progress.json'))
        assert not list(Path('/home/aemr/.dash-private-backups').glob('*/quiescent'))
        records = json.loads(subprocess.check_output(['docker','inspect','aemr-server-1','aemr-report-worker-1']))
        assert records[0]['State']['Status']=='running' and records[1]['State']['Status']=='exited'
        assert all((r['Config'].get('Labels') or {}).get('com.docker.compose.project')=='aemr' for r in records)
        volume = json.loads(subprocess.check_output(['docker','volume','inspect','aemr_server_data']))[0]
        assert volume['Name']=='aemr_server_data' and volume['Driver']=='local' and not volume.get('Options')
        source = Path(volume['Mountpoint'])/'reports'
        catalog = source/'published/publications.sqlite'
        assert not any(p.is_symlink() for p in (catalog,*catalog.parents))
        plan = json.loads(Path('/var/lib/aemr/release-runtime/trial-plan.json').read_bytes())
        total = sum(p.stat().st_size for p in source.glob('published/publications.sqlite*') if p.is_file())
        with closing(sqlite3.connect((source/'published/publications.sqlite').as_uri()+'?mode=ro',uri=True)) as db:
            record = next(json.loads(row[0]) for row in db.execute('SELECT receipt FROM publications ORDER BY report_date DESC,cutoff_at DESC,release_id DESC')
                if 'archive_origin' not in json.loads(row[0]) and json.loads(row[0]).get('replay_available') is not False)
        assert re.fullmatch(r'REL-[a-f0-9]{64}',record['release_id'])
        total += sum(p.stat().st_size for p in (source/'published/releases'/record['release_id']).rglob('*') if p.is_file())
        assert total<=3*1024**3 and shutil.disk_usage(base).free>=total+1024**3
        outcomes = {}
        with tempfile.TemporaryDirectory(prefix='native-status-',dir=base) as temporary:
            root = Path(temporary)/'capsule';build_capsule(source,root)
            for path in (root,*root.rglob('*')):os.chown(path,1000,1000)
            common = ['docker','run','--rm','--network','none','--read-only','--user','1000:1000',
                '--memory','768m','--memory-swap','1g','--cpus','0.5','--pids-limit','128',
                '--mount',f'type=bind,src={root},dst=/app/packages/server/data',
                '--workdir','/app/packages/server','--env','AEMR_API_KEY=isolated-native-status-diagnostic',
                '--env','SOURCE_AUTO_REFRESH_MINUTES=0','--env','REPORT_STATE_DIR=/app/packages/server/data/reports',
                '--env','SQLITE_PATH=/app/packages/server/data/aemr.db']
            image = plan['candidate_images']['server'];assert re.fullmatch(r'sha256:[a-f0-9]{64}',image)
            identity = uuid.uuid4().hex;name = 'aemr-status-probe-'+identity
            common += ['--name',name,'--label','aemr.native-status-probe='+identity]
            common += ['--tmpfs','/tmp:rw,nosuid,nodev,size=128m']
            previous_common = common.copy()
            active_image = image
            try:
                override = globals().get('PUBLICATION_STORE_OVERRIDE')
                if override is not None:
                    assert isinstance(override,bytes) and len(override)<=1024*1024
                    located = subprocess.run([*common,'--entrypoint','/opt/report-env/bin/python',image,'-c',
                        'import procurement_engine.publication_store as m;print(m.__file__)'],
                        capture_output=True,text=True,timeout=30,check=True).stdout.strip()
                    assert re.fullmatch(r'/opt/report-env/lib/python3\.[0-9]{1,2}/site-packages/procurement_engine/publication_store.py',located)
                    patch = Path(temporary)/'publication_store.py';patch.write_bytes(override);patch.chmod(0o444)
                    common += ['--mount',f'type=bind,src={patch},dst={located},readonly']
                    outcomes['module_override_sha256'] = hashlib.sha256(override).hexdigest()
                init = subprocess.run([*common,'--entrypoint','/opt/report-env/bin/proc-report',image,
                    'initialize-publication-readers','--state','/app/packages/server/data/reports'],capture_output=True,text=True,timeout=60,check=False)
                outcomes['initializer'] = {'returncode':init.returncode,'stderr':init.stderr[-65536:]}
                if init.returncode==0:
                    assert all(folder.is_dir() and not folder.is_symlink() for folder in (source/'published/releases',source/'archives'))
                    historical = ['--env','PROBE_HISTORY=1','--mount',f'type=bind,src={source}/published/releases,dst=/probe-history/releases,readonly',
                                  '--mount',f'type=bind,src={source}/archives,dst=/probe-history/archives,readonly']
                    result = subprocess.run([*common,*historical,'--entrypoint','./node_modules/.bin/tsx',image,'--eval',PROGRAM],
                        capture_output=True,text=True,timeout=120,check=False)
                    outcomes['native'] = {'returncode':result.returncode,'stdout':result.stdout[-65536:],'stderr':result.stderr[-65536:]}
                    private = root/'probe-private.json'
                    if private.is_file():outcomes.update(json.loads(private.read_bytes()))
                    # Check the actual prior image unchanged, before a full trial.
                    prior_image = plan['images']['server'];assert re.fullmatch(r'sha256:[a-f0-9]{64}',prior_image)
                    active_image = prior_image
                    prior = subprocess.run([*previous_common,
                        '--entrypoint','./node_modules/.bin/tsx',prior_image,'--eval',PROGRAM],
                        capture_output=True,text=True,timeout=120,check=False)
                    outcomes['previous'] = {'returncode':prior.returncode,'stderr':prior.stderr[-65536:]}
                    if prior.returncode==0:
                        outcomes['previous_receipt'] = json.loads(private.read_bytes())
                        outcomes['previous_summary'] = outcomes['previous_receipt'].get('summary')
            except subprocess.TimeoutExpired as error:
                outcomes['timed_out'] = True
                outcomes['timeout_stderr'] = (error.stderr or b'')[-65536:].decode('utf8',errors='replace') if isinstance(error.stderr,bytes) else (error.stderr or '')[-65536:]
            finally:
                inspected = subprocess.run(['docker','inspect',name],capture_output=True,text=True,timeout=20,check=False)
                if inspected.returncode==0:
                    owned = json.loads(inspected.stdout)[0]
                    assert owned['Image']==active_image and owned['Config']['Labels'].get('aemr.native-status-probe')==identity
                    subprocess.run(['docker','rm','--force',name],capture_output=True,text=True,timeout=20,check=True)
        # Keep the original failing receipt for comparison with the reviewed fix.
        suffix = '-'+outcomes['module_override_sha256'] if outcomes.get('module_override_sha256') else ''
        target = base/('native-status-probe'+suffix+'.json')
        with target.with_suffix('.tmp').open('w') as stream:json.dump(outcomes,stream);stream.flush();os.fsync(stream.fileno())
        target.with_suffix('.tmp').replace(target)
        print(json.dumps(public_summary(outcomes)))


if __name__ == '__main__':
    main()

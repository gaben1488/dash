"""Exact43 host adapter; no service, source, backup or retention-policy changes."""
import argparse
import ast
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import select
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import traceback
from contextlib import contextmanager
from pathlib import Path

SHA = '43f10742c274777dc5b8e0ac5b7c97d0a78cf6fa'
TOOL_SHA = '4a56bdd576424c80693f82ed36c5bcb019bae7ef'
# Temporary, explicit tooling/runtime boundary. Publication and retention code
# is identical; only disposable reader/diagnostic helpers changed after43.
READER_DIFFERENCES = {'deployment_diagnostics.py','publication_reader.py',
                      'readonly_catalog.py','rehearsal_policy.py'}
TOOLS = Path('/usr/local/libexec/aemr')
BACKUPS = Path('/home/aemr/.dash-private-backups')
SCRATCH = Path('/var/lib/aemr/weekly-scratch')
ENV = {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','DOCKER_CONFIG':'/etc/aemr/docker',
       'PYTHONDONTWRITEBYTECODE':'1'}
MODULES = {'release-controller.py','release_recovery.py','release_trial.py','stateful_backup.py','source_ci_gate.py'}

# EOF means the supervisor died before independent recovery was proved ready.
BARRIER = '''import os,sys
fd=int(sys.argv[1]);ready=os.read(fd,1);os.close(fd)
if ready!=b'1':raise SystemExit(2)
os.execv(sys.argv[2],sys.argv[2:])
'''
WATCHER = '''import os,runpy,sys
assert os.geteuid()==int(sys.argv[1])
tool=runpy.run_path(sys.argv[3]);fd=int(sys.argv[2])
os.write(fd,b'1');os.close(fd)
raise SystemExit(tool['main'](sys.argv[4:]))
'''
# Call the existing native function, preserving the main()-only authorization
# gates, without spawning main()'s second, descriptor-closing watchdog.
OWNER = '''import json,runpy,sys
from pathlib import Path
tool=runpy.run_path(sys.argv[1]);args=sys.argv[2:]
def value(flag):return args[args.index(flag)+1]
try:
 operation=value('--operation');state=value('--state')
 options={'candidate':value('--candidate'),'ci':json.loads(Path(value('--ci-evidence')).read_text()),
  'reader_package':value('--reader-package'),'expected_revision':value('--expected-revision'),
  'backup':value('--backup'),'source_receipt':json.loads(Path(value('--source-receipt')).read_text())}
 if operation=='apply':
  assert all(options.values())
  tool['_require_candidate_ci'](options['candidate'],options['ci'])
  tool['require_watchdog_lifecycle']()
  tool['validate_operator_runtime'](options['candidate'],options['ci'],options['reader_package'],options['source_receipt'])
  tool['validate_operator_state_owner'](state)
 review=value('--finalize-review') if '--finalize-review' in args else None
 print(json.dumps(tool['operate'](state,operation=operation,finalize_review=review,**options),sort_keys=True))
except Exception:
 print('NATIVE_PUBLICATION_OPERATION_BLOCKED');raise SystemExit(2) from None
'''
NATIVE = '''import hashlib,json,os,stat
from pathlib import Path
import procurement_engine
root=Path(procurement_engine.__file__).parent
lease=Path('/app/packages/server/data/reports/publication-readers.lock')
info=lease.lstat()
verify_reader_compatibility(root)
print(json.dumps({'uid':os.geteuid(),'hashes':{p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*.py')},'symlinks':any(p.is_symlink() for p in root.rglob('*')),'lease_uid':info.st_uid,'lease_regular':stat.S_ISREG(info.st_mode)}))
'''


def require(value, code):
    if not value:raise ValueError(code)


def acquire_lock(descriptor,*,timeout=45):
    deadline=time.monotonic()+timeout
    while True:
        try:
            fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
            return
        except BlockingIOError:
            if time.monotonic()>=deadline:raise
            time.sleep(0.2)


def private_diagnostic(body):
    log=os.fstat(2)
    if stat.S_ISREG(log.st_mode) and log.st_uid==0 and log.st_nlink==1 and stat.S_IMODE(log.st_mode)==0o600:
        os.write(2,body[:1024*1024])


@contextmanager
def owner_scratch(run,*,preserve_on_error=False):
    """Disk-backed disposable SQLite clones, never the host's default tmpfs."""
    require(re.fullmatch('[0-9]+',run),'OPERATOR_RUN_INVALID')
    SCRATCH.mkdir(mode=0o700,exist_ok=True)
    info=SCRATCH.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid==0 and stat.S_IMODE(info.st_mode)==0o700,
            'OPERATOR_SCRATCH_UNTRUSTED')
    path=Path(tempfile.mkdtemp(prefix=run+'-',dir=SCRATCH))
    before=ENV.get('TMPDIR');remove=True
    try:
        os.chown(path,1000,1000);path.chmod(0o700);ENV['TMPDIR']=str(path)
        yield path
    except BaseException:
        # Independent recovery can outlive the supervisor. Its SQLite scratch
        # must survive an exceptional owner exit, just like its source/tools.
        remove=not preserve_on_error
        raise
    finally:
        if before is None:ENV.pop('TMPDIR',None)
        else:ENV['TMPDIR']=before
        if remove:shutil.rmtree(path)


def owned(path, *, limit=1024*1024, private=True):
    path=Path(path)
    for parent in path.parents:
        info=parent.lstat()
        # Existing root600/root700 backup sessions live beneath /home/aemr.
        # Root ownership is required on the opened trust file, not that home.
        require(stat.S_ISDIR(info.st_mode),'OPERATOR_PATH_UNTRUSTED')
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as stream:
        info=os.fstat(stream.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1 and info.st_size<=limit,'OPERATOR_FILE_UNTRUSTED')
        require(stat.S_IMODE(info.st_mode)==0o600 if private else not info.st_mode&0o022,'OPERATOR_FILE_UNTRUSTED')
        body=stream.read(limit+1)
        require(len(body)<=limit,'OPERATOR_FILE_TOO_LARGE')
        return body


def validate_lifecycle(properties, cgroup, unit):
    require(properties.get('MainPID')==str(os.getpid()) and properties.get('KillMode')=='process'
            and properties.get('ExitType')=='cgroup'
            and unit in cgroup.split('/') and not Path('/.dockerenv').exists(),'INDEPENDENT_HOST_LIFECYCLE_REQUIRED')


def public_hashes(package):
    require(package.is_dir() and not package.is_symlink() and not any(p.is_symlink() for p in package.rglob('*')),
            'PUBLIC_CODE_SYMLINK_REJECTED')
    result={p.relative_to(package).as_posix():hashlib.sha256(owned(p,private=False)).hexdigest()
            for p in package.rglob('*.py')}
    require(bool(result),'PUBLIC_CODE_EMPTY')
    return result


def runtime_hashes(manifest, tool):
    """Do not relabel the old runtime or its unsuccessful full CI as the tool."""
    prefix='packages/report-engine/src/procurement_engine/'
    actual=manifest.get('hashes',{})
    require(manifest.get('candidate')==SHA and set(actual)==set(tool)
            and all(isinstance(value,str) and re.fullmatch('[a-f0-9]{64}',value) for value in actual.values()),
            'RUNTIME_SOURCE_MANIFEST_INVALID')
    changed={name for name in actual if actual[name]!=tool[name]}
    require(changed=={prefix+name for name in READER_DIFFERENCES},'UNREVIEWED_TOOL_RUNTIME_DIFFERENCE')
    return {name[len(prefix):]:value for name,value in actual.items() if name.startswith(prefix)}


def native_probe(tree):
    # Reuse the hash-verified native CLI's actual behavioral check. It runs
    # against the installed interpreter/package on disposable synthetic state.
    source=owned(tree/'deploy/plan-weekly-publications.py',private=False).decode()
    definitions=[node for node in ast.parse(source).body
                 if isinstance(node,ast.FunctionDef) and node.name=='verify_reader_compatibility']
    require(len(definitions)==1,'READER_BEHAVIOR_PROOF_MISSING')
    return ast.get_source_segment(source,definitions[0])+'\n'+NATIVE


def preview_plan(tree,python,privilege,state,*,output=None):
    """Existing read-only planner, with private IDs and bounded public metadata."""
    probe='import json,runpy,sys;tool=runpy.run_path(sys.argv[1]);print(json.dumps(tool["plan"](sys.argv[2])))'
    body=call([*privilege,str(python),'-IB','-c',probe,str(tree/'deploy/plan-weekly-publications.py'),str(state)],
              timeout=600,pass_fds=(9,) if os.path.exists('/proc/self/fd/9') else ())
    result=json.loads(body)
    require(re.fullmatch('[a-f0-9]{64}',result.get('catalog_revision','')),'PLAN_REVISION_INVALID')
    names=('publication_count','keep_count','retire_count','bytes_reclaimable')
    require(all(type(result.get(name)) is int and result[name]>=0 for name in names),'PLAN_COUNTS_INVALID')
    with os.fdopen(os.open(output or tree.parent/'retention-plan.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'wb') as stream:
        stream.write(body);stream.flush();os.fsync(stream.fileno())
    return {name:result[name] for name in ('catalog_revision',*names)}


def protected_identity_digest(path,fillable):
    """Protect every original cell except the exact nullable signature slots."""
    import sqlite3
    from contextlib import closing
    digest=hashlib.sha256()
    with closing(sqlite3.connect(path)) as db:
        schema=db.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall()
        digest.update(json.dumps(schema,separators=(',',':')).encode())
        for table,order in (('observations','snapshot_id,locator'),('snapshots','seq'),('reviews','review_id')):
            cursor=db.execute('SELECT * FROM '+table+' ORDER BY '+order)
            columns=[item[0] for item in cursor.description]
            for record in cursor:
                values=list(record)
                if table=='observations':
                    key=(values[columns.index('snapshot_id')],values[columns.index('locator')])
                    for name in fillable.get(key,()):values[columns.index(name)]=None
                digest.update(json.dumps([table,values],ensure_ascii=False,separators=(',',':')).encode())
    return digest.hexdigest()


def prepare_identity_copy(state,gaps):
    """Use the existing exact frozen-row backfill on disposable state only."""
    import sqlite3
    from contextlib import closing

    from procurement_engine.identity_store import IdentityStore
    from procurement_engine.readonly_catalog import copied_catalog

    require(isinstance(gaps,list) and 0<len(gaps)<=16,'IDENTITY_GAPS_INVALID')
    targets={item['snapshot_id'] for item in gaps}
    require(len(targets)==len(gaps) and all(isinstance(v,str) and 0<len(v)<=256 for v in targets),'IDENTITY_GAPS_INVALID')
    ids={rid for item in gaps for rid in item['release_ids']}
    require(0<len(ids)<=256 and all(re.fullmatch('REL-[a-f0-9]{64}',rid) for rid in ids),'IDENTITY_DONORS_INVALID')
    state=Path(state);original=state/'identity.sqlite'
    donors=[state/'published/releases'/rid/'snapshot_bundle' for rid in sorted(ids)]
    require(all(p.is_dir() and not any(v.is_symlink() for v in (p,*p.parents)) for p in donors),'IDENTITY_DONORS_INVALID')
    with copied_catalog(original) as copied:
        require(copied.resolve()!=original.resolve(),'IDENTITY_COPY_REQUIRED')
        fillable={}
        with closing(sqlite3.connect(copied)) as db:
            for item in gaps:
                records=db.execute('SELECT locator,plan_signature,entity_signature FROM observations WHERE snapshot_id=?',
                                   (item['snapshot_id'],)).fetchall()
                require(len(records)==item['observations']
                        and sum(row[1] is None for row in records)==item['missing_plan']
                        and sum(row[2] is None for row in records)==item['missing_entity'],'IDENTITY_TARGET_CHANGED')
                for locator,plan,entity in records:
                    names={name for name,value in (('plan_signature',plan),('entity_signature',entity)) if value is None}
                    if names:fillable[item['snapshot_id'],locator]=names
        require(bool(fillable),'IDENTITY_TARGET_EMPTY')
        before=protected_identity_digest(copied,fillable)
        diagnostics={}
        updated=IdentityStore(copied).recover_latest_plan_signatures(donors,required_snapshot_ids=targets,diagnostics=diagnostics)
        require(updated==len(fillable) and diagnostics.get('unrecovered_snapshots')==0,'IDENTITY_COPY_NOT_RECOVERED')
        require(protected_identity_digest(copied,fillable)==before,'IDENTITY_PROTECTED_DATA_CHANGED')
        patch=[]
        with closing(sqlite3.connect(copied)) as db:
            for (sid,locator),names in sorted(fillable.items()):
                signature,uid,plan,entity=db.execute('SELECT signature,uid,plan_signature,entity_signature FROM observations '
                                                   'WHERE snapshot_id=? AND locator=?',(sid,locator)).fetchone()
                require(plan is not None and entity is not None,'IDENTITY_COPY_NOT_RECOVERED')
                patch.append({'snapshot_id':sid,'locator':locator,'signature':signature,'uid':uid,
                              'plan_signature':plan,'entity_signature':entity,'fillable':sorted(names)})
        return {'identity_copy_preparation':'PASS','snapshots':len(targets),'updated_observations':updated,
                'updated_fields':sum(len(names) for names in fillable.values()),'protected_data_unchanged':True,
                'protected_digest':before,'private_patch':patch}


def load_identity_prepared(path):
    return json.loads(owned(path,limit=8*1024*1024))


def wait_for_worker_idle(path,*,timeout=480):
    with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'r') as file:
        info=os.fstat(file.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid==1000 and info.st_nlink==1,'IDENTITY_PATH_UNTRUSTED')
        acquire_lock(file.fileno(),timeout=timeout)


def apply_identity_patch(state,patch):
    """CAS only previously empty derived slots; one SQLite transaction for all targets."""
    import sqlite3
    from contextlib import closing
    require(isinstance(patch,list) and 0<len(patch)<=100000,'IDENTITY_PATCH_INVALID')
    seen=set();fields=rows=0
    for item in patch:
        require(set(item)=={'snapshot_id','locator','signature','uid','plan_signature','entity_signature','fillable'}
                and all(isinstance(item[k],str) and item[k] for k in ('snapshot_id','locator'))
                and (item['uid'] is None or isinstance(item['uid'],str) and bool(item['uid']))
                and all(re.fullmatch('[a-f0-9]{64}',item[k]) for k in ('signature','plan_signature'))
                and (item['entity_signature']=='' or re.fullmatch('[a-f0-9]{64}',item['entity_signature']))
                and isinstance(item['fillable'],list) and bool(item['fillable'])
                and set(item['fillable'])<={'plan_signature','entity_signature'},'IDENTITY_PATCH_INVALID')
        key=(item['snapshot_id'],item['locator'])
        require(key not in seen,'IDENTITY_PATCH_INVALID');seen.add(key)
    state=Path(state).absolute();path=state/'identity.sqlite'
    require(not any(p.is_symlink() for p in (path,*path.parents)),'IDENTITY_PATH_UNTRUSTED')
    def trusted(file):
        info=file.lstat()
        require(stat.S_ISREG(info.st_mode) and info.st_uid==os.geteuid() and info.st_nlink==1,'IDENTITY_PATH_UNTRUSTED')
        return info.st_dev,info.st_ino
    target=trusted(path)
    for suffix in ('-wal','-shm','-journal'):
        side=Path(str(path)+suffix)
        if os.path.lexists(side):trusted(side)
    lock_target=trusted(state/'run.lock')
    with os.fdopen(os.open(state/'run.lock',os.O_RDWR|os.O_NOFOLLOW),'r+') as lock:
        opened=os.fstat(lock.fileno())
        require((opened.st_dev,opened.st_ino)==lock_target==trusted(state/'run.lock'),'IDENTITY_PATH_UNTRUSTED')
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with closing(sqlite3.connect(path.as_uri()+'?mode=rw',uri=True,timeout=1)) as db,db:
            require(trusted(path)==target,'IDENTITY_PATH_UNTRUSTED')
            db.execute('PRAGMA synchronous=FULL');db.execute('BEGIN IMMEDIATE')
            require(not db.execute("SELECT 1 FROM sqlite_master WHERE type='trigger'").fetchone(),'IDENTITY_PATCH_TRIGGER')
            for item in patch:
                key=(item['snapshot_id'],item['locator'])
                prior=db.execute('SELECT signature,uid,plan_signature,entity_signature FROM observations WHERE snapshot_id=? AND locator=?',key).fetchone()
                require(prior is not None and prior[:2]==(item['signature'],item['uid']),'IDENTITY_PATCH_CONFLICT')
                changed=0
                for index,name in enumerate(('plan_signature','entity_signature'),2):
                    value=prior[index]
                    require(value==item[name] or (value is None and name in item['fillable']),'IDENTITY_PATCH_CONFLICT')
                    if value is None:
                        db.execute('UPDATE observations SET '+name+'=? WHERE snapshot_id=? AND locator=?',(item[name],*key));changed+=1
                rows+=bool(changed);fields+=changed
            require(trusted(path)==target,'IDENTITY_PATH_UNTRUSTED')
    return {'updated_observations':rows,'updated_fields':fields,'verified_observations':len(patch)}


def validate_context(plan,records,cycle,native,hashes,ci,*,backup_reference):
    require(plan['release_sha']==SHA and plan['backup_reference']==backup_reference,'ACCEPTED_BACKUP_CHANGED')
    require(ci.get('head_sha')==TOOL_SHA and ci.get('status')=='completed' and ci.get('conclusion')=='success'
            and ci.get('name')=='CI' and (ci.get('head_repository') or {}).get('full_name')=='gaben1488/dash'
            and type(ci.get('id')) is int and ci['id']>0,'EXACT_CANDIDATE_CI_REQUIRED')
    worker=records['report-worker']
    require(cycle.get('state')=='TWO_AUTONOMOUS_CYCLES_VERIFIED' and cycle.get('source_sha')==SHA
            and cycle.get('worker')==worker['Id'] and cycle.get('worker_image')==worker['Image']
            and cycle.get('worker_started_at')==worker['State']['StartedAt'] and cycle.get('native_word')=='PASS'
            and isinstance(cycle.get('attempt_ids'),list) and len(cycle['attempt_ids'])==2
            and all(isinstance(v,str) and v for v in cycle['attempt_ids']) and len(set(cycle['attempt_ids']))==2
            and type(cycle.get('sealed_entries_verified')) is int and cycle['sealed_entries_verified']>0,'ACCEPTED_WORKER_CYCLES_REQUIRED')
    for role in ('server','report-worker'):
        record=records[role];proof=native[role]
        require(record['Image']==plan['candidate_images'][role] and record['State']['Status']=='running'
                and record['State']['OOMKilled'] is False,'ACCEPTED_RUNTIME_CHANGED')
        require(proof=={'uid':1000,'hashes':hashes,'lease_uid':1000,'lease_regular':True,'symlinks':False},'LIVE_READER_SOURCE_OR_OWNER_CHANGED')
    require(records['server']['State']['Health']['Status']=='healthy','ACCEPTED_API_UNHEALTHY')


def cli_commands(tree,python,reader,ci,receipt,state,backup,*,operation,revision,finalize_review):
    require(operation in {'apply','recover','rollback','finalize'} and re.fullmatch('[a-f0-9]{64}',revision),'OPERATION_INVALID')
    require(operation!='finalize' or finalize_review==TOOL_SHA+':'+revision,'INDEPENDENT_FINALIZE_REVIEW_REQUIRED')
    result=[str(python),'-IB',str(tree/'deploy/plan-weekly-publications.py'),'--state',str(state),
            '--operation',operation,'--candidate',TOOL_SHA,'--ci-evidence',str(ci),'--source-receipt',str(receipt),
            '--reader-package',str(reader),'--expected-revision',revision,'--backup',str(backup)]
    if operation=='finalize':result+=['--finalize-review',finalize_review]
    return result


def call(arguments,*,timeout=180,pass_fds=(),input_bytes=None):
    result=subprocess.run(arguments,input=input_bytes,capture_output=True,env=ENV,timeout=timeout,check=False,pass_fds=pass_fds)
    if result.returncode:
        # Child diagnostics may contain private paths/payloads. Preserve them
        # only when stderr is an actual root600 private file, never a console.
        private_diagnostic(result.stderr)
    require(result.returncode==0 and len(result.stdout)<=8*1024*1024,'OPERATOR_COMMAND_FAILED')
    return result.stdout


def lock_held_by(pid,fd,expected):
    path=Path('/proc')/str(pid)/'fd'/str(fd)
    info=path.stat()
    if (info.st_dev,info.st_ino)!=(expected.st_dev,expected.st_ino):return False
    for line in (path.parent.parent/'fdinfo'/str(fd)).read_text().splitlines():
        fields=line.split()
        if fields and fields[0]=='lock:':fields=fields[1:]
        if len(fields)==8 and fields[1:4]==['FLOCK','ADVISORY','WRITE']:
            major,minor,inode=fields[5].split(':')
            if (int(major,16),int(minor,16),int(inode))==(os.major(expected.st_dev),os.minor(expected.st_dev),expected.st_ino):return True
    return False


def supervise(command,watch_prefix,*,owner_prefix=(),watch_uid=1000):
    """Both native owner and independent native recovery retain the real EX9.

    No original-state copying or process-control recovery lives in this adapter.
    A parent death before the readiness barrier produces EOF without mutation.
    """
    gate_read,gate_write=os.pipe();ready_read,ready_write=os.pipe()
    owner=watcher=None
    try:
        owner=subprocess.Popen([sys.executable,'-IB','-c',BARRIER,str(gate_read),*owner_prefix,
                                command[0],'-IB','-c',OWNER,command[2],*command[3:]],
                               env=ENV,pass_fds=(9,gate_read),start_new_session=True)
        os.close(gate_read);gate_read=None
        start=Path('/proc/'+str(owner.pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]
        recovery=command[3:]
        recovery[recovery.index('--operation')+1]='recover'
        if '--finalize-review' in recovery:
            index=recovery.index('--finalize-review');del recovery[index:index+2]
        recovery+=['--watch-owner',str(owner.pid),'--watch-start',start]
        watcher=subprocess.Popen([*watch_prefix,'-IB','-c',WATCHER,str(watch_uid),str(ready_write),command[2],*recovery],
                                 env=ENV,pass_fds=(9,ready_write),start_new_session=True)
        os.close(ready_write);ready_write=None
        require(select.select([ready_read],[],[],30)[0] and os.read(ready_read,1)==b'1'
                and watcher.poll() is None and lock_held_by(watcher.pid,9,os.fstat(9)),
                'INDEPENDENT_EX_WATCHDOG_NOT_READY')
        os.write(gate_write,b'1');os.close(gate_write);gate_write=None
        outcome=owner.wait()
        recovered=watcher.wait()
        require(outcome==0 and recovered==0,'NATIVE_COMPACTION_OR_RECOVERY_FAILED')
    finally:
        # Never kill either independent custodian on supervisor/SSH failure.
        for descriptor in (gate_read,gate_write,ready_read,ready_write):
            if descriptor is not None:os.close(descriptor)


def admit(args):
    unit='aemr-weekly-compaction-'+args.operator_run+'.service'
    properties=dict(line.split('=',1) for line in call(['systemctl','show',unit,'--property=MainPID,KillMode,ExitType']).decode().splitlines())
    validate_lifecycle(properties,Path('/proc/self/cgroup').read_text().strip(),unit)
    receipt=json.loads(owned(args.source_receipt));ci=json.loads(owned(args.ci_evidence))
    require(receipt.get('contract')=='exact-ci-public-code-v1' and receipt.get('repository')=='gaben1488/dash'
            and receipt.get('candidate')==TOOL_SHA and receipt.get('ci_run_id')==ci.get('id')
            and type(receipt.get('derivation_run_id')) is int and receipt['derivation_run_id']>0,'SOURCE_RECEIPT_INVALID')
    hashes=public_hashes(args.tree/'packages/report-engine/src/procurement_engine')
    observed={'packages/report-engine/src/procurement_engine/'+name:value for name,value in hashes.items()}
    for name in ('deploy/plan-weekly-publications.py','deploy/stateful_backup.py'):
        observed[name]=hashlib.sha256(owned(args.tree/name,private=False)).hexdigest()
    require(observed==receipt.get('file_hashes'),'EXACT_PUBLIC_CODE_REQUIRED')
    require(public_hashes(args.reader_package)==hashes,'HOST_READER_SOURCE_CHANGED')
    # This immutable authenticated staging receipt predates this adapter and
    # pins the real43 package independently of the green4a maintenance source.
    runtime=runtime_hashes(json.loads(owned(Path('/root/codex-fixes/weekly-38875479942/source-hashes.json'))),observed)
    # Native interpreter may be a venv symlink to the trusted host ABI binary.
    executable=args.python.resolve(strict=True);info=executable.stat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022,'HOST_INTERPRETER_UNTRUSTED')
    owned(args.python.parent.parent/'pyvenv.cfg',private=False)
    raw_plan=json.loads(owned(Path('/var/lib/aemr/release-runtime/trial-plan.json')))
    reference=raw_plan['backup_reference']
    require(re.fullmatch('worker-[0-9]+/backup',reference) and reference==args.backup_reference,'ACCEPTED_BACKUP_CHANGED')
    window=json.loads(owned(BACKUPS/Path(reference).parent/'release-window.json'))
    require(window.get('candidate')==SHA and set(window.get('module_sha256',{}))==MODULES,'ROOT_MODULE_PINS_REQUIRED')
    for name,pin in window['module_sha256'].items():
        require(hashlib.sha256(owned(TOOLS/name,private=False)).hexdigest()==pin,'ROOT_MODULE_CHANGED')
    sys.path.insert(0,str(TOOLS))
    import release_recovery as r
    r.require_lock(9);plan=r.validate_plan(raw_plan)
    accepted=json.loads(owned(r.STATE_DIR/'release-accepted.json'))
    require(accepted=={'plan_sha256':r.digest(json.dumps(plan,sort_keys=True,separators=(',',':')).encode()),
                       'acceptance':r.ReleaseRecovery._acceptance(plan)},'EXACT_ACCEPTED_RELEASE_REQUIRED')
    require(not any(os.path.lexists(r.STATE_DIR/name) for name in ('pending-release.json','release-recovery-progress.json'))
            and not list(BACKUPS.glob('*/quiescent')),'RELEASE_NOT_IDLE')
    executor=r.ReleaseRecovery(lock_fd=9);records=executor._records(plan,candidate=True)
    spec=importlib.util.spec_from_file_location('accepted_release_controller',TOOLS/'release-controller.py')
    controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
    controller.ReleaseController(executor)._proof(plan)
    _,config=executor._files(plan,candidate_runtime=True)
    controller.ReleaseController(executor)._saved_runtime({**plan,'images':plan['candidate_images']},records,json.loads(json.dumps(config).replace('$$','$')))
    cycle=json.loads(owned(args.worker_acceptance))
    probe=native_probe(args.tree)
    native={role:json.loads(call(['docker','exec',records[role]['Id'],'/opt/report-env/bin/python','-IB','-c',probe]))
            for role in ('server','report-worker')}
    validate_context(plan,records,cycle,native,runtime,ci,backup_reference=args.backup_reference)
    return executor._volume(plan)/'reports',BACKUPS/reference


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('tree','python','reader_package','ci_evidence','source_receipt','worker_acceptance'):
        parser.add_argument('--'+name.replace('_','-'),required=True,type=Path)
    parser.add_argument('--operator-run',required=True);parser.add_argument('--backup-reference',required=True)
    parser.add_argument('--expected-revision',required=True);parser.add_argument('--finalize-review')
    parser.add_argument('--operation',choices=('apply','recover','rollback','finalize'),required=True)
    parser.add_argument('--check',action='store_true');parser.add_argument('--identity-copy',action='store_true')
    parser.add_argument('--identity-apply',action='store_true')
    args=parser.parse_args()
    require(os.geteuid()==0 and re.fullmatch('[0-9]+',args.operator_run),'ROOT_OPERATOR_REQUIRED')
    os.umask(0o077);sys.dont_write_bytecode=True
    with os.fdopen(os.open('/run/lock/aemr-maintenance.lock',os.O_RDWR|os.O_NOFOLLOW),'r+') as lock:
        info=os.fstat(lock.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1,'GLOBAL_LOCK_UNTRUSTED')
        acquire_lock(lock.fileno())
        if lock.fileno()!=9:os.dup2(lock.fileno(),9,inheritable=True)
        try:
            state,backup=admit(args)
            with owner_scratch(args.operator_run,preserve_on_error=not args.check):
                privilege=['/usr/bin/setpriv','--reuid=1000','--regid=1000','--clear-groups',
                           '--inh-caps=+dac_read_search','--ambient-caps=+dac_read_search']
                if args.identity_apply:
                    require(not args.check and not args.identity_copy and args.operation=='apply','IDENTITY_PATCH_MODE_INVALID')
                    proof=load_identity_prepared(args.tree.parent/'identity-prepared-38889251691.json')
                    require(proof['runtime_source']==SHA and proof['tool_source']==TOOL_SHA
                            and proof['result']['protected_data_unchanged'] is True
                            and proof['result']['updated_observations']==len(proof['patch'])==8126
                            and proof['gap_proof_sha256']==hashlib.sha256(owned(Path('/root/codex-fixes/revision-probe-38887646833/private-result.json'))).hexdigest(),
                            'IDENTITY_COPY_PROOF_REQUIRED')
                    fcntl.flock(9,fcntl.LOCK_UN)
                    wait_for_worker_idle(state/'run.lock')
                    acquire_lock(9);admit(args)
                    program='import json,runpy,sys;tool=runpy.run_path(sys.argv[1]);print(json.dumps(tool["apply_identity_patch"](sys.argv[2],json.load(sys.stdin))))'
                    result=json.loads(call([*privilege,str(args.python),'-IB','-c',program,str(Path(__file__).resolve()),str(state)],
                                           input_bytes=json.dumps(proof['patch']).encode(),timeout=120,pass_fds=(9,)))
                    print(json.dumps({'identity_metadata_apply':result},sort_keys=True));return
                if args.identity_copy:
                    require(args.check and args.operation=='apply','IDENTITY_COPY_INSPECTION_ONLY')
                    gap_body=owned(Path('/root/codex-fixes/revision-probe-38887646833/private-result.json'))
                    gaps=json.loads(gap_body)['private_signature_gaps']
                    program='import json,runpy,sys;tool=runpy.run_path(sys.argv[1]);print(json.dumps(tool["prepare_identity_copy"](sys.argv[2],json.load(sys.stdin))))'
                    # Only disposable state is written. Keep process supervision
                    # available during this potentially long read-only rehearsal.
                    fcntl.flock(9,fcntl.LOCK_UN)
                    result=json.loads(call([*privilege,str(args.python),'-IB','-c',program,str(Path(__file__).resolve()),str(state)],
                                           input_bytes=json.dumps(gaps).encode(),timeout=600))
                    acquire_lock(9)
                    admit(args)  # Rebind the actual runtime before accepting proof.
                    patch=result.pop('private_patch')
                    evidence={'runtime_source':SHA,'tool_source':TOOL_SHA,'gap_proof_sha256':hashlib.sha256(gap_body).hexdigest(),
                              'result':result,'patch':patch}
                    output=args.tree.parent/('identity-prepared-'+args.operator_run+'.json')
                    with os.fdopen(os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'w') as file:
                        json.dump(evidence,file,separators=(',',':'));file.flush();os.fsync(file.fileno())
                    print(json.dumps(result,sort_keys=True))
                    print('IDENTITY_COPY_PREPARATION_PASS_NO_PRIMARY_WRITES')
                    return
                preview=None
                if args.check and args.expected_revision=='live':
                    preview=preview_plan(args.tree,args.python,privilege,state,
                                         output=args.tree.parent/('retention-plan-'+args.operator_run+'.json'))
                    args.expected_revision=preview['catalog_revision']
                command=cli_commands(args.tree,args.python,args.reader_package,args.ci_evidence,args.source_receipt,state,backup,
                                     operation=args.operation,revision=args.expected_revision,finalize_review=args.finalize_review)
                # Exercise actual host ABI/dependency closure and existing proof gates
                # as the real native data owner before any maintenance lock bootstrap.
                probe='import importlib.util,json,sys;import procurement_engine.runtime,docx;from pathlib import Path;from procurement_engine.publication_store import PublicationStore;spec=importlib.util.spec_from_file_location("weekly",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.operator_preflight(sys.argv[2],operation=sys.argv[3],candidate=sys.argv[4],ci=json.load(open(sys.argv[5])),reader_package=sys.argv[6],source_receipt=json.load(open(sys.argv[7])),expected_revision=sys.argv[8],backup=sys.argv[9],store=PublicationStore(Path(sys.argv[2])/"published",readonly=True));print("HOST_NATIVE_PREFLIGHT_PASS")'
                call([*privilege,str(args.python),'-IB','-c',probe,command[2],str(state),args.operation,TOOL_SHA,
                      str(args.ci_evidence),str(args.reader_package),str(args.source_receipt),args.expected_revision,str(backup)],timeout=1800,pass_fds=(9,))
                if args.check:
                    if preview:print(json.dumps(preview,sort_keys=True))
                    print('HOST_NATIVE_PREFLIGHT_PASS_NO_COMPACTION');return
                # The barrier execs setpriv in-place, preserving PID birth identity.
                owner_command=command
                supervise(owner_command,[*privilege,str(args.python)],owner_prefix=privilege)
                print('EXISTING_NATIVE_COMPACTION_AND_RECOVERY_COMPLETE')
        finally:
            if lock.fileno()!=9:os.close(9)


if __name__=='__main__':
    try:main()
    except Exception:  # noqa: BLE001 - private inputs never cross the fixed-code boundary
        private_diagnostic(traceback.format_exc().encode())
        print('WEEKLY_OPERATOR_BLOCKED');raise SystemExit(2) from None

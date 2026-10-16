"""Continue only the original exact43 trial using the existing production guardian."""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
import time
import traceback
from pathlib import Path

SHA = '43f10742c274777dc5b8e0ac5b7c97d0a78cf6fa'
RUN = '38821521319'
SESSION = Path('/home/aemr/.dash-private-backups') / ('worker-' + RUN)
TOOLS = Path('/usr/local/libexec/aemr')
ENV = {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin', 'DOCKER_CONFIG':'/etc/aemr/docker'}
SHELL_SHA = '5b2069b4168e9b764e6cf64e2213f3e558609021c7539e450e605e15a6706332'
LOCK_SHA = '0eb3463b292152967c08f6666f204c9aa1743e8aa5f9389be73a782b9f5cc5c9'


def owned(path, *, private=True):
    assert not any(p.is_symlink() for p in (path,*path.parents))
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        info=os.fstat(stream.fileno())
        assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1 and info.st_size<=1024*1024
        assert stat.S_IMODE(info.st_mode)==0o600 if private else not info.st_mode & 0o022
        return stream.read(1024*1024+1)


def guardian_program(source):
    body=source.split("  nohup bash -c '\n",1)[1].split("\n  ' watchdog ",1)[0]
    old='{ [ ! -f "$1/prepared" ] && ! kill -0 "$9" 2>/dev/null; }'
    assert body.count(old)==1
    # This continuation driver stays alive through dispatch. Its death must also
    # resume a prepared pre-arm window; the original dispatch remains synchronous.
    return body.replace(old, '! kill -0 "$9" 2>/dev/null')


def freeze_and_check(executor, controller, plan, backup, queue):
    executor._close(plan, services=('server',))
    executor._no_volume_writers(plan)
    try:
        result=executor.backup_tool.match_source(backup,executor._volume(plan))
    except executor.backup_tool.BackupError as error:
        if str(error)!='BACKUP_SOURCE_MISMATCH':raise
        # Only the original exact full trial authorizes retiring its predecessor.
        # Current live bytes are neither restored nor published on this branch.
        controller._retire_previous_checkpoint(plan)
        return 'SOURCE_CHANGED_RECAPTURE_REQUIRED'
    if result.get('state')!='SOURCE_MATCHED_ONLY':raise ValueError('CONTINUATION_MATCH_INVALID')
    queue()
    return 'RELEASE_QUEUED'


def admission():
    window=json.loads(owned(SESSION/'release-window.json'))
    names={'release-controller.py','release_recovery.py','release_trial.py','stateful_backup.py','source_ci_gate.py'}
    assert window['candidate']==SHA and window['run_id']==RUN and set(window['module_sha256'])==names
    assert window['boot_id']==Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    for name,pin in window['module_sha256'].items():
        assert re.fullmatch('[a-f0-9]{64}',pin) and hashlib.sha256(owned(TOOLS/name,private=False)).hexdigest()==pin
    source=owned(SESSION/'recovery-window.sh').decode()
    assert hashlib.sha256(source.encode()).hexdigest()==SHELL_SHA
    assert hashlib.sha256(owned(SESSION/'maintenance-lock.sh')).hexdigest()==LOCK_SHA
    sys.path.insert(0,str(TOOLS))
    import release_recovery as r
    r.require_lock(9)
    spec=importlib.util.spec_from_file_location('release_controller',TOOLS/'release-controller.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    executor=r.ReleaseRecovery(lock_fd=9);controller=module.ReleaseController(executor)
    custodians()  # Proc visibility must be available before any runtime transition.
    plan=r.validate_plan(json.loads(r.read_owned(r.RUNTIME_DIR/'trial-plan.json')))
    assert plan['release_sha']==SHA and plan['backup_reference']=='worker-'+RUN+'/backup'
    assert not any(os.path.lexists(r.STATE_DIR/name) for name in ('pending-release.json','release-recovery-progress.json'))
    assert not any(os.path.lexists(SESSION/name) for name in ('quiescent','cancel-request.json','release-result'))
    assert not os.path.lexists(r.RUNTIME_DIR/'guardian-request.json')
    assert hashlib.sha256(r.read_owned(r.RUNTIME_DIR/'trial-proof.json')).hexdigest()=='949837bf1053297eaaaa54f265a54f272e204bc55f93a52e015cd9ddd677adbb'
    controller._proof(plan);controller._images(plan)
    backup,candidate=executor._files(plan,candidate_runtime=True)
    service=candidate['services']['server']
    assert service.get('command') in (None,['./node_modules/.bin/tsx','src/index.ts']) and not service.get('entrypoint')
    executor._recovery_records(plan)
    records=executor._records(plan,original=True);controller._saved_runtime(plan,records)
    stage=json.loads(r.read_owned(r.RUNTIME_DIR/'stage.json'))
    captured=json.loads(owned(SESSION/'runtime.json'))
    assert {s:v['Id'] for s,v in records.items()}==stage['container_ids']
    assert captured['server']==records['server']['Id'] and captured['worker']==records['report-worker']['Id']
    assert captured['candidate']==SHA and captured['worker_was_running'] is False
    assert plan['original_running']['report-worker'] is False
    assert all(records[s]['State']['Status']=='running' for s in ('server','web','caddy'))
    assert records['server']['State']['Health']['Status']=='healthy'
    assert records['report-worker']['State']['Status'] in {'exited','created'}
    return r,executor,controller,plan,backup,window,source,captured


def request(mode):
    result=subprocess.run(['bash',str(SESSION/'recovery-window.sh'),mode,SHA,RUN,'/home/aemr/dash',str(SESSION.parent),
                           '--quiesce-worker','--release-controller'],cwd='/home/aemr/dash/deploy',env=ENV,
                          capture_output=True,timeout=2400 if mode=='resume-release' else 45,check=False,pass_fds=(9,))
    if result.returncode:raise ValueError('CONTINUATION_REQUEST_FAILED')


def custodians(expected=None):
    """Enumerate inherited EX9 under a stable set of PID generations.

    The pinned controller/dispatch/docker children all retain fd9. A changed PID
    set is retried rather than declaring that custody has become exclusive.
    """
    expected=os.fstat(9) if expected is None else expected
    def generations():
        result={}
        for path in Path('/proc').iterdir():
            if not path.name.isdigit():continue
            try:result[int(path.name)]=int((path/'stat').read_text().rsplit(')',1)[1].split()[19])
            except (FileNotFoundError,ProcessLookupError):continue
        return result
    before=generations();holders=[]
    for pid in before:
        if pid==os.getpid():continue
        try:
            fd=Path('/proc')/str(pid)/'fd/9';info=fd.stat()
            if (info.st_dev,info.st_ino)!=(expected.st_dev,expected.st_ino):continue
            for line in (Path('/proc')/str(pid)/'fdinfo/9').read_text().splitlines():
                fields=line.split()
                if fields and fields[0]=='lock:':fields=fields[1:]
                if len(fields)==8 and fields[1:4]==['FLOCK','ADVISORY','WRITE']:
                    major,minor,inode=fields[5].split(':')
                    if (int(major,16),int(minor,16),int(inode))==(os.major(expected.st_dev),os.minor(expected.st_dev),expected.st_ino):
                        holders.append(pid);break
        except (FileNotFoundError,ProcessLookupError):continue
    return sorted(holders) if before==generations() else None


def wait_closed(guardian, r):
    if not os.path.lexists(SESSION/'quiescent'):return
    until=time.monotonic()+6600
    queued=False
    while os.path.lexists(SESSION/'quiescent'):
        if guardian.poll() is not None:
            # A dead guardian may leave a live dispatch/controller sharing EX9.
            # Never run a second recovery alongside that original custodian.
            remaining=custodians()
            if remaining==[]:
                if not os.path.lexists(SESSION/'quiescent'):return
                r.atomic_bytes(SESSION/'guardian-ready',(str(os.getpid())+'\n').encode())
                request('request-resume');request('resume-release')
                assert not os.path.lexists(SESSION/'quiescent')
                return
        elif not queued:
            request('request-resume');queued=True
        if time.monotonic()>=until:raise ValueError('CONTINUATION_CUSTODY_TIMEOUT')
        time.sleep(2)


def execute(operator_run, admitted):
    r,executor,controller,plan,backup,window,source,captured=admitted
    evidence=Path('/root/codex-fixes/release-'+RUN)
    prefix=evidence/('continuation-'+operator_run)
    r.atomic_json(prefix.with_name(prefix.name+'-before.json'),{'window':window,'guardian':owned(SESSION/'guardian-ready').decode()})
    old_pid=int(owned(SESSION/'guardian-ready'))
    assert not Path('/proc/'+str(old_pid)).exists()
    r.atomic_json(SESSION/'release-window.json',{**window,'deadline_ns':time.monotonic_ns()+4500*10**9})
    (SESSION/'prepared').unlink()
    r.atomic_bytes(SESSION/'quiescent',b'')
    guardian=None
    phase='CONTINUATION_FAILED'
    try:
        with prefix.with_name(prefix.name+'-guardian.log').open('xb') as log:
            guardian=subprocess.Popen(['bash','-c',guardian_program(source),'watchdog',str(SESSION),captured['server'],str(SESSION),
                SHA,RUN,'/home/aemr/dash',str(SESSION.parent),'--quiesce-worker',str(os.getpid()),'true'],
                stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,env=ENV,pass_fds=(9,),start_new_session=True)
        ready=False
        for _ in range(100):
            if guardian.poll() is not None:raise ValueError('CONTINUATION_GUARDIAN_FAILED')
            ready_body=owned(SESSION/'guardian-ready').strip()
            if ready_body.isdigit() and int(ready_body)==guardian.pid:
                checked=subprocess.run(['bash','-c','. "$1"; maintenance_lock_owned_by "$2"','check',
                    str(SESSION/'maintenance-lock.sh'),str(guardian.pid)],env=ENV,capture_output=True,timeout=10,check=False)
                if checked.returncode==0:ready=True;break
            time.sleep(0.1)
        assert ready
        def queue():
            r.atomic_bytes(SESSION/'prepared',b'')
            request('request-release')
        phase=freeze_and_check(executor,controller,plan,backup,queue)
        if phase=='RELEASE_QUEUED':
            until=time.monotonic()+6600
            while not os.path.lexists(SESSION/'release-result') and time.monotonic()<until:
                if guardian.poll() is not None:raise ValueError('CONTINUATION_GUARDIAN_FAILED')
                time.sleep(2)
            assert owned(SESSION/'release-result').strip()==b'0'
            accepted=json.loads(r.read_owned(r.STATE_DIR/'release-accepted.json'))
            assert accepted=={'plan_sha256':r.digest(json.dumps(plan,sort_keys=True,separators=(',',':')).encode()),
                              'acceptance':r.ReleaseRecovery._acceptance(plan)}
            phase='RELEASE_CANDIDATE_ACCEPTED'
    finally:
        if guardian is not None:wait_closed(guardian,r)
        else:
            # No runtime was stopped before guardian readiness; restore markers.
            r.atomic_bytes(SESSION/'prepared',b'');(SESSION/'quiescent').unlink(missing_ok=True)
    records=executor._records(plan,candidate=phase=='RELEASE_CANDIDATE_ACCEPTED',original=phase!='RELEASE_CANDIDATE_ACCEPTED')
    assert all(records[s]['State']['Status']=='running' for s in ('server','web','caddy'))
    assert records['server']['State']['Health']['Status']=='healthy'
    assert records['report-worker']['State']['Status'] in {'exited','created'}
    return {'state':phase,'release_sha':SHA,'worker_started':False,'api_healthy':True}


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('operator_run');parser.add_argument('--check',action='store_true')
    args=parser.parse_args();assert re.fullmatch('[0-9]+',args.operator_run) and os.geteuid()==0
    os.umask(0o077);sys.dont_write_bytecode=True
    with os.fdopen(os.open('/run/lock/aemr-maintenance.lock',os.O_RDWR|os.O_NOFOLLOW),'r+') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if lock.fileno()!=9:os.dup2(lock.fileno(),9,inheritable=True)
        try:
            admitted=admission()
            if args.check:print('CONTINUATION_ADMISSION_PASS');return
            result=execute(args.operator_run,admitted)
            admitted[0].atomic_json(Path('/root/codex-fixes/release-'+RUN)/('continuation-'+args.operator_run+'-result.json'),result)
            print(result['state'])
        finally:
            if lock.fileno()!=9:os.close(9)


if __name__=='__main__':
    try:main()
    except Exception:  # noqa: BLE001 - only the private systemd log receives details
        traceback.print_exc();raise SystemExit(2) from None

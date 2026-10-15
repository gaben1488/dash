"""Bind actual controlled re-creation to original quarantine without moving OOM facts."""
import json
import os
import re


def record_lineage(executor, r, plan):
    r.require_lock(executor.lock_fd)
    assert not any(os.path.lexists(r.STATE_DIR/name) for name in
                   ('pending-release.json','release-recovery-progress.json','release-accepted.json'))
    completed_bytes=r.read_owned(r.STATE_DIR/'release-recovered.json')
    completed=r.validate_completed(json.loads(completed_bytes))
    assert completed['release_sha']==plan['release_sha']
    assert completed['manifest_sha256']==plan['manifest_sha256']
    assert completed['plan_sha256']==r.digest(json.dumps(plan,sort_keys=True,separators=(',',':')).encode())
    assert plan['original_running']['report-worker'] is False
    directory=r.STATE_DIR/'worker-quarantine'
    r.private_directory(directory)
    quarantine_bytes=r.read_owned(directory/'quarantine.json')
    quarantine=json.loads(quarantine_bytes)
    assert quarantine['state']=='WORKER_OOM_QUARANTINED'
    assert quarantine['image']==plan['images']['server']==plan['images']['report-worker']
    stage=json.loads(r.read_owned(r.RUNTIME_DIR/'stage.json'))
    assert all(stage[key]==plan[key] for key in ('release_sha','config_sha256','candidate_images'))
    assert stage['container_ids']['server']==quarantine['server']
    assert stage['container_ids']['report-worker']==quarantine['worker']
    executor._recovery_records(plan)
    records=executor._records(plan,original=True)
    assert set(records)==set(r.SERVICES)
    assert all(records[role]['State']['Status'] in
               ({'created','exited'} if role=='report-worker' else {'running'}) for role in r.SERVICES)
    assert all(re.fullmatch('[a-f0-9]{64}',record['Id']) for record in records.values())
    executor._verify_api_word(plan)
    bridge={'state':'VERIFIED_CONTROLLED_ROLLBACK_LINEAGE',
            'quarantine_sha256':r.digest(quarantine_bytes),
            'recovered_receipt_sha256':r.digest(completed_bytes),
            'recovered_plan_sha256':completed['plan_sha256'],
            'recovered_manifest_sha256':completed['manifest_sha256'],
            'recovered_release_sha':completed['release_sha'],
            'container_ids':{role:records[role]['Id'] for role in r.SERVICES},
            'images':dict(plan['images'])}
    path=directory/'rollback-lineage.json'
    if os.path.lexists(path):assert json.loads(r.read_owned(path))==bridge
    else:r.atomic_json(path,bridge)
    after=executor._records(plan,original=True)
    assert {role:after[role]['Id'] for role in r.SERVICES}==bridge['container_ids']
    assert r.read_owned(directory/'quarantine.json')==quarantine_bytes
    return bridge


def main():
    import fcntl
    import hashlib
    import importlib.util
    import stat
    import sys
    import time
    from pathlib import Path

    def owned(path, *, limit=65536, private=True):
        assert not any(p.is_symlink() for p in (path,*path.parents))
        with os.fdopen(os.open(path,os.O_RDONLY|os.O_NOFOLLOW),'rb') as file:
            info=os.fstat(file.fileno())
            assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1 and info.st_size<=limit
            assert stat.S_IMODE(info.st_mode)==0o600 if private else not info.st_mode&0o022
            return file.read(limit+1)

    assert os.geteuid()==0
    path=Path('/run/lock/aemr-maintenance.lock')
    fd=os.open(path,os.O_RDWR|os.O_NOFOLLOW)
    info=os.fstat(fd)
    assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1
    if fd!=9:os.dup2(fd,9);os.close(fd)
    with os.fdopen(9,'r+'):
        deadline=time.monotonic()+45
        while True:
            try:fcntl.flock(9,fcntl.LOCK_EX|fcntl.LOCK_NB);break
            except BlockingIOError:
                if time.monotonic()>=deadline:raise
                time.sleep(0.2)
        runtime=Path('/var/lib/aemr/release-runtime');tools=Path('/usr/local/libexec/aemr')
        for directory in (runtime,tools):
            assert not any(p.is_symlink() for p in (directory,*directory.parents))
            info=directory.lstat();assert stat.S_ISDIR(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022
        raw=json.loads(owned(runtime/'trial-plan.json'))
        assert re.fullmatch('worker-[0-9]+/backup',raw['backup_reference'])
        assert re.fullmatch('[a-f0-9]{40}',raw['release_sha'])
        session=Path('/home/aemr/.dash-private-backups')/Path(raw['backup_reference']).parent
        window=json.loads(owned(session/'release-window.json'))
        assert window['format']=='aemr-release-window-v1' and window['candidate']==raw['release_sha']
        assert window['boot_id']==Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        names={'release-controller.py','release_recovery.py','release_trial.py','stateful_backup.py','source_ci_gate.py'}
        assert set(window['module_sha256'])==names
        for name,digest in window['module_sha256'].items():
            assert re.fullmatch('[a-f0-9]{64}',digest)
            assert hashlib.sha256(owned(tools/name,limit=1024*1024,private=False)).hexdigest()==digest
        sys.path.insert(0,str(tools))
        import release_recovery as r
        r.require_lock(9)
        spec=importlib.util.spec_from_file_location('pinned_lineage_controller',tools/'release-controller.py')
        controller=importlib.util.module_from_spec(spec);spec.loader.exec_module(controller)
        executor=r.ReleaseRecovery()
        operator=controller.ReleaseController(executor)
        plan=operator._proof(r.validate_plan(raw))
        _,config=executor._files(plan)
        operator._saved_runtime(plan,executor._records(plan,original=True),json.loads(json.dumps(config).replace('$$','$')))
        record_lineage(executor,r,plan)
        print('VERIFIED_CONTROLLED_ROLLBACK_LINEAGE',flush=True)


if __name__=='__main__':
    try:main()
    except Exception as error:  # noqa: BLE001 - only fixed public codes, no private config
        import sys
        print('CONTROLLED_ROLLBACK_LINEAGE_REJECTED',flush=True)
        kind=type(error).__name__
        print(json.dumps({'kind':kind if kind in {'AssertionError','RecoveryError','FileNotFoundError','BlockingIOError'} else 'OtherError',
                          'entry_line':error.__traceback__.tb_lineno}),flush=True)
        sys.exit(2)

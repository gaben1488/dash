"""Restore the proven previous runtime with the pinned checkpoint executor."""
import hashlib
import importlib.util
import json
import os
import re
import stat
import sys
from pathlib import Path

SHA = '394c7e853a2b326b9a5c89ea52f60c51e075302e'
RUN = '38792810076'


LEGACY = '485545e6e5afb846ff126887530c9c69ebbb7ab76ad4ae50d25196ed067b3260'
LEGACY_IMAGE = 'sha256:9df39cca24e19ebd4b4ce7b2b252dac1a0df67ce656607b3c9ab503b4f6dd134'
TAG = 'aemr-private-preserved:legacy-485545e6-20261015'
FRESH_ARCHIVE_BYTES = 5226094530
OLD_ARCHIVE_BYTES = 4589649313


def validate_legacy(value):
    labels = value.get('Config', {}).get('Labels') or {}
    assert value['Id'] == LEGACY and value['Image'] == LEGACY_IMAGE
    assert value['State']['Status'] == 'exited' and value['State'].get('Pid', 0) == 0
    assert labels.get('com.docker.compose.project') == 'aemr'
    assert labels.get('com.docker.compose.service') == 'server'
    assert value['Name'] not in {'/aemr-' + service + '-1' for service in ('server', 'web', 'caddy', 'report-worker')}
    assert value.get('Mounts') == []
    assert type(value['SizeRw']) is int and 0 <= value['SizeRw'] <= 256*1024*1024


def retire_stopped_legacy(command, r):
    private = Path('/root/codex-fixes/release-38792810076/legacy-preserved')
    # Protect every path component before any secret-bearing inspect is saved.
    for parent in [*reversed(private.parents), private]:
        if not parent.exists(): parent.mkdir(mode=0o700)
        value = parent.lstat()
        assert stat.S_ISDIR(value.st_mode) and value.st_uid == 0 and not value.st_mode & 0o022
    assert stat.S_IMODE(private.stat().st_mode) == 0o700
    inspect_path = private / 'container.json'
    receipt_path = private / 'preservation.json'
    identifiers = command(['ps', '--all', '--quiet', '--no-trunc']).split()
    if LEGACY not in identifiers:
        saved = json.loads(r.read_owned(receipt_path))
        assert saved['container'] == LEGACY and saved['original_image'] == LEGACY_IMAGE
        assert json.loads(command(['image', 'inspect', saved['preserved_image']]))[0]['Id'] == saved['preserved_image']
        assert json.loads(r.read_owned(inspect_path, 8*1024*1024))['Id'] == LEGACY
        return 'ALREADY_PRESERVED_AND_RETIRED'
    raw = command(['inspect', '--size', LEGACY])
    value = json.loads(raw)[0]
    validate_legacy(value)
    available = os.statvfs('/var/lib/docker')
    assert available.f_bavail*available.f_frsize > value['SizeRw'] + 1024*1024*1024
    # Private inspect preserves configuration; commit preserves the stopped
    # writable layer. Neither is exported or pushed to the public repository.
    if os.path.lexists(inspect_path):
        assert json.loads(r.read_owned(inspect_path, 8*1024*1024)) == value
    else:
        r.atomic_json(inspect_path, value)
    preserved = command(['commit', LEGACY, TAG], timeout=180).strip()
    assert re.fullmatch('sha256:[a-f0-9]{64}', preserved)
    assert json.loads(command(['image', 'inspect', TAG]))[0]['Id'] == preserved
    r.atomic_json(receipt_path, {'container': LEGACY, 'original_image': LEGACY_IMAGE, 'preserved_image': preserved})
    # State may not change between preservation and exact non-force removal.
    current = json.loads(command(['inspect', '--size', LEGACY]))[0]
    assert current == value
    command(['rm', LEGACY])  # No force; no volume removal; exact stopped ID only.
    return 'PRESERVED_AND_RETIRED'


def retire_superseded_backup(executor, r, plan):
    fresh, _ = executor._files(plan)
    manifest, _, _ = executor.backup_tool._validated_backup(fresh)
    assert manifest['format'] == 2 and manifest['archive_bytes'] == FRESH_ARCHIVE_BYTES
    old = r.BACKUP_BASE / 'worker-38349415596' / 'backup'
    assert old != fresh and not any(p.is_symlink() for p in (old, *old.parents))
    for directory in (r.BACKUP_BASE, old.parent, old): r.private_directory(directory)
    old_manifest = json.loads(r.read_owned(old / 'manifest.json', 64*1024*1024, private=False))
    assert old_manifest['format'] == 2 and old_manifest['archive_bytes'] == OLD_ARCHIVE_BYTES
    archive = old / 'state.tar.gz'
    record = old / 'superseded-retirement.json'
    expected = {'state': 'SUPERSEDED_ARCHIVE_RETIRED', 'retained_backup': plan['backup_reference'],
                'retained_manifest_sha256': plan['manifest_sha256'],
                'removed_bytes': old_manifest['archive_bytes'], 'removed_sha256': old_manifest['archive_sha256']}
    if os.path.lexists(archive):
        with os.fdopen(os.open(archive, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as file:
            info = os.fstat(file.fileno())
            assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
            assert stat.S_IMODE(info.st_mode) in {0o600, 0o644} and info.st_size == expected['removed_bytes']
            assert hashlib.file_digest(file, 'sha256').hexdigest() == expected['removed_sha256']
        assert archive.stat().st_ino != (fresh / 'state.tar.gz').stat().st_ino
        r.private_directory(old)
        # Durable admission before unlink makes interruption after removal safe.
        if os.path.lexists(record): assert json.loads(r.read_owned(record)) == expected
        else: r.atomic_json(record, expected)
        current = archive.lstat()
        fields = ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_uid','st_gid','st_mode','st_nlink')
        assert all(getattr(current,key) == getattr(info,key) for key in fields)
        archive.unlink()
        r.fsync_directory(old)
    else:
        assert json.loads(r.read_owned(record)) == expected
    print('SUPERSEDED_ARCHIVE_RETIRED_FRESH_FULL_TRIAL_BACKUP_PRESERVED', flush=True)


def main():
    assert os.geteuid() == 0
    tools = Path('/usr/local/libexec/aemr')
    runtime = Path('/var/lib/aemr/release-runtime')
    session = Path('/home/aemr/.dash-private-backups') / ('worker-' + RUN)
    for path in (tools, runtime, session):
        assert not any(p.is_symlink() for p in (path, *path.parents))
        assert path.stat().st_uid == 0 and not path.stat().st_mode & 0o022
    # Pins are fixed by the original independent full-restore gate; no tool,
    # candidate image, contract, checkpoint, or source is replaced by this retry.
    with os.fdopen(os.open(session / 'release-window.json', os.O_RDONLY | os.O_NOFOLLOW), 'rb') as file:
        info = os.fstat(file.fileno())
        assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
        assert stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 65536
        window = json.load(file)
    assert set(window) == {'format', 'candidate', 'run_id', 'module_sha256', 'boot_id', 'deadline_ns'}
    assert window['format'] == 'aemr-release-window-v1'
    assert window['candidate'] == SHA and window['run_id'] == RUN
    assert window['boot_id'] == Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    assert type(window['deadline_ns']) is int
    names = {'release-controller.py', 'release_recovery.py', 'release_trial.py', 'stateful_backup.py', 'source_ci_gate.py'}
    assert set(window['module_sha256']) == names
    for name, digest in window['module_sha256'].items():
        path = tools / name
        assert re.fullmatch('[a-f0-9]{64}', digest)
        assert not path.is_symlink() and path.stat().st_uid == 0 and not path.stat().st_mode & 0o022
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
    sys.path.insert(0, str(tools))
    import release_recovery as r
    r.require_lock(9)
    spec = importlib.util.spec_from_file_location('pinned_release_controller', tools / 'release-controller.py')
    controller = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(controller)
    executor = r.ReleaseRecovery()
    operator = controller.ReleaseController(executor)
    plan = operator._proof(r.validate_plan(json.loads(r.read_owned(runtime / 'trial-plan.json'))))
    assert plan['release_sha'] == SHA
    assert plan['backup_reference'] == 'worker-' + RUN + '/backup'
    assert plan['original_running']['report-worker'] is False
    assert not os.path.lexists(r.STATE_DIR / 'release-accepted.json')
    progress_path = r.STATE_DIR / 'release-recovery-progress.json'
    expected_plan = r.digest(json.dumps(plan, sort_keys=True, separators=(',', ':')).encode())
    if os.path.lexists(r.PENDING):
        assert r.validate_plan(json.loads(r.read_owned(r.PENDING))) == plan
        if os.path.lexists(progress_path):
            progress = r.validate_progress(json.loads(r.read_owned(progress_path)))
            assert progress['phase'] == 'runtime_resume'
            assert progress['plan_sha256'] == expected_plan
        assert retire_stopped_legacy(executor.command, r) in {'PRESERVED_AND_RETIRED', 'ALREADY_PRESERVED_AND_RETIRED'}
        retire_superseded_backup(executor, r, plan)
        print('STOPPED_LEGACY_PRESERVED_AND_RETIRED', flush=True)
        # The unchanged recovery validator admits only bound original/candidate
        # survivors and handles an interrupted, partially reconstructed rollback.
        executor._recovery_records(plan)
        print('PINNED_FULL_ROLLBACK_START', flush=True)
        receipt = executor.recover()
    else:
        receipt = r.validate_completed(json.loads(r.read_owned(r.STATE_DIR / 'release-recovered.json')))
        assert receipt['release_sha'] == SHA and receipt['manifest_sha256'] == plan['manifest_sha256']
        assert receipt['plan_sha256'] == expected_plan
        assert executor.recover() is None  # Retire only exactly matching crash progress.
        executor._verify_api_word(plan)
    assert receipt['state'] == 'RELEASE_RUNTIME_AND_STATE_RECOVERED'
    assert receipt['release_sha'] == SHA
    assert receipt['manifest_sha256'] == plan['manifest_sha256']
    assert receipt['plan_sha256'] == expected_plan
    records = executor._records(plan, original=True)
    assert records['server']['State']['Status'] == 'running'
    assert records['caddy']['State']['Status'] == 'running'
    assert records['report-worker']['State']['Status'] in {'created', 'exited'}
    assert not os.path.lexists(r.PENDING)
    assert not os.path.lexists(progress_path)
    cleanup = []
    request = runtime / 'guardian-request.json'
    if os.path.lexists(request):
        assert json.loads(r.read_owned(request)) == {'candidate': SHA, 'run_id': RUN, 'plan_sha256': expected_plan, 'stage': 'deploy'}
        cleanup.append(request)
    request = session / 'cancel-request.json'
    if os.path.lexists(request):
        assert json.loads(r.read_owned(request)) == {'candidate': SHA, 'run_id': RUN, 'runtime_sha256': r.digest(r.read_owned(session / 'runtime.json'))}
        cleanup.append(request)
    for name in ('quiescent', 'worker-draining'):
        path = session / name
        if os.path.lexists(path):
            r.read_owned(path)
            cleanup.append(path)
    for path in cleanup: path.unlink()
    r.fsync_directory(session)
    r.fsync_directory(runtime)
    print('PREVIOUS_RUNTIME_AND_STATE_RECOVERED_WORKER_QUARANTINED', flush=True)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:  # noqa: BLE001 - fixed public codes only, no private details
        allowed={'RELEASE_RECOVERY_FAILED','RELEASE_RUNTIME_NOT_OWNED','RELEASE_API_NOT_HEALTHY','RELEASE_NATIVE_WORD_MISMATCH','RELEASE_TRIAL_PROOF_INVALID','RELEASE_CHECKPOINT_CHANGED','RELEASE_LOCK_REQUIRED','RELEASE_COMMAND_FAILED','RELEASE_STATE_RESTORE_FAILED','RELEASE_OWNED_FILE_INVALID','RELEASE_PRIVATE_DIRECTORY_INVALID','BACKUP_STORAGE_INSUFFICIENT','BACKUP_MISMATCH','BACKUP_UNSAFE_FILE','BACKUP_STATE_INCOMPLETE','BACKUP_MANIFEST_INVALID','BACKUP_SQLITE_INVALID','BACKUP_DOCX_INVALID','BACKUP_OWNERSHIP_UNAVAILABLE','BACKUP_VERIFIED_MANIFEST_MISMATCH'}
        seen=set()
        while error is not None and id(error) not in seen and len(seen)<6:
            seen.add(id(error))
            kind=type(error).__name__
            print(json.dumps({'rollback_failure':str(error) if str(error) in allowed else 'PRIVATE_DETAILS_WITHHELD',
                'kind':kind if kind in {'AssertionError','BackupError','RecoveryError','OSError','PermissionError','FileNotFoundError'} else 'OtherError',
                'entry_line':error.__traceback__.tb_lineno if error.__traceback__ else None,
                'errno':error.errno if isinstance(error,OSError) else None}),flush=True)
            error=error.__cause__ or error.__context__
        sys.exit(2)

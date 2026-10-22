"""Read a frozen failed-release archive without extracting a second full state.

This is diagnosis only, never independent full-restore/deployment acceptance.
Only one SQLite family or Word is staged in private temporary storage at a time.
"""
import hashlib
import json
import os
import shutil
import sqlite3
import tarfile
import tempfile
import zipfile
from pathlib import Path

CAPTURE = '38727198402'
SOURCE = 'b8e98ec5b255bf32d1aafb68a7e5d1e018db3e7b'
RESERVE = 1024 * 1024 * 1024


def validate_archive(tool, backup, scratch, progress):
    progress.update(phase='archive_hash', address=None)
    manifest, files, _ = tool._validated_backup(backup)
    if manifest['format'] != 2:
        raise ValueError('COMPRESSED_CAPTURE_REQUIRED')
    databases = {name for name in files if Path(name).suffix.lower() in {'.db', '.sqlite', '.sqlite3'}}
    groups = {name: {name} | {name + suffix for suffix in ('-wal', '-shm', '-journal')
                            if name + suffix in files} for name in databases}
    families = {name: base for base, names in groups.items() for name in names}
    seen, dbs, docs = set(), 0, 0
    active, working, remaining = None, None, set()
    try:
        with tarfile.open(backup / 'state.tar.gz', 'r|gz') as stream:
            for member in stream:
                progress.update(phase='archive_member', address=member.name)
                _, info = tool._checked_member(member, files, seen)
                if not member.isfile():
                    continue
                base = families.get(member.name)
                word = Path(member.name).suffix.lower() == '.docx'
                if base is not None:
                    if active != base:
                        if active is not None:
                            raise ValueError('DIAGNOSTIC_DATABASE_ORDER_UNSUPPORTED')
                        if shutil.disk_usage(scratch).free < sum(files[n]['bytes'] for n in groups[base]) + RESERVE:
                            raise ValueError('DIAGNOSTIC_SCRATCH_INSUFFICIENT')
                        working = tempfile.TemporaryDirectory(dir=scratch, prefix='sqlite-')
                        active, remaining = base, set(groups[base])
                    target = Path(working.name) / Path(member.name).name
                    with stream.extractfile(member) as source, target.open('xb') as destination:
                        shutil.copyfileobj(source, destination)
                    with target.open('rb') as content:
                        digest = hashlib.file_digest(content, 'sha256').hexdigest()
                    if digest != info['sha256']:
                        raise ValueError('BACKUP_MISMATCH')
                    remaining.remove(member.name)
                    if not remaining:
                        progress.update(phase='sqlite', address=base)
                        try:
                            with sqlite3.connect((Path(working.name) / Path(base).name).as_uri() + '?mode=ro', uri=True) as db:
                                if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                                    raise ValueError('BACKUP_SQLITE_INVALID')
                        except sqlite3.Error as error:
                            raise ValueError('BACKUP_SQLITE_INVALID') from error
                        dbs += 1
                        working.cleanup()
                        working, active = None, None
                elif word:
                    if shutil.disk_usage(scratch).free < info['bytes'] + RESERVE:
                        raise ValueError('DIAGNOSTIC_SCRATCH_INSUFFICIENT')
                    with tempfile.TemporaryFile(dir=scratch) as document:
                        with stream.extractfile(member) as source:
                            shutil.copyfileobj(source, document)
                        document.seek(0)
                        if hashlib.file_digest(document, 'sha256').hexdigest() != info['sha256']:
                            raise ValueError('BACKUP_MISMATCH')
                        document.seek(0)
                        progress.update(phase='docx', address=member.name)
                        try:
                            with zipfile.ZipFile(document) as archive:
                                if 'word/document.xml' not in archive.namelist() or archive.testzip() is not None:
                                    raise ValueError('BACKUP_DOCX_INVALID')
                        except zipfile.BadZipFile as error:
                            raise ValueError('BACKUP_DOCX_INVALID') from error
                    docs += 1
                else:
                    with stream.extractfile(member) as content:
                        if hashlib.file_digest(content, 'sha256').hexdigest() != info['sha256']:
                            raise ValueError('BACKUP_MISMATCH')
        if seen != set(files) or active is not None:
            raise ValueError('BACKUP_MISMATCH')
        if dbs == 0 or docs == 0:
            raise ValueError('BACKUP_STATE_INCOMPLETE')
        progress.update(phase='complete', address=None)
        return {'files_checked': len(seen), 'sqlite_checked': dbs, 'docx_checked': docs}
    finally:
        if working is not None:
            working.cleanup()


def main():
    import re
    import subprocess
    import sys
    import traceback
    sys.dont_write_bytecode = True
    assert os.geteuid() == 0
    os.umask(0o077)
    os.nice(15)
    tools = Path('/usr/local/libexec/aemr')
    sys.path.insert(0, str(tools))
    import release_recovery as r
    progress = {'phase': 'admission', 'address': None}
    result = {'state': 'NOT_ACCEPTED', 'capture': CAPTURE}
    def records():
        value = json.loads(subprocess.check_output(['docker', 'inspect', *['aemr-' + role + '-1' for role in r.SERVICES]], timeout=30))
        return [{**{key: row[key] for key in ('Id', 'Image', 'RestartCount', 'Config', 'HostConfig')},
                 'Mounts': sorted(json.dumps(mount, sort_keys=True) for mount in row['Mounts']),
                 'State': {**{key: row['State'].get(key) for key in ('Status', 'StartedAt', 'OOMKilled')},
                           'health': row['State'].get('Health', {}).get('Status')}} for row in value]
    def online():
        assert not any(os.path.lexists(r.STATE_DIR / name) for name in ('pending-release.json', 'release-recovery-progress.json'))
        assert not list(r.BACKUP_BASE.glob('*/quiescent'))
        current = records()
        server = next(row for row in current if row['Config']['Labels']['com.docker.compose.service'] == 'server')
        assert server['State']['Status'] == 'running' and server['State']['health'] == 'healthy'
        return current
    before = online()
    proof = Path('/root/codex-fixes/release-' + CAPTURE)
    r.private_directory(proof)
    try:
        plan = r.validate_plan(json.loads(r.read_owned(r.RUNTIME_DIR / 'trial-plan.json')))
        assert plan['release_sha'] == SOURCE and plan['backup_reference'] == 'worker-' + CAPTURE + '/backup'
        backup = r.BACKUP_BASE / plan['backup_reference']
        window = json.loads(r.read_owned(backup.parent / 'release-window.json'))
        assert window['candidate'] == SOURCE
        assert set(window['module_sha256']) == {'release-controller.py', 'release_recovery.py', 'release_trial.py', 'stateful_backup.py', 'source_ci_gate.py'}
        for name, pin in window['module_sha256'].items():
            assert name in {'release-controller.py', 'release_recovery.py', 'release_trial.py', 'stateful_backup.py', 'source_ci_gate.py'}
            assert r.digest(r.read_owned(tools / name, private=False)) == pin
        capsule = r.STATE_DIR / 'release-configs' / SOURCE / 'Caddyfile'
        assert r.read_owned(capsule) == r.read_owned(r.RUNTIME_DIR / 'Caddyfile')
        def readonly(args, **kwargs):
            assert args[:2] == ['image', 'inspect']
            return r.docker(args, **kwargs)
        executor = r.ReleaseRecovery(command=readonly)
        progress['phase'] = 'files'
        executor._files(plan)  # Capsule already exists; no new configuration is created.
        progress['phase'] = 'images'
        executor._images(plan)
        progress['phase'] = 'source_ci'
        import release_trial
        release_trial.check_source_ci(plan)
        assert r.digest(r.read_owned(backup / 'manifest.json', limit=64 * 1024 * 1024)) == plan['manifest_sha256']
        with tempfile.TemporaryDirectory(dir=proof, prefix='scratch-') as scratch:
            result.update(validate_archive(executor.backup_tool, backup, Path(scratch), progress))
        result['state'] = 'READ_ONLY_ARCHIVE_CHECK_PASS'
    except Exception as error:  # noqa: BLE001 - private diagnostic boundary
        code = str(error)
        result.update(state='READ_ONLY_ARCHIVE_CHECK_FAILED', error_code=code if re.fullmatch('(?:BACKUP|RELEASE|DIAGNOSTIC)_[A-Z_]+', code) else 'DIAGNOSTIC_ADMISSION_FAILED',
                      exception_type=type(error).__name__, private_trace=traceback.format_exc(limit=12))
    result['progress'] = progress
    result['runtime_unchanged'] = online() == before
    r.atomic_json(proof / 'archive-readback.json', result)
    public = {key: value for key, value in result.items() if key not in {'private_trace', 'progress'}}
    public['phase'] = progress['phase']
    public['address_sha256'] = r.digest(progress['address'].encode()) if progress.get('address') else None
    print(json.dumps(public))
    return 0 if result['state'] == 'READ_ONLY_ARCHIVE_CHECK_PASS' and result['runtime_unchanged'] else 2


if __name__ == '__main__':
    raise SystemExit(main())

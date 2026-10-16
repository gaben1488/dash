"""Private read-only census before weekly retention; never removes files or rows.

Only aggregate output goes to Actions. The release IDs remain in memory so an
operator can later bind a tested retirement transaction to this exact plan.
The shared planner checks release file hashes, not full replay acceptance or
permission to execute deletion. Reclaimable bytes are an upper bound before
retaining exact downloads and historical decision proofs.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def _trusted_backup(backup, repo):
    import importlib.util
    if backup is None or Path(backup).is_symlink():
        raise ValueError('TRUSTED_EXTERNAL_BACKUP_REQUIRED')
    spec = importlib.util.spec_from_file_location('stateful_backup', repo / 'deploy/stateful_backup.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    try:
        _, trusted, _ = module._validated_backup(Path(backup))
    except module.BackupError as error:
        raise ValueError('TRUSTED_EXTERNAL_BACKUP_INVALID') from error
    return module, trusted


def _unbacked_roots(store, trusted):
    import re
    import sqlite3
    from contextlib import closing
    backed = set()
    for name, attributes in trusted.items():
        match = re.fullmatch(r'reports/published/releases/(REL-[a-f0-9]{64})/.+', name)
        if match and attributes.get('kind') != 'directory':
            backed.add(match[1])
    with closing(sqlite3.connect(store.database_path.absolute().as_uri() + '?mode=ro', uri=True)) as db:
        return {row[0] for row in db.execute('SELECT release_id FROM publications')} - backed


def plan(state, *, backup=None):
    # One keep-policy implementation shared with the reversible apply phase.
    # This adapter remains read-only and preserves the existing census CLI.
    from procurement_engine.publication_store import PublicationStore

    store = PublicationStore(Path(state) / 'published', readonly=True)
    protected = _unbacked_roots(store, _trusted_backup(backup, Path(__file__).resolve().parents[1])[1]) if backup else ()
    result = store.plan_compaction(protected_release_ids=protected)
    if backup:
        result['backup_protected_release_ids'] = sorted(protected)
    result.pop('records')
    result['status'] = 'READ_ONLY_PLAN'
    result['bytes_reclaimable'] = result.pop('bytes_reclaimable_upper_bound')
    result['bytes_reclaimable_kind'] = 'upper_bound_before_retained_artifacts_and_proofs'
    return result


def verify_reader_compatibility(package):
    """Behavioral smoke test in disposable state, never on a live publication."""
    import subprocess
    import sys

    probe = r"""
import hashlib,json,sqlite3,sys,tempfile
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from procurement_engine.publication_store import PublicationStore
with tempfile.TemporaryDirectory(prefix='publication-reader-proof-') as temporary:
    root=Path(temporary)/'published'; rid='REL-'+'a'*64
    release=root/'releases'/rid; release.mkdir(parents=True)
    (root.parent/'publication-readers.lock').touch()
    content=b'synthetic saved Word'; (release/'main_report.docx').write_bytes(content)
    receipt={'release_id':rid,'report_date':'01.10.2026','report_year':2026,'quarter':3,
             'replay_available':False,'cutoff_at':'2026-10-01T08:00:00+00:00'}
    files={'main_report.docx':hashlib.sha256(content).hexdigest()}
    with sqlite3.connect(root/'publications.sqlite') as db:
        db.execute('CREATE TABLE publications(release_id TEXT,report_date TEXT,cutoff_at TEXT,receipt TEXT,files TEXT)')
        db.execute('INSERT INTO publications VALUES (?,?,?,?,?)',(rid,'2026-10-01',receipt['cutoff_at'],json.dumps(receipt),json.dumps(files)))
    store=PublicationStore(root,readonly=True)
    assert store.select('2026-10-01',2026,3)['release_id']==rid
    assert store.latest_for_period('2026-10-02',2026,3)['release_id']==rid
    assert store.select('2026-10-01',2027,3) is None
    assert store.latest() is None
    assert store.read_artifact(rid,'main_report.docx')==content
    assert not (release/'report_model.json').exists()
    work=root/'.retirement';work.mkdir()
    marker=work/'journal.json'
    marker.write_text(json.dumps({'contract':'publication-compaction-v2','readers_ready':True}))
    assert store.read_artifact(rid,'main_report.docx')==content
    marker.write_text(json.dumps({'contract':'publication-compaction-v2','readers_ready':False}))
    try:store.read_artifact(rid,'main_report.docx')
    except ValueError as error:assert str(error)=='PUBLICATION_RETENTION_RECOVERY_REQUIRED'
    else:raise AssertionError('reader ignored recovery fence')
"""
    result = subprocess.run([sys.executable, '-B', '-c', probe, str(Path(package).parent)],
                            capture_output=True, timeout=30, check=False)
    if result.returncode:
        raise ValueError('READER_RUNTIME_COMPATIBILITY_REQUIRED')


def _require_candidate_ci(candidate, ci):
    import re
    if (not re.fullmatch(r'[a-f0-9]{40}', candidate or '')
            or ci.get('head_sha') != candidate or ci.get('status') != 'completed'
            or ci.get('conclusion') != 'success'
            or ci.get('name') != 'CI'
            or (ci.get('head_repository') or {}).get('full_name') != 'gaben1488/dash'):
        raise ValueError('EXACT_CANDIDATE_CI_REQUIRED')


def candidate_source_receipt(repo, candidate, ci, *, derivation_run_id):
    """Authenticated management job calls this on its exact clean Git checkout.

    The transport contains public code hashes only. Its trusted channel/job
    provenance is enforced by the existing release gate, not by a self-declared
    Boolean inside the image. No Git/runtime dependency is installed in Node.
    """
    import hashlib
    import subprocess

    _require_candidate_ci(candidate, ci)
    if type(ci.get('id')) is not int or ci['id'] <= 0 or type(derivation_run_id) is not int or derivation_run_id <= 0:
        raise ValueError('TRUSTED_CANDIDATE_JOB_RECEIPT_REQUIRED')
    repo = Path(repo)
    head = subprocess.run(['git','-C',str(repo),'rev-parse','HEAD'],check=True,capture_output=True,text=True).stdout.strip()
    paths = ['deploy/plan-weekly-publications.py','deploy/stateful_backup.py',
             'packages/report-engine/src/procurement_engine']
    if head != candidate or subprocess.run(['git','-C',str(repo),'diff','--quiet',candidate,'--',*paths],check=False).returncode:
        raise ValueError('EXACT_CANDIDATE_SOURCE_REQUIRED')
    names = subprocess.run(['git','-C',str(repo),'ls-tree','-r','--name-only',candidate,'--',*paths],
                           check=True,capture_output=True,text=True).stdout.splitlines()
    hashes = {}
    for name in names:
        if name.endswith('.py'):
            content = subprocess.run(['git','-C',str(repo),'show',candidate+':'+name],check=True,capture_output=True).stdout
            hashes[name] = hashlib.sha256(content).hexdigest()
    return {'contract':'exact-ci-public-code-v1','repository':'gaben1488/dash','candidate':candidate,
            'ci_run_id':ci['id'],'derivation_run_id':derivation_run_id,'file_hashes':hashes}


def validate_operator_runtime(candidate, ci, reader_package, source_receipt=None):
    import hashlib

    _require_candidate_ci(candidate, ci)
    repo = Path(__file__).resolve().parents[1]
    if source_receipt is None:
        source_receipt = candidate_source_receipt(repo, candidate, ci, derivation_run_id=ci.get('id'))
    if source_receipt is not None:
        if (source_receipt.get('contract') != 'exact-ci-public-code-v1'
                or source_receipt.get('candidate') != candidate
                or source_receipt.get('repository') != 'gaben1488/dash'
                or source_receipt.get('ci_run_id') != ci.get('id')
                or type(ci.get('id')) is not int or ci['id'] <= 0
                or type(source_receipt.get('derivation_run_id')) is not int
                or source_receipt['derivation_run_id'] <= 0):
            raise ValueError('TRUSTED_CANDIDATE_JOB_RECEIPT_REQUIRED')
        # Receipt is delivered by the authenticated management job via read-only
        # public-code transport. A caller-provided verified=True is never used.
        expected_transport = source_receipt.get('file_hashes')
        actual_transport = {p.relative_to(repo).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (repo / 'packages/report-engine/src/procurement_engine').rglob('*.py')}
        for name in ('deploy/plan-weekly-publications.py', 'deploy/stateful_backup.py'):
            actual_transport[name] = hashlib.sha256((repo / name).read_bytes()).hexdigest()
        if expected_transport != actual_transport:
            raise ValueError('EXACT_CANDIDATE_SOURCE_REQUIRED')
    source = repo / 'packages/report-engine/src/procurement_engine'
    installed = Path(reader_package) if reader_package else None
    if installed is None or installed.is_symlink() or not installed.is_dir():
        raise ValueError('READER_RUNTIME_COMPATIBILITY_REQUIRED')
    from procurement_engine import publication_store as native
    if Path(native.__file__).parent.resolve() != installed.resolve():
        raise ValueError('READER_RUNTIME_OWNERSHIP_CHANGED')
    # Exact installed reader/writer module tree, not a declared image tag.
    expected = {p.relative_to(source).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in source.rglob('*.py')}
    observed = {p.relative_to(installed).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in installed.rglob('*.py') if not p.is_symlink()}
    if observed != expected or any(p.is_symlink() for p in installed.rglob('*')):
        raise ValueError('READER_RUNTIME_COMPATIBILITY_REQUIRED')
    verify_reader_compatibility(installed)
    return repo


def operator_preflight(state, *, operation, candidate, ci, reader_package,
                       expected_revision, backup, store=None, source_receipt=None, publication_plan=None):
    """Native admission before the owned reader/writer drain.

    CI evidence must come from the authenticated release gate, not a browser.
    A Caddy reload is not proof that already-spawned report/archive children ended.
    No timer, runtime, Caddy configuration or mutable state is changed here.
    """
    if operation not in {'apply', 'recover', 'rollback', 'finalize'}:
        raise ValueError('OPERATION_INVALID')
    repo = validate_operator_runtime(candidate, ci, reader_package, source_receipt)
    validate_operator_state_owner(state)
    module, trusted = _trusted_backup(backup, repo)
    journal_exists = store is not None and (store.root / '.retirement/journal.json').is_file()
    if operation == 'apply' or (operation == 'recover' and not journal_exists):
        # Only compact_publications supplies this in-process plan, while holding
        # all native locks. CLI never accepts a caller-serialized plan.
        fresh = publication_plan if publication_plan is not None else (
            store.plan_compaction(protected_release_ids=_unbacked_roots(store, trusted)) if store else plan(state, backup=backup))
        if operation == 'apply' and expected_revision != 'live' and fresh['catalog_revision'] != expected_revision:
            raise ValueError('PUBLICATION_RETENTION_PLAN_CHANGED')
        if not fresh['identity_ready']:
            raise ValueError('PUBLICATION_RETENTION_IDENTITY_MISSING')
        originals = {rid: Path(state) / 'published/releases' / rid for rid in fresh['retire_release_ids']}
    else:
        if store is None:
            raise ValueError('MAINTENANCE_LEASE_REQUIRED')
        work, entries = store._retirement_entries()
        if operation == 'finalize' and json.loads((work / 'journal.json').read_text()).get('plan_revision') != expected_revision:
            raise ValueError('INDEPENDENT_FINALIZE_REVIEW_REQUIRED')
        originals = {entry['release_id']: (work / 'original' / entry['release_id']
                     if (work / 'original' / entry['release_id']).is_dir()
                     else store.releases / entry['release_id']) for entry in entries}
    # Only sealed original publication roots must match the trusted old backup.
    # New mutable SQLite/WAL/status/ledger are NOT a rollback target.
    for rid, original_root in originals.items():
        prefix = 'reports/published/releases/' + rid + '/'
        original = module.inventory(original_root, require_complete=False)
        expected_root = {k[len(prefix):]: v for k, v in trusted.items()
                         if k.startswith(prefix) and k != prefix}
        if not expected_root or original != expected_root:
            raise ValueError('IMMUTABLE_PUBLICATION_BACKUP_MISMATCH')
    result = {'status': 'PREREQUISITES_VERIFIED', 'original_roots': len(originals)}
    if operation == 'apply' and expected_revision == 'live':
        result['plan'] = {key: value for key, value in fresh.items() if key != 'records'}
    return result


def validate_operator_state_owner(state):
    import os

    root = Path(state) / 'published'
    if root.is_symlink() or root.stat().st_uid != os.geteuid():
        # New private journal/staged roots must remain readable by the same
        # report data owner after EX lease release; no blanket chown/restore.
        raise ValueError('PUBLICATION_DATA_OWNER_MISMATCH')


def operate(state, *, operation, candidate, ci, reader_package, expected_revision, backup,
            finalize_review=None, source_receipt=None):
    """One-time native operation, with proof repeated after reader/writer drain.

    No runtime/config/timer switch and no full-state restore. Kernel leases are
    released on process death; the durable journal keeps report GET fail-closed
    until this same reviewed candidate performs explicit recovery. Quarantine is
    retained by apply, and never automatically finalized by failure recovery.
    """
    from procurement_engine.publication_store import PublicationStore

    # Early authorization and installed-reader checks precede even lock bootstrap.
    validate_operator_runtime(candidate, ci, reader_package, source_receipt)
    validate_operator_state_owner(state)
    store = PublicationStore(Path(state) / 'published', readonly=True)
    if not (store.root.parent / 'publication-readers.lock').is_file() or (store.root.parent / 'publication-readers.lock').is_symlink():
        raise ValueError('PUBLICATION_READER_LEASE_UNINITIALIZED')
    def gate(locked, publication_plan=None):
        return operator_preflight(state, operation=operation, candidate=candidate, ci=ci,
            reader_package=reader_package, expected_revision=expected_revision, backup=backup,
            store=locked, source_receipt=source_receipt, publication_plan=publication_plan)
    if operation == 'apply':
        try:
            _, trusted = _trusted_backup(backup, Path(__file__).resolve().parents[1])
            return store.compact_publications(expected_revision=expected_revision, plan_preflight=gate,
                                              protected_release_ids=_unbacked_roots(store, trusted))
        except BaseException:
            # Release/drain locks first. Only the owned immutable publication
            # transaction is recovered; post-backup mutable state is untouched.
            # SIGKILL still leaves a durable fence for explicit recovery/watchdog.
            if (store.root / '.retirement').exists():
                def recovery_gate(locked):
                    return operator_preflight(state, operation='recover', candidate=candidate, ci=ci,
                        reader_package=reader_package, expected_revision=expected_revision,
                        backup=backup, store=locked, source_receipt=source_receipt)
                store.recover_compaction(preflight=recovery_gate)
            raise
    if operation == 'recover':
        return store.recover_compaction(preflight=gate)
    if operation == 'rollback':
        return store.rollback_compaction(preflight=gate)
    if operation == 'finalize':
        if finalize_review != candidate + ':' + expected_revision:
            raise ValueError('INDEPENDENT_FINALIZE_REVIEW_REQUIRED')
        return store.finalize_compaction(preflight=gate)
    raise ValueError('OPERATION_INVALID')



def require_watchdog_lifecycle():
    import os

    if os.getpid() == 1:
        raise ValueError('WATCHDOG_LIFECYCLE_UNPROVEN')
    if Path('/.dockerenv').is_file() and Path('/proc/1/comm').read_text().strip() != 'node':
        # A one-off container (also with tini) kills sibling watchers on exit.
        # Resident Node exec or independently owned host orchestration is needed.
        raise ValueError('WATCHDOG_LIFECYCLE_UNPROVEN')


def owner_start_token(pid):
    """Linux PID birth identity: never attach recovery to a reused PID."""
    fields = Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()
    return None if fields[0] == 'Z' else fields[19]


def watch_owner_then_recover(pid, start_token, state, **options):
    import time

    while True:
        try:
            same_owner = owner_start_token(pid) == start_token
        except (OSError, IndexError):
            same_owner = False
        if not same_owner:
            break
        time.sleep(0.1)
    if not (Path(state) / 'published/.retirement').exists():
        return {'status': 'UNCHANGED'}
    # Re-check exact runtime/source/backup ownership under the native EX lease.
    # Recovery alone; never finalize or restore mutable post-backup state.
    return operate(state, operation='recover', **options)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', required=True)
    parser.add_argument('--operation', choices=('census', 'apply', 'recover', 'rollback', 'finalize'), default='census')
    parser.add_argument('--candidate')
    parser.add_argument('--ci-evidence')
    parser.add_argument('--reader-package')
    parser.add_argument('--expected-revision')
    parser.add_argument('--backup')
    parser.add_argument('--finalize-review')
    parser.add_argument('--watch-owner', type=int)
    parser.add_argument('--watch-start')
    parser.add_argument('--source-receipt')
    args = parser.parse_args(argv)
    try:
        if args.operation != 'census':
            ci = json.loads(Path(args.ci_evidence).read_text()) if args.ci_evidence else {}
            source_receipt = json.loads(Path(args.source_receipt).read_text()) if args.source_receipt else None
            options = {'source_receipt':source_receipt, 'candidate':args.candidate, 'ci':ci, 'reader_package':args.reader_package,
                       'expected_revision':args.expected_revision, 'backup':args.backup}
            if args.watch_owner is not None:
                if args.operation != 'recover' or not args.watch_start:
                    raise ValueError('WATCHDOG_OPERATION_INVALID')
                result = watch_owner_then_recover(args.watch_owner, args.watch_start, args.state, **options)
            else:
                if args.operation == 'apply':
                    import os
                    import subprocess
                    import sys
                    if not all((args.candidate, args.ci_evidence, args.reader_package, args.expected_revision, args.backup)):
                        raise ValueError('EXACT_CANDIDATE_CI_REQUIRED')
                    _require_candidate_ci(args.candidate, ci)
                    require_watchdog_lifecycle()
                    validate_operator_runtime(args.candidate, ci, args.reader_package, source_receipt)
                    validate_operator_state_owner(args.state)
                    log_path = Path(args.state) / 'compaction-watchdog.log'
                    if log_path.is_symlink():
                        raise ValueError('WATCHDOG_LOG_UNSAFE')
                    descriptor = os.open(log_path, os.O_CREAT | os.O_APPEND | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
                    source_args = ['--source-receipt', args.source_receipt] if args.source_receipt else []
                    with os.fdopen(descriptor, 'ab') as log:
                        subprocess.Popen([sys.executable, '-B', str(Path(__file__).resolve()), '--state', args.state,
                        '--operation', 'recover', '--candidate', args.candidate, '--ci-evidence', args.ci_evidence,
                        '--reader-package', args.reader_package, '--expected-revision', args.expected_revision,
                        '--backup', args.backup, '--watch-owner', str(os.getpid()),
                        '--watch-start', owner_start_token(os.getpid()), *source_args], start_new_session=True,
                            stdin=subprocess.DEVNULL, stdout=log, stderr=log)
                result = operate(args.state, operation=args.operation, **options,
                                 finalize_review=args.finalize_review)
            print(json.dumps(result, sort_keys=True))
            return 0
        result = plan(args.state, backup=args.backup)
    except Exception as error:  # noqa: BLE001 — CLI boundary never exposes private paths or content.
        import re
        code = 'RETENTION_CENSUS_FAILED'
        if args.operation != 'census':
            code = (str(error) if isinstance(error, ValueError)
                    and re.fullmatch(r'[A-Z][A-Z_]{4,127}', str(error))
                    else 'PUBLICATION_COMPACTION_FAILED')
        print(json.dumps({'status': 'CENSUS_BLOCKED' if args.operation == 'census' else 'COMPACTION_BLOCKED', 'error_code': code}))
        return 2
    result.pop('keep_release_ids')
    result.pop('retire_release_ids')
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

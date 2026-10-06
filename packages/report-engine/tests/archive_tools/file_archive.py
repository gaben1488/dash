"""Original XLSX/ZIP intake, with byte-bound cached-value evidence.

The administrator enrols a source manifest, not a new business spreadsheet. It
binds roles to exact archived files/hashes and a declared historical cutoff.
Dates in filenames or present-day Google values never supply missing evidence.
No source spreadsheet is modified and no formula is executed.
"""
from __future__ import annotations

import base64
import hashlib
import io
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath

from procurement_engine.archived_evidence import (
    FORMAT,
    MAX_FILE_SET_BYTES,
    MAX_JSON_BYTES,
    FileArchiveError,
    _decode_json,
    _manifest,
    _sources,
    verify_archived_values,
)
from procurement_engine.snapshot import canonical_semantic_hash
from procurement_engine.xlsx_raw import (
    MAX_PACKAGE_BYTES,
    XlsxEvidenceError,
    checked_members,
)


def read_original_files(archive_path, manifest):
    """Read registered bytes, without extractall, path guessing or network I/O."""
    _manifest(manifest)
    root = Path(archive_path)
    if root.is_symlink():
        raise FileArchiveError('ARCHIVE_FILE_PATH_INVALID')
    names = manifest['files']
    if root.is_dir():
        result = {}
        for name in names:
            current = root
            for part in PurePosixPath(name).parts:
                current = current / part
                if current.is_symlink():
                    raise FileArchiveError('ARCHIVE_FILE_PATH_INVALID', file=name)
            if not current.is_file():
                raise FileArchiveError('ARCHIVE_FILE_MISSING', file=name)
            if current.stat().st_size > MAX_PACKAGE_BYTES:
                raise FileArchiveError('ARCHIVE_FILE_SET_LIMIT', file=name)
            result[name] = current.read_bytes()
            if sum(map(len, result.values())) > MAX_FILE_SET_BYTES:
                raise FileArchiveError('ARCHIVE_FILE_SET_LIMIT')
        # AFTER barrier across the entire source set, not one file at a time.
        for name, content in result.items():
            current = root / name
            if current.is_symlink() or hashlib.sha256(current.read_bytes()).digest() != hashlib.sha256(content).digest():
                raise FileArchiveError('ARCHIVE_CHANGED', file=name)
    else:
        if not root.is_file() or root.stat().st_size > MAX_FILE_SET_BYTES:
            raise FileArchiveError('ARCHIVE_FILE_MISSING')
        content = root.read_bytes()
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                members = checked_members(archive)
                missing = sorted(set(names) - set(members))
                if missing:
                    raise FileArchiveError('ARCHIVE_FILE_MISSING', file=missing[0])
                if sum(members[name].file_size for name in names) > MAX_FILE_SET_BYTES:
                    raise FileArchiveError('ARCHIVE_FILE_SET_LIMIT')
                result = {name: archive.read(name) for name in names}
        except (zipfile.BadZipFile, XlsxEvidenceError) as error:
            raise FileArchiveError('ARCHIVE_FILE_CONTAINER_INVALID') from error
        if hashlib.sha256(root.read_bytes()).digest() != hashlib.sha256(content).digest():
            raise FileArchiveError('ARCHIVE_CHANGED')
    for name, content in result.items():
        if hashlib.sha256(content).hexdigest() != names[name]:
            raise FileArchiveError('ARCHIVE_FILE_HASH_MISMATCH', file=name)
    return result


def capture_file_archive(archive_path, manifest):
    """Build the existing engine's input; never inherit a current ledger or identity."""
    from procurement_engine.recommendation_history import enroll_history_package
    from procurement_engine.runtime_inputs import validate_inputs

    day, registry = _manifest(manifest)
    files = read_original_files(archive_path, manifest)
    ledger = _decode_json(files[manifest['ledger_file']])
    validate_inputs(registry, ledger)
    evidence = {'format': FORMAT, 'manifest': manifest,
                'files': {name: base64.b64encode(content).decode('ascii') for name, content in files.items()}}
    origin = {'contract': 'xlsx-archive-v1', 'bundle_sha256': canonical_semantic_hash(manifest),
              'report_date': day, 'cutoff_at': manifest['cutoff_at'],
              'basis': 'Values cached in registered archived XLSX bytes; declared historical cutoff, not a live provider capture.',
              'upstream_formula_freshness_verified': False}
    capture = {'captured_at': manifest['cutoff_at'], 'timezone': manifest['timezone'],
               'report_date': '.'.join(reversed(day.split('-'))), 'report_year': int(day[:4]),
               'sources': _sources(manifest, files), 'archive_origin': origin,
               'archived_file_evidence': evidence}
    if manifest.get('history_file'):
        package = _decode_json(files[manifest['history_file']])
        ledger, _ = enroll_history_package(package, ledger)
        capture['recommendation_history_evidence'] = {'package': package,
            'metadata': {'file_sha256': manifest['files'][manifest['history_file']], 'capture_method': 'archived-file'}}
    return capture, registry, ledger, files


def import_file_archive(archive_path, manifest, state_dir):
    """Seal original weekly inputs for the existing run-archive command.

    Ingest is separate from publication. Invalid data can be retained as evidence
    without labelling a business report verified. Production inputs are untouched.
    """
    import fcntl
    import os
    import shutil
    import tempfile
    from contextlib import closing
    from datetime import timezone

    from procurement_engine.adapters import normalize_master_values
    from procurement_engine.identity_store import IdentityStore
    from procurement_engine.raw_pipeline import bundle_from_capture
    from procurement_engine.runtime import _write
    from procurement_engine.snapshot_bundle_io import (
        persist_atomic_bundle,
        verify_persisted_bundle,
    )

    capture, registry, ledger, files = capture_file_archive(archive_path, manifest)
    verify_archived_values(capture, registry=registry, ledger=ledger)
    bundle = bundle_from_capture(capture, registry, ledger)
    archives = Path(state_dir) / 'archives'
    if Path(state_dir).is_symlink() or archives.is_symlink():
        raise FileArchiveError('ARCHIVE_FILE_PATH_INVALID')
    archives.mkdir(parents=True, exist_ok=True, mode=0o700)
    key = 'XLSX-' + canonical_semantic_hash(manifest)
    target = archives / key
    with (archives / '.import.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if target.exists():
            if target.is_symlink() or verify_persisted_bundle(target / 'snapshot_bundle'):
                raise FileArchiveError('ARCHIVE_CORRUPT')
            from procurement_engine.archive_runtime import _frozen_fingerprint
            _frozen_fingerprint(target)
            return {'archive_id': key, 'report_date': capture['report_date'], 'status': 'ALREADY_IMPORTED'}
        stage = Path(tempfile.mkdtemp(prefix='.import-', dir=archives))
        try:
            persist_atomic_bundle(bundle, stage / 'snapshot_bundle')
            if manifest.get('identity_file'):
                if not files[manifest['identity_file']].startswith(b'SQLite format 3\x00'):
                    raise FileArchiveError('ARCHIVE_IDENTITY_INVALID')
                (stage / 'identity.sqlite').write_bytes(files[manifest['identity_file']])
                # Open only the private copy and retain its dated reviews.
                identity = IdentityStore(stage / 'identity.sqlite')
                with closing(identity.connect()) as db:
                    cutoff = datetime.fromisoformat(manifest['cutoff_at'].replace('Z', '+00:00'))
                    for table, field in (('snapshots', 'captured_at'), ('reviews', 'reviewed_at')):
                        for record in db.execute(f'SELECT {field} FROM {table}'):
                            instant = datetime.fromisoformat(record[0].replace('Z', '+00:00'))
                            if instant.tzinfo is None or instant > cutoff:
                                raise FileArchiveError('ARCHIVE_IDENTITY_AFTER_CUTOFF')
            else:
                identity = IdentityStore(stage / 'identity.sqlite')
            # Seed ONCE per immutable archive, independent of selected plan period.
            # Different quarters copy this baseline, never bootstrap random new UIDs.
            rows = []
            for source in capture['sources']:
                if source['role'] == 'master':
                    rows.extend(normalize_master_values(source['values'],
                        snapshot_id=bundle.manifest['snapshot_id'], expected_grbs=source['grbs'],
                        data_start_row=source['header_rows'], source_id=source['provider_id'],
                        sheet_name=source['sheet']))
            identity.ingest(rows, snapshot_id=bundle.manifest['snapshot_id'],
                            captured_at=capture['captured_at'], allow_plan_updates=True)
            _write(stage / 'import.json', {'archive_id': key, 'report_date': capture['report_date'],
                    'imported_at': datetime.now(timezone.utc).isoformat(),
                    'source_cutoff_at': manifest['cutoff_at'], 'source_manifest': manifest,
                    'identity_seed_snapshot_id': bundle.manifest['snapshot_id'],
                    'identity_sha256': hashlib.sha256((stage / 'identity.sqlite').read_bytes()).hexdigest(),
                    'publication_created': False})
            for path in stage.rglob('*'):
                if path.is_file():
                    os.chmod(path, 0o600)
                    with path.open('rb') as stream:
                        os.fsync(stream.fileno())
            directories = [p for p in stage.rglob('*') if p.is_dir()] + [stage]
            for directory in sorted(directories, key=lambda p: len(p.parts), reverse=True):
                fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
            os.rename(stage, target)
            fd = os.open(archives, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        finally:
            if stage.exists():
                shutil.rmtree(stage)
    return {'archive_id': key, 'report_date': capture['report_date'], 'status': 'IMPORTED'}


INBOX_MESSAGE = ('Проверка исходных файлов недельного архива не пройдена. '
    'Сопровождение должно восстановить комплект среза по сохранённому описанию источников. '
    'Рабочие таблицы и прошлый Word исправлять не нужно; текущие данные не подставлялись.')


def import_inbox_week(state_dir, day):
    """Trusted service inbox, exact date only; HTTP callers never supply a path.

    A collector/admin stages originals and writes manifest.json LAST. The native
    prepare action does the import, seed and validation automatically. No business
    sheet conversion or user-maintained second ledger is required.
    """
    import os

    from procurement_engine.archive_runtime import ArchiveError
    from procurement_engine.runtime import _write

    state = Path(state_dir)
    parent = state / 'archive_inbox'
    folder = parent / day
    path = folder / 'manifest.json'
    if state.is_symlink() or parent.is_symlink() or folder.is_symlink() or path.is_symlink():
        raise ArchiveError('ARCHIVE_INTAKE_FAILED')
    if not path.exists():
        return None
    work = state / 'archive_intake' / day
    work.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        if path.stat().st_size > MAX_JSON_BYTES:
            raise FileArchiveError('ARCHIVE_JSON_LIMIT')
        manifest = _decode_json(path.read_bytes())
        declared_day, _ = _manifest(manifest)
        if day != declared_day:
            raise FileArchiveError('ARCHIVE_FILE_DATE_MISMATCH')
        result = import_file_archive(folder, manifest, state)
    except Exception as error:
        detail = error.issue if isinstance(error, FileArchiveError) else {'code': 'ARCHIVE_IMPORT_FAILED'}
        _write(work / 'error.json', {**detail, 'exception_class': type(error).__name__,
            'owner': 'ENGINE', 'message': INBOX_MESSAGE})
        os.chmod(work / 'error.json', 0o600)
        raise ArchiveError('ARCHIVE_INTAKE_FAILED') from error
    _write(work / 'status.json', result)
    return result

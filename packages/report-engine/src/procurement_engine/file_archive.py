"""Original XLSX/ZIP intake, with byte-bound cached-value evidence.

The administrator enrols a source manifest, not a new business spreadsheet. It
binds roles to exact archived files/hashes and a declared historical cutoff.
Dates in filenames or present-day Google values never supply missing evidence.
No source spreadsheet is modified and no formula is executed.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import io
import json
import re
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from zoneinfo import ZoneInfo

from .normalize import parse_date
from .snapshot import canonical_semantic_hash
from .xlsx_raw import (
    MAX_PACKAGE_BYTES,
    WorkbookEvidence,
    XlsxEvidenceError,
    checked_members,
)

FORMAT = 'xlsx-report-week-v1'
MAX_FILE_SET_BYTES = 192 * 1024 * 1024
MAX_JSON_BYTES = 32 * 1024 * 1024


class FileArchiveError(ValueError):
    def __init__(self, code, *, source=None, file=None, details=None):
        super().__init__(code)
        self.issue = {'code': code, 'source_id': source, 'file': file, 'details': details}


def _safe_name(name):
    if (not isinstance(name, str) or not name or '\\' in name or ':' in name
            or name.startswith('/') or '..' in PurePosixPath(name).parts or str(PurePosixPath(name)) != name):
        raise FileArchiveError('ARCHIVE_FILE_PATH_INVALID')
    return name


def _decode_json(content):
    if len(content) > MAX_JSON_BYTES:
        raise FileArchiveError('ARCHIVE_JSON_LIMIT')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise FileArchiveError('ARCHIVE_DUPLICATE_JSON_KEY')
            result[key] = value
        return result
    try:
        return json.loads(content, object_pairs_hook=pairs,
                          parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (ValueError, UnicodeError) as error:
        if isinstance(error, FileArchiveError):
            raise
        raise FileArchiveError('ARCHIVE_JSON_INVALID') from error


def _manifest(manifest):
    from .runtime_inputs import validate_inputs

    if not isinstance(manifest, dict) or manifest.get('format') != FORMAT:
        raise FileArchiveError('ARCHIVE_FILE_MANIFEST_INVALID')
    try:
        cutoff = datetime.fromisoformat(manifest['cutoff_at'].replace('Z', '+00:00'))
        zone = ZoneInfo(manifest['timezone'])
        if cutoff.tzinfo is None:
            raise ValueError
        day = cutoff.astimezone(zone).date().isoformat()
        if parse_date(manifest['report_date']) != day:
            raise ValueError
        registry = manifest['registry']
        validate_inputs(registry, [])
    except (KeyError, TypeError, ValueError) as error:
        raise FileArchiveError('ARCHIVE_FILE_CONTRACT_INVALID', details=str(error)) from error
    files = manifest.get('files')
    if (not isinstance(files, dict) or not files or len(files) > 100
        or any(not isinstance(value, str) or not re.fullmatch('[0-9a-f]{64}', value) for value in files.values())):
        raise FileArchiveError('ARCHIVE_FILE_HASH_CONTRACT_INVALID')
    for name in files:
        _safe_name(name)
    wanted = [source.get('archive_file') for source in registry['sources']]
    wanted.append(manifest.get('ledger_file'))
    wanted.extend(manifest[key] for key in ('history_file', 'identity_file') if key in manifest)
    if any(not isinstance(name, str) or name not in files for name in wanted):
        raise FileArchiveError('ARCHIVE_FILE_CONTRACT_INCOMPLETE')
    # Extra files are also sealed, but never inferred as missing mandatory roles.
    return day, registry


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


def _sources(manifest, files):
    result, workbooks = [], {}
    for contract in manifest['registry']['sources']:
        sid = contract['source_id']; name = contract['archive_file']
        if name not in workbooks:
            try:
                workbooks[name] = WorkbookEvidence(files[name])
            except XlsxEvidenceError as error:
                raise FileArchiveError(str(error).split(':')[0], source=sid, file=name) from error
        book = workbooks[name]
        try:
            sheet = book.sheet(contract['sheet'])
            values, width = sheet.matrix(min_rows=contract['header_rows'], min_columns=contract['columns'])
        except XlsxEvidenceError as error:
            raise FileArchiveError(str(error).split(':')[0], source=sid, file=name, details=str(error)) from error
        # Google sheetId and OOXML sheetId are distinct namespaces. Bind the
        # original registered source ID to the explicitly selected exported title.
        evidence = {'rows': len(values), 'columns': width, 'formulas': sheet.formulas,
                    'sheets': [{'title': title, 'sheetId': data[0]} for title, data in book.sheets.items()],
                    'named_ranges': book.named_ranges, 'basis': 'original-xlsx-cached-cells',
                    'xlsx_sheet_id': sheet.sheet_id}
        if width > contract['columns']:
            evidence['extra_values'] = [row[contract['columns']:] for row in values]
        result.append({**{k: contract.get(k) for k in
                           ('source_id', 'provider_id', 'sheet_id', 'sheet', 'role', 'grbs', 'columns', 'header_rows')},
                       'rows': len(values), 'values': [row[:contract['columns']] for row in values],
                       'before': 'file-sha256:' + book.sha256, 'after': 'file-sha256:' + book.sha256,
                       'archive_file_sha256': book.sha256, 'capture_method': 'xlsx_cached_archive',
                       'formula_evidence': evidence})
    return result


def capture_file_archive(archive_path, manifest):
    """Build the existing engine's input; never inherit a current ledger or identity."""
    from .recommendation_history import enroll_history_package
    from .runtime_inputs import validate_inputs

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


def verify_archived_values(capture, *, registry=None, ledger=None):
    """Verify matrices/formulas back to original bytes, also at publication/read.

    This verifies recorded cache observations, NOT an execution of Excel formulae.
    The caller must still run independent numeric/period/content audits.
    """
    from .recommendation_history import enroll_history_package

    evidence = capture.get('archived_file_evidence')
    if not isinstance(evidence, dict) or evidence.get('format') != FORMAT:
        raise FileArchiveError('ARCHIVE_FILE_EVIDENCE_MISSING')
    manifest = evidence.get('manifest'); day, saved_registry = _manifest(manifest)
    encoded = evidence.get('files')
    if not isinstance(encoded, dict) or set(encoded) != set(manifest['files']):
        raise FileArchiveError('ARCHIVE_FILE_SET_MISMATCH')
    files = {}
    if sum(len(v) if isinstance(v, str) else MAX_FILE_SET_BYTES * 2 for v in encoded.values()) > MAX_FILE_SET_BYTES * 4 // 3 + len(encoded) * 4:
        raise FileArchiveError('ARCHIVE_FILE_SET_LIMIT')
    for name, value in encoded.items():
        try:
            content = base64.b64decode(value, validate=True)
        except (ValueError, TypeError, binascii.Error) as error:
            raise FileArchiveError('ARCHIVE_FILE_ENCODING_INVALID') from error
        if hashlib.sha256(content).hexdigest() != manifest['files'][name]:
            raise FileArchiveError('ARCHIVE_FILE_HASH_MISMATCH', file=name)
        files[name] = content
    if parse_date(capture['report_date']) != day:
        raise FileArchiveError('ARCHIVE_FILE_DATE_MISMATCH')
    if capture.get('captured_at', manifest['cutoff_at']) != manifest['cutoff_at']:
        raise FileArchiveError('ARCHIVE_FILE_DATE_MISMATCH')
    origin = capture.get('archive_origin') or {}
    if origin.get('contract') not in {'xlsx-archive-v1', 'frozen-archive-v1'}:
        raise FileArchiveError('ARCHIVE_FILE_ORIGIN_MISSING')
    if origin.get('cutoff_at') != manifest['cutoff_at'] or parse_date(origin.get('report_date')) != day:
        raise FileArchiveError('ARCHIVE_FILE_DATE_MISMATCH')
    if origin['contract'] == 'xlsx-archive-v1' and origin.get('bundle_sha256') != canonical_semantic_hash(manifest):
        raise FileArchiveError('ARCHIVE_FILE_MANIFEST_MISMATCH')
    expected = _sources(manifest, files)
    actual = capture.get('sources')
    if not isinstance(actual, list) or len(actual) != len(expected):
        raise FileArchiveError('ARCHIVE_FILE_SOURCE_MISMATCH')
    actual_by_id = {source['source_id']: source for source in actual}
    for source in expected:
        observed = actual_by_id.get(source['source_id'], {})
        # The publication reader does not carry revision strings in its matrix
        # projection; all business cells and original-formula evidence MUST match.
        for key in source.keys() - {'before', 'after'}:
            if observed.get(key) != source[key]:
                raise FileArchiveError('ARCHIVE_FILE_MATRIX_MISMATCH', source=source['source_id'], details=key)
    if registry is not None and registry != saved_registry:
        raise FileArchiveError('ARCHIVE_FILE_REGISTRY_MISMATCH')
    original_ledger = _decode_json(files[manifest['ledger_file']])
    if manifest.get('history_file'):
        history = _decode_json(files[manifest['history_file']])
        original_ledger, _ = enroll_history_package(history, original_ledger)
        if (capture.get('recommendation_history_evidence') or {}).get('package') != history:
            raise FileArchiveError('ARCHIVE_FILE_HISTORY_MISMATCH')
    elif capture.get('recommendation_history_evidence') is not None:
        raise FileArchiveError('ARCHIVE_FILE_HISTORY_MISMATCH')
    if ledger is not None and ledger != original_ledger:
        raise FileArchiveError('ARCHIVE_FILE_LEDGER_MISMATCH')
    return {'closed': True, 'issues': [], 'edges': [],
            'verification_kind': 'original-xlsx-cache-observations-v1',
            'formula_execution_verified': False, 'upstream_formula_freshness_verified': False,
            'scope': 'Every input matrix and stored formula is checked against registered original archived bytes. No recalculation or live-source freshness is asserted.'}


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

    from .adapters import normalize_master_values
    from .identity_store import IdentityStore
    from .raw_pipeline import bundle_from_capture
    from .runtime import _write
    from .snapshot_bundle_io import persist_atomic_bundle, verify_persisted_bundle

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
            from .archive_runtime import _frozen_fingerprint
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

    from .archive_runtime import ArchiveError
    from .runtime import _write

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

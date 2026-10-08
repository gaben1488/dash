"""Materialize an exact archived context without Google or current-ledger reads.

Legacy dashboard snapshots are useful but do not contain a complete report input.
They must never be silently padded with today's procedures/recommendations. Saved
full input bundles reuse the normal engine and publication gates, not a second
arithmetic or Word renderer. All archive writes are separate from the live worker.
"""
from __future__ import annotations

import fcntl
import json
import shutil
import sqlite3
import tempfile
from contextlib import closing
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .identity_store import IdentityStore
from .normalize import parse_date
from .publication_store import PublicationStore, _files, _hash
from .raw_pipeline import RAW_RULES_VERSION, build_from_capture
from .runtime import _write
from .runtime_inputs import validate_inputs
from .snapshot import canonical_semantic_hash
from .snapshot_bundle_io import verify_persisted_bundle


class ArchiveError(ValueError):
    """Fixed, non-sensitive failure code at the CLI/API boundary."""


MESSAGES = {
    'ARCHIVE_NOT_FOUND': 'За выбранную дату полный архив входных данных не найден. Текущие таблицы не использованы.',
    'ARCHIVE_INPUT_INCOMPLETE': 'Снимок страницы сохранился, но полного набора входов отчёта в нём нет. Требуется восстановление полного снимка входов генератора; переписывать отчёт вручную не нужно.',
    'ARCHIVE_CORRUPT': 'Проверка целостности архива не пройдена. Требуется восстановление архивной копии; рабочие таблицы менять не нужно.',
    'ARCHIVE_CHANGED': 'Архив изменился во время обработки. Выпуск отменён; требуется проверка хранения архива.',
    'ARCHIVE_BUILD_FAILED': 'Сборка архивного отчёта не прошла контроль. Это задача сопровождения; последний сохранённый выпуск не заменён.',
    'ARCHIVE_INTAKE_FAILED': 'Проверка исходных файлов недельного архива не пройдена. Сопровождение должно восстановить комплект среза. Рабочие таблицы и прошлый Word менять не нужно; текущие данные не использованы.',
    'ARCHIVE_BUSY': 'Архивный комплект уже собирается. Готовность будет проверена автоматически.',
}


def selection_key(day, year, quarter):
    try:
        if (date.fromisoformat(day).isoformat() != day or type(year) is not int
                or not 1900 <= year <= 9999 or type(quarter) is not int or quarter not in (1, 2, 3, 4)):
            raise ValueError
    except (TypeError, ValueError) as exc:
        raise ArchiveError('PUBLICATION_CONTEXT_INVALID') from exc
    return f'{day}-{year}-q{quarter}'


def _read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def _frozen_fingerprint(root):
    if root.is_symlink() or (root / 'snapshot_bundle').is_symlink():
        raise ArchiveError('ARCHIVE_CORRUPT')
    result = _files(root / 'snapshot_bundle')
    identity = root / 'identity.sqlite'
    if identity.is_symlink() or not identity.is_file():
        raise ArchiveError('ARCHIVE_INPUT_INCOMPLETE')
    result['identity.sqlite'] = _hash(identity)
    intake = root / 'import.json'
    if intake.exists():
        if intake.is_symlink():
            raise ArchiveError('ARCHIVE_CORRUPT')
        receipt = _read(intake)
        if receipt.get('identity_sha256') != result['identity.sqlite']:
            raise ArchiveError('ARCHIVE_CORRUPT')
        result['import.json'] = _hash(intake)
    return result


def load_frozen_input(root, *, day, year, quarter):
    """Validate and restore only evidence enclosed in this exact frozen bundle."""
    selection_key(day, year, quarter)
    root = Path(root)
    before = _frozen_fingerprint(root)
    folder = root / 'snapshot_bundle'
    try:
        manifest = _read(folder / 'manifest.json')
        # Check paths BEFORE the generic persisted-bundle verifier opens payloads.
        for item in manifest['payload_index']:
            relative = Path(item['path'])
            if relative.is_absolute() or '..' in relative.parts:
                raise ArchiveError('ARCHIVE_CORRUPT')
        if verify_persisted_bundle(folder):
            raise ArchiveError('ARCHIVE_CORRUPT')
        bundle = _read(folder / 'bundle.json')
        if not bundle['after'] or bundle['before'] != bundle['after']:
            raise ArchiveError('ARCHIVE_CORRUPT')
        if parse_date(manifest['report_date']) != day:
            raise ArchiveError('ARCHIVE_NOT_FOUND')
        payloads = [_read(folder / item['path']) for item in manifest['payload_index']]
        def one(role):
            entries = [p['semantic_values'] for p in payloads if p['role'] == role]
            if len(entries) != 1:
                raise ArchiveError('ARCHIVE_INPUT_INCOMPLETE')
            return entries[0]
        registry, ledger = one('rule_contract'), one('historical_ledger')
        validate_inputs(registry, ledger)
        capture = {key: manifest[key] for key in ('captured_at', 'timezone', 'report_date')}
        capture.update(report_year=year, report_scope={'year': year, 'quarter': quarter}, sources=[])
        for payload in payloads:
            meta = payload.get('metadata') or {}
            if payload['role'] == 'archived_file_evidence':
                capture['archived_file_evidence'] = payload['semantic_values']
            if payload['role'] == 'historical_report_evidence':
                capture['recommendation_history_evidence'] = payload['semantic_values']
            if payload['role'] == 'authoritative_ledger_input':
                capture['authoritative_ledger_source'] = payload['semantic_values']
            if 'sheet_title' not in meta:
                continue
            sid = payload['source_id']
            source = {'source_id': sid, 'role': payload['role'], 'provider_id': payload['provider_id'],
                'sheet_id': int(payload['sheet_or_tab_id']), 'sheet': meta['sheet_title'],
                'grbs': meta.get('grbs'), 'rows': meta['row_count'], 'columns': meta['column_count'],
                'header_rows': meta.get('header_rows', 3), 'values': payload['semantic_values'],
                'before': bundle['before'][sid], 'after': bundle['after'][sid]}
            for key in ('capture_method', 'archive_file_sha256'):
                if key in meta:
                    source[key] = meta[key]
            if 'formula_evidence' in meta:
                source['formula_evidence'] = meta['formula_evidence']
            capture['sources'].append(source)
        capture['archive_origin'] = {
            'contract': 'frozen-archive-v1', 'snapshot_id': manifest['snapshot_id'],
            'bundle_sha256': canonical_semantic_hash(before), 'report_date': manifest['report_date'],
            'cutoff_at': manifest['cutoff_at'], 'rules_version': manifest['rules_version'],
        }
    except (OSError, KeyError, TypeError, ValueError) as exc:
        if isinstance(exc, ArchiveError):
            raise
        raise ArchiveError('ARCHIVE_CORRUPT') from exc
    if before != _frozen_fingerprint(root):
        raise ArchiveError('ARCHIVE_CHANGED')
    return capture, registry, ledger, before


def build_archived_release(source, state_dir, *, day, year, quarter):
    """Recompute the frozen inputs under installed rules; publish a new immutable ID.

    The final barrier checks ARCHIVE BYTES, not present-day provider revisions.
    The receipt explicitly identifies this as frozen-archive verification.
    """
    source, state = Path(source), Path(state_dir)
    key = selection_key(day, year, quarter)
    capture, registry, ledger, before = load_frozen_input(source, day=day, year=year, quarter=quarter)
    work = state / 'archive_attempts' / key
    work.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix='build-', dir=work) as folder:
        temp = Path(folder)
        # Never ingest an old week into the live IdentityStore or borrow later reviews.
        shutil.copyfile(source / 'identity.sqlite', temp / 'identity.sqlite')
        identity = IdentityStore(temp / 'identity.sqlite')
        model = build_from_capture(capture, registry, ledger, temp / 'bundle', identity_store=identity)
        if not model['release']['official_release_allowed']:
            _write(work / 'failure.json', {'blockers': model['release']['blockers']})
            error = ArchiveError('ARCHIVE_BUILD_FAILED')
            error.blockers = model['release']['blockers']
            error.source_issues = model.get('issues', [])
            raise error
        expected = _read(temp / 'bundle/snapshot_bundle/bundle.json')['after']
        def frozen_barrier():
            if before != _frozen_fingerprint(source):
                raise ArchiveError('ARCHIVE_CHANGED')
            return expected
        store = PublicationStore(state / 'published')
        receipt = store.publish(temp / 'bundle', read_revisions=frozen_barrier)
        return {**receipt, 'report_year': year, 'quarter': quarter}


def _source_for_day(state, day):
    """Prefer the sealed weekly truth; otherwise use the latest exact-date capture."""
    weekly = state / 'archives' / f'WEEKLY-{day}'
    if weekly.exists():
        try:
            if weekly.is_symlink() or not weekly.is_dir():
                raise ValueError
            quarter = (int(day[5:7]) - 1) // 3 + 1
            load_frozen_input(weekly, day=day, year=int(day[:4]), quarter=quarter)
            return weekly
        except (ArchiveError, KeyError, TypeError, ValueError, OSError) as exc:
            # A named weekly archive is authoritative for that day. Corruption is
            # never permission to fall through to a later attempt from the same day.
            raise ArchiveError('ARCHIVE_CORRUPT') from exc

    candidates = []
    for pattern in ('archives/*/snapshot_bundle/manifest.json',
                    'published/releases/*/snapshot_bundle/manifest.json',
                    'attempts/*/bundle/snapshot_bundle/manifest.json'):
        for path in state.glob(pattern):
            try:
                manifest = _read(path)
                if parse_date(manifest['report_date']) == day and (not manifest.get('archive_origin')
                        or manifest['archive_origin'].get('contract') == 'xlsx-archive-v1'):
                    instant = datetime.fromisoformat(manifest['captured_at'])
                    if instant.tzinfo is None:
                        raise ValueError
                    candidates.append((instant, str(path), path.parent.parent))
            except (KeyError, TypeError, ValueError, OSError) as exc:
                # A damaged dated archive is not permission to silently use an older one.
                raise ArchiveError('ARCHIVE_CORRUPT') from exc
    return max(candidates)[2] if candidates else None


def legacy_coverage(database, day):
    """Explain what the old snapshot actually retained, without modifying it."""
    db = Path(database)
    if not db.is_file():
        return None
    from .readonly_catalog import copied_catalog
    with copied_catalog(db) as copied, closing(sqlite3.connect(copied)) as connection:
        rows = connection.execute('SELECT created_at, data FROM snapshots ORDER BY created_at DESC')
        for instant, raw in rows:
            try:
                stamp = datetime.fromisoformat(instant.replace('Z', '+00:00'))
                if stamp.tzinfo is None or stamp.astimezone(ZoneInfo('Asia/Kamchatka')).date().isoformat() != day:
                    continue
                snapshot = json.loads(raw or '{}')
                data = snapshot.get('rowsByDept') or {}
                if not data:
                    continue
                # Old DataSnapshot does not define the full procedure/ledger contract.
                return {'departments': len(data), 'rows': sum(len(v) for v in data.values()),
                    'missing_sections': ['Архив рабочих реестров процедур',
                        'Накопительный реестр рекомендаций с доказательствами на дату среза',
                        'Полный контракт и доказательства чтения источников']}
            except (TypeError, ValueError, KeyError) as exc:
                raise ArchiveError('ARCHIVE_CORRUPT') from exc
    return None


def ensure_archive_release(state_dir, *, day, year, quarter, legacy_database=None):
    """Native API entry: no caller-provided filesystem paths and no Google client."""
    state = Path(state_dir)
    key = selection_key(day, year, quarter)
    work = state / 'archive_attempts' / key
    work.mkdir(parents=True, exist_ok=True, mode=0o700)
    result = {'selected': None, 'attempt': None}
    with (work / 'run.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {**result, 'archive': {'status': 'RUNNING', 'code': 'ARCHIVE_BUSY', 'message': MESSAGES['ARCHIVE_BUSY']}}
        try:
            pub = state / 'published'
            if (pub / 'publications.sqlite').is_file():
                from .readonly_catalog import copied_catalog
                store = PublicationStore(pub, readonly=True)
                with copied_catalog(store.database_path) as copied:
                    store.database_path = copied
                    existing = store.select(day, year, quarter)
                if existing and existing['rules_version'] == RAW_RULES_VERSION:
                    result['selected'] = existing
                    result['archive'] = {'status': 'READY', 'code': 'ARCHIVE_READY', 'message': 'Комплект сформирован из сохранённого среза.'}
                    _write(work / 'status.json', result)
                    return result
            _write(work / 'status.json', {**result, 'archive': {'status': 'RUNNING', 'code': 'ARCHIVE_BUSY', 'message': MESSAGES['ARCHIVE_BUSY']}})
            source = _source_for_day(state, day)
            if source is None:
                coverage = legacy_coverage(legacy_database, day) if legacy_database else None
                if coverage:
                    result['archive'] = {'coverage': coverage}
                raise ArchiveError('ARCHIVE_INPUT_INCOMPLETE' if coverage else 'ARCHIVE_NOT_FOUND')
            result['selected'] = build_archived_release(source, state, day=day, year=year, quarter=quarter)
            result['archive'] = {'status': 'READY', 'code': 'ARCHIVE_READY', 'message': 'Комплект сформирован из сохранённого среза.'}
        except Exception as error:  # noqa: BLE001 — API boundary, original details stay private.
            code = str(error) if str(error) in MESSAGES else 'ARCHIVE_BUILD_FAILED'
            _write(work / 'error.json', {'code': code, 'exception_class': type(error).__name__, 'message': str(error)})
            result['archive'] = {**result.get('archive', {}), 'status': 'NOT_ISSUED', 'code': code, 'message': MESSAGES[code]}
        _write(work / 'status.json', result)
    return result

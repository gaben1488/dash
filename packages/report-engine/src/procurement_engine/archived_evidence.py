"""Compatibility validation for already sealed XLSX evidence; no intake or source reads.

The administrator enrols a source manifest, not a new business spreadsheet. It
binds roles to exact archived files/hashes and a declared historical cutoff.
Dates in filenames or present-day Google values never supply missing evidence.
No source spreadsheet is modified and no formula is executed.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from datetime import datetime
from pathlib import PurePosixPath
from zoneinfo import ZoneInfo

from .normalize import parse_date
from .snapshot import canonical_semantic_hash
from .xlsx_raw import (
    WorkbookEvidence,
    XlsxEvidenceError,
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



"""A real file adapter, real engine and real publication; all inputs synthetic."""
import hashlib
import zipfile
from copy import deepcopy

import pytest
from archive_tools.file_archive import (
    FileArchiveError,
    capture_file_archive,
    import_file_archive,
    verify_archived_values,
)
from procurement_engine.archive_runtime import ensure_archive_release
from procurement_engine.formula_dependencies import audit_formula_dependencies
from procurement_engine.publication_reader import read_publication
from procurement_engine.raw_pipeline import header_hash
from procurement_engine.semantic_headers import semantic_header_hash
from test_xlsx_archive_reader import sheet, workbook_bytes


def inputs(root):
    row = '<row r="1"><c r="A1" t="inlineStr"><is><t>Header</t></is></c></row>'
    values = [['Header']]
    book = workbook_bytes(sheet(row))
    manifest = {'format': 'xlsx-report-week-v1', 'cutoff_at': '2034-05-25T09:00:00+12:00',
        'report_date': '2034-05-25', 'timezone': 'Asia/Kamchatka',
        'ledger_file': 'ledger.json', 'files': {}, 'registry': {'grbs_order': ['ТЕСТ'], 'sources': []}}
    for number, (title, role) in enumerate([('ВСЕ', 'master'), ('Рабочий реестр процедур', 'procedure'), ('Процедуры в работе', 'procedure')]):
        name = f'book-{number}.xlsx'
        # Only the worksheet title differs; recorded content is intentionally blank.
        import io
        stream = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(book)) as source, zipfile.ZipFile(stream, 'w') as target:
            for item in source.infolist():
                target.writestr(item.filename, source.read(item).replace('ВСЕ'.encode(), title.encode()))
        (root / name).write_bytes(stream.getvalue())
        manifest['files'][name] = hashlib.sha256(stream.getvalue()).hexdigest()
        manifest['registry']['sources'].append({'source_id': f'src-{number}', 'provider_id': f'provider-{number}',
            'sheet': title, 'sheet_id': 56789, 'role': role, 'grbs': 'ТЕСТ' if role == 'master' else None,
            'columns': 34, 'header_rows': 1, 'units': 'тыс. руб.' if role == 'master' else 'руб.',
            'schema_fingerprint': header_hash(values, 1),
            'semantic_header_fingerprint': semantic_header_hash(values, 1, 34), 'archive_file': name})
    (root / 'ledger.json').write_text('[]')
    manifest['files']['ledger.json'] = hashlib.sha256(b'[]').hexdigest()
    return manifest


def test_full_original_week_creates_two_verified_archived_documents(tmp_path, monkeypatch):
    manifest = inputs(tmp_path)
    import procurement_engine.google_adapter as google
    monkeypatch.setattr(google.GoogleReadClient, '__init__', lambda *a, **k: pytest.fail('archive must not access Google'))
    state = tmp_path / 'state'
    result = import_file_archive(tmp_path, manifest, state)
    assert result['status'] == 'IMPORTED'
    assert import_file_archive(tmp_path, manifest, state)['status'] == 'ALREADY_IMPORTED'
    result = ensure_archive_release(state, day='2034-05-25', year=2034, quarter=2)
    assert result['archive']['status'] == 'READY', result
    assert not (state / 'identity.sqlite').exists()
    assert not (state / 'status.json').exists()
    for view in ('main', 'supplement'):
        assert read_publication(state, view, result['selected']['release_id']).startswith(b'PK')
    assert len(list((state / 'published/releases').iterdir())) == 1


def test_folder_and_zip_produce_identical_evidence_and_preserve_provider_identity(tmp_path):
    manifest = inputs(tmp_path)
    first = capture_file_archive(tmp_path, manifest)
    with zipfile.ZipFile(tmp_path / 'week.zip', 'w') as archive:
        for name in manifest['files']:
            archive.write(tmp_path / name, name)
    second = capture_file_archive(tmp_path / 'week.zip', manifest)
    assert first[:3] == second[:3]
    assert first[0]['sources'][0]['sheet_id'] == 56789
    assert first[0]['sources'][0]['formula_evidence']['xlsx_sheet_id'] == 1
    audit = verify_archived_values(first[0], registry=first[1], ledger=first[2])
    assert audit['closed'] and not audit['formula_execution_verified']


@pytest.mark.parametrize('mutation,code', [
    ('missing-file', 'ARCHIVE_FILE_MISSING'), ('changed-byte', 'ARCHIVE_FILE_HASH_MISMATCH'),
    ('path-escape', 'ARCHIVE_FILE_PATH_INVALID'), ('date', 'ARCHIVE_FILE_CONTRACT_INVALID'),
    ('missing-role', 'ARCHIVE_FILE_CONTRACT_INVALID'), ('missing-ledger', 'ARCHIVE_FILE_CONTRACT_INCOMPLETE'),
])
def test_bad_intake_does_not_make_missing_evidence_zero(tmp_path, mutation, code):
    manifest = inputs(tmp_path)
    if mutation == 'missing-file': (tmp_path / 'book-0.xlsx').unlink()
    if mutation == 'changed-byte': (tmp_path / 'book-0.xlsx').write_bytes(b'changed')
    if mutation == 'path-escape': manifest['files']['../escape'] = '0' * 64
    if mutation == 'date': manifest['report_date'] = '2034-05-24'
    if mutation == 'missing-role': manifest['registry']['sources'].pop()
    if mutation == 'missing-ledger': manifest.pop('ledger_file')
    with pytest.raises(FileArchiveError, match=code):
        capture_file_archive(tmp_path, manifest)


@pytest.mark.parametrize('field', ['values', 'formula_evidence', 'grbs', 'sheet', 'archive_file_sha256'])
def test_source_or_formula_tampering_is_detected_from_original_bytes(tmp_path, field):
    manifest = inputs(tmp_path)
    capture, registry, ledger, _ = capture_file_archive(tmp_path, manifest)
    capture['sources'][0][field] = 'forged'
    with pytest.raises(FileArchiveError, match='ARCHIVE_FILE_MATRIX_MISMATCH'):
        verify_archived_values(capture, registry=registry, ledger=ledger)
    assert not audit_formula_dependencies(capture)['closed']


def test_dropping_proof_does_not_restore_live_validation(tmp_path):
    capture, *_ = capture_file_archive(tmp_path, inputs(tmp_path))
    capture.pop('archived_file_evidence')
    result = audit_formula_dependencies(capture)
    assert not result['closed']
    assert result['issues'][0]['code'] == 'ARCHIVE_FILE_EVIDENCE_MISSING'


def test_source_contract_and_ledger_cannot_be_substituted_after_intake(tmp_path):
    capture, registry, ledger, _ = capture_file_archive(tmp_path, inputs(tmp_path))
    changed = deepcopy(registry); changed['grbs_order'] = ['ДРУГОЙ']
    with pytest.raises(FileArchiveError, match='ARCHIVE_FILE_REGISTRY_MISMATCH'):
        verify_archived_values(capture, registry=changed, ledger=ledger)
    with pytest.raises(FileArchiveError, match='ARCHIVE_FILE_LEDGER_MISMATCH'):
        verify_archived_values(capture, registry=registry, ledger=[{'forged': True}])


def test_import_does_not_modify_original_files(tmp_path):
    manifest = inputs(tmp_path)
    before = {name: (tmp_path / name).read_bytes() for name in manifest['files']}
    import_file_archive(tmp_path, manifest, tmp_path / 'state')
    assert {name: (tmp_path / name).read_bytes() for name in manifest['files']} == before


def test_json_duplicate_ledger_key_is_not_silently_overwritten(tmp_path):
    manifest = inputs(tmp_path)
    content = b'[{"recommendation_id":"one","recommendation_id":"two"}]'
    (tmp_path / 'ledger.json').write_bytes(content)
    manifest['files']['ledger.json'] = hashlib.sha256(content).hexdigest()
    with pytest.raises(FileArchiveError, match='ARCHIVE_DUPLICATE_JSON_KEY'):
        capture_file_archive(tmp_path, manifest)


def test_archived_proof_cannot_be_relabelled_as_live(tmp_path):
    capture, registry, ledger, _ = capture_file_archive(tmp_path, inputs(tmp_path))
    capture.pop('archive_origin')
    with pytest.raises(FileArchiveError, match='ARCHIVE_FILE_ORIGIN_MISSING'):
        verify_archived_values(capture, registry=registry, ledger=ledger)


def populated_inputs(root):
    """A real nonempty procurement row; blank human number is intentional."""
    from xml.sax.saxutils import escape
    manifest = inputs(root)
    values = {2: 'ТЕСТ', 3: 'Учреждение', 6: 'Поставка', 7: 'Бумага для принтера',
        8: 0, 9: 0, 10: 17.5, 11: 17.5, 12: 'ЕП', 13: 'Поставка по фактической потребности',
        14: '01.05.2034', 15: 2, 16: 2034, 22: 0, 23: 0, 24: 0, 25: 0,
        26: 0, 27: 0, 28: 0, 29: 0, 30: 'нет', 31: 'Для работы учреждения',
        32: 'Финансирование ожидается'}
    from openpyxl.utils.cell import get_column_letter as col_letter
    cells = []
    for col, value in values.items():
        ref = col_letter(col) + '2'
        cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
                     if isinstance(value, str) else f'<c r="{ref}"><v>{value}</v></c>')
    content = workbook_bytes(sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>Header</t></is></c></row>'
                                  + '<row r="2">' + ''.join(cells) + '</row>'))
    (root / 'book-0.xlsx').write_bytes(content)
    manifest['files']['book-0.xlsx'] = hashlib.sha256(content).hexdigest()
    return manifest


def test_same_archived_purchase_keeps_uid_for_independent_quarter_selections(tmp_path):
    import json
    state = tmp_path / 'state'
    manifest = populated_inputs(tmp_path)
    import_file_archive(tmp_path, manifest, state)
    models = []
    for quarter in (2, 3):
        result = ensure_archive_release(state, day='2034-05-25', year=2034, quarter=quarter)
        assert result['archive']['status'] == 'READY', result
        folder = state / 'published/releases' / result['selected']['release_id']
        models.append(json.loads((folder / 'report_model.json').read_text()))
        for view in ('main', 'supplement'):
            assert read_publication(state, view, result['selected']['release_id']).startswith(b'PK')
    assert len(models[0]['details']) == len(models[1]['details']) == 1
    uid = models[0]['details'][0]['procurement_uid']
    assert uid and uid == models[1]['details'][0]['procurement_uid']
    assert models[0]['headline']['single_supplier']['quarter']['plan_amount'] == 17.5
    assert models[1]['headline']['single_supplier']['quarter']['plan_count'] == 0
    assert all(m['headline']['single_supplier']['year']['fact_count'] == 0 for m in models)
    assert models[0]['details'][0]['single_supplier_reason'] == 'Поставка по фактической потребности'


def test_offline_import_explicitly_seals_original_inbox_before_native_replay(tmp_path, monkeypatch):
    import json

    import procurement_engine.google_adapter as google
    monkeypatch.setattr(google.GoogleReadClient, '__init__', lambda *a, **k: pytest.fail('no live data'))
    state = tmp_path / 'state'
    inbox = state / 'archive_inbox/2034-05-25'
    inbox.mkdir(parents=True)
    manifest = populated_inputs(inbox)
    (inbox / 'manifest.json').write_text(json.dumps(manifest))
    import_file_archive(inbox, manifest, state)
    result = ensure_archive_release(state, day='2034-05-25', year=2034, quarter=2)
    assert result['archive']['status'] == 'READY', result
    assert list((state / 'archives').glob('XLSX-*'))
    assert not (state / 'identity.sqlite').exists()
    again = ensure_archive_release(state, day='2034-05-25', year=2034, quarter=2)
    assert result['selected']['release_id'] == again['selected']['release_id']


@pytest.mark.parametrize('corruption', ['wrong-day', 'changed-file', 'symlink', 'bad-json'])
def test_bad_inbox_does_not_fallback_or_create_generic_data_task(tmp_path, corruption):
    import json
    state = tmp_path / 'state'; inbox = state / 'archive_inbox/2034-05-25'
    inbox.mkdir(parents=True)
    manifest = inputs(inbox)
    if corruption == 'wrong-day':
        manifest['report_date'] = '2034-05-24'
        manifest['cutoff_at'] = '2034-05-24T09:00:00+12:00'
    if corruption == 'changed-file': (inbox / 'book-0.xlsx').write_bytes(b'changed')
    (inbox / 'manifest.json').write_text(json.dumps(manifest) if corruption != 'bad-json' else 'not json')
    if corruption == 'symlink':
        (inbox / 'manifest.json').rename(inbox / 'real.json')
        (inbox / 'manifest.json').symlink_to(inbox / 'real.json')
    result = ensure_archive_release(state, day='2034-05-25', year=2034, quarter=2)
    assert result['archive']['code'] == 'ARCHIVE_NOT_FOUND'
    assert result['selected'] is None
    assert 'Текущие таблицы не использованы' in result['archive']['message']
    assert not (state / 'published').exists()


def test_future_identity_database_cannot_supply_earlier_archive(tmp_path):
    from procurement_engine.identity_store import IdentityStore
    manifest = populated_inputs(tmp_path)
    store = IdentityStore(tmp_path / 'history.sqlite')
    store.ingest([], snapshot_id='SNP-later', captured_at='2034-06-01T00:00:00+12:00')
    manifest['identity_file'] = 'history.sqlite'
    manifest['files']['history.sqlite'] = hashlib.sha256((tmp_path / 'history.sqlite').read_bytes()).hexdigest()
    with pytest.raises(FileArchiveError, match='ARCHIVE_IDENTITY_AFTER_CUTOFF'):
        import_file_archive(tmp_path, manifest, tmp_path / 'state')
    assert not list((tmp_path / 'state/archives').glob('XLSX-*'))


def test_changed_seed_identity_is_detected_before_rebuild(tmp_path):
    state = tmp_path / 'state'
    result = import_file_archive(tmp_path, populated_inputs(tmp_path), state)
    path = state / 'archives' / result['archive_id'] / 'identity.sqlite'
    path.write_bytes(b'changed seed')
    result = ensure_archive_release(state, day='2034-05-25', year=2034, quarter=2)
    assert result['archive']['code'] == 'ARCHIVE_CORRUPT'
    assert result['selected'] is None


@pytest.mark.parametrize('version', ['renderer-v1.5.0rc13', 'renderer-v1.5.0rc14', 'renderer-v2.0.0'])
def test_later_version_does_not_drop_assurance_or_context_gates(tmp_path, version):
    import json

    from procurement_engine.release_gates import validate_recorded_state_model
    state = tmp_path / 'state'
    import_file_archive(tmp_path, inputs(tmp_path), state)
    result = ensure_archive_release(state, day='2034-05-25', year=2034, quarter=2)
    model = json.loads((state / 'published/releases' / result['selected']['release_id'] / 'report_model.json').read_text())
    model['snapshot']['renderer_version'] = version
    model['contract'].pop('automation_assurance_contract')
    model['contract'].pop('context_presentation_contract')
    codes = {issue.code for issue in validate_recorded_state_model(model, ledger=[])}
    assert {'AUTOMATION_ASSURANCE_MISSING', 'CONTEXT_PRESENTATION_MISSING'} <= codes


def test_empty_declared_identity_is_not_mistaken_for_a_real_archive_database(tmp_path):
    manifest = inputs(tmp_path)
    (tmp_path / 'empty.sqlite').write_bytes(b'')
    manifest['identity_file'] = 'empty.sqlite'
    manifest['files']['empty.sqlite'] = hashlib.sha256(b'').hexdigest()
    with pytest.raises(FileArchiveError, match='ARCHIVE_IDENTITY_INVALID'):
        import_file_archive(tmp_path, manifest, tmp_path / 'state')


def test_production_cli_has_no_historical_intake_or_revision_probe():
    from procurement_engine.cli import main
    for command in ('import-week-files', 'probe-master-revisions'):
        with pytest.raises(SystemExit) as error:
            main([command])
        assert error.value.code == 2

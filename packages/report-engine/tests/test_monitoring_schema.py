import json
from copy import deepcopy
from pathlib import Path

import pytest
from procurement_engine.google_adapter import GoogleReadError
from procurement_engine.monitoring_schema import (
    apply_monitoring_schema,
    review_registry,
)
from procurement_engine.raw_pipeline import header_hash
from procurement_engine.semantic_headers import semantic_header_hash
from test_runtime import inputs

# Only published column labels from the 10.10 live customer-directory schema.
# None of the customer records, IDs, transactions, or private data are fixtures.
ZMO_DIRECTORY_EXTENSION = [
    'Заказчик в ЗМО — исходное название',
    'Охват ЗМО на 08.09.2026',
    'Записей в ЗМО',
    'Записей ЗМО без точных повторов',
    'Сумма записей ЗМО без точных повторов, ₽',
    'Первая дата подписания в ЗМО',
    'Последняя дата подписания в ЗМО',
    'Статусы формирования в ЗМО',
    'Статусы исполнения в ЗМО',
    'Источники финансирования в ЗМО',
    'Уровень привязки ЗМО',
    'Дата отчёта ЗМО',
    'Источник ЗМО',
]
WORKING_NAME_EXTENSION = [
    'Рабочее сокращение',
    'Действующее краткое название',
]


def test_dynamic_header_counts_do_not_change_the_schema_but_static_labels_do():
    before = [['Code', 'No successor count', 23, 1000]]
    after = [['Code', 'No successor count', 24, 2000]]
    volatile = [[1, 3], [1, 4]]
    assert header_hash(before, 1, volatile_cells=volatile) == header_hash(after, 1, volatile_cells=volatile)
    after[0][0] = 'Different key'
    assert header_hash(before, 1, volatile_cells=volatile) != header_hash(after, 1, volatile_cells=volatile)


@pytest.mark.parametrize('unknown_label', [False, True])
def test_reviewed_queue_task_heading_migrates_once_without_accepting_other_label_changes(monkeypatch, unknown_label):
    from procurement_engine import monitoring_schema as module

    patch = next(p for p in module.REVIEWS if p['sheet'] == 'Процедуры в работе')
    monkeypatch.setattr(module, 'REVIEWS', [patch])
    monkeypatch.setattr(module, 'RETIRED', [])
    queue = {'source_id': 'queue', 'provider_id': 'private-monitoring', 'sheet_id': 2526400,
        'sheet': 'Процедуры в работе', 'role': 'procedure_lifecycle', 'grbs': None, 'units': 'rub',
        'columns': 24, 'header_rows': 2,
        'schema_fingerprint': '7410aa94a1ca8067db0aee24c04859bee9c88abec9a077542f00ad5291420afe',
        'semantic_header_fingerprint': '40e6c01b2bcc1aee6f7d1fe8bb63139b23ddd37cda12ba347494f07ae522ccdf'}
    original = {'sources': [
        {'source_id': 'anchor', 'provider_id': 'private-monitoring', 'sheet': 'Рабочий реестр процедур', 'sheet_id': 2526300},
        queue]}
    sealed = {'queue': (deepcopy(queue), queue['semantic_header_fingerprint'])}
    rows = json.loads((Path(__file__).parent / 'fixtures/reviewed_queue_task_headers_20261008.json').read_text())
    if unknown_label:
        rows[1][15] = 'Unknown procedure identity'

    class Client:
        def revision(self, provider):
            return 'stable'

        def grid(self, provider, sheet_id):
            assert sheet_id == 2526400
            return {'title': 'Процедуры в работе', 'gridProperties': {'columnCount': 24}}

        def values(self, provider, title, start, end, columns):
            return deepcopy(rows)

    before = deepcopy(original)
    if unknown_label:
        with pytest.raises(ValueError, match='MONITORING_SCHEMA_LIVE_HEADER_MISMATCH'):
            review_registry(original, sealed, Client())
    else:
        reviewed, changes = review_registry(original, sealed, Client())
        assert changes == 1
        assert reviewed['sources'][0] == original['sources'][0]
        assert all(reviewed['sources'][1][key] == queue[key] for key in
                   ('source_id', 'provider_id', 'sheet_id', 'role', 'grbs', 'units', 'columns', 'header_rows'))
        assert reviewed['sources'][1]['schema_fingerprint'] == 'd5a8ca1c915713c86af01eb3e712b88788e65a66bad5988b699bc5347663a4fb'
        assert review_registry(reviewed, sealed, Client())[1] == 0
    assert original == before


@pytest.mark.parametrize('drift', [None, 'directory', 'supplier', 'joint', 'department', 'checks'])
def test_installed_october_headers_have_exact_reviewed_transitions(monkeypatch, drift):
    from procurement_engine import monitoring_schema as module

    headers = json.loads((Path(__file__).parent / 'fixtures/reviewed_headers_20261008.json').read_text())
    specs = [('directory', 'Справочник заказчиков', 837564274, 18,
              '04d9440713606d56c7ed624aa3c5c872b2ae55e39a3e7ea84f9e11d86fbdfcb3',
              'be2978db6b2c34e25bf5803977f4da10e01294928126bf8056e1965f305792fe'),
             ('joint', 'Лист Совместных закупок', 2526402, 20,
              '49b9390505ad81f75260f76c3debb2e99d34de4a8013966365255b56c3c5b377',
              '1f22e2ea69429ffcfd6d988daa4c43153d080a39e6ef13b46f25acfb421581d1'),
             ('supplier', '_Поставщики', 110002, 6,
              '78f3cdb4b1c5e59f3d35b433e3bad2e4305c245235f79381d076c852f6b822f5',
              '530bd5d15273718352e3a9527323fa97b78e0ac01cf89f1e33eb53c817df9a10')]
    selected = [p for p in module.REVIEWS if p['sheet'] in {s[1] for s in specs} | {'_Проверки'}]
    monkeypatch.setattr(module, 'REVIEWS', selected)
    monkeypatch.setattr(module, 'RETIRED', [])
    canonical = '1wET-yUf9OQGTgPWSs96xAE3X7WSrVejtVGWRH1pv-1E'
    original = {'sources': [{'source_id': 'anchor', 'provider_id': canonical, 'sheet': 'Рабочий реестр процедур', 'sheet_id': 2526300}]}
    sealed = {}; keys = {}
    for name, title, sheet_id, columns, raw, semantic in specs:
        patch = next(p for p in selected if p['sheet'] == title)
        source = {'source_id': name, 'provider_id': canonical, 'sheet': title, 'sheet_id': sheet_id,
                  'columns': columns, 'header_rows': 1, 'schema_fingerprint': raw, 'role': patch['role'], 'grbs': None, 'units': 'rub'}
        original['sources'].append(source); sealed[name] = (deepcopy(source), semantic); keys[title] = name
    ud = {'source_id': 'department', 'provider_id': '1zrpgVaCyS4S4KBNMFuDleMJS-PSTonHmPY_bRLgTVsg', 'sheet': 'ВСЕ', 'sheet_id': 1489829974,
          'role': 'master', 'grbs': 'УД', 'columns': 34, 'header_rows': 3, 'units': 'thousand_rub',
          'schema_fingerprint': '9f99bae48efdc4516559fdf23f81c4f7634fc4eb15d3a3b65bea7e0e8580b88e'}
    original['sources'].append(ud)
    sealed['department'] = (deepcopy(ud), '2488b3c0690154103023303e35a7cc8cb119b825336d0403ee37011fec08507e')
    keys['ВСЕ'] = 'department'
    keys['_Проверки'] = 'checks'

    class Client:
        def revision(self, provider):
            return 'stable'

        def grid(self, provider, sheet_id):
            if sheet_id == 913657450:
                return {'title': '_Проверки', 'gridProperties': {'columnCount': 8}}
            source = next(s for s in original['sources'] if s['sheet_id'] == sheet_id)
            return {'title': source['sheet'], 'gridProperties': {'columnCount': 34 if source['source_id'] == 'directory' else source['columns']}}

        def values(self, provider, title, start, end, columns):
            result = deepcopy(headers[keys[title]])
            if keys[title] == 'directory':
                assert len(result[-1]) == 19
                result[-1].extend(ZMO_DIRECTORY_EXTENSION + WORKING_NAME_EXTENSION)
            if keys[title] == drift:
                result[-1][0] = 'Unreviewed business label'
            return result

    if drift:
        with pytest.raises(ValueError, match='MONITORING_SCHEMA_'):
            review_registry(original, sealed, Client())
    else:
        reviewed, changes = review_registry(original, sealed, Client())
        assert changes == 5
        assert original['sources'][-1] == ud
        assert review_registry(reviewed, sealed, Client())[1] == 0
        assert next(s for s in reviewed['sources'] if s['source_id'] == 'department')['schema_fingerprint'] == ud['schema_fingerprint']
        assert reviewed['sources'][-1]['sheet'] == '_Проверки'


def test_customer_directory_34_col_extension_preserves_19_and_32_predecessors():
    """Two observed additive transitions are pinned; unknown drift is rejected."""
    from procurement_engine import monitoring_schema as module

    previous = json.loads((Path(__file__).parent / 'fixtures/reviewed_headers_20261008.json').read_text())['directory']
    assert len(previous) == 1 and len(previous[0]) == 19
    current = [previous[0] + ZMO_DIRECTORY_EXTENSION + WORKING_NAME_EXTENSION]
    patch = next(p for p in module.REVIEWS if p['sheet'] == 'Справочник заказчиков')
    assert patch['sheet_id'] == 837564274
    assert patch['columns'] == 34
    assert len(current[0]) == 34
    assert header_hash(current, 1) == patch['fingerprint']
    assert semantic_header_hash(current, 1, 34) == patch['semantic']
    assert (19, 1, header_hash(previous, 1)) in [tuple(g) for g in patch['previous_geometry']]
    assert semantic_header_hash(previous, 1, 19) in patch['previous_semantics']
    intermediate = [previous[0] + ZMO_DIRECTORY_EXTENSION]
    assert (32, 1, header_hash(intermediate, 1)) in [tuple(g) for g in patch['previous_geometry']]
    assert semantic_header_hash(intermediate, 1, 32) in patch['previous_semantics']
    # The last working-name label is also part of the mandatory source contract.
    current[0][-1] += ' (other interpretation)'
    assert header_hash(current, 1) != patch['fingerprint']


def test_customer_directory_34_column_registry_rejects_changed_extra_header(monkeypatch):
    """Reject changed evidence/working-name headers before touching the registry."""
    from procurement_engine import monitoring_schema as module

    patch = next(p for p in module.REVIEWS if p['sheet'] == 'Справочник заказчиков')
    monkeypatch.setattr(module, 'REVIEWS', [patch])
    monkeypatch.setattr(module, 'RETIRED', [])
    old = json.loads((Path(__file__).parent / 'fixtures/reviewed_headers_20261008.json').read_text())['directory']
    current = [old[0] + ZMO_DIRECTORY_EXTENSION + WORKING_NAME_EXTENSION]
    source = {'source_id': 'customer-dir', 'provider_id': 'private-monitoring',
              'sheet_id': 837564274, 'sheet': 'Справочник заказчиков',
              'role': 'formula_dependency', 'grbs': None, 'units': 'directory',
              'columns': 19, 'header_rows': 1,
              'schema_fingerprint': header_hash(old, 1)}
    original = {'sources': [
        {'source_id': 'master', 'provider_id': 'private-monitoring',
         'sheet': 'Рабочий реестр процедур', 'sheet_id': 2526300},
        source,
    ]}
    sealed = {'customer-dir': (deepcopy(source), semantic_header_hash(old, 1, 19))}

    class Client:
        def revision(self, provider):
            return 'stable'

        def grid(self, provider, sheet_id):
            return {'title': 'Справочник заказчиков',
                    'gridProperties': {'columnCount': 34}}

        def values(self, provider, title, start, end, columns):
            assert columns == 34
            return deepcopy(current)

    reviewed, changes = review_registry(original, sealed, Client())
    assert changes == 1
    assert original['sources'][1] == source
    assert reviewed['sources'][1]['columns'] == 34
    assert reviewed['sources'][1]['schema_fingerprint'] == patch['fingerprint']
    assert review_registry(reviewed, sealed, Client())[1] == 0

    for column in (24, 32, 33):
        original_value = current[0][column]
        current[0][column] = 'Unreviewed business interpretation'
        with pytest.raises(ValueError, match='MONITORING_SCHEMA_LIVE_HEADER_MISMATCH'):
            review_registry(original, sealed, Client())
        current[0][column] = original_value
    assert original['sources'][1] == source


def fixture(tmp_path, monkeypatch):
    from procurement_engine import monitoring_schema as module

    path, _ = inputs(tmp_path)
    original = json.loads(path.read_text())
    for index, source in enumerate(original['sources'][-2:], 1):
        source.update(provider_id='private-monitoring', sheet_id=index, role='procedure_lifecycle')
    source = original['sources'][-1]
    old = [['Old queue']]; new = [['Today', 123], ['Code', 'Action']]
    source.update(columns=1, header_rows=1, schema_fingerprint=header_hash(old, 1))
    patch = {'old_sheet': source['sheet'], 'sheet': source['sheet'], 'role': source['role'],
             'old_columns': 1, 'columns': 2, 'old_header_rows': 1, 'header_rows': 2,
             'old_fingerprint': source['schema_fingerprint'], 'fingerprint': header_hash(new, 2),
             'previous_semantic': semantic_header_hash(old, 1, 1),
             'semantic': semantic_header_hash(new, 2, 2, volatile_cells=[[1, 2]]),
             'volatile_cells': [[1, 2]]}
    original['sources'].append({'source_id': 'legacy', 'provider_id': 'private-monitoring',
        'sheet_id': 3, 'sheet': 'Legacy control', 'role': 'historical_control_dependency',
        'columns': 1, 'header_rows': 1, 'units': 'control', 'grbs': None,
        'schema_fingerprint': header_hash([['Legacy']], 1)})
    monkeypatch.setattr(module, 'REVIEWS', [patch])
    monkeypatch.setattr(module, 'RETIRED', [('Legacy control', 'historical_control_dependency',
        1, 1, original['sources'][-1]['schema_fingerprint'])])
    sealed = {source['source_id']: (deepcopy(source), patch['previous_semantic'])}
    monkeypatch.setattr(module, '_sealed_headers', lambda state: sealed)
    path.write_text(json.dumps(original))

    class Client:
        def revision(self, provider):
            return '1'

        def grid(self, provider, sheet_id):
            if sheet_id == 3:
                raise GoogleReadError('GOOGLE_SHEET_ID_NOT_FOUND')
            return {'title': source['sheet'], 'gridProperties': {'columnCount': 2, 'rowCount': 10}}

        def values(self, provider, title, start, end, columns):
            return deepcopy(new)

    return path, original, sealed, Client


def test_reviewed_monitoring_migration_keeps_primary_identity_ledger_and_backup(tmp_path, monkeypatch):
    path, original, _, Client = fixture(tmp_path, monkeypatch)
    ledger_bytes = (tmp_path / 'ledger.json').read_bytes()
    assert apply_monitoring_schema(path, tmp_path, client=Client()) == 2
    after = json.loads(path.read_text())
    assert after['sources'][:-1] == original['sources'][:-2]
    assert all(after['sources'][-1][k] == original['sources'][-2][k]
               for k in ('source_id', 'provider_id', 'sheet_id', 'role', 'units', 'grbs'))
    assert after['sources'][-1]['columns'] == 2
    assert (tmp_path / 'ledger.json').read_bytes() == ledger_bytes
    backups = [p for p in (tmp_path / 'registry-history').glob('*.json') if not p.name.endswith('.migration.json')]
    assert len(backups) == 1 and json.loads(backups[0].read_text()) == original
    assert apply_monitoring_schema(path, tmp_path, client=Client()) == 0


@pytest.mark.parametrize('kind', ['unknown_header', 'wrong_identity', 'wrong_sheet_id', 'wrong_geometry', 'changed_revision', 'retired_still_exists', 'wrong_sealed_base'])
def test_unreviewed_monitoring_drift_never_changes_installed_contract(tmp_path, monkeypatch, kind):
    path, original, sealed, Client = fixture(tmp_path, monkeypatch)

    class Changed(Client):
        calls = 0

        def revision(self, provider):
            self.calls += 1
            return str(self.calls) if kind == 'changed_revision' else '1'

        def grid(self, provider, sheet_id):
            if kind == 'retired_still_exists' and sheet_id == 3:
                return {'title': 'Legacy control', 'gridProperties': {'columnCount': 1}}
            result = super().grid(provider, sheet_id)
            if kind == 'wrong_geometry': result['gridProperties']['columnCount'] = 3
            return result

        def values(self, *args):
            result = super().values(*args)
            if kind == 'unknown_header': result[1][0] = 'Another meaning'
            return result

    if kind == 'wrong_identity':
        original['sources'][-2]['provider_id'] = 'another-book'; path.write_text(json.dumps(original))
    if kind == 'wrong_sheet_id':
        original['sources'][-2]['sheet_id'] = 999; path.write_text(json.dumps(original))
    if kind == 'wrong_sealed_base':
        key = original['sources'][-2]['source_id']; sealed[key] = (sealed[key][0], '0' * 64)
    with pytest.raises(ValueError, match='MONITORING_SCHEMA_'):
        apply_monitoring_schema(path, tmp_path, client=Changed())
    assert json.loads(path.read_text()) == original


def test_volatile_values_can_change_but_static_headers_cannot(tmp_path, monkeypatch):
    _, original, sealed, Client = fixture(tmp_path, monkeypatch)
    reviewed, _ = review_registry(original, sealed, Client())

    class Tomorrow(Client):
        def values(self, *args):
            result = super().values(*args); result[0][1] += 1
            return result

    assert review_registry(reviewed, sealed, Tomorrow())[1] == 0


def test_already_reviewed_hash_cannot_hide_a_changed_physical_identity(tmp_path, monkeypatch):
    _, original, sealed, Client = fixture(tmp_path, monkeypatch)
    reviewed, _ = review_registry(original, sealed, Client())
    reviewed['sources'][-1]['sheet_id'] = 999
    with pytest.raises(ValueError, match='MONITORING_SCHEMA_SEALED_BASE_MISMATCH'):
        review_registry(reviewed, sealed, Client())


def test_concurrent_registry_write_is_preserved(tmp_path, monkeypatch):
    path, _, _, Client = fixture(tmp_path, monkeypatch)

    class Concurrent(Client):
        def values(self, *args):
            changed = json.loads(path.read_text()); changed['sources'][0]['units'] = 'concurrent unit'
            path.write_text(json.dumps(changed))
            return super().values(*args)

    with pytest.raises(ValueError, match='MONITORING_SCHEMA_REGISTRY_CHANGED'):
        apply_monitoring_schema(path, tmp_path, client=Concurrent())
    assert json.loads(path.read_text())['sources'][0]['units'] == 'concurrent unit'


def test_cli_uses_the_explicit_reviewed_monitoring_migration(monkeypatch, capsys):
    from procurement_engine.cli import main

    calls = []
    monkeypatch.setattr('procurement_engine.monitoring_schema.apply_monitoring_schema',
        lambda registry, state: calls.append((registry, state)) or 9)
    assert main(['migrate-monitoring-schema', '--registry', 'private/registry.json', '--state', 'private/state']) == 0
    assert calls == [('private/registry.json', 'private/state')]
    assert json.loads(capsys.readouterr().out) == {'reviewed_monitoring_changes_applied': 9}

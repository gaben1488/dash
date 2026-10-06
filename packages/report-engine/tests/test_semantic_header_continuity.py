"""Upper-row schema changes must not pass just because numbered labels stayed put."""

import json

import pytest
from procurement_engine.publication_store import PublicationStore
from procurement_engine.runtime import run_once
from test_recorded_release import CompleteGoogle
from test_runtime import inputs


class HeaderGoogle(CompleteGoogle):
    def __init__(self, heading='План', revision='r1'):
        self.heading, self.version = heading, revision

    def revision(self, provider):
        return self.version

    def values(self, provider, title, start, end, columns):
        values = super().values(provider, title, start, end, columns)
        if start == 1:
            values[0] = [self.heading]
        return values


def test_upper_header_edit_rejects_new_publication_and_preserves_previous(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    first = run_once(registry, ledger, state, client=HeaderGoogle())
    assert first['status'] == 'VERIFIED'
    second = run_once(registry, ledger, state, client=HeaderGoogle('Факт', 'r2'))
    assert second['status'] == 'NOT_ISSUED'
    assert second['error_code'] == 'SOURCE_SEMANTIC_HEADER_CHANGED'
    assert PublicationStore(state / 'published').latest()['release_id'] == first['publication']['release_id']


def test_same_header_new_revision_is_accepted(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    assert run_once(registry, ledger, state, client=HeaderGoogle())['status'] == 'VERIFIED'
    assert run_once(registry, ledger, state, client=HeaderGoogle(revision='r2'))['status'] == 'VERIFIED'



def test_explicit_full_header_migration_requires_both_hashes_and_preserves_history(tmp_path):
    from procurement_engine.semantic_headers import semantic_header_hash
    registry, ledger = inputs(tmp_path); state = tmp_path / 'state'
    first = run_once(registry, ledger, state, client=HeaderGoogle())
    original = json.loads(registry.read_text())
    for source in original['sources']:
        old = [['План'], [], ['Synthetic header']]
        new = [['Факт'], [], ['Synthetic header']]
        source.update(semantic_header_fingerprint=semantic_header_hash(new, source['header_rows'], source['columns']),
                      previous_semantic_header_fingerprint=semantic_header_hash(old, source['header_rows'], source['columns']),
                      schema_change_reason='Синтетическая проверка явной миграции подписи; смысл столбцов не меняется.')
    registry.write_text(json.dumps(original))
    second = run_once(registry, ledger, state, client=HeaderGoogle('Факт', 'r2'))
    assert first['status'] == second['status'] == 'VERIFIED'
    assert len(PublicationStore(state / 'published').history()) == 2


def test_wrong_full_header_override_does_not_bless_live_schema(tmp_path):
    from procurement_engine.semantic_headers import semantic_header_hash
    registry, ledger = inputs(tmp_path); state = tmp_path / 'state'
    assert run_once(registry, ledger, state, client=HeaderGoogle())['status'] == 'VERIFIED'
    data = json.loads(registry.read_text())
    for source in data['sources']:
        source['semantic_header_fingerprint'] = semantic_header_hash([['Не тот заголовок']], source['header_rows'], source['columns'])
    registry.write_text(json.dumps(data))
    assert run_once(registry, ledger, state, client=HeaderGoogle('Факт', 'r2'))['status'] == 'NOT_ISSUED'


def test_reviewed_volatile_header_cell_does_not_hide_static_caption_changes():
    from procurement_engine.semantic_headers import semantic_header_hash

    first = [['Сегодня:', 46000], ['Код', 'Предмет']]
    second = [['Сегодня:', 46001], ['Код', 'Предмет']]
    assert semantic_header_hash(first, 2, 2) != semantic_header_hash(second, 2, 2)
    assert semantic_header_hash(first, 2, 2, volatile_cells=[[1, 2]]) == semantic_header_hash(
        second, 2, 2, volatile_cells=[[1, 2]])
    second[0][0] = 'Срок:'
    assert semantic_header_hash(first, 2, 2, volatile_cells=[[1, 2]]) != semantic_header_hash(
        second, 2, 2, volatile_cells=[[1, 2]])
    assert first[0][1] == 46000


@pytest.mark.parametrize('cells', [[[0, 2]], [[1, 3]], [[True, 2]], [[1, 2], [1, 2]]])
def test_volatile_header_cells_must_be_unique_and_inside_the_declared_header(cells):
    from procurement_engine.semantic_headers import semantic_header_hash

    with pytest.raises(ValueError, match='SOURCE_SEMANTIC_HEADER_INVALID'):
        semantic_header_hash([['Сегодня:', 46000]], 1, 2, volatile_cells=cells)


def test_master_headers_cannot_opt_out_of_the_full_schema_gate(tmp_path):
    from procurement_engine.runtime_inputs import validate_inputs

    registry, ledger = inputs(tmp_path)
    data = json.loads(registry.read_text())
    data['sources'][0]['volatile_header_cells'] = [[1, 2]]
    with pytest.raises(ValueError, match='INPUT_VOLATILE_HEADER_CONTRACT_INVALID'):
        validate_inputs(data, json.loads(ledger.read_text()))

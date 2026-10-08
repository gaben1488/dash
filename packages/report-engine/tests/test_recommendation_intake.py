"""Authenticated official recommendations are append-only and proof-bound."""
import copy
import json

import pytest
from procurement_engine.recommendation_history import read_google_history
from procurement_engine.recommendation_intake import (
    previous_published_ledger,
    read_registered_ledger,
    validate_append_only,
    verify_new_official_records,
)
from procurement_engine.runtime import run_once
from test_recommendation_history import fixture
from test_recorded_release import CompleteGoogle
from test_runtime import inputs


def existing_and_new():
    old, package, _ = fixture()
    old[0].update(active_in_current_slice=True, first_seen='25.09.2026',
                  source_procurement_ids=['42'], section='ep', table_no=1, row_no=1)
    new = copy.deepcopy(old[0])
    new.update(recommendation_id='REC-second', first_seen='25.09.2026',
               recommendation_text='Иное документированное предложение',
               source_procurement_ids=['43'], origin_evidence=[])
    return old, new, package


def test_append_only_addition_and_explicit_supersession():
    old, new, _package = existing_and_new()
    assert validate_append_only(old, old + [new]) == ('REC-second',)
    changed = copy.deepcopy(old)
    changed[0]['active_in_current_slice'] = False
    with pytest.raises(ValueError, match='STATUS_CHANGED_WITHOUT_DECISION'):
        validate_append_only(old, changed)
    new['supersedes_recommendation_ids'] = ['synthetic']
    assert validate_append_only(old, changed + [new]) == ('REC-second',)
    with pytest.raises(ValueError, match='SUPERSESSION_NOT_APPLIED'):
        validate_append_only(old, old + [new])


@pytest.mark.parametrize('mutation,code', [
    ('remove', 'HISTORY_MISSING'),
    ('rewrite', 'IMMUTABLE_RECORD_CHANGED'),
    ('origin_remove', 'ORIGIN_REMOVED'),
    ('silent_suppress', 'STATUS_CHANGED_WITHOUT_DECISION'),
    ('duplicate_supercession', 'SUPERSESSION_CONFLICT'),
])
def test_historical_entries_cannot_be_lost_or_silently_rewritten(mutation, code):
    old, new, package = existing_and_new()
    old[0]['origin_evidence'] = package['records'][0]['origin_evidence']
    updated = copy.deepcopy(old)
    if mutation == 'remove':
        updated = []
    elif mutation == 'rewrite':
        updated[0]['recommendation_text'] = 'Переписанная история'
    elif mutation == 'origin_remove':
        updated[0]['origin_evidence'] = []
    elif mutation == 'silent_suppress':
        updated[0]['active_in_current_slice'] = False
    elif mutation == 'duplicate_supercession':
        new['supersedes_recommendation_ids'] = ['synthetic']
        again = copy.deepcopy(new)
        again['recommendation_id'] = 'REC-another'
        updated += [new, again]
    with pytest.raises(ValueError, match=code):
        validate_append_only(old, updated)


class AuthorizedDrive(CompleteGoogle):
    input_name = 'aemr-report-runtime-inputs-v1.json'
    history_name = 'aemr-report-recommendation-history-v1.json'

    def __init__(self, body, history, *, missing_inputs=False, change_version=False):
        self.body, self.history = body, history
        self.missing_inputs, self.change_version = missing_inputs, change_version

    def _get(self, url, params):
        input_meta = {'id': 'registered-inputs', 'name': self.input_name,
            'mimeType': 'application/json', 'version': '7', 'modifiedTime': '2026-10-09T01:00:00Z'}
        history_meta = {'id': 'registered-history', 'name': self.history_name,
            'mimeType': 'application/json', 'version': '4', 'modifiedTime': '2026-10-09T01:00:00Z'}
        if url.endswith('/files'):
            if self.input_name in params['q']:
                return {'files': [] if self.missing_inputs else [input_meta]}
            if self.history_name in params['q']:
                return {'files': [history_meta]}
            return {'files': []}
        if url.endswith('/registered-inputs'):
            return self.body if params.get('alt') == 'media' else (
                {**input_meta, 'version': '8'} if self.change_version else input_meta)
        if url.endswith('/registered-history'):
            return self.history if params.get('alt') == 'media' else history_meta
        raise AssertionError('Unexpected authenticated Drive path')


def test_registered_source_checks_revision_and_must_extend_existing_ledger():
    old, new, history = existing_and_new()
    remote = {'format': 'aemr-report-runtime-inputs-v1', 'registry': {},
              'ledger': old + [new]}
    drive = AuthorizedDrive(remote, history)
    received, meta, new_ids = read_registered_ledger(drive, old)
    assert received == remote['ledger']
    assert meta['version'] == '7'
    assert new_ids == ('REC-second',)
    assert read_registered_ledger(AuthorizedDrive(remote, history, missing_inputs=True), old)[1] is None
    with pytest.raises(ValueError, match='OFFICIAL_LEDGER_SOURCE_CHANGED'):
        read_registered_ledger(AuthorizedDrive(remote, history, change_version=True), old)


def test_new_official_id_without_original_is_rejected():
    old, new, history = existing_and_new()
    verified, documents, _, _ = read_google_history(
        AuthorizedDrive({}, history), old + [new], include_package=True)
    with pytest.raises(ValueError, match='OFFICIAL_LEDGER_NEW_ORIGIN_NOT_VERIFIED'):
        verify_new_official_records(verified, ['REC-second'], documents, report_date='09.10.2026')
    assert verify_new_official_records(verified, ['synthetic'], documents, report_date='09.10.2026')


def test_registered_new_recommendation_is_frozen_and_reused_in_real_release(tmp_path):
    old, _new, history = existing_and_new()
    remote = {'format': 'aemr-report-runtime-inputs-v1',
              'registry': {}, 'ledger': old}
    client = AuthorizedDrive(remote, history)
    registry, ledger = inputs(tmp_path)
    # Local bootstrap stays empty. The authenticated input is the current authority.
    state = tmp_path / 'state'
    first = run_once(registry, ledger, state, client=client)
    assert first['status'] in {'VERIFIED', 'VERIFIED_WITH_WARNINGS'}, first
    from procurement_engine.publication_reader import read_publication

    dashboard = json.loads(read_publication(state, 'dashboard', first['publication']['release_id']))
    assert len(dashboard['recommendation_records']) == 1 or len(
        dashboard.get('recommendations', {}).get('tables', {}).get('1', [])) == 1
    assert json.loads(ledger.read_text()) == []
    frozen = previous_published_ledger(state, first['publication'])
    assert frozen and {r['recommendation_id'] for r in frozen} == {'synthetic'}
    second = run_once(registry, ledger, state, client=client)
    assert second.get('reused_publication') is True
    assert second['snapshot_id'] == first['snapshot_id']
    # A removed registered authority must never erase the accepted new recommendation.
    unavailable = run_once(registry, ledger, state, client=AuthorizedDrive(remote, history, missing_inputs=True))
    assert unavailable['status'] == 'NOT_ISSUED'
    assert unavailable['error_code'] in {'OFFICIAL_LEDGER_HISTORY_MISSING', 'GENERATION_FAILED'}
    assert previous_published_ledger(state, first['publication']) == frozen

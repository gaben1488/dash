import json
import shutil
from copy import deepcopy

import pytest
from procurement_engine.publication_reader import read_publication
from procurement_engine.publication_store import PublicationError, PublicationStore
from test_publication_store import candidate, revisions


@pytest.mark.parametrize('contextual', [True, False])
def test_status_sends_large_assurance_once_without_rewriting_the_receipt_or_attempt(tmp_path, monkeypatch, contextual):
    state = tmp_path / 'state'
    PublicationStore(state / 'published')
    assurance = {'contract': 'actionable-assurance-v2', 'fully_automated': True,
        'user_action_count': 0, 'engine_action_count': 0, 'active_recommendations': 0,
        'link_status_counts': {}, 'action_status_counts': {}, 'actions': [],
        'source_observations': [], 'nonprocurement_identity_observations': 0,
        'meaning': 'Synthetic evidence ' * 65536}
    receipt = {'release_id': 'REL-' + '1' * 64, 'snapshot_id': 'frozen-snapshot',
        'report_date': '16.10.2026', 'cutoff_at': '2026-10-16T01:00:00+00:00',
        'status': 'VERIFIED', 'report_year': 2026, 'quarter': 4, 'automation_assurance': assurance}
    original = deepcopy(receipt)
    monkeypatch.setattr(PublicationStore, 'select', lambda *_: receipt)
    monkeypatch.setattr(PublicationStore, 'latest', lambda *_: receipt)
    monkeypatch.setattr(PublicationStore, 'latest_for_period', lambda *_: deepcopy(receipt))
    attempt = {'status': 'VERIFIED', 'started_at': '2026-10-16T01:00:00+00:00',
        'finished_at': '2026-10-16T01:01:00+00:00', 'snapshot_id': receipt['snapshot_id'],
        'publication': receipt, 'automation_assurance': assurance}
    saved = json.dumps(attempt).encode()
    (state / 'status.json').write_bytes(saved)
    content = read_publication(state, 'status', selection=('2026-10-16', 2026, 4) if contextual else None)
    status = json.loads(content)
    visible = status['selected' if contextual else 'latest']
    assert visible['automation_assurance'] == assurance
    assert len(content) < len(json.dumps(assurance).encode()) + 16384
    assert status['attempt']['automation_assurance_release_id'] == receipt['release_id']
    assert status['attempt']['publication']['automation_assurance_release_id'] == receipt['release_id']
    if contextual:
        assert status['latest_matching']['release_id'] == receipt['release_id']
        assert status['latest_matching']['automation_assurance_release_id'] == receipt['release_id']
    expanded = deepcopy(status['attempt'])
    for record in [expanded, expanded['publication']]:
        assert record.pop('automation_assurance_release_id') == receipt['release_id']
        record['automation_assurance'] = assurance
    assert expanded == attempt
    assert receipt == original
    assert (state / 'status.json').read_bytes() == saved


@pytest.mark.parametrize('same_id', [False, True])
def test_status_does_not_merge_distinct_attempt_evidence_or_publications(tmp_path, monkeypatch, same_id):
    state = tmp_path / 'state'
    PublicationStore(state / 'published')
    prior = {'release_id': 'REL-' + '1' * 64, 'snapshot_id': 'prior',
        'report_date': '15.10.2026', 'cutoff_at': '2026-10-15T01:00:00+00:00',
        'status': 'VERIFIED', 'automation_assurance': {'meaning': 'Prior evidence'}}
    later = {**prior, 'release_id': prior['release_id'] if same_id else 'REL-' + '2' * 64,
        'automation_assurance': {'meaning': 'Conflicting evidence'} if same_id else prior['automation_assurance']}
    monkeypatch.setattr(PublicationStore, 'select', lambda *_: prior)
    monkeypatch.setattr(PublicationStore, 'latest_for_period', lambda *_: later)
    attempt = {'status': 'NOT_ISSUED', 'started_at': '2026-10-16T01:00:00+00:00',
        'automation_assurance': {'meaning': 'New failed-attempt evidence'}}
    (state / 'status.json').write_text(json.dumps(attempt))
    status = json.loads(read_publication(state, 'status', selection=('2026-10-16', 2026, 4)))
    assert status['attempt']['automation_assurance'] == attempt['automation_assurance']
    assert status['latest_matching']['automation_assurance'] == later['automation_assurance']


def test_empty_reader_does_not_create_a_database(tmp_path):
    state = tmp_path / 'absent'
    result = json.loads(read_publication(state, 'status'))
    assert result['latest'] is None and result['attempt'] is None
    assert result['operations']['worker_state'] == 'unknown'
    assert not state.exists()


def test_failed_attempt_retains_prior_release_and_pinned_download(tmp_path):
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    old = candidate(tmp_path / 'old')
    first = store.publish(old, read_revisions=revisions)
    store.publish(candidate(tmp_path / 'new', date='01.10.2026'), read_revisions=revisions)
    (state / 'status.json').write_text('{"status":"NOT_ISSUED","error_code":"SOURCE_CHANGED"}')
    status = json.loads(read_publication(state, 'status'))
    assert status['attempt']['status'] == 'NOT_ISSUED'
    assert status['latest']['report_date'] == '01.10.2026'
    assert read_publication(state, 'main', first['release_id']) == (old / 'main_report.docx').read_bytes()
    assert json.loads(read_publication(state, 'dashboard', first['release_id'])) == json.loads((old / 'dashboard.json').read_text())


def test_orphans_unsafe_names_and_corrupt_releases_are_not_served(tmp_path):
    state = tmp_path / 'state'; store = PublicationStore(state / 'published')
    bundle = candidate(tmp_path / 'candidate')
    orphan = 'REL-' + '0' * 64
    shutil.copytree(bundle, store.releases / orphan)
    with pytest.raises(PublicationError, match='PUBLICATION_NOT_FOUND'):
        read_publication(state, 'main', orphan)
    with pytest.raises(PublicationError, match='PUBLICATION_ID_INVALID'):
        read_publication(state, 'main', '../private')
    first = store.publish(bundle, read_revisions=revisions)
    with pytest.raises(PublicationError, match='PUBLICATION_VIEW_INVALID'):
        read_publication(state, 'capture', first['release_id'])
    (store.releases / first['release_id'] / 'main_report.docx').write_bytes(b'changed')
    with pytest.raises(PublicationError, match='PUBLISHED_BUNDLE_CORRUPT'):
        read_publication(state, 'main', first['release_id'])


def test_context_selects_exact_archive_date_year_and_quarter(tmp_path):
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    first = store.publish(candidate(tmp_path / 'archive', date='24.09.2026'), read_revisions=revisions)
    store.publish(candidate(tmp_path / 'today'), read_revisions=revisions)
    status = json.loads(read_publication(state, 'status', selection=('2026-09-24', 2026, 3)))
    assert status['selected']['release_id'] == first['release_id']
    assert status['selected']['report_year'] == 2026
    assert status['selected']['quarter'] == 3
    for selection in [('2026-09-23', 2026, 3), ('2026-09-24', 2027, 3), ('2026-09-24', 2026, 4)]:
        assert json.loads(read_publication(state, 'status', selection=selection))['selected'] is None


def test_selected_bundle_is_checked_and_empty_selection_does_not_create_state(tmp_path):
    state = tmp_path / 'state'
    selection = ('2026-09-30', 2026, 3)
    assert json.loads(read_publication(state, 'status', selection=selection))['selected'] is None
    assert not state.exists()
    store = PublicationStore(state / 'published')
    first = store.publish(candidate(tmp_path / 'candidate'), read_revisions=revisions)
    (store.releases / first['release_id'] / 'main_report.docx').write_bytes(b'corrupt')
    with pytest.raises(PublicationError, match='PUBLISHED_BUNDLE_CORRUPT'):
        read_publication(state, 'status', selection=selection)


def test_intact_archive_can_be_read_even_if_a_later_release_is_corrupt(tmp_path):
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    first = store.publish(candidate(tmp_path / 'archive', date='24.09.2026'), read_revisions=revisions)
    latest = store.publish(candidate(tmp_path / 'latest'), read_revisions=revisions)
    (store.releases / latest['release_id'] / 'main_report.docx').write_bytes(b'corrupt')
    status = json.loads(read_publication(state, 'status', selection=('2026-09-24', 2026, 3)))
    assert status['selected']['release_id'] == first['release_id']
    with pytest.raises(PublicationError, match='PUBLISHED_BUNDLE_CORRUPT'):
        read_publication(state, 'status')


@pytest.mark.parametrize('selection', [('2026-02-30', 2026, 1), ('2026-09-30', 2026, 0), ('30.09.2026', 2026, 3)])
def test_reader_rejects_invalid_selection(tmp_path, selection):
    with pytest.raises(PublicationError, match='PUBLICATION_CONTEXT_INVALID'):
        read_publication(tmp_path, 'status', selection=selection)

def test_live_period_fallback_is_verified_and_never_changes_archive_selection(tmp_path):
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    old = store.publish(candidate(tmp_path / 'quarter_three', date='30.09.2026', year=2026, quarter=3),
        read_revisions=revisions)
    # A later calendar release for another reporting quarter must not replace Q3.
    store.publish(candidate(tmp_path / 'quarter_four', date='10.10.2026', year=2026, quarter=4),
        read_revisions=revisions)

    result = json.loads(read_publication(state, 'status', selection=('2026-10-11', 2026, 3)))
    assert result['selected'] is None
    assert result['latest_matching']['release_id'] == old['release_id']
    assert result['latest_matching']['report_date'] == '30.09.2026'
    assert (result['latest_matching']['report_year'], result['latest_matching']['quarter']) == (2026, 3)

    # No leakage to a different reporting period or an earlier requested day.
    assert json.loads(read_publication(state, 'status',
        selection=('2026-09-29', 2026, 3)))['latest_matching'] is None
    assert json.loads(read_publication(state, 'status',
        selection=('2026-10-11', 2027, 3)))['latest_matching'] is None
    assert json.loads(read_publication(state, 'status',
        selection=('2026-10-11', 2026, 1)))['latest_matching'] is None


def test_period_fallback_never_serves_corrupt_published_documents(tmp_path):
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    release = store.publish(candidate(tmp_path / 'quarter_three'), read_revisions=revisions)
    (store.releases / release['release_id'] / 'main_report.docx').write_bytes(b'corrupt')
    with pytest.raises(PublicationError, match='PUBLISHED_BUNDLE_CORRUPT'):
        read_publication(state, 'status', selection=('2026-10-11', 2026, 3))


import importlib
import json
import shutil
import sqlite3
from copy import deepcopy

import pytest
from docx import Document
from procurement_engine.docx_renderer import _save_with_manifest
from procurement_engine.publication_reader import read_publication
from procurement_engine.publication_store import PublicationError, PublicationStore
from test_publication_store import candidate, revisions


def three_document_candidate(path):
    bundle = candidate(path)
    document = Document()
    document.add_paragraph('Synthetic operational report')
    _save_with_manifest(document, json.loads((bundle / 'report_model.json').read_text()),
                        bundle / 'operational_report.docx', view='operational', narrative_mode='GENERIC_TEMPLATE')
    return bundle


@pytest.mark.parametrize('context', ['latest', 'selected', 'pinned'])
def test_status_hashes_only_published_documents(tmp_path, monkeypatch, context):
    from procurement_engine import publication_store

    # Lazy imports must bind real helpers before this test instruments hashing.
    # Otherwise archive_runtime retains the patched alias after monkeypatch undo.
    importlib.import_module('procurement_engine.archive_runtime')
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    release = store.publish(three_document_candidate(tmp_path / 'candidate'), read_revisions=revisions)
    hashed = []
    original = publication_store._hash

    def document_hash(path):
        assert path.suffix == '.docx', 'status must not read source payloads, models or frozen databases'
        hashed.append(path.name)
        return original(path)

    monkeypatch.setattr(publication_store, '_hash', document_hash)
    kwargs = {'selection': ('2026-09-30', 2026, 3)} if context == 'selected' else {}
    if context == 'pinned':
        kwargs['release_id'] = release['release_id']
    result = json.loads(read_publication(state, 'status', **kwargs))
    assert result['latest' if context == 'latest' else 'selected']['release_id'] == release['release_id']
    assert sorted(hashed) == ['main_report.docx', 'management_report.docx', 'operational_report.docx']


@pytest.mark.parametrize('view', ['main', 'supplement', 'operational', 'dashboard'])
def test_artifact_read_does_not_hash_unrequested_files(tmp_path, monkeypatch, view):
    from procurement_engine import publication_store

    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    bundle = three_document_candidate(tmp_path / 'candidate')
    release = store.publish(bundle, read_revisions=revisions)

    def forbidden(path):
        raise AssertionError('a download must hash its returned bytes, not reopen the bundle')

    monkeypatch.setattr(publication_store, '_hash', forbidden)
    name = {'main': 'main_report.docx', 'supplement': 'management_report.docx',
            'operational': 'operational_report.docx', 'dashboard': 'dashboard.json'}[view]
    assert read_publication(state, view, release['release_id']) == (bundle / name).read_bytes()


def test_pinned_status_does_not_read_unrelated_live_attempt(tmp_path, monkeypatch):
    from pathlib import Path

    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    release = store.publish(three_document_candidate(tmp_path / 'candidate'), read_revisions=revisions)
    live_status = state / 'status.json'
    live_status.write_text('{incomplete unrelated live attempt' + ' ' * (2 * 1024 * 1024), encoding='utf-8')
    original = Path.read_text

    def read(path, *args, **kwargs):
        assert path != live_status, 'pinned publication must not load the current live attempt'
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, 'read_text', read)
    result = json.loads(read_publication(state, 'status', release['release_id']))
    assert result['selected']['release_id'] == release['release_id']
    assert result['attempt'] is None


def test_unrequested_payload_corruption_does_not_block_documents_but_full_audit_rejects_it(tmp_path):
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    bundle = candidate(tmp_path / 'candidate')
    release = store.publish(bundle, read_revisions=revisions)
    payload = next((store.releases / release['release_id'] / 'snapshot_bundle' / 'payloads').glob('*.json'))
    payload.write_bytes(b'x' * payload.stat().st_size)
    assert json.loads(read_publication(state, 'status'))['latest']['release_id'] == release['release_id']
    assert read_publication(state, 'main', release['release_id']) == (bundle / 'main_report.docx').read_bytes()
    with pytest.raises(PublicationError, match='PUBLISHED_BUNDLE_CORRUPT'):
        store.latest()


@pytest.mark.parametrize('damage', ['missing', 'extra', 'symlink'])
def test_document_scope_still_rejects_unsafe_or_changed_file_inventory(tmp_path, damage):
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    release = store.publish(candidate(tmp_path / 'candidate'), read_revisions=revisions)
    root = store.releases / release['release_id']
    payload = next((root / 'snapshot_bundle' / 'payloads').glob('*.json'))
    if damage == 'missing':
        payload.unlink()
    elif damage == 'extra':
        (root / 'unexpected.json').write_text('{}')
    else:
        payload.unlink()
        payload.symlink_to(root / 'main_report.docx')
    for view in ['status', 'main']:
        with pytest.raises(PublicationError, match='PUBLISHED_BUNDLE_CORRUPT|BUNDLE_UNSAFE_FILE'):
            read_publication(state, view, release['release_id'])


def test_selected_status_verifies_the_same_immutable_bundle_once_per_read(tmp_path, monkeypatch):
    from procurement_engine import publication_store

    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    release = store.publish(candidate(tmp_path / 'candidate'), read_revisions=revisions)
    checked = []
    original = publication_store._files

    def counted(root, **kwargs):
        checked.append(root)
        return original(root, **kwargs)

    monkeypatch.setattr(publication_store, '_files', counted)
    assert json.loads(read_publication(state, 'status'))['latest']['release_id'] == release['release_id']
    assert checked == [store.releases / release['release_id']]
    checked.clear()
    selected = json.loads(read_publication(state, 'status', selection=('2026-09-30', 2026, 3)))
    assert selected['selected']['release_id'] == selected['latest_matching']['release_id'] == release['release_id']
    assert checked == [store.releases / release['release_id']]


def test_selected_verification_is_not_cached_between_reads(tmp_path):
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    release = store.publish(candidate(tmp_path / 'candidate'), read_revisions=revisions)
    selection = ('2026-09-30', 2026, 3)
    assert json.loads(read_publication(state, 'status', selection=selection))['selected']
    (store.releases / release['release_id'] / 'main_report.docx').write_bytes(b'corrupt after prior GET')
    with pytest.raises(PublicationError, match='PUBLISHED_BUNDLE_CORRUPT'):
        read_publication(state, 'status', selection=selection)


@pytest.mark.parametrize('origin', [None, {'contract': 'synthetic-archive'}])
def test_selected_archive_does_not_replace_live_period_fallback(tmp_path, origin):
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    live = store.publish(candidate(tmp_path / 'live', date='24.09.2026'), read_revisions=revisions)
    archive = store.publish(candidate(tmp_path / 'archive'), read_revisions=revisions)
    # The reader treats any archive_origin key as non-live, including legacy null.
    with sqlite3.connect(store.database_path) as db:
        db.execute('UPDATE publications SET receipt=? WHERE release_id=?',
            (json.dumps({**archive, 'archive_origin': origin}), archive['release_id']))
    status = json.loads(read_publication(state, 'status', selection=('2026-09-30', 2026, 3)))
    assert status['selected']['release_id'] == archive['release_id']
    assert status['latest_matching']['release_id'] == live['release_id']
    (store.releases / live['release_id'] / 'main_report.docx').write_bytes(b'corrupt fallback')
    with pytest.raises(PublicationError, match='PUBLISHED_BUNDLE_CORRUPT'):
        read_publication(state, 'status', selection=('2026-09-30', 2026, 3))


def test_selected_read_checks_a_new_live_release_committed_between_selectors(tmp_path, monkeypatch):
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    first = store.publish(candidate(tmp_path / 'first'), read_revisions=revisions)
    new_bundle = candidate(tmp_path / 'new', cutoff='2026-09-30T01:00:00Z')
    published = []
    original = PublicationStore._checked

    def checked(self, row, **kwargs):
        receipt = original(self, row, **kwargs)
        if receipt and receipt['release_id'] == first['release_id'] and not published:
            published.append(store.publish(new_bundle, read_revisions=revisions))
        return receipt

    monkeypatch.setattr(PublicationStore, '_checked', checked)
    status = json.loads(read_publication(state, 'status', selection=('2026-09-30', 2026, 3)))
    assert status['selected']['release_id'] == first['release_id']
    assert status['latest_matching']['release_id'] == published[0]['release_id']
    assert status['selected']['release_id'] != status['latest_matching']['release_id']


@pytest.mark.parametrize('changed', ['files', 'receipt'])
def test_selected_read_does_not_reuse_verification_for_changed_catalog_payload(tmp_path, monkeypatch, changed):
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    store.publish(candidate(tmp_path / 'candidate'), read_revisions=revisions)
    original = PublicationStore._checked
    checked_rows = []

    def checked(self, row, **kwargs):
        receipt = original(self, row, **kwargs)
        checked_rows.append(row)
        if len(checked_rows) == 1:
            with sqlite3.connect(store.database_path) as db:
                if changed == 'files':
                    db.execute('UPDATE publications SET files=?', ('{}',))
                else:
                    later = {**receipt, 'automation_assurance': {'meaning': 'Distinct synthetic evidence'}}
                    db.execute('UPDATE publications SET receipt=?', (json.dumps(later),))
        return receipt

    monkeypatch.setattr(PublicationStore, '_checked', checked)
    if changed == 'files':
        with pytest.raises(PublicationError, match='PUBLISHED_BUNDLE_CORRUPT'):
            read_publication(state, 'status', selection=('2026-09-30', 2026, 3))
    else:
        status = json.loads(read_publication(state, 'status', selection=('2026-09-30', 2026, 3)))
        assert status['latest_matching']['automation_assurance'] == {'meaning': 'Distinct synthetic evidence'}
        assert len(checked_rows) == 2


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
    monkeypatch.setattr(PublicationStore, 'select_status', lambda *_, **kwargs: {'selected': receipt, 'latest_matching': deepcopy(receipt)})
    monkeypatch.setattr(PublicationStore, 'latest', lambda *_, **kwargs: receipt)
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
    monkeypatch.setattr(PublicationStore, 'select_status', lambda *_, **kwargs: {'selected': prior, 'latest_matching': later})
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



def test_exact_status_keeps_selected_release_and_never_substitutes_latest(tmp_path):
    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    first = store.publish(candidate(tmp_path / 'first'), read_revisions=revisions)
    store.publish(candidate(tmp_path / 'second', date='01.10.2026', quarter=4), read_revisions=revisions)
    selected = json.loads(read_publication(state, 'status', first['release_id']))
    assert selected['selected']['release_id'] == first['release_id']
    assert selected['selected']['report_year'] == 2026
    assert selected['selected']['quarter'] == 3
    assert selected.get('latest_matching') is None
    with pytest.raises(PublicationError, match='PUBLICATION_NOT_FOUND'):
        read_publication(state, 'status', 'REL-' + 'f' * 64)
    with pytest.raises(PublicationError, match='PUBLICATION_ID_INVALID'):
        read_publication(state, 'status', '../private')

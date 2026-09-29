import json
import shutil

import pytest
from procurement_engine.publication_reader import read_publication
from procurement_engine.publication_store import PublicationError, PublicationStore
from test_publication_store import candidate, revisions


def test_empty_reader_does_not_create_a_database(tmp_path):
    state = tmp_path / 'absent'
    assert json.loads(read_publication(state, 'status')) == {'latest': None, 'attempt': None}
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

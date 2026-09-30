"""An upgrade rehearsal must not publish or change production business state."""
import hashlib
import json

import pytest
from procurement_engine.rehearsal import rehearse_latest
from procurement_engine.runtime import run_once
from test_recorded_release import CompleteGoogle
from test_runtime import inputs


def business_files(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file() and not p.name.endswith(('-wal', '-shm'))}


def test_frozen_rehearsal_rebuilds_both_documents_without_publishing(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    run_once(registry, ledger, state, client=CompleteGoogle())
    before = business_files(state)
    result = rehearse_latest(state)
    assert result == {'frozen_release_readable': True, 'replay_status': 'PASS',
                      'independent_audit': 'PASS', 'two_docx_rebuilt': True,
                      'headline_changed': False, 'error_counts': {}}
    assert business_files(state) == before


def test_missing_publication_is_not_a_successful_rehearsal(tmp_path):
    with pytest.raises(ValueError, match='PUBLICATION_NOT_FOUND'):
        rehearse_latest(tmp_path)


def test_corrupt_saved_doc_is_rejected_before_replay(tmp_path):
    registry, ledger = inputs(tmp_path); state = tmp_path / 'state'
    result = run_once(registry, ledger, state, client=CompleteGoogle())
    (state / 'published/releases' / result['publication']['release_id'] / 'main_report.docx').write_bytes(b'not a document')
    with pytest.raises(ValueError, match='PUBLISHED_BUNDLE_CORRUPT'):
        rehearse_latest(state)


def test_rehearsal_cli_sanitizes_private_failure(tmp_path, capsys):
    from procurement_engine.rehearsal import main
    assert main(['--state', str(tmp_path / 'private-name')]) == 2
    result = json.loads(capsys.readouterr().out)
    assert result == {'replay_status': 'FAIL', 'error_code': 'PUBLICATION_NOT_FOUND'}

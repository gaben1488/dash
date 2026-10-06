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



def test_coverage_reports_only_aggregate_gap_shapes(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    run_once(registry, ledger, state, client=CompleteGoogle())
    result = rehearse_latest(state, coverage=True)
    assert result['replay_status'] == 'PASS'
    assert isinstance(result['identity_status_counts'], dict)
    assert isinstance(result['identity_unresolved_candidate_uid_buckets'], dict)
    assert isinstance(result['recommendation_gap_shapes'], dict)
    assert isinstance(result['text_reference_missing_subject_shapes'], dict)
    diagnostic = {
        'identity': result['identity_status_counts'],
        'candidates': result['identity_unresolved_candidate_uid_buckets'],
        'recommendations': result['recommendation_gap_shapes'],
        'origin_date_bindable_count': result['origin_date_identity_bindable_count'],
        'subject_shapes': result['text_reference_missing_subject_shapes'],
    }
    # Diagnostic output is counts only: no raw source locator, subject, recommendation ID or business ID fields.
    def keys(value):
        if isinstance(value, dict):
            return set(value) | set().union(*(keys(item) for item in value.values()), set())
        if isinstance(value, list):
            return set().union(*(keys(item) for item in value), set())
        return set()
    assert not {'source_row_key', 'recommendation_id', 'subject', 'business_id'} & keys(diagnostic)


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
    output = capsys.readouterr().out
    result = json.loads(output)
    assert result['replay_status'] == 'FAIL'
    assert result['error_code'] == 'PUBLICATION_NOT_FOUND'
    assert result['error_type'] == 'ValueError'
    assert result['internal_code'] == 'PUBLICATION_NOT_FOUND'
    assert 'private-name' not in output

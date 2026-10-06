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


def test_rehearsal_does_not_echo_uppercase_private_exception_text(monkeypatch, capsys):
    from procurement_engine import rehearsal
    def failure(*a, **kw):
        error = ValueError('PRIVATE_CUSTOMER_NAME')
        error.sqlite_errorname = 'SQLITE_PRIVATE_CUSTOMER_NAME'
        raise error
    monkeypatch.setattr(rehearsal, 'rehearse_latest', failure)
    assert rehearsal.main(['--state', '/unused']) == 2
    assert 'PRIVATE_CUSTOMER_NAME' not in capsys.readouterr().out


def test_last_sealed_week_replays_both_documents_without_changing_source_state(tmp_path):
    from procurement_engine.rehearsal import rehearse_weekly
    from procurement_engine.weekly_archive import seal_weekly_archive
    from test_weekly_archive import complete_attempt

    state, status = complete_attempt(tmp_path)
    assert seal_weekly_archive(state, status)['status'] == 'SEALED'
    before = business_files(state)
    assert rehearse_weekly(state) == {
        'replay_status': 'PASS', 'two_docx_rebuilt': True,
        'source_verification': 'FROZEN_ARCHIVE_HASHES',
    }
    assert business_files(state) == before


def test_failed_publication_recheck_is_diagnosed_without_source_text_or_mutation(tmp_path, monkeypatch):
    from procurement_engine import section_audit
    from procurement_engine.rehearsal import diagnose_failed_attempt

    registry, ledger = inputs(tmp_path); state = tmp_path / 'state'
    original = section_audit.audit_source_sections
    def saved_only_failure(capture, *args, **kwargs):
        return ['automation_assurance', 'PRIVATE_SOURCE_TEXT'] if 'captured_at' not in capture else original(capture, *args, **kwargs)
    monkeypatch.setattr(section_audit, 'audit_source_sections', saved_only_failure)
    result = run_once(registry, ledger, state, client=CompleteGoogle())
    assert result['error_code'] == 'SAVED_SOURCE_RECHECK_FAILED'
    before = business_files(state)
    diagnostic = diagnose_failed_attempt(state)
    assert diagnostic == {'error_code': 'SAVED_SOURCE_RECHECK_FAILED',
        'formula_closed': True, 'arithmetic_pass': True,
        'section_errors': {'automation_assurance': 1, 'UNRECOGNIZED_SECTION': 1}}
    assert business_files(state) == before
    assert 'PRIVATE_SOURCE_TEXT' not in json.dumps(diagnostic)
    compacted = state / 'attempts/compacted'
    compacted.mkdir()
    (compacted / 'status.json').write_text(json.dumps({'error_code': 'SAVED_SOURCE_RECHECK_FAILED',
        'finished_at': '2034-09-28T12:00:00Z'}))
    assert diagnose_failed_attempt(state) == diagnostic
    monkeypatch.setattr(section_audit, 'audit_source_sections', original)
    assert diagnose_failed_attempt(state) == {'recheck_status': 'PASS'}


def test_failed_attempt_cli_sanitizes_unexpected_failure(monkeypatch, capsys):
    from procurement_engine import rehearsal
    def failure(*args):
        raise ValueError('PRIVATE_SOURCE_TEXT')
    monkeypatch.setattr(rehearsal, 'diagnose_failed_attempt', failure)
    assert rehearsal.main(['--state', '/unused', '--failed-attempt']) == 2
    assert 'PRIVATE_SOURCE_TEXT' not in capsys.readouterr().out

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


def test_archive_rehearsal_reports_only_fixed_blocker_codes(monkeypatch, capsys):
    from procurement_engine import rehearsal
    from procurement_engine.archive_runtime import ArchiveError

    error = ArchiveError('ARCHIVE_BUILD_FAILED')
    error.blockers = [{'code': 'SOURCE_QA_ERRORS', 'message': 'Private customer'},
                     {'code': 'SECTION_SOURCE_MISMATCH', 'context': {'sections':
                         ['procedure_source_contract', 'Private source', 'procedures']}},
                     {'code': 'Private customer and credentials'},
                     {'code': 'SECTION_SOURCE_MISMATCH: private source'},
                     {'message': 'Private source without code'}]
    error.source_issues = [
        {'severity': 'ERROR', 'code': 'PROCEDURE_QUEUE_COVERAGE_MISMATCH', 'message': 'Private customer'},
        {'severity': 'ERROR', 'code': 'PROCEDURE_QUEUE_COVERAGE_MISMATCH'},
        {'severity': 'ERROR', 'code': 'Private source'},
        {'severity': 'WARN', 'code': 'DUPLICATE_PROCEDURE_CODE'},
    ]
    def fail(*args, **kwargs):
        raise error
    monkeypatch.setattr(rehearsal, 'rehearse_latest', fail)
    assert rehearsal.main(['--state', '/unused']) == 2
    result = json.loads(capsys.readouterr().out)
    assert result['blocker_codes'] == ['GENERATION_FAILED', 'SECTION_SOURCE_MISMATCH', 'SOURCE_QA_ERRORS']
    assert result['section_errors'] == {'procedure_source_contract': 1, 'procedures': 1,
                                       'UNRECOGNIZED_SECTION': 1}
    assert result['source_error_counts'] == {'PROCEDURE_QUEUE_COVERAGE_MISMATCH': 2,
                                            'UNRECOGNIZED_ERROR': 1}
    assert 'Private' not in json.dumps(result)



def test_coverage_reports_only_aggregate_gap_shapes(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    run_once(registry, ledger, state, client=CompleteGoogle())
    before = business_files(state)
    result = rehearse_latest(state, coverage=True)
    assert result['replay_status'] == 'PASS'
    assert result.get('published_release_restore') == {
        'catalog': 'PASS', 'artifacts': 'PASS', 'source_recheck': 'PASS',
    }
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
    assert business_files(state) == before


def test_identity_gap_diagnostic_distinguishes_changed_context_from_missing_row_without_writes(tmp_path):
    import hashlib
    from dataclasses import asdict, replace

    from procurement_engine.identity_store import IdentityStore
    from procurement_engine.rehearsal import _identity_gap_diagnostics
    from test_recommendation_links import TEXT, row

    store = IdentityStore(tmp_path / 'identity.sqlite')
    original = replace(row(), snapshot_id='old', institution='Synthetic institution',
        activity_kind='CURRENT', planned_year=2026, program='Original program')
    store.ingest([original], snapshot_id='old', captured_at='2026-09-25T00:00:00+00:00')
    current = replace(original, snapshot_id='new', program='Changed program', procurement_uid=None)
    observation = store.ingest([current], snapshot_id='new', captured_at='2026-09-26T00:00:00+00:00',
        allow_plan_updates=True)
    assert observation['rows'][0]['procurement_uid'] is None
    model = {'snapshot': {'snapshot_id': 'new'}, 'details': [asdict(current)],
        'identity_observations': observation,
        'recommendation_records': [{'grbs': current.grbs, 'table_no': 1, 'row_no': 1,
            'active_in_current_slice': True, 'recommendation_text': TEXT,
            'current_link': {'status': 'CURRENT_EVIDENCE_MISSING'}}]}
    before = hashlib.sha256(store.path.read_bytes()).hexdigest()
    result = _identity_gap_diagnostics(model, store)
    assert result['identity_chain_break_counts'] == {'ENTITY_CONTEXT_CHANGED_IN_CHAIN': 1}
    gap = result['recommendation_identity_gap_index'][0]
    assert gap['missing_primary_number_count'] == 0
    assert gap['full_literal_subject_match_count'] == 1
    assert gap['matched_current_uid_count'] == 0
    assert gap['identity_chain_reasons'] == {'ENTITY_CONTEXT_CHANGED_IN_CHAIN': 1}
    serialized = json.dumps(result)
    assert 'Synthetic institution' not in serialized and 'Original program' not in serialized
    assert 'source_row_key' not in serialized and 'PUR-' not in serialized and 'synthetic-book' not in serialized
    assert hashlib.sha256(store.path.read_bytes()).hexdigest() == before


@pytest.mark.parametrize('upgrade', [False, True])
def test_coverage_uses_the_live_history_copy_beyond_the_compact_release_snapshot(tmp_path, monkeypatch, upgrade):
    class ChangedProgram(CompleteGoogle):
        program = 'Original program'

        def revision(self, provider):
            return self.program

        def grid(self, provider, sheet_id):
            value = super().grid(provider, sheet_id)
            if provider == 'master-0':
                value['gridProperties']['rowCount'] = 4
            return value

        def values(self, provider, title, start, end, columns):
            values = [[], [], ['Synthetic header']]
            if provider == 'master-0':
                row = [''] * 34
                for index, value in {0: '42', 1: 'УЭР', 2: 'Synthetic customer',
                    3: self.program, 5: 'Текущая деятельность', 6: 'Поставка бумаги',
                    7: 0, 8: 0, 9: 46, 10: 46, 11: 'ЕП', 15: 2026}.items():
                    row[index] = value
                values.append(row)
            return values[start - 1:end]

    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    client = ChangedProgram()
    first = run_once(registry, ledger, state, client=client)
    client.program = 'Changed program'
    result = run_once(registry, ledger, state, client=client)
    assert result['status'] in {'VERIFIED', 'VERIFIED_WITH_WARNINGS'}
    original = json.loads((state / 'attempts' / first['attempt_id'] / 'bundle/report_model.json').read_text())
    current = json.loads((state / 'attempts' / result['attempt_id'] / 'bundle/report_model.json').read_text())
    original_row = original['identity_observations']['rows'][0]
    current_row = current['identity_observations']['rows'][0]
    assert current_row['procurement_uid'] != original_row['procurement_uid']
    assert current_row['status'] == 'CURRENT_IDENTITY_ESTABLISHED'
    assert current_row['evidence']['historical_uid_recovered'] is False
    before = business_files(state)
    if upgrade:
        from procurement_engine import raw_pipeline

        monkeypatch.setattr(raw_pipeline, 'RAW_RULES_VERSION', raw_pipeline.RAW_RULES_VERSION + '+synthetic-upgrade')
    coverage = rehearse_latest(state, coverage=True)
    # A new current identity is valid; no historical continuation was claimed.
    assert coverage['identity_chain_break_counts'] == {}
    assert business_files(state) == before


def test_identity_gap_without_business_number_is_incomplete_before_searching_history(tmp_path):
    from dataclasses import asdict, replace

    from procurement_engine.identity_store import IdentityStore
    from procurement_engine.rehearsal import _identity_gap_diagnostics
    from test_recommendation_links import row

    store = IdentityStore(tmp_path / 'identity.sqlite')
    current = replace(row(), source_row_no=None, institution='Synthetic institution',
        activity_kind='CURRENT', planned_year=2026)
    observation = store.ingest([current], snapshot_id='snapshot', captured_at='2026-09-26T00:00:00+00:00')
    observation['rows'][0].update(procurement_uid=None, status='REVIEW_REQUIRED')
    model = {'snapshot': {'snapshot_id': 'snapshot'}, 'details': [asdict(current)],
        'identity_observations': observation}
    assert _identity_gap_diagnostics(model, store)['identity_chain_break_counts'] == {'INCOMPLETE_CURRENT_ENTITY': 1}


def test_restore_rejects_bytes_damaged_during_copy(tmp_path, monkeypatch):
    import shutil
    from pathlib import Path

    from procurement_engine.rehearsal import rehearse_release_restore

    registry, ledger = inputs(tmp_path); state = tmp_path / 'state'
    receipt = run_once(registry, ledger, state, client=CompleteGoogle())['publication']
    before = business_files(state)
    copy = shutil.copytree
    def damaged_copy(source, destination, *args, **kwargs):
        result = copy(source, destination, *args, **kwargs)
        document = Path(destination) / 'main_report.docx'
        if document.is_file():
            document.write_bytes(b'damaged backup')
        return result
    monkeypatch.setattr(shutil, 'copytree', damaged_copy)
    with pytest.raises(ValueError, match='PUBLISHED_BUNDLE_CORRUPT'):
        rehearse_release_restore(state, receipt)
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

def test_diagnostic_summary_does_not_waive_failed_weekly_archive(tmp_path, monkeypatch, capsys):
    from procurement_engine import rehearsal

    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    assert run_once(registry, ledger, state, client=CompleteGoogle())['status'] in {
        'VERIFIED', 'VERIFIED_WITH_WARNINGS'}
    before = business_files(state)

    def broken_weekly(_state):
        raise ValueError('PRIVATE_WEEKLY_INPUT_HAS_DUPLICATE_PROCEDURE')

    monkeypatch.setattr(rehearsal, 'rehearse_weekly', broken_weekly)
    with pytest.raises(ValueError, match='PRIVATE_WEEKLY_INPUT_HAS_DUPLICATE_PROCEDURE'):
        rehearsal.rehearse_latest(state, coverage=True)
    summary = rehearsal.rehearse_latest(state, coverage=True, skip_weekly=True)
    assert summary['weekly_replay'] == 'NOT_CHECKED'
    assert isinstance(summary['identity_unresolved_scope_counts'], dict)
    assert sum(summary['identity_unresolved_scope_counts'].values()) == summary['identity_unresolved_count']
    assert rehearsal.main(['--state', str(state), '--coverage-summary']) == 0
    public = json.loads(capsys.readouterr().out)
    assert public['weekly_replay'] == 'NOT_CHECKED'
    assert public['replay_status'] == 'PASS'
    assert 'recommendation_gap_index' not in public
    assert 'recommendation_identity_gap_index' not in public
    assert 'recommendation_ids' not in json.dumps(public)
    assert 'PRIVATE_WEEKLY_INPUT' not in json.dumps(public)
    assert business_files(state) == before

def test_replay_delta_catches_lost_proof_without_exposing_identifiers():
    from procurement_engine.rehearsal import _recommendation_replay_delta

    previous = {'recommendation_records': [
        {'recommendation_id': 'private-1', 'current_link': {'status': 'CONFIRMED'},
         'dimensions': {'compliance_status': 'IMPLEMENTED'}},
        {'recommendation_id': 'private-2', 'current_link': {'status': 'ORIGIN_UNPROVEN'},
         'dimensions': {'compliance_status': 'UNKNOWN'}},
    ]}
    candidate = {'recommendation_records': [
        {'recommendation_id': 'private-1', 'current_link': {'status': 'ORIGIN_UNPROVEN'},
         'dimensions': {'compliance_status': 'UNKNOWN'}},
        {'recommendation_id': 'private-2', 'current_link': {'status': 'CONFIRMED'},
         'dimensions': {'compliance_status': 'IMPLEMENTED'}},
    ]}
    value = _recommendation_replay_delta(previous, candidate)
    assert value == {
        'published_recommendation_count': 2,
        'candidate_recommendation_count': 2,
        'historical_ids_missing_from_candidate': 0,
        'candidate_ids_not_in_published': 0,
        'confirmed_links_lost': 1, 'confirmed_links_gained': 1,
        'known_compliance_became_unknown': 1,
        'unknown_compliance_became_known': 1,
        'compliance_changed': 2,
    }
    assert 'private-' not in json.dumps(value)


def test_published_evidence_summary_is_readonly_and_does_not_claim_replay(tmp_path, capsys):
    from procurement_engine import rehearsal

    registry, ledger = inputs(tmp_path)
    state = tmp_path / 'state'
    release = run_once(registry, ledger, state, client=CompleteGoogle())
    assert release['status'] in {'VERIFIED', 'VERIFIED_WITH_WARNINGS'}
    before = business_files(state)
    result = rehearsal.published_evidence_summary(state)
    assert result['published_evidence_read'] == 'PASS'
    assert result['candidate_replay'] == 'NOT_RUN'
    assert result['weekly_replay'] == 'NOT_CHECKED'
    assert result['legacy_fingerprint_backfill'] == 'NOT_RUN'
    assert isinstance(result['identity_chain_break_counts'], dict)
    assert isinstance(result['identity_unresolved_scope_counts'], dict)
    assert 'recommendation_gap_index' not in result
    assert 'recommendation_identity_gap_index' not in result
    assert rehearsal.main(['--state', str(state), '--published-summary']) == 0
    public = json.loads(capsys.readouterr().out)
    assert public == result
    assert business_files(state) == before


def test_published_evidence_summary_requires_existing_publication(tmp_path, capsys):
    from procurement_engine import rehearsal

    state = tmp_path / 'state'
    assert rehearsal.main(['--state', str(state), '--published-summary']) == 2
    result = json.loads(capsys.readouterr().out)
    assert result['replay_status'] == 'FAIL'
    assert result['error_code'] in {'PUBLICATION_NOT_FOUND', 'GENERATION_FAILED'}


def test_weekly_only_cli_reports_archive_error_without_candidate_replay(monkeypatch, capsys):
    from procurement_engine import rehearsal
    from procurement_engine.archive_runtime import ArchiveError

    def broken_weekly(_state):
        err = ArchiveError('ARCHIVE_BUILD_FAILED')
        err.blockers = [{'code': 'SOURCE_QA_ERRORS'},
                        {'code': 'SECTION_SOURCE_MISMATCH',
                         'context': {'sections': ['procedure_source_contract']}}]
        err.source_issues = [{'code': 'DUPLICATE_PROCEDURE_CODE', 'severity': 'ERROR'}]
        raise err

    def candidate_should_never_run(*args, **kwargs):
        raise AssertionError('Candidate report is not part of the weekly-only gate')

    monkeypatch.setattr(rehearsal, 'rehearse_latest', candidate_should_never_run)
    monkeypatch.setattr(rehearsal, 'rehearse_weekly', broken_weekly)
    assert rehearsal.main(['--state', '/unused', '--weekly-only']) == 2
    result = json.loads(capsys.readouterr().out)
    assert result['replay_status'] == 'FAIL'
    assert result['internal_code'] == 'ARCHIVE_BUILD_FAILED'
    assert result['source_error_counts'] == {'DUPLICATE_PROCEDURE_CODE': 1}
    assert result['section_errors'] == {'procedure_source_contract': 1}
    assert 'candidate' not in json.dumps(result).lower()


def test_weekly_only_cli_accepts_clean_start_without_claiming_replay(tmp_path, capsys):
    from procurement_engine import rehearsal

    assert rehearsal.main(['--state', str(tmp_path), '--weekly-only']) == 0
    result = json.loads(capsys.readouterr().out)
    assert result == {'replay_status': 'NOT_APPLICABLE', 'reason': 'NO_WEEKLY_ARCHIVES', 'archive_count': 0}
    (tmp_path / 'archives').mkdir()
    assert rehearsal.main(['--state', str(tmp_path), '--weekly-only']) == 0
    assert json.loads(capsys.readouterr().out) == result


def test_weekly_only_does_not_mistake_unreadable_state_for_clean_start(tmp_path, capsys):
    from procurement_engine import rehearsal

    assert rehearsal.main(['--state', str(tmp_path / 'absent'), '--weekly-only']) == 2
    assert json.loads(capsys.readouterr().out)['replay_status'] == 'FAIL'
    (tmp_path / 'archives').write_text('not a directory')
    assert rehearsal.main(['--state', str(tmp_path), '--weekly-only']) == 2
    assert json.loads(capsys.readouterr().out)['replay_status'] == 'FAIL'


@pytest.mark.parametrize('option', ['--published-summary', '--coverage-summary', None])
@pytest.mark.parametrize('initialized', [False, True])
def test_no_publication_yet_is_not_a_failed_or_verified_replay(tmp_path, capsys, option, initialized):
    from procurement_engine import rehearsal
    from procurement_engine.publication_store import PublicationStore

    if initialized:
        PublicationStore(tmp_path / 'published')
    args = ['--state', str(tmp_path)] + ([option] if option else [])
    assert rehearsal.main(args) == 0
    result = json.loads(capsys.readouterr().out)
    key = 'published_evidence_read' if option == '--published-summary' else 'replay_status'
    assert result == {key: 'NOT_APPLICABLE', 'reason': 'NO_PUBLISHED_RELEASE', 'publication_count': 0}


@pytest.mark.parametrize('broken', ['database', 'orphan'])
def test_broken_publication_state_is_not_clean_start(tmp_path, capsys, broken):
    from procurement_engine import rehearsal

    published = tmp_path / 'published'
    published.mkdir()
    if broken == 'database':
        (published / 'publications.sqlite').write_text('broken SQLite')
    else:
        (published / 'releases' / 'REL-orphan').mkdir(parents=True)
    assert rehearsal.main(['--state', str(tmp_path), '--coverage-summary']) == 2
    assert json.loads(capsys.readouterr().out)['replay_status'] == 'FAIL'


def test_rehearsal_os_errors_disclose_only_safe_errno_not_private_path(monkeypatch, capsys):
    import errno

    from procurement_engine import rehearsal

    def private_disk_error(*_args, **_kwargs):
        raise OSError(errno.ENOSPC, 'no space left', '/private/source/secret-ledger.json')

    monkeypatch.setattr(rehearsal, 'rehearse_latest', private_disk_error)
    assert rehearsal.main(['--state', '/unused']) == 2
    result = json.loads(capsys.readouterr().out)
    assert result['replay_status'] == 'FAIL'
    assert result['os_error_code'] == 'ENOSPC'
    assert 'private' not in json.dumps(result)
    assert 'secret' not in json.dumps(result)


def test_invalid_reference_proof_requires_literal_errors_in_the_complete_audit():
    from copy import deepcopy

    from procurement_engine.rehearsal import _invalid_reference_proof
    from test_formula_dependencies import source

    original = source(sid='PRIVATE_SOURCE', formulas=[
        {'row': row, 'column': 1, 'formula': '=#REF!'} for row in (1, 2, 3)])
    capture = {'sources': [original], 'archive_origin': {'snapshot_id': 'PRIVATE_SNAPSHOT'}}
    proof = _invalid_reference_proof(capture, {'private/path': 'a' * 64})
    assert proof['invalid_reference_count'] == 3
    assert 'PRIVATE' not in json.dumps(proof) and 'private/path' not in json.dumps(proof)
    moved = deepcopy(capture)
    moved['sources'][0]['formula_evidence']['formulas'][0]['column'] = 2
    assert _invalid_reference_proof(moved, {'private/path': 'a' * 64})['dependency_issue_sha256'] != proof['dependency_issue_sha256']
    assert _invalid_reference_proof(capture, {'private/path': 'b' * 64})['archive_sha256'] != proof['archive_sha256']
    for formula in ('=Support!A1', '=CUSTOM_REMOTE(A1)', '=REF!A1'):
        different = deepcopy(capture)
        different['sources'][0]['formula_evidence']['formulas'][0]['formula'] = formula
        assert _invalid_reference_proof(different, {}) is None


def test_weekly_refusal_proves_frozen_input_without_changing_it_or_authorizing_a_publication(tmp_path, monkeypatch, capsys):
    import test_weekly_archive as weekly
    from procurement_engine import rehearsal
    from procurement_engine.weekly_archive import seal_weekly_archive

    original = weekly.FormulaGoogle.formulas
    def broken(self, provider, title, start, end, columns):
        if provider == 'master-0':
            return [['=#REF!'] if row <= 3 else [] for row in range(start, end + 1)]
        return original(self, provider, title, start, end, columns)
    monkeypatch.setattr(weekly.FormulaGoogle, 'formulas', broken)
    state, status = weekly.complete_attempt(tmp_path)
    seal_weekly_archive(state, status)
    before = business_files(state)
    assert rehearsal.main(['--state', str(state), '--weekly-only']) == 2
    result = json.loads(capsys.readouterr().out)
    assert result['replay_status'] == 'FAIL'
    assert result['blocker_codes'] == ['UPSTREAM_IMPORT_FRESHNESS_NOT_PROVEN']
    assert result['frozen_refusal']['invalid_reference_count'] == 3
    assert business_files(state) == before
    assert not (state / 'published/releases').exists()


@pytest.mark.parametrize('valid_hash', [False, True])
def test_refusal_cli_does_not_publish_arbitrary_exception_attributes(monkeypatch, capsys, valid_hash):
    from procurement_engine import rehearsal
    from procurement_engine.archive_runtime import ArchiveError

    error = ArchiveError('ARCHIVE_BUILD_FAILED')
    error.blockers = [{'code': 'UPSTREAM_IMPORT_FRESHNESS_NOT_PROVEN'}]
    error.frozen_refusal = {'contract': 'frozen-invalid-reference-proof-v1',
        'invalid_reference_count': 3, 'archive_sha256': 'a' * 64 if valid_hash else 'PRIVATE_SENTINEL',
        'snapshot_sha256': 'b' * 64, 'dependency_issue_sha256': 'c' * 64,
        'private_note': 'PRIVATE_SENTINEL'}
    def fail(*args, **kwargs):
        raise error
    monkeypatch.setattr(rehearsal, 'rehearse_weekly', fail)
    assert rehearsal.main(['--state', '/unused', '--weekly-only']) == 2
    text = capsys.readouterr().out
    assert 'PRIVATE_SENTINEL' not in text and 'private_note' not in text
    assert ('frozen_refusal' in json.loads(text)) is valid_hash


def test_quoted_sheet_title_containing_ref_error_does_not_prove_an_unrelated_missing_reference():
    from procurement_engine.rehearsal import _invalid_reference_proof
    from test_formula_dependencies import source

    first = source(formulas=[{'row': 1, 'column': 1, 'formula': "=IFERROR(REF!A1;'#REF!'!A1)"}])
    second = source('captured-title', 2, '#REF!')
    for item in (first, second):
        item['formula_evidence']['sheets'].append({'sheetId': 2, 'title': '#REF!'})
    capture = {'sources': [first, second], 'archive_origin': {'snapshot_id': 'SNP-synthetic'}}
    assert _invalid_reference_proof(capture, {}) is None

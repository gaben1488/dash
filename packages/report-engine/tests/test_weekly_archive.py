import json
import shutil

from procurement_engine.archive_runtime import _source_for_day, ensure_archive_release, load_frozen_input
from procurement_engine.google_adapter import capture_google
from procurement_engine.identity_store import IdentityStore
from procurement_engine.raw_pipeline import build_from_capture
from procurement_engine.weekly_archive import (
    recover_weekly_archives,
    seal_weekly_archive,
)
from test_runtime import Google, inputs


class FormulaGoogle(Google):
    def formula_context(self, provider):
        return {'sheets': [{'sheetId': 0, 'title': self.grid(provider, 0)['title']}], 'named_ranges': []}

    def formulas(self, provider, title, start, end, columns):
        return self.values(provider, title, start, end, columns)


def complete_attempt(root, *, attempt_id='attempt-1', day='2034-09-28'):
    registry_path, _ = inputs(root)
    registry = json.loads(registry_path.read_text())
    capture = capture_google(registry, FormulaGoogle())
    iso = f'{day}T12:00:00+12:00'
    capture.update(
        captured_at=iso,
        acquisition_started_at=iso,
        acquisition_completed_at=iso,
        report_date='.'.join(reversed(day.split('-'))),
        report_year=int(day[:4]),
    )
    state = root / 'state'
    bundle = state / 'attempts' / attempt_id / 'bundle'
    model = build_from_capture(
        capture,
        registry,
        [],
        bundle,
        identity_store=IdentityStore(state / 'identity.sqlite'),
    )
    status = {
        'status': 'NOT_ISSUED',
        'attempt_id': attempt_id,
        'snapshot_id': model['snapshot']['snapshot_id'],
        'report_date': model['snapshot']['report_date'],
        'finished_at': iso,
    }
    (bundle.parent / 'status.json').write_text(json.dumps(status))
    return state, status


def test_complete_thursday_attempt_becomes_self_contained_replay_input(tmp_path):
    state, status = complete_attempt(tmp_path)
    result = seal_weekly_archive(state, status)
    assert result['status'] == 'SEALED'
    archive = state / 'archives/WEEKLY-2034-09-28'
    assert (archive / 'snapshot_bundle/manifest.json').is_file()
    assert (archive / 'identity.sqlite').is_file()

    capture, registry, ledger, _ = load_frozen_input(
        archive, day='2034-09-28', year=2034, quarter=3)
    assert capture['archive_origin']['snapshot_id'] == status['snapshot_id']
    assert {source['sheet'] for source in capture['sources']} >= {
        'Рабочий реестр процедур', 'Процедуры в работе'}
    assert len([source for source in capture['sources'] if source['role'] == 'master']) == 8
    assert ledger == []
    assert len(registry['sources']) == 10

    # Historical generation survives removal of the transient attempt and never
    # needs a current Google read or current identity database.
    shutil.rmtree(state / 'attempts')
    (state / 'identity.sqlite').unlink()
    replay = ensure_archive_release(state, day='2034-09-28', year=2034, quarter=3)
    assert replay['selected'] is not None
    assert replay['selected']['source_verification'] == 'FROZEN_ARCHIVE_HASHES'


def test_sealed_weekly_archive_wins_over_same_day_attempts(tmp_path):
    state, status = complete_attempt(tmp_path)
    result = seal_weekly_archive(state, status)
    archive = state / 'archives/WEEKLY-2034-09-28'
    assert result['status'] == 'SEALED'
    assert (state / 'attempts' / status['attempt_id'] / 'bundle').is_dir()

    # The transient attempt has the same date and can even sort later by path/time;
    # once WEEKLY-* exists it is the authoritative exact-date replay input.
    assert _source_for_day(state, '2034-09-28') == archive


def test_later_attempt_cannot_replace_first_sealed_thursday(tmp_path):
    state, status = complete_attempt(tmp_path)
    first = seal_weekly_archive(state, status)
    later = seal_weekly_archive(state, {
        **status,
        'attempt_id': 'later-attempt',
        'snapshot_id': 'SNAP-later-must-not-replace',
    })
    assert later['status'] == 'ALREADY_SEALED'
    assert later['snapshot_id'] == first['snapshot_id']


def test_incomplete_or_non_thursday_attempt_is_never_promoted(tmp_path):
    state = tmp_path / 'state'
    incomplete = {
        'attempt_id': 'missing',
        'snapshot_id': 'SNAP-missing',
        'report_date': '28.09.2034',
    }
    result = seal_weekly_archive(state, incomplete)
    assert result['status'] == 'NOT_READY'
    assert not (state / 'archives/WEEKLY-2034-09-28').exists()

    friday = seal_weekly_archive(state, {
        **incomplete,
        'report_date': '29.09.2034',
    })
    assert friday['status'] == 'NOT_APPLICABLE'
    assert not (state / 'archives/WEEKLY-2034-09-29').exists()


def test_recovery_scans_retained_attempts_without_live_reread(tmp_path):
    state, status = complete_attempt(tmp_path, attempt_id='kept-attempt')
    assert not (state / 'archives/WEEKLY-2034-09-28').exists()
    results = recover_weekly_archives(state)
    assert any(item['status'] == 'SEALED' for item in results)
    assert (state / 'archives/WEEKLY-2034-09-28').is_dir()

    # A second recovery is idempotent and keeps the same frozen snapshot.
    repeated = recover_weekly_archives(state)
    assert any(item['status'] == 'ALREADY_SEALED' for item in repeated)
    capture, _, _, _ = load_frozen_input(
        state / 'archives/WEEKLY-2034-09-28', day='2034-09-28', year=2034, quarter=3)
    assert capture['archive_origin']['snapshot_id'] == status['snapshot_id']

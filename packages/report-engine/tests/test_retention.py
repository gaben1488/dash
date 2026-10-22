import hashlib
import json
import tracemalloc
from datetime import datetime, timedelta, timezone

from procurement_engine import retention
from procurement_engine.retention import (
    apply_transient_attempt_retention,
    plan_transient_attempt_retention,
)


def test_publication_revision_preserves_exact_legacy_json_bytes():
    rows=[('REL-b','2026-10-16','2026-10-16T00:00:00Z','{"text":"смета\\n№173/18🌅"}','{}'),
          ('REL-a','2026-10-15','2026-10-15T00:00:00Z','{"empty":null,"zero":0}','{}')]
    keep={'REL-b','REL-a'};targets=['REL-z','REL-c']
    legacy=json.dumps([rows,sorted(keep),sorted(targets)],separators=(',',':')).encode()
    assert retention._catalog_revision(rows,keep,iter(targets))==hashlib.sha256(legacy).hexdigest()


def test_publication_revision_does_not_allocate_the_whole_encoded_catalog():
    # Repeated observed content still has64 distinct catalog records. Measure
    # serialization overhead, with the already-read input outside the probe.
    receipt='{"proof":"'+'x'*(512*1024)+'"}'
    rows=[(f'REL-{index:064x}','2026-10-16','2026-10-16T00:00:00Z',receipt,'{}') for index in range(64)]
    tracemalloc.start()
    try:
        revision=retention._catalog_revision(rows,set(),(row[0] for row in rows))
        _,peak=tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert len(revision)==64
    assert peak<8*1024**2, f'Catalog serialization retained {peak} bytes for32MiB of receipts'


def _attempt(state, name, *, when, report_date="07.10.2034", size=128):
    root = state / "attempts" / name
    root.mkdir(parents=True)
    status = {
        "status": "NOT_ISSUED",
        "attempt_id": name,
        "started_at": when.isoformat(),
        "finished_at": (when + timedelta(minutes=1)).isoformat(),
        "report_date": report_date,
    }
    (root / "status.json").write_text(json.dumps(status), encoding="utf-8")
    (root / "error.json").write_text('{"code":"TEST"}', encoding="utf-8")
    (root / "capture.json").write_bytes(b"x" * size)
    bundle = root / "bundle"
    bundle.mkdir()
    (bundle / "report_model.json").write_bytes(b"y" * size)
    return root


def _weekly_archive(state, *, day, source_ref, snapshot_id="SNAP-week"):
    root = state / "archives" / f"WEEKLY-{day}"
    (root / "snapshot_bundle").mkdir(parents=True)
    (root / "snapshot_bundle" / "manifest.json").write_text(json.dumps({
        "snapshot_id": snapshot_id,
        "report_date": ".".join(reversed(day.split("-"))),
    }), encoding="utf-8")
    (root / "identity.sqlite").write_bytes(b"identity")
    (root / "import.json").write_text(json.dumps({
        "archive_id": f"WEEKLY-{day}",
        "report_date": day,
        "snapshot_id": snapshot_id,
        "source_kind": "attempt",
        "source_ref": source_ref,
        "contract": "canonical-weekly-report-input-v1",
    }), encoding="utf-8")


def test_retention_compacts_only_old_payloads_and_keeps_audit_records(tmp_path):
    state = tmp_path / "state"
    base = datetime(2034, 10, 7, tzinfo=timezone.utc)
    roots = [
        _attempt(state, f"a{i:02d}", when=base + timedelta(minutes=i), size=100 + i)
        for i in range(8)
    ]
    # Current attempt is deliberately old: current status must beat age/count.
    (state / "status.json").write_text(json.dumps({"attempt_id": "a00"}), encoding="utf-8")

    plan = plan_transient_attempt_retention(state, keep_full=2)
    assert plan["attempt_count"] == 8
    assert plan["compact_count"] == 5
    assert plan["bytes_reclaimable"] > 0
    assert "a00" not in plan["compact_attempts"]
    assert "a06" not in plan["compact_attempts"]
    assert "a07" not in plan["compact_attempts"]

    result = apply_transient_attempt_retention(
        state, keep_full=2, expected_attempts=plan["compact_attempts"])
    assert result["status"] == "COMPACTED"
    assert result["compacted"] == 5
    assert result["bytes_reclaimed"] == plan["bytes_reclaimable"]

    for root in roots:
        # Retention never deletes the attempt, status or diagnostic error.
        assert (root / "status.json").is_file()
        assert (root / "error.json").is_file()
    for name in plan["compact_attempts"]:
        root = state / "attempts" / name
        assert not (root / "capture.json").exists()
        assert not (root / "bundle").exists()
    for name in ("a00", "a06", "a07"):
        root = state / "attempts" / name
        assert (root / "capture.json").is_file()
        assert (root / "bundle").is_dir()


def test_default_does_not_keep_a_dozen_redundant_full_captures(tmp_path):
    state = tmp_path / "state"
    base = datetime(2034, 10, 7, tzinfo=timezone.utc)
    for i in range(8):
        _attempt(state, f"a{i:02d}", when=base + timedelta(minutes=i))
    plan = plan_transient_attempt_retention(state)
    assert plan["compact_count"] == 6
    assert plan["keep_full"] == 2


def test_unsealed_thursday_is_fail_closed_and_never_compacted(tmp_path):
    state = tmp_path / "state"
    # 2034-09-28 is Thursday.
    old = _attempt(
        state, "thursday-only-source",
        when=datetime(2034, 9, 28, tzinfo=timezone.utc),
        report_date="28.09.2034",
    )
    for i in range(4):
        _attempt(
            state, f"new-{i}",
            when=datetime(2034, 10, 1, tzinfo=timezone.utc) + timedelta(minutes=i),
        )

    plan = plan_transient_attempt_retention(state, keep_full=2)
    assert plan["protected_unsealed_thursdays"] == 1
    assert "thursday-only-source" not in plan["compact_attempts"]
    apply_transient_attempt_retention(state, keep_full=2)
    assert (old / "capture.json").is_file()
    assert (old / "bundle").is_dir()


def test_sealed_week_releases_duplicate_only_after_archive_integrity_check(tmp_path):
    from procurement_engine.weekly_archive import seal_weekly_archive
    from test_weekly_archive import complete_attempt

    state, status = complete_attempt(tmp_path, attempt_id='weekly-source')
    source = state / 'attempts/weekly-source'
    assert seal_weekly_archive(state, status)['status'] == 'SEALED'
    for i in range(5):
        _attempt(
            state, f"later-{i}",
            when=datetime(2034, 10, 1, tzinfo=timezone.utc) + timedelta(minutes=i),
        )

    plan = plan_transient_attempt_retention(state, keep_full=2)
    assert plan["protected_unsealed_thursdays"] == 0
    assert "weekly-source" in plan["compact_attempts"]
    archive = state / 'archives/WEEKLY-2034-09-28/snapshot_bundle'
    manifest = json.loads((archive / 'manifest.json').read_text())
    payload = archive / manifest['payload_index'][0]['path']
    original = payload.read_bytes()
    payload.write_bytes(original + b' ')
    damaged = plan_transient_attempt_retention(state, keep_full=2)
    assert damaged['protected_unsealed_thursdays'] == 1
    assert 'weekly-source' not in damaged['compact_attempts']
    payload.write_bytes(original)
    apply_transient_attempt_retention(state, keep_full=2)
    assert not (source / "bundle").exists()
    assert (source / 'status.json').is_file()
    assert payload.read_bytes() == original


def test_dry_run_compare_barrier_rejects_changed_plan(tmp_path):
    state = tmp_path / "state"
    base = datetime(2034, 10, 7, tzinfo=timezone.utc)
    for i in range(4):
        _attempt(state, f"a{i}", when=base + timedelta(minutes=i))
    old_plan = plan_transient_attempt_retention(state, keep_full=2)
    _attempt(state, "newest", when=base + timedelta(hours=1))

    result = apply_transient_attempt_retention(
        state, keep_full=2, expected_attempts=old_plan["compact_attempts"])
    assert result["status"] == "PLAN_CHANGED"
    assert result["bytes_reclaimed"] == 0


def test_apply_retention_takes_the_same_exclusive_run_lock_as_report_generation(tmp_path, monkeypatch):
    state = tmp_path / "state"
    base = datetime(2034, 10, 7, tzinfo=timezone.utc)
    for i in range(4):
        _attempt(state, f"a{i}", when=base + timedelta(minutes=i))

    calls = []
    real_flock = retention.fcntl.flock

    def observed(fd, operation):
        calls.append(operation)
        return real_flock(fd, operation)

    monkeypatch.setattr(retention.fcntl, "flock", observed)
    result = apply_transient_attempt_retention(state, keep_full=2)

    assert result["status"] == "COMPACTED"
    assert retention.fcntl.LOCK_EX in calls
    assert (state / "run.lock").is_file()


def test_retention_refuses_symlinked_run_lock(tmp_path):
    state = tmp_path / "state"
    state.mkdir()
    target = tmp_path / "outside.lock"
    target.write_text("", encoding="utf-8")
    (state / "run.lock").symlink_to(target)

    try:
        apply_transient_attempt_retention(state, keep_full=2)
    except ValueError as error:
        assert str(error) == "ATTEMPT_RETENTION_LOCK_UNSAFE"
    else:
        raise AssertionError("symlinked run lock must fail closed")


def test_worker_retention_bounds_publications_and_repeated_status_details(tmp_path):
    from procurement_engine.publication_store import PublicationStore
    from test_publication_store import candidate, revisions

    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    records = []
    # Two prior weekly baselines, previous report day, and two current releases.
    for number, day in enumerate(['01.10.2026', '02.10.2026', '08.10.2026',
                                 '09.10.2026', '12.10.2026', '13.10.2026',
                                 '14.10.2026', '15.10.2026', '16.10.2026',
                                 '19.10.2026', '19.10.2026']):
        records.append(store.publish(candidate(tmp_path / f'candidate{number}', date=day,
            cutoff=f'2026-10-19T{number:02d}:00:00Z'), read_revisions=revisions))
    base = datetime(2026, 10, 19, tzinfo=timezone.utc)
    for number in range(5):
        root = _attempt(state, f'a{number:02d}', when=base + timedelta(minutes=number))
        status = json.loads((root / 'status.json').read_text())
        status.update(automation_assurance={'details': 'repeated' * 10000},
                      publication={**records[-1], 'weekly_summary': {'details': 'repeated' * 10000}})
        (root / 'status.json').write_text(json.dumps(status))
    (state / 'status.json').write_text(json.dumps({'attempt_id': 'a04'}))
    retention.safe_compact_transient_attempts(state, keep_full=2)

    assert {r['release_id'] for r in store.history()} == {
        records[i]['release_id'] for i in (3, 8, 9, 10)}
    old = json.loads((state / 'attempts/a00/status.json').read_text())
    assert old['status'] == 'NOT_ISSUED'
    assert old['publication']['release_id'] == records[-1]['release_id']
    assert len(json.dumps(old)) < 4096
    assert (state / 'attempts/a04/bundle').is_dir()


def test_unreconciled_attempt_protects_payload_and_committed_receipt(tmp_path):
    from procurement_engine.publication_store import PublicationStore
    from test_publication_store import candidate, revisions

    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    records = [store.publish(candidate(tmp_path / f'c{i}', date='19.10.2026',
        cutoff=f'2026-10-19T{i:02d}:00:00Z'), read_revisions=revisions) for i in range(3)]
    base = datetime(2026, 10, 19, tzinfo=timezone.utc)
    for number in range(4):
        _attempt(state, f'a{number}', when=base + timedelta(minutes=number))
    journal = state / 'attempts/a0/status.json'
    status = json.loads(journal.read_text())
    status.update(status='RUNNING', pending_release_id=records[0]['release_id'])
    journal.write_text(json.dumps(status))
    result = retention.safe_compact_transient_attempts(state)
    assert result['status'] == 'COMPACTED'
    assert (journal.parent / 'bundle').exists()
    assert store.receipt(records[0]['release_id'])['release_id'] == records[0]['release_id']
    status['status'] = 'NOT_ISSUED'
    journal.write_text(json.dumps(status))
    result = retention.safe_compact_transient_attempts(state)
    assert result['publications']['removed'] == 1
    assert not (journal.parent / 'bundle').exists()


def test_publication_retention_removes_interrupted_staging_under_writer_locks(tmp_path):
    from procurement_engine.publication_retention import apply_publication_retention
    from procurement_engine.publication_store import PublicationStore
    from test_publication_store import candidate, revisions

    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    record = store.publish(candidate(tmp_path / 'candidate'), read_revisions=revisions)
    pending = store.releases / '.pending-ab12_cd3'
    pending.mkdir()
    (pending / 'partial.json').write_bytes(b'uncommitted')
    result = apply_publication_retention(state)
    assert result['pending_removed'] == 1
    assert result['pending_bytes_reclaimed'] == len(b'uncommitted')
    assert not pending.exists()
    assert store.latest() == record
    assert apply_publication_retention(state)['pending_removed'] == 0


def test_publication_retention_rejects_unsafe_staging_before_deletion(tmp_path):
    import pytest
    from procurement_engine.publication_retention import apply_publication_retention
    from procurement_engine.publication_store import PublicationStore
    from test_publication_store import candidate, revisions

    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    record = store.publish(candidate(tmp_path / 'candidate'), read_revisions=revisions)
    outside = tmp_path / 'outside'
    outside.mkdir()
    (outside / 'keep').write_text('important')
    (store.releases / '.pending-ab12_cd3').symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match='ATTEMPT_PAYLOAD_SYMLINK'):
        apply_publication_retention(state)
    assert (outside / 'keep').read_text() == 'important'
    assert store.latest() == record


def test_publication_retention_does_not_change_archive_inputs_and_retries_orphans(tmp_path, monkeypatch):
    from procurement_engine import publication_retention
    from procurement_engine.publication_store import PublicationStore
    from test_publication_store import candidate, revisions

    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    records = [store.publish(candidate(tmp_path / f'c{i}', date='19.10.2026',
        cutoff=f'2026-10-19T{i:02d}:00:00Z'), read_revisions=revisions) for i in range(4)]
    _weekly_archive(state, day='2026-10-15', source_ref='old-attempt')
    archive = state / 'archives/WEEKLY-2026-10-15/identity.sqlite'
    before = archive.read_bytes()
    remove = publication_retention.plan_publication_retention(state)['remove']
    real_remove = publication_retention.shutil.rmtree

    def fail_once(path):
        raise OSError('simulated interrupted cleanup')

    monkeypatch.setattr(publication_retention.shutil, 'rmtree', fail_once)
    import pytest
    with pytest.raises(OSError):
        publication_retention.apply_publication_retention(state, expected_remove=remove)
    assert store.latest() == records[-1]
    assert len(store.history()) == 2
    monkeypatch.setattr(publication_retention.shutil, 'rmtree', real_remove)
    result = publication_retention.apply_publication_retention(state)
    assert result['removed'] == 2
    assert archive.read_bytes() == before
    assert len(list(store.releases.iterdir())) == 2


def test_publication_retention_refuses_symlink_and_stale_plan(tmp_path):
    import pytest
    from procurement_engine.publication_retention import apply_publication_retention
    from procurement_engine.publication_store import PublicationStore
    from test_publication_store import candidate, revisions

    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    for i in range(3):
        store.publish(candidate(tmp_path / f'c{i}', date='19.10.2026',
            cutoff=f'2026-10-19T{i:02d}:00:00Z'), read_revisions=revisions)
    assert apply_publication_retention(state, expected_remove=[])['status'] == 'PLAN_CHANGED'
    assert len(store.history()) == 3

    outside = tmp_path / 'outside'
    outside.mkdir()
    (store.releases / ('REL-' + 'f' * 64)).symlink_to(outside)
    with pytest.raises(ValueError, match='PUBLICATION_RETENTION_UNSAFE'):
        apply_publication_retention(state)
    assert len(store.history()) == 3


def test_retention_keeps_identity_copy_until_live_identity_contains_its_snapshot(tmp_path):
    from procurement_engine.publication_retention import plan_publication_retention
    from procurement_engine.publication_store import PublicationStore
    from test_publication_store import candidate, revisions

    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    records = []
    for i in range(3):
        root = candidate(tmp_path / f'c{i}', date='19.10.2026', cutoff=f'2026-10-19T{i:02d}:00:00Z')
        (root / 'identity.sqlite').write_bytes(b'only saved identity')
        records.append(store.publish(root, read_revisions=revisions))
    plan = plan_publication_retention(state)
    assert records[0]['release_id'] in plan['keep']


def test_interrupted_retention_retries_orphan_with_identity_backup(tmp_path, monkeypatch):
    import sqlite3

    import pytest
    from procurement_engine import publication_retention
    from procurement_engine.publication_store import PublicationStore
    from test_publication_store import candidate, revisions

    state = tmp_path / 'state'
    store = PublicationStore(state / 'published')
    records = []
    for i in range(3):
        root = candidate(tmp_path / f'c{i}', date='19.10.2026', cutoff=f'2026-10-19T{i:02d}:00:00Z')
        (root / 'identity.sqlite').write_bytes(b'identity backup')
        records.append(store.publish(root, read_revisions=revisions))
    with sqlite3.connect(state / 'identity.sqlite') as db:
        db.executescript('CREATE TABLE snapshots(snapshot_id); '
                        'CREATE TABLE observations(snapshot_id,plan_signature,entity_signature);')
        for record in records:
            db.execute('INSERT INTO snapshots VALUES (?)', (record['snapshot_id'],))
            db.execute('INSERT INTO observations VALUES (?,?,?)', (record['snapshot_id'], 'plan', 'entity'))
    remove = publication_retention.shutil.rmtree
    def interrupted(path):
        raise OSError('interrupted after catalog commit')
    monkeypatch.setattr(publication_retention.shutil, 'rmtree', interrupted)
    with pytest.raises(OSError):
        publication_retention.apply_publication_retention(state)
    monkeypatch.setattr(publication_retention.shutil, 'rmtree', remove)
    result = publication_retention.apply_publication_retention(state)
    assert result['removed'] == 1
    assert not (store.releases / records[0]['release_id']).exists()
    assert store.latest()['release_id'] == records[-1]['release_id']

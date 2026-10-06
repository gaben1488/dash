import json
from datetime import datetime, timedelta, timezone

from procurement_engine.retention import (
    apply_transient_attempt_retention,
    plan_transient_attempt_retention,
)


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


def test_sealed_week_keeps_its_single_source_attempt_as_independent_copy(tmp_path):
    state = tmp_path / "state"
    source = _attempt(
        state, "weekly-source",
        when=datetime(2034, 9, 28, tzinfo=timezone.utc),
        report_date="28.09.2034",
    )
    _weekly_archive(state, day="2034-09-28", source_ref="weekly-source")
    for i in range(5):
        _attempt(
            state, f"later-{i}",
            when=datetime(2034, 10, 1, tzinfo=timezone.utc) + timedelta(minutes=i),
        )

    plan = plan_transient_attempt_retention(state, keep_full=2)
    assert plan["protected_unsealed_thursdays"] == 0
    assert "weekly-source" not in plan["compact_attempts"]
    apply_transient_attempt_retention(state, keep_full=2)
    assert (source / "capture.json").is_file()
    assert (source / "bundle").is_dir()


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

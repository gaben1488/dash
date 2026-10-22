"""Persistent JSON preserves source meaning without pretty-printing large matrices."""
import json
import os
import stat
import tracemalloc

import pytest
from procurement_engine.raw_pipeline import dump
from procurement_engine.runtime import _write
from procurement_engine.snapshot import canonical_semantic_hash


@pytest.mark.parametrize("writer", [dump, _write], ids=["report-bundle", "attempt-capture"])
def test_persistent_matrix_is_compact_and_semantically_identical(tmp_path, writer):
    value = {"rows": [[i, None, False, 0, 12.345, 'Не оплачено; "Х"\nстрока \\']
                      for i in range(1000)], "revision": "источник-1"}
    target = tmp_path / "capture.json"
    writer(target, value) if writer is _write else writer(value, target)
    saved = target.read_bytes()
    compact = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    assert len(saved) <= len(compact)
    assert json.loads(saved) == value
    assert canonical_semantic_hash(json.loads(saved)) == canonical_semantic_hash(value)


def test_report_json_does_not_allocate_a_second_full_serialized_matrix(tmp_path):
    # Start after constructing the input: the budget is for the writer, not the
    # captured source. Returning a full dumps() string used several times this.
    value = {"rows": [[i, "абвгд" * 40] for i in range(10000)]}
    target = tmp_path / "report_model.json"
    tracemalloc.start()
    try:
        dump(value, target)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert peak < 1024 * 1024
    assert json.loads(target.read_bytes()) == value


@pytest.mark.parametrize("writer", [dump, _write], ids=["report-bundle", "attempt-capture"])
def test_invalid_source_number_preserves_previous_file(tmp_path, writer):
    target = tmp_path / "capture.json"
    target.write_text('{"previous":"сохранено"}', encoding="utf-8")
    before = target.read_bytes()
    with pytest.raises(ValueError):
        writer(target, {"rows": [1, float("nan")]}) if writer is _write else writer(
            {"rows": [1, float("nan")]}, target)
    assert target.read_bytes() == before
    assert list(tmp_path.iterdir()) == [target]


@pytest.mark.parametrize("writer", [dump, _write], ids=["report-bundle", "attempt-capture"])
def test_replacing_private_capture_preserves_its_permissions(tmp_path, writer):
    target = tmp_path / "capture.json"
    target.write_text('{}', encoding="utf-8")
    target.chmod(0o600)
    previous_umask = os.umask(0o022)
    try:
        writer(target, {"revision": 2}) if writer is _write else writer({"revision": 2}, target)
    finally:
        os.umask(previous_umask)
    assert stat.S_IMODE(target.stat().st_mode) == 0o600

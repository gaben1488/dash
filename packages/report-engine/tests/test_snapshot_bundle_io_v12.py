import hashlib
import json
from pathlib import Path

import pytest
from procurement_engine.atomic_snapshot import SourcePayload, capture_atomic_snapshot
from procurement_engine.snapshot_bundle_io import (
    matrix_shape,
    persist_atomic_bundle,
    schema_fingerprint_from_matrix,
    verify_persisted_bundle,
)


class FakeAdapter:
    def __init__(self, source_id, values, revision="r1", tab="10"):
        self.source_id = source_id
        self.role = "MASTER"
        self.provider_id = "provider-" + source_id
        self.values = values
        self._revision = revision
        self.tab = tab
        self.allowed_schema_fingerprints = (schema_fingerprint_from_matrix(values),)

    def revision_token(self):
        return self._revision

    def read_payload(self):
        return SourcePayload(
            source_id=self.source_id,
            role=self.role,
            provider_id=self.provider_id,
            semantic_values=self.values,
            sheet_or_tab_id=self.tab,
            schema_fingerprint=schema_fingerprint_from_matrix(self.values),
            metadata={"range": "A1:AH10", "sheet_title": "ВСЕ"},
        )


def test_schema_fingerprint_depends_on_header_not_body():
    a = [["h1", "h2"], ["sub"], ["x", "y"], [1, 2]]
    b = [["h1", "h2"], ["sub"], ["x", "y"], [999, 888]]
    assert schema_fingerprint_from_matrix(a) == schema_fingerprint_from_matrix(b)
    b[2][1] = "changed"
    assert schema_fingerprint_from_matrix(a) != schema_fingerprint_from_matrix(b)


def test_matrix_shape():
    assert matrix_shape([[1], [1, 2, 3]]) == {"rows": 2, "max_columns": 3}


def test_persist_and_verify_bundle(tmp_path: Path):
    adapter = FakeAdapter("UO", [["a"], ["b"], ["c"], [1]])
    bundle = capture_atomic_snapshot(
        [adapter], report_date="2026-09-29", report_year=2026,
        rules_version="r", renderer_version="x", cutoff_at="2026-09-29T08:00:00Z"
    )
    meta = persist_atomic_bundle(bundle, tmp_path / "snap")
    assert meta["payload_count"] == 1
    assert verify_persisted_bundle(tmp_path / "snap") == []
    manifest = json.loads((tmp_path / "snap" / "manifest.json").read_text())
    assert manifest["sources"][0]["payload_metadata"]["range"] == "A1:AH10"
    assert manifest["payload_index"][0]["shape"] == {"rows": 4, "max_columns": 1}


def test_verify_detects_payload_tampering(tmp_path: Path):
    adapter = FakeAdapter("UO", [["a"], ["b"], ["c"], [1]])
    bundle = capture_atomic_snapshot(
        [adapter], report_date="2026-09-29", report_year=2026,
        rules_version="r", renderer_version="x", cutoff_at="2026-09-29T08:00:00Z"
    )
    persist_atomic_bundle(bundle, tmp_path / "snap")
    p = tmp_path / "snap" / "payloads" / "UO.json"
    p.write_text(p.read_text() + " ")
    errors = verify_persisted_bundle(tmp_path / "snap")
    assert "SNAPSHOT_PAYLOAD_FILE_HASH_MISMATCH:UO" in errors


@pytest.mark.parametrize("part", ["manifest", "meta", "payload"])
@pytest.mark.parametrize("invalid", [[], 1, None])
def test_verify_rejects_checksummed_json_with_wrong_shape(tmp_path, part, invalid):
    bundle = capture_atomic_snapshot(
        [FakeAdapter("UO", [["a"], ["b"], ["c"], [1]])],
        report_date="2026-09-29", report_year=2026, rules_version="r",
        renderer_version="x", cutoff_at="2026-09-29T08:00:00Z",
    )
    persist_atomic_bundle(bundle, tmp_path)
    manifest_path = tmp_path / "manifest.json"
    meta_path = tmp_path / "bundle.json"
    manifest = json.loads(manifest_path.read_text())
    meta = json.loads(meta_path.read_text())
    if part == "payload":
        payload = tmp_path / manifest["payload_index"][0]["path"]
        payload.write_text(json.dumps(invalid))
        manifest["payload_index"][0]["bundle_file_sha256"] = hashlib.sha256(payload.read_bytes()).hexdigest()
        manifest_path.write_text(json.dumps(manifest))
    elif part == "manifest":
        manifest_path.write_text(json.dumps(invalid))
    meta["manifest_sha256"] = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    meta_path.write_text(json.dumps(invalid if part == "meta" else meta))
    assert verify_persisted_bundle(tmp_path) == [
        "SNAPSHOT_PAYLOAD_SHAPE_INVALID:UO" if part == "payload" else "SNAPSHOT_BUNDLE_SHAPE_INVALID"
    ]

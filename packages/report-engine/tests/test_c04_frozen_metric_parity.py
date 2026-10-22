"""C04.01: cross-runtime, fixed-day, document-bound metric acceptance.

Synthetic source matrices only; no Google access or production writes.
"""
import importlib.util
import json
from copy import deepcopy
from pathlib import Path

import pytest
from docx import Document
from procurement_engine.google_adapter import capture_google
from procurement_engine.identity_store import IdentityStore
from procurement_engine.raw_pipeline import build_from_capture, captured_source_revision
from test_forensic_qa import rawrow
from test_recorded_release import CompleteGoogle
from test_runtime import inputs

REPO = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location(
    "economy_source_parity", REPO / ".github/ci/economy_source_parity.py"
)
PROBE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROBE)


@pytest.fixture
def frozen_case(tmp_path):
    registry_path, _ = inputs(tmp_path)
    registry = json.loads(registry_path.read_text())
    capture = capture_google(registry, CompleteGoogle())
    capture.update(report_date="30.09.2026", report_year=2026,
                   captured_at="2026-09-30T00:00:00+00:00")
    masters = [s for s in capture["sources"] if s["role"] == "master"]
    assert len(masters) == 8

    for index, source in enumerate(masters):
        for quarter in range(1, 5):
            for method_index, method in enumerate(("ЭА", "ЕП")):
                completed = quarter < 4 and (index + quarter + method_index) % 3 != 0
                approved = completed and (index + quarter + method_index) % 2 == 0
                plan = (10 + index, 20 + quarter, 30 + method_index)
                fact = (7 + index, 14 + quarter, 22 + method_index) if completed else (0, 0, 0)
                row = rawrow(
                    str(10000 + 100 * index + 10 * quarter + method_index),
                    subject=f"Испытательная позиция {index}-{quarter}-{method_index}",
                    method=method, q=quarter, year=2026,
                    plan_date=f"15.{quarter * 3 - 2:02d}.2026",
                    plan=plan, fact_date="29.09.2026" if completed else "X", fact=fact,
                )
                row[25:29] = [1.25, -0.15, 0.05, 1.15] if approved else [0, 0, 0, 0]
                row[29] = "да" if approved else "нет"
                source["values"].append(row)
        source["rows"] = len(source["values"])
        source["formula_evidence"]["rows"] = source["rows"]

    # Pin the same complete capture that the live source coordinator seals.
    capture["source_revision"] = captured_source_revision(capture)
    root = tmp_path / "bundle"
    build_from_capture(capture, registry, [], root, identity_store=IdentityStore(tmp_path / "identity.sqlite"))
    return root, {
        "report_model": root / "report_model.json",
        "dashboard": root / "dashboard.json",
        "main_docx": root / "main_report.docx",
        "management_docx": root / "management_report.docx",
    }


def test_c04_eight_masters_two_methods_five_scopes_and_pinned_word(frozen_case):
    root, paths = frozen_case
    evidence = PROBE.compare(root / "snapshot_bundle", REPO, **paths)
    assert evidence["state"] == "PASS", evidence["mismatches"]
    assert evidence["scope"] == "FROZEN_TS_PYTHON_MODEL_DASHBOARD_WORD"
    assert evidence["masters"] == 8
    assert evidence["ts_python_cells"] == 480
    assert evidence["model_cells"] == 560
    assert evidence["validated_word_documents"] == 2
    assert evidence["mismatch_count"] == 0
    assert evidence["as_of"] == "2026-09-30"


def test_c04_report_dashboard_inherits_frozen_revision_and_rejects_tampering(frozen_case, tmp_path):
    root, paths = frozen_case
    manifest = json.loads((root / "snapshot_bundle/manifest.json").read_text())
    report_model = json.loads(paths["report_model"].read_text())
    dashboard = json.loads(paths["dashboard"].read_text())
    assert manifest["source_revision"] == report_model["snapshot"]["source_revision"]
    assert dashboard["source_revision"] == manifest["source_revision"]

    dashboard["source_revision"] = "SRC-" + "0" * 64
    altered = tmp_path / "altered-revision-dashboard.json"
    altered.write_text(json.dumps(dashboard))
    with pytest.raises(ValueError, match="ARTIFACT_SOURCE_REVISION_MISMATCH"):
        PROBE.compare(root / "snapshot_bundle", REPO, **{**paths, "dashboard": altered})


def test_c04_historical_projection_preserves_original_artifact_shape():
    from procurement_engine.projections import (
        assert_projection_parity,
        project_dashboard,
    )

    # Historical reports can already have source_revision in the immutable
    # ReportModel while their stored dashboard.json predates this field.
    legacy = {"snapshot": {"snapshot_id": "historical", "source_revision": "SRC-" + "a" * 64},
              "headline": {"competitive": {"year": {"plan_count": 1}}},
              "contract": {"report_model_version": "report-model-v1.2.0"}}
    old_dashboard = project_dashboard(legacy)
    assert "source_revision" not in old_dashboard
    assert_projection_parity(legacy, old_dashboard)
    new = {**legacy, "contract": {**legacy["contract"], "source_revision_projection": "v1"}}
    new_dashboard = project_dashboard(new)
    assert new_dashboard["source_revision"] == legacy["snapshot"]["source_revision"]
    assert_projection_parity(new, new_dashboard)


def test_c04_dashboard_snapshot_drift_blocks_acceptance(frozen_case, tmp_path):
    root, paths = frozen_case
    wrong = json.loads(paths["dashboard"].read_text())
    wrong["headline"]["competitive"]["year"]["plan_count"] += 1
    altered = tmp_path / "altered-dashboard.json"
    altered.write_text(json.dumps(wrong))
    with pytest.raises(ValueError, match="ARTIFACT_DASHBOARD_MISMATCH"):
        PROBE.compare(root / "snapshot_bundle", REPO, **{**paths, "dashboard": altered})


def test_c04_word_tampering_blocks_acceptance(frozen_case, tmp_path):
    root, paths = frozen_case
    altered = tmp_path / "altered-main.docx"
    document = Document(paths["main_docx"])
    document.add_paragraph("Число без источника: 999999.")
    document.save(altered)
    with pytest.raises(ValueError, match="DOCUMENT_CONTENT_MISMATCH"):
        PROBE.compare(root / "snapshot_bundle", REPO, **{**paths, "main_docx": altered})


def test_c04_matching_but_false_dashboard_and_model_headline_is_rejected(frozen_case, tmp_path):
    root, paths = frozen_case
    changed_model = json.loads(paths["report_model"].read_text())
    changed_dashboard = json.loads(paths["dashboard"].read_text())
    for document in (changed_model, changed_dashboard):
        document["headline"]["competitive"]["year"]["plan_count"] += 1
    model_file = tmp_path / "false-model.json"
    dashboard_file = tmp_path / "false-dashboard.json"
    model_file.write_text(json.dumps(changed_model))
    dashboard_file.write_text(json.dumps(changed_dashboard))
    evidence = PROBE.compare(root / "snapshot_bundle", REPO, **{
        **paths, "report_model": model_file, "dashboard": dashboard_file,
    })
    assert evidence["state"] == "MISMATCH"
    assert evidence["mismatch_count"] > 0
    assert any(item["scope"] == "headline" and item["metric"] == "plan_count"
               for item in evidence["mismatches"])


def test_c04_model_must_match_exact_frozen_source(frozen_case, tmp_path):
    root, paths = frozen_case
    wrong = deepcopy(json.loads(paths["report_model"].read_text()))
    wrong["snapshot"]["snapshot_id"] = "synthetic-wrong-snapshot"
    altered = tmp_path / "altered-model.json"
    altered.write_text(json.dumps(wrong))
    with pytest.raises(ValueError, match="ARTIFACT_SNAPSHOT_MISMATCH"):
        PROBE.compare(root / "snapshot_bundle", REPO, **{**paths, "report_model": altered})


def test_c04_partial_artifact_set_is_not_acceptance():
    with pytest.raises(ValueError, match="ARTIFACT_SET_INCOMPLETE"):
        PROBE.compare(Path("not-a-real-bundle"), REPO, report_model=Path("not-a-real-model"))

"""The third executive briefing must be a first-class verified Word release."""
import json

from docx import Document
from procurement_engine.document_content import planned_documents, validate_document_content
from procurement_engine.operational_plan import _focus_quarter, _relevant_comment
from procurement_engine.publication_reader import read_publication
from procurement_engine.publication_store import _document_artifacts
from procurement_engine.runtime import run_once
from test_recorded_release import CompleteGoogle
from test_runtime import inputs


def test_operational_report_is_published_atomically_with_both_existing_word_files(tmp_path):
    registry, ledger = inputs(tmp_path)
    state = tmp_path / "state"
    result = run_once(registry, ledger, state, client=CompleteGoogle())
    assert result["status"] == "VERIFIED", result
    publication = result["publication"]
    assert publication["operational_available"] is True
    release = publication["release_id"]
    main = read_publication(state, "main", release)
    supplement = read_publication(state, "supplement", release)
    operational = read_publication(state, "operational", release)
    assert all(blob.startswith(b"PK") for blob in (main, supplement, operational))
    saved = state / "published" / "releases" / release
    model = json.loads((saved / "report_model.json").read_text())
    assert set(model["document_plans"]) == {"main", "management", "operational"}
    assert model["contract"]["operational_document_contract"] == "operational-report-v1"
    assert model["snapshot"]["snapshot_id"] == publication["snapshot_id"]
    for name, view in (("main_report.docx", "main"), ("management_report.docx", "management"),
                       ("operational_report.docx", "operational")):
        validate_document_content(saved / name, model["document_plans"][view])
        sidecar = json.loads((saved / (name + ".manifest.json")).read_text())
        assert sidecar["snapshot_id"] == model["snapshot"]["snapshot_id"]
    doc = Document(saved / "operational_report.docx")
    text = "\n".join(x.text for x in doc.paragraphs)
    for phrase in ("ОПЕРАТИВНЫЙ ОТЧЁТ", "Исполнение плана конкурентных", "Единственный поставщик",
                   "Финансовые остатки", "ИЗМЕНЕНИЯ ПО СРАВНЕНИЮ"):
        assert phrase in text
    assert "identity_review_required" not in text.lower()
    assert "[сверка кодов]" not in text.lower()
    assert "Требует уточнения" in text


def test_old_release_document_contract_keeps_exactly_two_files():
    assert _document_artifacts({"contract": {}}) == [
        ("main_report.docx", "main"), ("management_report.docx", "management")]
    modern = _document_artifacts({"contract": {"operational_document_contract": "operational-report-v1"}})
    assert modern[-1] == ("operational_report.docx", "operational")
    # Published old ReportModels are not backfilled or assigned an invented third file.


def test_de_quarter_rollover_keeps_just_closed_period_in_early_october():
    assert _focus_quarter({"snapshot": {"report_date": "02.10.2026"},
                          "headline": {"current_quarter": 4}}) == 3
    assert _focus_quarter({"snapshot": {"report_date": "19.10.2026"},
                          "headline": {"current_quarter": 4}}) == 4
    assert _focus_quarter({"snapshot": {"report_date": "02.01.2027"},
                          "headline": {"current_quarter": 1}}) == 1


def test_source_comments_never_promote_known_engine_annotations_into_executive_text():
    assert not _relevant_comment({"deviation_reason": "[сверка кодов] ЭА343-26",
                                  "grbs_comment": "Плановый срок перенесён из-за погоды."}).startswith("[")
    assert _relevant_comment({"grbs_comment": "По информации заказчика, договор пока не заключён."}
                             ) == "По информации заказчика, договор пока не заключён."

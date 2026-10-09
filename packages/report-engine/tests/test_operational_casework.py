"""No procedure conclusion without a verified plan-code/subject/owner match."""
from procurement_engine.operational_casework import (
    build_case_index,
    describe_linked_procedure,
    procedure_candidate_sentence,
    unlinked_procedure_candidates,
)


def attempt(code, *, subject="ЭАС342-26 Поставка бумаги для офисной техники",
            grbs="УО", stage="Состоялась", result="Состоялась",
            final_price=450260, successor=None, nmc=616800):
    return {"procedure_code": code, "subject": subject, "grbs": grbs,
            "customer": "Школа", "stage": stage, "result": result,
            "final_price": final_price, "nmc": nmc,
            "ancestor_code": None, "successor_code": successor,
            "source_ref": "s::Рабочий реестр процедур!10",
            "results_date": "2026-10-02"}


def row(code="ЭАС342-26", *, subject="Поставка бумаги для офисной техники", grbs="УО"):
    return {"procurement_uid": "PUR-1", "included": True, "planned_year": 2026,
            "grbs": grbs, "subject": subject, "procedure_code": code}


def test_explicit_plan_code_and_compatible_subject_show_a_procedure_not_a_contract():
    data = {"attempts": [attempt("ЭАС342-26")], "shares": []}
    index = build_case_index(data, [row()], year=2026)
    description, warning = describe_linked_procedure(row(), index)
    assert not warning
    assert "процедура" in description.casefold()
    assert "450,26 тыс. руб." in description
    assert "договор заключ" not in description.casefold()
    assert "02.10.2026" in description


def test_old_code_cannot_be_falsely_replaced_by_similar_subject():
    data = {"attempts": [attempt("ЭАС342-26")], "shares": []}
    index = build_case_index(data, [row("ЭАС324-26")], year=2026)
    statement, warning = describe_linked_procedure(row("ЭАС324-26"), index)
    assert not statement
    assert "ЭАС324-26" in warning
    assert "не найдена" in warning


def test_explicit_ancestor_successor_can_describe_both_results():
    before = attempt("ЭАС339-26", subject="Оказание услуг по круглосуточной охране",
                     stage="Переоформлена", result="Отмена по решению заказчика",
                     final_price=None, successor="ЭАС343-26")
    after = attempt("ЭАС343-26", subject="Оказание услуг по круглосуточной охране",
                    stage="Состоялась", final_price=10633410)
    original = row("ЭАС339-26", subject="Оказание услуг по круглосуточной охране")
    index = build_case_index({"attempts": [before, after], "shares": []},
                             [original], year=2026)
    summary, uncertainty = describe_linked_procedure(original, index)
    assert not uncertainty
    assert "ЭАС343-26" in summary
    assert "10 633,41" in summary


def test_wrong_grbs_or_subject_leads_to_visible_human_check_not_an_asserted_outcome():
    mismatched = attempt("ЭАС342-26", subject="Поставка ковров для спортзала")
    index = build_case_index({"attempts": [mismatched], "shares": []},
                             [row()], year=2026)
    summary, uncertainty = describe_linked_procedure(row(), index)
    assert not summary
    assert "не совпадает" in uncertainty
    wrong = attempt("ЭАС342-26", grbs="УАГЗО")
    index = build_case_index({"attempts": [wrong], "shares": []},
                             [row()], year=2026)
    summary, uncertainty = describe_linked_procedure(row(), index)
    assert not summary
    assert "принадлежность" in uncertainty


def test_unlinked_procedure_is_a_case_for_review_not_a_new_plan_position():
    waiting = attempt("ЭА349-26", subject="Ремонт дорог", grbs="УДТХ",
                      stage="Объявлена", result="", final_price=None, nmc=1418520)
    index = build_case_index({"attempts": [waiting], "shares": []},
                             [row()], year=2026)
    cases, omitted = unlinked_procedure_candidates(index, year=2026, limit=5)
    assert omitted == 0 and cases[0]["procedure_code"] == "ЭА349-26"
    sentence = procedure_candidate_sentence(cases[0])
    assert "Точная связь" in sentence
    assert "1 418,52" in sentence
    assert "внеплановая" not in sentence.casefold()


def test_ambiguous_code_cannot_become_confirmed():
    data = {"attempts": [attempt("ЭАС342-26"), attempt("ЭАС342-26")],
            "shares": []}
    index = build_case_index(data, [row()], year=2026)
    summary, uncertainty = describe_linked_procedure(row(), index)
    assert not summary
    assert "не найдена" in uncertainty

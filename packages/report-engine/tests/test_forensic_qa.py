import tempfile
import unittest
from pathlib import Path

from procurement_engine.adapters import normalize_master_values
from procurement_engine.qa import (
    assess_procedure_binding,
    classify_2027_context,
    compare_declared_to_derived,
    derive_master_model,
    freshness_gate,
    validate_master_values,
)
from procurement_engine.snapshot import freeze_manifest


def rawrow(pid="1", subject="test", method="ЕП", plan_date="25.09.2026", q=3, year=2026,
           plan=(0,0,100), fact_date="X", fact=(0,0,0)):
    r=[None]*34
    r[0]=pid; r[1]="УО"; r[2]="Учреждение"; r[5]="Текущая деятельность"; r[6]=subject
    r[7],r[8],r[9]=plan; r[10]=sum(plan); r[11]=method
    r[13]=plan_date; r[14]=q; r[15]=year; r[16]=fact_date
    r[21],r[22],r[23]=fact; r[24]=sum(fact)
    r[25]=r[26]=r[27]=r[28]=0
    return r


class ForensicQATests(unittest.TestCase):
    def test_duplicate_business_id_is_detected(self):
        issues=validate_master_values([rawrow("174"),rawrow("174",subject="other")],grbs="УО",source_id="uo",sheet_name="ВСЕ")
        self.assertIn("DUPLICATE_BUSINESS_ID",[x.code for x in issues])

    def test_monetary_fact_without_completion_date_is_not_treated_as_clean_completion(self):
        issues=validate_master_values([rawrow("15",fact_date="X",fact=(0,0,5.215))],grbs="УО",source_id="uo",sheet_name="ВСЕ")
        self.assertIn("MONETARY_FACT_WITHOUT_COMPLETION_DATE",[x.code for x in issues])

    def test_real_procedure_binding_patterns(self):
        # UД 173/18 -> ЭА333-26: exact explicit evidence.
        good=assess_procedure_binding(explicit_code_link=True,same_grbs=True,same_institution=True,
                                      subject_similarity=1.0,amount_relative_diff=0.0)
        self.assertTrue(good["reliable"])
        # УЭР A=56 -> ЭА280-26 actually belongs to another GRBS.
        cross=assess_procedure_binding(explicit_code_link=True,same_grbs=False,same_institution=False,
                                       subject_similarity=0.05,amount_relative_diff=24.0)
        self.assertEqual(cross["decision"],"REJECT_CROSS_GRBS")
        # УДТХ current 5.881m row still carries old ЭА12-26 while new ЭА350-26 is active.
        stale=assess_procedure_binding(explicit_code_link=True,same_grbs=True,same_institution=True,
                                       subject_similarity=0.474,amount_relative_diff=0.6664,active_newer_attempt=True)
        self.assertEqual(stale["decision"],"REJECT_STALE_CODE")
        # УАГЗО A=69 / ЭА341-26 has no explicit code and the subject conflicts: review/reject, never auto fact.
        conflict=assess_procedure_binding(explicit_code_link=False,same_grbs=True,same_institution=True,
                                          subject_similarity=0.05,amount_relative_diff=0.0,unique_candidate=True)
        self.assertFalse(conflict["reliable"])
        # УО A=2853 / ЭЕП337-26: unique institution + near exact NMC + strong item match.
        eep=assess_procedure_binding(explicit_code_link=False,same_grbs=True,same_institution=True,
                                     subject_similarity=0.70,amount_relative_diff=2/178995,unique_candidate=True)
        self.assertEqual(eep["decision"],"REVIEW_STRONG_INFERRED")
        self.assertFalse(eep["reliable"])

    def test_2027_is_multidimensional_not_substring_rule(self):
        target=rawrow("2122",subject="Капитальный ремонт",method="ЭА",plan_date="X",q=None,year=None,plan=(0,0,5200))
        target[30]="Денег катастрофически нет. поставили в план на 2027 год"
        self.assertEqual(classify_2027_context(target),"TARGET_PLAN_2027_UNSTRUCTURED")
        need=rawrow("174",subject="поставка воды питьевой упакованной (на 2027 год)",method="ЭА",plan_date="15.10.2026",q=4,year=2026,plan=(0,0,392.985))
        self.assertEqual(classify_2027_context(need),"PROCUREMENT_2026_FOR_2027_NEED")
        deadline=rawrow("69",subject="утилизация картриджей",method="ЭА",plan_date="20.08.2026",q=3,year=2026,plan=(0,0,26))
        deadline[30]="максимально все утилизировать до 01.01.2027"
        self.assertEqual(classify_2027_context(deadline),"DEADLINE_OR_REQUIREMENT_2027")
        funding=rawrow("2460",subject="капремонт",method="ЭА",plan_date="31.07.2026",q=3,year=2026,plan=(0,0,100))
        funding[31]="6643 тыс. руб. это ассигнования на плановый 2027 год"
        self.assertEqual(classify_2027_context(funding),"MULTIYEAR_FUNDING_2027")

    def test_source_changed_during_freeze_blocks_release(self):
        issues=freshness_gate({"UO":"t1","UD":"t1"},{"UO":"t2","UD":"t1"})
        self.assertEqual([x.code for x in issues],["SOURCE_CHANGED_DURING_FREEZE"])

    def test_snapshot_id_is_deterministic_for_same_evidence(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"a.txt";p.write_text("same",encoding="utf8")
            kw={"report_date": "29.09.2026","report_year": 2026,
                    "source_files": [{"source_id":"S","role":"MASTER","provider_id":"x","revision_or_modified_at":"r1","path":str(p)}],
                    "rules_version": "2","renderer_version": "2","mode": "CANONICAL"}
            a=freeze_manifest(**kw,cutoff_at="2026-09-29T01:00:00Z")
            b=freeze_manifest(**kw,cutoff_at="2026-09-29T02:00:00Z")
            self.assertEqual(a["snapshot_id"],b["snapshot_id"])
            self.assertNotEqual(a["captured_at"],b["captured_at"])

    def test_model_mutation_is_detected_against_normalized_rows(self):
        vals=[rawrow("1",method="ЕП",plan=(0,0,100),fact_date="25.09.2026",fact=(0,0,90))]
        rows=normalize_master_values(vals,snapshot_id="S",expected_grbs="УО",data_start_row=0)
        derived=derive_master_model(rows,report_year=2026)
        declared={"УО":{"comp":{"year":{},"q1":{},"q2":{},"q3":{},"q4":{}},"ep":{}}}
        for scope in ("year","q1","q2","q3","q4"):
            e=derived["УО"]["ep"][scope]
            declared["УО"]["ep"][scope]={"plan_count":e["plan_count"],"fact_count":e["fact_count"],
                                              "plan_amount":e["plan_amount"],"fact_amount":e["fact_amount"]}
        declared["УО"]["ep"]["year"]["plan_amount"] += 1000
        issues=compare_declared_to_derived(declared,derived)
        self.assertIn("MODEL_AMOUNT_DERIVATION_MISMATCH",[x.code for x in issues])

if __name__ == '__main__':
    unittest.main()

class UniversalizationRegressionTests(unittest.TestCase):
    def test_unknown_method_fails_closed(self):
        vals=[rawrow("9001", method="НЕИЗВЕСТНЫЙ СПОСОБ", plan_date="25.09.2028", q=3, year=2028)]
        issues=validate_master_values(vals, grbs="TEST", source_id="S", sheet_name="T", first_sheet_row=4)
        self.assertIn("METHOD_UNKNOWN_FOR_PLANNED_ROW", {x.code for x in issues})

    def test_future_classifier_is_parameterized(self):
        from procurement_engine.qa import classify_future_context
        r=rawrow("9002", method="ЭА", plan_date="X", q=None, year=None, plan=(0,0,10))
        r[31]="поставили в план на 2028 год"
        self.assertEqual(classify_future_context(r, target_year=2028), "TARGET_PLAN_2028_UNSTRUCTURED")


def test_unexpected_numeric_parser_failure_is_not_reported_as_zero(monkeypatch):
    import pytest
    from procurement_engine import qa

    def broken_parser(value):
        raise RuntimeError('unexpected parser failure')

    monkeypatch.setattr(qa, 'to_decimal', broken_parser)
    with pytest.raises(RuntimeError, match='unexpected parser failure'):
        qa._num('10')

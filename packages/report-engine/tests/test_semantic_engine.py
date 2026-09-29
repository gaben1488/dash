import unittest

from procurement_engine.recommendations import evaluate_recommendation


class SemanticEngineTests(unittest.TestCase):
    def base(self, **kw):
        d = {"active_in_current_slice": True, "recommendation_type": "CHANGE_METHOD_EA",
                 "current_procurement_state": "IN_PLAN_NO_FACT", "current_method": "ЕП",
                 "current_procurement_ids": ["1"], "procedure_binding_reliable": {"reliable_codes":[]},
                 "recommendation_text": "", "grbs_response_original": "", "uer_decision_original": "", "status_evidence": ""}
        d.update(kw); return d

    def test_target_ea_implemented(self):
        self.assertEqual(evaluate_recommendation(self.base(current_method="ЭА")).status, "IMPLEMENTED")

    def test_completed_needs_reliable_binding(self):
        r=self.base(current_method="ЭА", current_procurement_state="PROCEDURE_COMPLETED",
                    procedure_binding_reliable={"reliable_codes":["ЭА1-26"]})
        self.assertEqual(evaluate_recommendation(r).status, "IMPLEMENTED_AND_COMPLETED")

    def test_ep_fact_is_contracted_ep(self):
        r=self.base(current_procurement_state="FACT_RECORDED")
        self.assertEqual(evaluate_recommendation(r).status, "CONTRACTED_EP")

    def test_absent_without_replacement_removed(self):
        r=self.base(current_procurement_state="ABSENT_FROM_CURRENT_PLAN", current_method=None, current_procurement_ids=[])
        self.assertEqual(evaluate_recommendation(r).status, "REMOVED_FROM_PLAN")

    def test_2027_precedence(self):
        r=self.base(current_procurement_state="POSTPONED", status_evidence="перенесено на 2027 год")
        self.assertEqual(evaluate_recommendation(r).status, "MOVED_TO_2027")

if __name__ == '__main__': unittest.main()

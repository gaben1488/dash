import unittest

from procurement_engine.input_contract import (
    MANDATORY_CORE_SOURCES,
    validate_input_contract,
)
from procurement_engine.release_gates import validate_release_v2


class InputContractTests(unittest.TestCase):
    def test_complete_core_contract_passes(self):
        issues=validate_input_contract(
            available_sources=MANDATORY_CORE_SOURCES,
            available_capabilities=['SOURCE_REVISION_METADATA','STRUCTURED_FUTURE_PLAN_PERIOD','CURRENT_RECOMMENDATION_EVENTS','CONTRACT_REGISTER'],
            requested_claims=['atomic_live_release','monthly_2027','current_recommendation_semantics','contract_count'],
            unresolved_critical_items=[],
        )
        self.assertEqual(issues,[])

    def test_missing_contract_source_blocks_contract_count_claim(self):
        issues=validate_input_contract(
            available_sources=MANDATORY_CORE_SOURCES,
            available_capabilities=['SOURCE_REVISION_METADATA'],
            requested_claims=['contract_count'],
        )
        self.assertIn('INPUT_CAPABILITY_MISSING',[x.code for x in issues])

    def test_unresolved_source_conflict_blocks_release(self):
        issues=validate_input_contract(
            available_sources=MANDATORY_CORE_SOURCES,
            unresolved_critical_items=['UAGZO::ВСЕ::70::69 subject/procedure conflict'],
        )
        self.assertIn('CRITICAL_INPUT_UNRESOLVED',[x.code for x in issues])

    def test_missing_master_blocks_release(self):
        src=[x for x in MANDATORY_CORE_SOURCES if x!='UO']
        issues=validate_input_contract(available_sources=src)
        self.assertIn('INPUT_SOURCE_MISSING',[x.code for x in issues])


    def test_release_gate_composes_input_contract(self):
        contract_issues=validate_input_contract(available_sources=[x for x in MANDATORY_CORE_SOURCES if x!='PROCEDURES'])
        issues=validate_release_v2(
            source_before={'UO':'r1'}, source_after={'UO':'r1'}, raw_issues=[], binding_uses=[],
            recommendation_replay_proven=True, report_model={'report_date':'29.09.2026'},
            input_contract_issues=contract_issues,
        )
        self.assertIn('INPUT_SOURCE_MISSING',[x.code for x in issues])

if __name__=='__main__': unittest.main()

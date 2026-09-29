import unittest

from procurement_engine.adapters import normalize_master_values
from procurement_engine.fact_model import derive_fact_metrics, is_procurement_row


def base_row():
    r=[None]*34
    r[1]='УЭР'; r[2]='Учреждение'; r[5]='Текущая деятельность'; r[6]='Предмет'
    r[7:10]=[0,0,60]; r[10]=60; r[11]='ЕП'; r[13]='16.09.2026'; r[14]=3; r[15]=2026
    r[16]='X'; r[21:24]=[0,0,0]; r[24]=0
    return r

class CanonicalRowExistenceTests(unittest.TestCase):
    def test_blank_A_valid_procurement_is_not_dropped(self):
        r=base_row(); r[0]=None
        rows=normalize_master_values([r], snapshot_id='S', expected_grbs='УЭР', data_start_row=0, source_id='UER', sheet_name='ВСЕ', first_sheet_row=80)
        self.assertEqual(len(rows),1)
        self.assertIsNone(rows[0].source_row_no)
        self.assertTrue(rows[0].procurement_id.startswith('__ROW__::UER::ВСЕ::80'))
        self.assertTrue(is_procurement_row(rows[0], report_year=2026))
        m=derive_fact_metrics(rows, report_year=2026, method='ЕП')
        self.assertEqual(m.plan_count,1)
        self.assertAlmostEqual(m.plan_amount,60.0)

    def test_blank_B_uses_authoritative_source_context(self):
        r=base_row(); r[0]='2234'; r[1]=None; r[2]='МБОУ школа'; r[6]='Поставка ПО'; r[10]=2.5; r[7:10]=[0,0,2.5]; r[13]='08.04.2026'; r[14]=2
        rows=normalize_master_values([r], snapshot_id='S', expected_grbs='УО', data_start_row=0, source_id='UO', sheet_name='ВСЕ', first_sheet_row=1929)
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0].grbs,'УО')
        self.assertEqual(rows[0].procurement_id,'2234')
        self.assertTrue(is_procurement_row(rows[0], report_year=2026))

    def test_A_and_B_are_not_projection_predicates(self):
        r=base_row(); r[0]=None; r[1]=None
        rows=normalize_master_values([r], snapshot_id='S', expected_grbs='УЭР', data_start_row=0, source_id='UER', sheet_name='ВСЕ', first_sheet_row=80)
        self.assertEqual(derive_fact_metrics(rows, report_year=2026, method='ЕП').plan_count,1)

    def test_F_L_N_P_define_projection_eligibility(self):
        r=base_row(); r[0]='1'
        rows=normalize_master_values([r], snapshot_id='S', expected_grbs='УЭР', data_start_row=0)
        self.assertTrue(is_procurement_row(rows[0], report_year=2026))
        for idx in (5,11,13,15):
            bad=base_row(); bad[0]='1'; bad[idx]=None
            rr=normalize_master_values([bad], snapshot_id='S', expected_grbs='УЭР', data_start_row=0)
            # Unknown/empty L still normalizes as procurement-shaped due other content, but projection excludes it.
            self.assertEqual(len(rr),1)
            self.assertFalse(is_procurement_row(rr[0], report_year=2026))

if __name__=='__main__':
    unittest.main()

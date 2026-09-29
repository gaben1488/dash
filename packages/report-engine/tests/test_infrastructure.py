import unittest

from procurement_engine.adapters import normalize_master_values
from procurement_engine.diff import diff_rows
from procurement_engine.identity import IdentityGraph
from procurement_engine.models import IdentityEdge
from procurement_engine.normalize import parse_date
from procurement_engine.source_contract import (
    schema_fingerprint,
    validate_schema_fingerprint,
)


class InfrastructureTests(unittest.TestCase):
    def test_diff(self):
        prev=[{"procurement_id":"1","method":"ЕП","actual_date":None}]
        cur=[{"procurement_id":"1","method":"ЭА","actual_date":"2026-09-25"},{"procurement_id":"2","method":"ЕП"}]
        types=[e.event_type for e in diff_rows(prev,cur)]
        self.assertEqual(types, ["ROW_ADDED","METHOD_CHANGED","FACT_ADDED"])

    def test_diff_uses_physical_row_key_for_duplicate_business_ids(self):
        prev=[
            {"physical_row_key":"S::ВСЕ::10::174","procurement_id":"174","method":"ЕП"},
            {"physical_row_key":"S::ВСЕ::20::174","procurement_id":"174","method":"ЭА"},
        ]
        cur=[
            {"physical_row_key":"S::ВСЕ::10::174","procurement_id":"174","method":"ЭА"},
            {"physical_row_key":"S::ВСЕ::20::174","procurement_id":"174","method":"ЭА"},
        ]
        events=diff_rows(prev,cur)
        self.assertEqual([(e.event_type,e.procurement_id) for e in events],[("METHOD_CHANGED","174")])

    def test_diff_fails_closed_on_duplicate_business_id_without_physical_key(self):
        rows=[{"procurement_id":"174","method":"ЕП"},{"procurement_id":"174","method":"ЭА"}]
        with self.assertRaisesRegex(ValueError,"DUPLICATE_DIFF_KEY"):
            diff_rows(rows,rows)

    def test_identity_terminal_replacement(self):
        g=IdentityGraph()
        g.add(IdentityEdge("1205","2277","MERGES_INTO","explicit historical/current replacement"))
        g.add(IdentityEdge("1309","2277","MERGES_INTO","explicit historical/current replacement"))
        self.assertEqual(g.terminal_replacements(["1205","1309"]),["2277"])
        self.assertEqual(g.validate(),[])

    def test_schema_fingerprint_fail_closed(self):
        fp=schema_fingerprint([["A","B","Предмет"],["", "", ""]])
        validate_schema_fingerprint(fp,[fp])
        with self.assertRaisesRegex(ValueError,"SOURCE_SCHEMA_CHANGED"):
            validate_schema_fingerprint("deadbeef",[fp])

    def test_numeric_spreadsheet_date_serial(self):
        # 46290 == 2026-09-25 in Google Sheets/Excel serial-date convention.
        self.assertEqual(parse_date(46290), "2026-09-25")

    def test_values_adapter(self):
        row=[None]*34
        row[0]="74.0"; row[1]="УЭР"; row[6]="Тестовая закупка"; row[11]="ЕП"; row[13]="25.09.2026"
        row[7]=10; row[8]=2; row[9]=3; row[10]=15; row[29]="Да"; row[32]="ЭА1-26"
        rows=normalize_master_values([["header"]*34,row],snapshot_id="S",expected_grbs="УЭР")
        self.assertEqual(len(rows),1); self.assertEqual(rows[0].procurement_id,"74")
        self.assertAlmostEqual(rows[0].plan_total,15); self.assertEqual(rows[0].planned_date,"2026-09-25")

if __name__ == '__main__': unittest.main()

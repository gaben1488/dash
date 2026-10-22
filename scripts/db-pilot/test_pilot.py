"""C08.14 isolated benchmark safety and repeatability tests."""
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from compare import Pilot, percentile, new_payload, run_one
from decision import compare


class PilotTests(unittest.TestCase):
    def args(self):
        return argparse.Namespace(snapshots=3,issues=31,queue=20,payload_kib=2,requests=6,readers=2,reads_per_reader=3,writes=4)

    def test_known_percentile(self):
        self.assertEqual(percentile([9,1,3,7,5],.95),9)
        self.assertEqual(percentile([9,1,3,7,5],.5),5)
        with self.assertRaises(ValueError):
            percentile([],.5)

    def test_deterministic_json(self):
        self.assertEqual(new_payload(0,1),new_payload(0,1))
        self.assertNotEqual(new_payload(0,1),new_payload(1,1))
        self.assertTrue(json.loads(new_payload(0,1))["raw"])

    def test_full_sqlite_workload_and_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            result=run_one("sqlite",self.args(),Path(tmp))
        self.assertTrue(result["restored"]["full_content_sha256_matches"])
        self.assertEqual(result["concurrency"]["errors"],0)
        self.assertEqual(result["workload"]["issue_page"]["count"],6)
        self.assertEqual(len(result["data_contract_sha256"]),64)

    def test_pg_hard_safety_gate_before_connection(self):
        with patch.dict(os.environ,{"PGDATABASE":"production"}):
            with tempfile.TemporaryDirectory() as tmp:
                with self.assertRaisesRegex(RuntimeError,"dedicated"):
                    run_one("postgres",self.args(),Path(tmp))

    def test_comparison_rejects_unverified_restore_or_drift(self):
        doc={"pilot":"C08.14","sample":"synthetic-not-live","seed":"sha256-shake256-v1","parameters":{"snapshots":3},"result":{"engine":"sqlite","restored":{"full_content_sha256_matches":True},"concurrency":{"errors":0},"data_contract_sha256":"123", "workload":{k:{"p95_ms":1.0} for k in ("latest_head","issue_page","payload_detail","queue_poll")},"storage_bytes":1,"peak_process_rss_kib":1}}
        doc["result"]["concurrency"].update({"p95_read_ms":1.0,"wall_ms":2.0})
        doc["result"]["restored"]["backup_bytes"]=10
        pg=json.loads(json.dumps(doc));pg["result"]["engine"]="postgres"
        self.assertFalse(compare(doc,pg)["migration_approved"])
        pg["parameters"]["snapshots"]=4
        with self.assertRaisesRegex(ValueError,"non-comparable"):
            compare(doc,pg)
        pg["parameters"]["snapshots"]=3
        pg["result"]["restored"]["full_content_sha256_matches"]=False
        with self.assertRaisesRegex(ValueError,"restore"):
            compare(doc,pg)


if __name__=="__main__":
    unittest.main()

"""Use the actual engine helper; private catalog data never reaches the result."""
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from procurement_engine.retention import _catalog_revision


class RevisionProbeTests(unittest.TestCase):
    def setUp(self):
        path=Path(__file__).with_name('publication_revision_probe.py')
        spec=importlib.util.spec_from_file_location('revision_probe',path)
        self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.database=Path(self.temp.name)/'catalog.sqlite'
        self.rows=[('REL-'+str(i)*64,'2026-10-16',f'2026-10-16T0{i}:00:00Z',json.dumps({'text':'private смета🌅'}),'{}') for i in (2,1)]
        with sqlite3.connect(self.database) as db:
            db.execute('CREATE TABLE publications(release_id TEXT PRIMARY KEY,report_date TEXT,cutoff_at TEXT,receipt TEXT,files TEXT)')
            db.executemany('INSERT INTO publications VALUES (?,?,?,?,?)',self.rows)
        keep=[self.rows[0][0]];targets=[self.rows[1][0]]
        digest=hashlib.sha256(json.dumps([self.rows,keep,targets],separators=(',',':')).encode()).hexdigest()
        self.reference={'keep_release_ids':keep,'retire_release_ids':targets,'catalog_revision':digest}

    def test_exact_old_subset_is_verified_without_writing_or_disclosing_receipts(self):
        with sqlite3.connect(self.database) as db:
            db.execute('INSERT INTO publications VALUES (?,?,?,?,?)',('REL-'+'3'*64,'2026-10-16','2026-10-16T03:00:00Z','new observation','{}'))
        before=self.database.read_bytes()
        result=self.module.revision_summary(self.database,self.reference,_catalog_revision)
        self.assertEqual(result['frozen_catalog_rows'],2)
        self.assertTrue(result['reference_digest_matches'])
        self.assertEqual(self.database.read_bytes(),before)
        self.assertNotIn('private',json.dumps(result))
        self.assertNotIn('REL-',json.dumps(result))

    def test_missing_changed_or_ambiguous_reference_is_rejected(self):
        for scenario in ('missing','changed','overlap'):
            reference=json.loads(json.dumps(self.reference))
            if scenario=='missing':reference['retire_release_ids']=['REL-'+'9'*64]
            if scenario=='changed':reference['catalog_revision']='f'*64
            if scenario=='overlap':reference['retire_release_ids']=reference['keep_release_ids']
            with self.subTest(scenario=scenario),self.assertRaises(ValueError):
                self.module.revision_summary(self.database,reference,_catalog_revision)


if __name__=='__main__':unittest.main()

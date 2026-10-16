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

    def test_identity_gaps_remain_bound_to_exact_retirement_targets(self):
        state=Path(self.temp.name);published=state/'published';published.mkdir()
        with sqlite3.connect(published/'publications.sqlite') as db:
            db.execute('CREATE TABLE publications(release_id TEXT PRIMARY KEY,receipt TEXT)')
            db.executemany('INSERT INTO publications VALUES (?,?)',
                           [(self.rows[0][0],json.dumps({'snapshot_id':'kept'})),
                            (self.rows[1][0],json.dumps({'snapshot_id':'target'}))])
        with sqlite3.connect(state/'identity.sqlite') as db:
            db.execute('CREATE TABLE observations(snapshot_id TEXT,plan_signature TEXT,entity_signature TEXT)')
            db.executemany('INSERT INTO observations VALUES (?,?,?)',[('kept',None,None),('target',None,'known')])
        before=(state/'identity.sqlite').read_bytes()
        summary,private=self.module.identity_gap_summary(state,self.reference)
        self.assertEqual(summary,{'target_snapshots':1,'affected_snapshots':1,'missing_plan':1,
                                  'missing_entity':0,'missing_snapshots':0,'atomic':False})
        self.assertEqual(private[0]['snapshot_id'],'target')
        self.assertEqual(private[0]['release_ids'],self.reference['retire_release_ids'])
        self.assertEqual((state/'identity.sqlite').read_bytes(),before)

    def test_backup_coverage_uses_exact_catalog_file_hashes_and_counts(self):
        rid=self.reference['retire_release_ids'][0]
        files={'dashboard.json':'a'*64,'identity.sqlite':'b'*64}
        with sqlite3.connect(self.database) as db:db.execute('UPDATE publications SET files=? WHERE release_id=?',(json.dumps(files),rid))
        manifest={'files':{f'reports/published/releases/{rid}/{name}':{'kind':'file','sha256':sha} for name,sha in files.items()}}
        exact=self.module.backup_coverage_summary(self.database,self.reference,manifest)
        self.assertEqual(exact,{'target_roots':1,'covered_roots':1,'missing_roots':0,'mismatched_roots':0,'catalog_hashes_only':True})
        changed=json.loads(json.dumps(manifest));changed['files'][f'reports/published/releases/{rid}/identity.sqlite']['sha256']='c'*64
        self.assertEqual(self.module.backup_coverage_summary(self.database,self.reference,changed)['mismatched_roots'],1)
        self.assertEqual(self.module.backup_coverage_summary(self.database,self.reference,{'files':{}})['missing_roots'],1)


if __name__=='__main__':unittest.main()

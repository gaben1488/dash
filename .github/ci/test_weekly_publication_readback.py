"""Independent read-only proof before the first reviewed publication finalization."""
import hashlib
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


class ReadbackTests(unittest.TestCase):
    def tool(self):
        path=Path(__file__).with_name('weekly_publication_readback.py')
        self.assertTrue(path.is_file(),'Missing native read-only retained-state verifier')
        spec=importlib.util.spec_from_file_location('readback',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module

    def fixture(self,root):
        published=root/'published';releases=published/'releases';releases.mkdir(parents=True)
        work=published/'.retirement';work.mkdir();(root/'publication-readers.lock').touch()
        original=[];keep=[];retire=[];entries=[]
        for n,day in ((2,'2026-10-16'),(1,'2026-10-15')):
            rid='REL-'+f'{n:064x}';folder=releases/rid;folder.mkdir()
            receipt=json.dumps({'release_id':rid,'report_date':day,'snapshot_id':'SNAP-'+str(n)})
            blobs={name:(b'{}' if name.endswith('json') else b'PK\x03\x04synthetic')
                   for name in ('dashboard.json','main_report.docx','management_report.docx')}
            manifest=json.dumps({'sources':[{'source_id':'ledger','role':'historical_ledger'}],
                                  'payload_index':[{'source_id':'ledger','path':'payloads/ledger.json'}]}).encode()
            source={'snapshot_bundle/manifest.json':manifest,'snapshot_bundle/payloads/ledger.json':b'{"proof":true}',
                    'report_model.json':b'{"snapshot":{"report_year":2026},"headline":{"current_quarter":4}}'}
            files={name:hashlib.sha256(body).hexdigest() for name,body in {**blobs,**source}.items()}
            raw_files=json.dumps(files);row=(rid,day,day+'T00:00:00Z',receipt,raw_files);original.append(row)
            if n==2:
                keep.append(rid);current={**blobs,**source}
            else:
                retire.append(rid)
                compact=json.dumps({**json.loads(receipt),'replay_available':False,'report_year':2026,'quarter':4})
                current={**blobs,'retained_evidence/source_manifest.json':manifest,
                         'retained_evidence/payloads/ledger.json':source['snapshot_bundle/payloads/ledger.json']}
                compact_files=json.dumps({name:hashlib.sha256(body).hexdigest() for name,body in current.items()})
                entries.append({'release_id':rid,'original':[receipt,raw_files],'compact':[compact,compact_files]})
                for name,body in source.items():
                    path=work/'original'/rid/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(body)
            for name,body in current.items():
                path=folder/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(body)
        with sqlite3.connect(published/'publications.sqlite') as db:
            db.execute('CREATE TABLE publications(release_id TEXT PRIMARY KEY,report_date TEXT,cutoff_at TEXT,receipt TEXT,files TEXT)')
            for row in original:
                changed=(*row[:3],*entries[0]['compact']) if row[0] in retire else row
                db.execute('INSERT INTO publications VALUES(?,?,?,?,?)',changed)
        plan={'catalog_revision':hashlib.sha256(json.dumps([original,sorted(keep),sorted(retire)],separators=(',',':')).encode()).hexdigest(),'publication_count':2,
              'keep_release_ids':keep,'retire_release_ids':retire}
        with sqlite3.connect(work/'entries.sqlite') as db:
            db.execute('CREATE TABLE entries(ordinal INTEGER PRIMARY KEY,release_id TEXT UNIQUE,payload TEXT)')
            db.execute('INSERT INTO entries VALUES(?,?,?)',(0,retire[0],json.dumps(entries[0])))
        marker={'contract':'publication-compaction-v2','readers_ready':True,'entry_count':1,
                'plan_revision':plan['catalog_revision'],'entries_sha256':hashlib.sha256((work/'entries.sqlite').read_bytes()).hexdigest()}
        (work/'journal.json').write_text(json.dumps(marker))
        return plan,work,releases

    def test_consistently_changed_compact_files_and_receipt_do_not_hide_loss(self):
        tool=self.tool()
        for defect in ('missing_word','replaced_word','missing_ledger','receipt','period'):
            with self.subTest(defect=defect),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);plan,work,releases=self.fixture(root);rid=plan['retire_release_ids'][0]
                with sqlite3.connect(work/'entries.sqlite') as journal,sqlite3.connect(root/'published/publications.sqlite') as db:
                    item=json.loads(journal.execute('SELECT payload FROM entries').fetchone()[0])
                    files=json.loads(item['compact'][1]);receipt=json.loads(item['compact'][0])
                    if defect in {'missing_word','missing_ledger'}:
                        name='management_report.docx' if defect=='missing_word' else 'retained_evidence/payloads/ledger.json'
                        (releases/rid/name).unlink();files.pop(name)
                    if defect=='replaced_word':
                        body=b'PK\x03\x04wrong report';(releases/rid/'main_report.docx').write_bytes(body)
                        files['main_report.docx']=hashlib.sha256(body).hexdigest()
                    if defect=='receipt':receipt['snapshot_id']='wrong'
                    if defect=='period':receipt['quarter']=3
                    item['compact']=[json.dumps(receipt),json.dumps(files)]
                    db.execute('UPDATE publications SET receipt=?,files=? WHERE release_id=?',(*item['compact'],rid))
                    journal.execute('UPDATE entries SET payload=?',(json.dumps(item),))
                marker=work/'journal.json';value=json.loads(marker.read_text())
                value['entries_sha256']=hashlib.sha256((work/'entries.sqlite').read_bytes()).hexdigest();marker.write_text(json.dumps(value))
                with self.assertRaises((ValueError,RuntimeError)):tool.verify(root,plan)

    def test_native_readback_binds_original_catalog_and_every_retained_artifact_without_writes(self):
        tool=self.tool()
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);plan,_,_=self.fixture(root)
            before={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
            result=tool.verify(root,plan)
            self.assertRegex(result.pop('journal_sha256'),'^[a-f0-9]{64}$')
            self.assertRegex(result.pop('marker_sha256'),'^[a-f0-9]{64}$')
            self.assertEqual(result,{'status':'RETAINED_STATE_VERIFIED','verified_roots':2,'compacted_roots':1,
                                     'protected_roots':1,'word_artifacts':4,'dashboard_artifacts':2,'original_catalog_equivalent':True})
            after={str(p.relative_to(root)):p.read_bytes() for p in root.rglob('*') if p.is_file()}
            self.assertEqual(before,after)

    def test_corrupted_artifact_protected_metadata_and_journal_never_pass(self):
        tool=self.tool()
        for defect in ('artifact','protected_metadata','journal_hash','revision','missing_entry','not_ready'):
            with self.subTest(defect=defect),tempfile.TemporaryDirectory() as temporary:
                root=Path(temporary);plan,work,releases=self.fixture(root)
                if defect=='artifact':(releases/plan['keep_release_ids'][0]/'main_report.docx').write_bytes(b'bad')
                if defect=='protected_metadata':
                    with sqlite3.connect(root/'published/publications.sqlite') as db:
                        db.execute('UPDATE publications SET cutoff_at=? WHERE release_id=?',('different',plan['keep_release_ids'][0]))
                if defect=='journal_hash':(work/'entries.sqlite').write_bytes(b'bad')
                if defect=='revision':plan['catalog_revision']='f'*64
                if defect=='missing_entry':plan['retire_release_ids'].append('REL-'+'f'*64)
                if defect=='not_ready':
                    p=work/'journal.json';value=json.loads(p.read_text());value['readers_ready']=False;p.write_text(json.dumps(value))
                with self.assertRaises((ValueError,RuntimeError)):tool.verify(root,plan)


if __name__=='__main__':unittest.main()

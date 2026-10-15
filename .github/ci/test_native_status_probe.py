"""A thin private diagnostic copies only catalog/latest data, never edits sources."""
import hashlib
import importlib.util
import json
import sqlite3
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


class NativeStatusProbeTests(unittest.TestCase):
    def test_remote_exec_accepts_exact_runner_file_hash_and_rejects_mismatch(self):
        import sys
        workflow = Path(__file__).parents[1]/'workflows/vps-cache-cleanup.yml'
        body = workflow.read_text().split("<<'PYTRUSTEDPROBE'\n",1)[1].split('\n            PYTRUSTEDPROBE',1)[0]
        program = textwrap.dedent(body)
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)/'probe.py';path.write_text("assert PUBLICATION_STORE_OVERRIDE==b'reviewed patch'\nprint('EXACT_SOURCE_PASS')\n")
            patch = Path(temporary)/'store.py';patch.write_bytes(b'reviewed patch')
            digest,patch_digest = hashlib.sha256(path.read_bytes()).hexdigest(),hashlib.sha256(patch.read_bytes()).hexdigest()
            for expected,store_expected,accepted in ((digest,patch_digest,True),('0'*64,patch_digest,False),(digest,'0'*64,False)):
                result = subprocess.run([sys.executable,'-I','-',str(path),expected,str(patch),store_expected],input=program,
                    capture_output=True,text=True,timeout=5,check=False)
                self.assertEqual(result.returncode==0,accepted)
                self.assertEqual(result.stdout.strip(),'EXACT_SOURCE_PASS' if accepted else '')

    def test_redaction_retains_qualified_errors_and_hides_private_details(self):
        path = Path(__file__).with_name('native_status_probe.py')
        spec = importlib.util.spec_from_file_location('native_status_probe',path)
        module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        self.assertTrue(hasattr(module,'public_summary'))
        value = module.public_summary({'failures':[{'code':2,'stderr':
            'PRIVATE_DETAIL\nsqlite3.OperationalError: database or disk is full\njson.decoder.JSONDecodeError: PRIVATE_DETAIL\n'}],
            'timed_out':True})
        self.assertEqual(value['python_errors'],['OperationalError','JSONDecodeError'])
        self.assertTrue(value['sqlite_disk_full']);self.assertTrue(value['timed_out'])
        self.assertNotIn('PRIVATE_DETAIL',json.dumps(value))

    def test_native_execfile_observer_preserves_real_success_and_error(self):
        import ast
        tree = ast.parse(Path(__file__).with_name('native_status_probe.py').read_text())
        program = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign)
                       and any(isinstance(t,ast.Name) and t.id=='PROGRAM' for t in n.targets))
        prefix = program.split('const {createApp}',1)[0]
        result = subprocess.run(['node','--input-type=module','--eval',prefix+r'''
const execute=promisify(cp.execFile);
const good=await execute(process.execPath,['-e','console.log("OK")']);
if(good.stdout.trim()!=="OK")throw Error('changed-success');
try{await execute(process.execPath,['read-publication'],{encoding:'buffer'});}catch(error){
 if(error.code!==1||failures.length!==1||typeof failures[0].stderr!=='string'||!failures[0].stderr)throw Error('changed-error');
 console.log('OBSERVER_PASS');return;
}throw Error('missing-error');})();'''],capture_output=True,text=True,timeout=10,check=False)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(result.stdout.strip(),'OBSERVER_PASS')

    def test_capsule_keeps_source_exact_and_copies_wal_catalog_and_latest(self):
        path = Path(__file__).with_name('native_status_probe.py')
        self.assertTrue(path.is_file(), 'Missing bounded native status diagnostic')
        spec = importlib.util.spec_from_file_location('native_status_probe', path)
        module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary);source = root/'source';published = source/'published'
            release_id = 'REL-'+'a'*64;release = published/'releases'/release_id
            release.mkdir(parents=True);(release/'model.json').write_text('PRIVATE_SOURCE')
            (source/'status.json').write_text('{"status":"RUNNING"}')
            catalog = published/'publications.sqlite'
            with sqlite3.connect(catalog) as db:
                db.execute('PRAGMA journal_mode=WAL')
                db.execute('CREATE TABLE publications(release_id,report_date,cutoff_at,receipt,files)')
                files = {'model.json':hashlib.sha256(b'PRIVATE_SOURCE').hexdigest()}
                db.execute('INSERT INTO publications VALUES(?,?,?,?,?)',
                    (release_id,'2026-10-15','2026-10-15T00:00:00Z',json.dumps({'release_id':release_id}),json.dumps(files)))
                db.commit()
                before = {p.name:p.read_bytes() for p in release.iterdir()}
                capsule = root/'capsule'
                module.build_capsule(source,capsule)
                self.assertEqual({p.name:p.read_bytes() for p in release.iterdir()},before)
                self.assertEqual((capsule/'reports/published/releases'/release_id/'model.json').read_text(),'PRIVATE_SOURCE')
                self.assertEqual((capsule/'reports/status.json').read_bytes(),(source/'status.json').read_bytes())
                with sqlite3.connect(capsule/'reports/published/publications.sqlite') as copied:
                    self.assertEqual(copied.execute('SELECT count(*) FROM publications').fetchone(),(1,))
                (release/'unexpected').symlink_to(root/'outside')
                with self.assertRaisesRegex(ValueError,'UNSAFE'):
                    module.build_capsule(source,root/'rejected')


if __name__ == '__main__':
    unittest.main()

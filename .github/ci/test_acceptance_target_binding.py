"""Keep the existing acceptance tools bound to the same reviewed application."""
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

TARGET = '06cad6a2ee352b265aadb610cb7d7ac47f9122bb'
HISTORICAL_REUSE_TARGET = 'ed3e4589a33a4b5bed3f4cab684ef1d519d0290d'
MANAGED = ('browser-readback', 'observe', 'api-timing', 'worker-observe')


def job(source, name):
    match = re.search(r'^  ' + re.escape(name) + r':\n(.*?)(?=^  [a-z][a-z0-9-]*:|\Z)', source, re.MULTILINE | re.DOTALL)
    assert match, name
    return match.group(1)


class AcceptanceTargetBinding(unittest.TestCase):
    def test_all_managed_jobs_admit_the_reviewed_target(self):
        source = (Path(__file__).resolve().parents[1] / 'workflows' / 'ci.yml').read_text()
        for name in MANAGED:
            with self.subTest(job=name):
                body = job(source, name)
                admitted = re.findall(r"inputs\.release_sha == '([a-f0-9]{40})'", body)
                self.assertTrue(admitted)
                self.assertEqual(set(admitted), {TARGET})
                self.assertNotIn('78d293b217a8afe982583c73bc67aaccdb4d906c', body)

    def test_fresh_release_reuses_exact_candidate_and_preserves_application_checkout_and_gates(self):
        source=(Path(__file__).resolve().parents[1]/'workflows/ci.yml').read_text()
        body=job(source,'fresh-release')
        self.assertEqual(set(re.findall(r"inputs\.release_sha == '([a-f0-9]{40})'",body)),{HISTORICAL_REUSE_TARGET})
        self.assertIn('ref: '+HISTORICAL_REUSE_TARGET,body)
        self.assertIn('Preserve reviewed reuse operator before application checkout',body)
        self.assertIn('--staged-candidates',body)
        self.assertNotIn('worker-38821521319',body)
        self.assertNotRegex(body,r'\bdocker\s+(?:build(?:\s|$)|buildx\s+build)')
        for gate in ('source_ci_gate.py','LIVE_LATEST_REPORT_SCHEMA_PASS','RELEASE_NATIVE_ENVIRONMENT_ADMISSION_PASS',
                     'BACKUP_SPACE_BUDGET_INSUFFICIENT','Freeze writers once','Independent one-clone candidate and previous runtime with actual complete restore'):
            self.assertIn(gate,body)

    def test_native_worker_and_browser_readback_use_the_same_target(self):
        source = (Path(__file__).resolve().parents[1] / 'workflows' / 'ci.yml').read_text()
        self.assertTrue("observer='" + TARGET + "'" in job(source, 'worker-observe'), 'worker observer target differs')
        self.assertTrue("sha='" + TARGET + "'" in job(source, 'browser-readback'), 'browser target differs')
        self.assertTrue('EXPECTED_SOURCE_SHA: ' + TARGET in job(source, 'browser-readback'), 'browser verifier target differs')
        self.assertTrue('PRIMARY_SOURCE_SHA: ' + TARGET in job(source, 'observe'), 'checkpoint planner source differs')
        self.assertTrue("['org.opencontainers.image.revision']=='" + TARGET + "'" in job(source, 'api-timing'), 'timing target differs')

    def test_failed_local_binding_cannot_start_schema_ssh(self):
        source = (Path(__file__).resolve().parents[1] / 'workflows/ci.yml').read_text()
        for name in MANAGED:
            self.assertTrue('id: target-binding' in job(source, name), name)
        schema = job(source, 'worker-observe').split(
            '- name: Check actual historical schemas independently of timer acceptance', 1)[1]
        self.assertIn("if: always() && steps.target-binding.outcome == 'success'", schema)

    def browser_binding(self, reference, defect=None):
        source = (Path(__file__).resolve().parents[1] / 'workflows/ci.yml').read_text()
        body = job(source, 'browser-readback')
        code = textwrap.dedent('          '+body.split("          tools=Path(", 1)[1].split('          executor=', 1)[0])
        code = 'tools=Path('+code.lstrip()
        backups = Path('/home/aemr/.dash-private-backups')
        runtime = Path('/var/lib/aemr/release-runtime')
        state = Path('/var/lib/aemr')
        tools = Path('/usr/local/libexec/aemr')
        digest = lambda value: hashlib.sha256(value).hexdigest()
        module = b'reviewed installed module'
        manifest = b'{"files":{}}'
        plan = {'release_sha': TARGET, 'backup_reference': reference,
                'manifest_sha256': digest(manifest)}
        acceptance = {'release_sha': TARGET}
        canonical = json.dumps(plan, sort_keys=True, separators=(',', ':')).encode()
        marker = {'plan_sha256': digest(canonical), 'acceptance': acceptance}
        window = {'candidate': TARGET, 'module_sha256': {name:digest(module) for name in (
            'release-controller.py', 'release_recovery.py', 'release_trial.py', 'stateful_backup.py', 'source_ci_gate.py')}}
        if defect == 'window': window['candidate'] = '0'*40
        if defect == 'module': window['module_sha256']['release_recovery.py'] = '0'*64
        if defect == 'acceptance': marker['plan_sha256'] = '0'*64
        files = {runtime/'trial-plan.json': json.dumps(plan).encode(),
                 state/'release-accepted.json': json.dumps(marker).encode(),
                 (backups/reference).parent/'release-window.json': json.dumps(window).encode(),
                 backups/reference/'manifest.json': b'changed' if defect == 'manifest' else manifest}
        files.update({tools/name:module for name in window['module_sha256']})
        reads = []
        def owned(path, **kwargs):
            reads.append(path)
            return files[path]
        recovery = SimpleNamespace(RUNTIME_DIR=runtime, STATE_DIR=state, BACKUP_BASE=backups,
            read_owned=owned, validate_plan=lambda value:value, digest=digest,
            ReleaseRecovery=SimpleNamespace(_acceptance=lambda value:acceptance))
        namespace = {'Path': Path, 'owned': owned, 'json': json, 'os': SimpleNamespace(path=SimpleNamespace(lexists=lambda path:False)),
                     're': re, 'hashlib': hashlib, 'sys': sys, 'sha': TARGET}
        with patch.dict(sys.modules, {'release_recovery': recovery}):
            exec(compile(code, '<actual-browser-binding>', 'exec'), namespace)  # noqa: S102
        return reads

    def test_browser_uses_the_accepted_plan_checkpoint(self):
        for reference in ('worker-999999/backup', 'worker-999999/release-'+TARGET+'-123-1'):
            with self.subTest(reference=reference):
                reads = self.browser_binding(reference)
                self.assertIn(Path('/home/aemr/.dash-private-backups')/reference/'manifest.json', reads)

    def test_browser_rejects_foreign_or_modified_evidence(self):
        for defect in ('window', 'module', 'manifest', 'acceptance'):
            with self.subTest(defect=defect), self.assertRaises(AssertionError):
                self.browser_binding('worker-999999/backup', defect)

    def checkpoint_binding(self, *, corrupt=False):
        source = (Path(__file__).resolve().parents[1] / 'workflows/ci.yml').read_text()
        prefix = source.split('            def checkpoint_metadata(storage_only=False):\n',1)[1].split('                result.update(',1)[0]
        code = textwrap.dedent(prefix)
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); backup=root/'worker-999999'/'backup'; runtime=root/'runtime'
            backup.mkdir(parents=True); runtime.mkdir()
            manifest=b'{"files":{}}';(backup/'manifest.json').write_bytes(b'{"files":{"changed":true}}' if corrupt else manifest)
            plan={'release_sha':TARGET,'backup_reference':'worker-999999/backup',
                  'manifest_sha256':hashlib.sha256(manifest).hexdigest()}
            opened=[]
            def open_file(path,flags):
                opened.append(path)
                return os.open(path,flags)
            def fstat(fd):
                info=os.fstat(fd)
                return SimpleNamespace(st_mode=stat.S_IFREG|0o600,st_uid=0,st_nlink=1,st_size=info.st_size)
            guarded=SimpleNamespace(path=os.path,open=open_file,fdopen=os.fdopen,fstat=fstat,O_RDONLY=os.O_RDONLY,O_NOFOLLOW=os.O_NOFOLLOW)
            recovery=SimpleNamespace(BACKUP_BASE=root,RUNTIME_DIR=runtime)
            namespace={'current_release_plan':lambda:(recovery,plan),'os':guarded,
                       'stat':stat,'json':json,'hashlib':hashlib}
            exec(compile(code,'<actual-checkpoint-binding>','exec'),namespace)  # noqa: S102
            self.assertEqual(opened,[backup/'manifest.json'])

    def test_metadata_checkpoint_comes_from_current_plan(self):
        self.checkpoint_binding()
        with self.assertRaises(AssertionError):
            self.checkpoint_binding(corrupt=True)


if __name__ == '__main__':
    unittest.main()

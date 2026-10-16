"""Native-program boundary tests use isolated files and an explicitly stubbed engine."""
import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class AttemptReadbackTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('attempt_proof_readback.py')
        spec = importlib.util.spec_from_file_location('readback', path)
        self.module = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.module)
        self.full = {'attempt_id': 'a'*32, 'status': 'VERIFIED', 'snapshot_id': 'snapshot',
            'reused_publication': True, 'publication': {'status': 'VERIFIED', 'snapshot_id': 'snapshot',
            'model_sha256': 'b'*64, 'release_id': 'REL-'+'b'*64,
            'automation_assurance': {'synthetic_private': 'PRIVATE_SENTINEL', 'unicode': 'ёж'}}}
        self.thin = copy.deepcopy(self.full)
        assurance = self.thin['publication'].pop('automation_assurance')
        self.thin['publication']['automation_assurance_ref'] = {
            'release_id': self.full['publication']['release_id'],
            'content_sha256': self.module.expected_status_hash(assurance)}

    def native(self, retained=None, proof=None, global_status=None, *, bad_id=None, bad_hash=None, symlink=False, oversize=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = root / 'attempts' / ('a'*32) / 'status.json'; path.parent.mkdir(parents=True)
            path.write_text(json.dumps(self.thin if retained is None else retained))
            (root / 'status.json').write_text(json.dumps(self.full if global_status is None else global_status))
            if symlink:
                path.rename(root / 'external'); path.symlink_to(root / 'external')
            if oversize:
                with path.open('r+b') as stream: stream.truncate(32*1024*1024+1)
            returned = self.full if proof is None else proof
            prelude = f'''import json,sys,types
package=types.ModuleType('procurement_engine'); module=types.ModuleType('procurement_engine.publication_store')
class Store:
 def __init__(self,root,*,readonly):
  assert readonly is True
 def read_attempt(self,identity):
  assert identity == {'a'*32!r}
  return json.loads({json.dumps(returned)!r})
module.PublicationStore=Store
sys.modules['procurement_engine']=package
sys.modules['procurement_engine.publication_store']=module
'''
            program = self.module.NATIVE_PROGRAM.replace("Path('/app/packages/server/data/reports')", f'Path({str(root)!r})')
            result = subprocess.run([sys.executable, '-IB', '-c', prelude+program,
                bad_id if bad_id is not None else 'a'*32,
                bad_hash if bad_hash is not None else self.module.expected_status_hash(returned)],
                capture_output=True, timeout=10, check=False)
            self.assertEqual(result.stderr, b'')
            self.assertNotIn(b'PRIVATE_SENTINEL', result.stdout)
            return result.returncode, json.loads(result.stdout)

    def test_reference_proof_matches_and_command_is_fixed(self):
        code, result = self.native()
        self.assertEqual(code, 0)
        self.module.validate_result(result, self.full)
        self.assertEqual(result['coverage'], 'OBSERVED')
        self.assertEqual(self.module.native_command(self.full), ['exec', '--user', '1000:1000',
            'aemr-server-1', '/opt/report-env/bin/python', '-IB', '-c', self.module.NATIVE_PROGRAM,
            'a'*32, self.module.expected_status_hash(self.full)])
        bad = dict(result, retained_bytes=True)
        with self.assertRaises(ValueError): self.module.validate_result(bad, self.full)

    def test_inline_new_build_is_not_observed_without_requiring_global_pointer(self):
        status = copy.deepcopy(self.full); status['reused_publication'] = False
        code, result = self.native(retained=status, proof=status, global_status={'status': 'RUNNING'})
        self.assertEqual(code, 0)
        self.assertEqual(result['coverage'], 'NOT_OBSERVED')
        self.module.validate_result(result, status)

    def test_failed_inline_proof_is_not_zero_or_reuse_observation(self):
        status = {'attempt_id': 'a'*32, 'status': 'NOT_ISSUED', 'error_code': 'ACQUISITION_FAILED'}
        code, result = self.native(retained=status, proof=status, global_status={'status': 'RUNNING'})
        self.assertEqual(code, 0)
        self.assertEqual(result['coverage'], 'NOT_OBSERVED')
        self.assertIsNone(result['global_compatible'])
        self.module.validate_result(result, status)

    def test_hash_uses_strict_canonical_stream(self):
        import hashlib
        expected = hashlib.sha256(json.dumps(self.full, ensure_ascii=False, sort_keys=True,
            separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        self.assertEqual(self.module.expected_status_hash(self.full), expected)
        for value in (float('nan'), float('inf'), object()):
            with self.assertRaises((ValueError, TypeError)):
                self.module.expected_status_hash({'private': value})

    def test_rejects_invalid_identity_hash_symlink_bounds_and_stale_global(self):
        for arguments in ({'bad_id': '../PRIVATE_SENTINEL'}, {'bad_hash': 'private'}, {'bad_hash': '0'*64},
                          {'symlink': True}, {'oversize': True}, {'global_status': {'status': 'RUNNING'}},
                          {'retained': self.full}):
            with self.subTest(arguments=list(arguments)):
                code, result = self.native(**arguments)
                self.assertEqual(code, 1)
                self.assertEqual(result, {'code': 'ATTEMPT_PROOF_READBACK_FAILED'})

    def test_rejects_reference_binding_changes_even_if_store_returns_expected_proof(self):
        for field in ('release_id', 'content_sha256'):
            retained = copy.deepcopy(self.thin)
            retained['publication']['automation_assurance_ref'][field] = 'PRIVATE_SENTINEL'
            code, result = self.native(retained=retained)
            self.assertEqual((code, result), (1, {'code': 'ATTEMPT_PROOF_READBACK_FAILED'}))


if __name__ == '__main__':
    unittest.main()

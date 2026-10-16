"""A normal accepted rollout does not create a worker-repair start receipt."""
import copy
import json
import tempfile
import textwrap
import types
import unittest
from pathlib import Path
from unittest.mock import patch


class ControlledWorkerObservationTests(unittest.TestCase):
    def test_terminal_status_is_reused_but_running_is_actually_read_twice(self):
        workflow = (Path(__file__).parents[1] / 'workflows/ci.yml').read_text().split('  worker-observe:', 1)[1]
        start = workflow.index('                def read_status():')
        code = textwrap.dedent(workflow[start:workflow.index('                samples=[]', start)])
        with tempfile.TemporaryDirectory() as temporary:
            volume = Path(temporary)
            (volume / 'reports').mkdir()
            path = volume / 'reports/status.json'
            scope = {'volume': volume, 'json': json, 'status_cache': {}}
            exec(code, scope)  # noqa: S102 - actual trusted workflow helper
            read_status = scope['read_status']
            original = Path.read_bytes
            with patch.object(Path, 'read_bytes', autospec=True, side_effect=original) as reads:
                path.write_text(json.dumps({'status': 'VERIFIED', 'attempt_id': 'old', 'padding': 'x' * 100000}))
                self.assertEqual(read_status()['attempt_id'], 'old')
                self.assertEqual(read_status()['attempt_id'], 'old')
                self.assertEqual(reads.call_count, 1, 'Unchanged terminal receipt must not be decoded every5s')
                replacement = path.with_suffix('.new')
                replacement.write_text(json.dumps({'status': 'VERIFIED', 'attempt_id': 'new'}))
                replacement.replace(path)
                self.assertEqual(read_status()['attempt_id'], 'new')
                path.write_text(json.dumps({'status': 'RUNNING', 'attempt_id': 'active'}))
                before = reads.call_count
                self.assertEqual(read_status()['attempt_id'], 'active')
                self.assertEqual(read_status()['attempt_id'], 'active')
                self.assertEqual(reads.call_count - before, 2)

    def test_controlled_release_admission_uses_its_acceptance_and_actual_running_worker(self):
        workflow=(Path(__file__).parents[1]/'workflows/ci.yml').read_text().split('  worker-observe:',1)[1]
        start=workflow.index("                worker_id=baseline['report-worker']['Id'];image=plan['candidate_images']['report-worker']")
        code=textwrap.dedent(workflow[start:workflow.index('                since=',start)])
        sha='83b813ab250b4533d1b80ba9e306afaa8bc5f383';image='sha256:'+'b'*64
        scope={'json':json,'baseline':{'report-worker':{'Id':'actual-worker','State':{'Status':'running'}}},
               'plan':{'candidate_images':{'report-worker':image},'original_running':{'report-worker':True}},
               'sha':sha,'sys':types.SimpleNamespace(argv=['observer',sha])}
        def not_a_repair(_path):raise FileNotFoundError('No worker-repair receipt for a normal rollout')
        scope['r']=types.SimpleNamespace(STATE_DIR=Path('/private'),read_owned=not_a_repair)
        exec(code,dict(scope))  # noqa: S102 - trusted local admission block
        for defect in ('source','disabled','stopped'):
            changed={**scope,'plan':copy.deepcopy(scope['plan']),'baseline':copy.deepcopy(scope['baseline'])}
            if defect=='source':changed['sha']='c'*40
            if defect=='disabled':changed['plan']['original_running']['report-worker']=False
            if defect=='stopped':changed['baseline']['report-worker']['State']['Status']='exited'
            with self.subTest(defect=defect),self.assertRaises(AssertionError):
                exec(code,changed)  # noqa: S102 - trusted local admission block


if __name__=='__main__':unittest.main()

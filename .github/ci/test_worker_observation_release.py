"""A normal accepted rollout does not create a worker-repair start receipt."""
import copy
import json
import textwrap
import types
import unittest
from pathlib import Path


class ControlledWorkerObservationTests(unittest.TestCase):
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

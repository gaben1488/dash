"""Prearming must not admit an old runtime or an unfinished release."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import worker_release_wait as waiter


class WorkerReleaseWaitTests(unittest.TestCase):
    def scenario(self, *, ready_at=5, corrupt=False):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name)
        runtime, state, backups = base/'runtime', base/'state', base/'backups'
        for path in (runtime, state, backups):
            path.mkdir()
        now = [0]
        plan = {'release_sha': 'a'*40}
        expected = {'plan_sha256': 'fixed', 'acceptance': {'source': 'a'*40}}
        def read(path):
            if now[0] < ready_at:
                return json.dumps({'release_sha': 'b'*40})
            if path.name == 'trial-plan.json':
                return json.dumps(plan)
            return json.dumps({} if corrupt else expected)
        r = SimpleNamespace(RUNTIME_DIR=runtime, STATE_DIR=state, BACKUP_BASE=backups,
            read_owned=read, validate_plan=lambda value: value, digest=lambda body: 'fixed',
            ReleaseRecovery=SimpleNamespace(_acceptance=lambda value: expected['acceptance']))
        def pause(seconds):
            now[0] += seconds
        return r, now, pause

    def test_old_runtime_is_not_admitted_while_waiting_for_exact_source(self):
        r, now, pause = self.scenario()
        plan = waiter.wait_for_release('a'*40, r, clock=lambda: now[0], pause=pause)
        self.assertEqual(plan['release_sha'], 'a'*40)
        self.assertEqual(now[0], 5)

    def test_unfinished_release_times_out_without_writing_or_generating(self):
        r, now, pause = self.scenario(ready_at=0)
        pending = r.STATE_DIR/'pending-release.json'
        pending.write_text('unchanged')
        with self.assertRaisesRegex(RuntimeError, '^WORKER_RELEASE_WAIT_TIMED_OUT$'):
            waiter.wait_for_release('a'*40, r, clock=lambda: now[0], pause=pause, timeout_seconds=10)
        self.assertEqual(pending.read_text(), 'unchanged')
        self.assertEqual(list(r.RUNTIME_DIR.iterdir()), [])
        self.assertEqual(now[0], 10)

    def test_invalid_acceptance_is_not_retried_or_admitted(self):
        r, now, pause = self.scenario(ready_at=0, corrupt=True)
        with self.assertRaisesRegex(RuntimeError, '^WORKER_RELEASE_ACCEPTANCE_INVALID$'):
            waiter.wait_for_release('a'*40, r, clock=lambda: now[0], pause=pause)
        self.assertEqual(now[0], 0)

    def test_cutoff_is_later_of_real_observer_start_and_new_container_start(self):
        observer, worker = '2026-10-17T00:00:00+00:00', '2026-10-17T00:10:00Z'
        self.assertEqual(waiter.cycle_cutoff(observer, worker), '2026-10-17T00:10:00+00:00')
        self.assertEqual(waiter.cycle_cutoff(worker, observer), '2026-10-17T00:10:00+00:00')

    def test_naive_clock_cannot_define_acceptance_cutoff(self):
        with self.assertRaisesRegex(ValueError, '^WORKER_OBSERVATION_CLOCK_INVALID$'):
            waiter.cycle_cutoff('2026-10-17T00:00:00', '2026-10-17T00:10:00Z')

    def test_workflow_records_real_start_before_wait_and_preserves_cycle_deadline(self):
        flow = (Path(__file__).parents[1]/'workflows/ci.yml').read_text().split('  worker-observe:', 1)[1]
        self.assertEqual(flow.count('observation_since=datetime.now(timezone.utc).isoformat()'), 1)
        self.assertLess(flow.index('observation_since=datetime.now'), flow.index('plan=waiter.wait_for_release('))
        self.assertIn('eligibility_since=waiter.cycle_cutoff(observation_since,since)', flow)
        self.assertIn('m.accept_cycle(status,eligibility_since,seen,attributed,interval)', flow)
        self.assertIn('deadline=time.monotonic()+max(2700,2*interval+900)', flow)
        self.assertIn('group: worker-observe-readonly', flow)


if __name__ == '__main__':
    unittest.main()

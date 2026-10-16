"""A resumed deployment must freshly match data and retain pre-arm API recovery."""
import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace


class ContinuedReleaseTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('continue_release.py')
        self.assertTrue(path.is_file(), 'No reviewed custody continuation exists')
        spec = importlib.util.spec_from_file_location('continue_release', path)
        self.module = importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)

    def phase(self, outcome):
        trace = []
        class BackupError(Exception):pass
        def match(backup, source):
            trace.append('match')
            if isinstance(outcome, str):raise BackupError(outcome)
            return outcome
        executor = SimpleNamespace(_close=lambda plan, services:trace.append(('close', services)),
            _no_volume_writers=lambda plan:trace.append('no-writers'),_volume=lambda plan:Path('/synthetic'),
            backup_tool=SimpleNamespace(BackupError=BackupError,match_source=match))
        controller = SimpleNamespace(_retire_previous_checkpoint=lambda plan:trace.append('retire-proven-prior'))
        result = self.module.freeze_and_check(executor, controller, {}, Path('/private-synthetic'), lambda:trace.append('queue-existing-controller'))
        return trace, result

    def test_real_content_drift_cannot_publish_or_restore_data(self):
        trace, result = self.phase('BACKUP_SOURCE_MISMATCH')
        self.assertEqual(result, 'SOURCE_CHANGED_RECAPTURE_REQUIRED')
        self.assertEqual(trace, [('close', ('server',)), 'no-writers', 'match', 'retire-proven-prior'])

    def test_matching_capture_only_queues_the_unchanged_controller(self):
        trace, result = self.phase({'state':'SOURCE_MATCHED_ONLY'})
        self.assertEqual(result, 'RELEASE_QUEUED')
        self.assertEqual(trace, [('close', ('server',)), 'no-writers', 'match', 'queue-existing-controller'])

    def test_archive_failure_is_not_treated_as_drift_or_checkpoint_permission(self):
        with self.assertRaisesRegex(Exception, 'BACKUP_MISMATCH'):
            self.phase('BACKUP_MISMATCH')

    def test_invalid_match_result_does_not_queue_deployment(self):
        with self.assertRaisesRegex(ValueError, 'CONTINUATION_MATCH_INVALID'):
            self.phase({'state':'UNPROVEN'})

    def test_dead_guardian_cannot_start_recovery_while_a_controller_still_owns_ex(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'quiescent').touch();trace=[]
            def write(path,body):trace.append('sole-owner-write');path.write_bytes(body)
            def request(mode):
                trace.append(mode)
                if mode=='resume-release':(root/'quiescent').unlink()
            with patch.object(self.module,'SESSION',root), patch.object(self.module,'custodians',side_effect=[[123],None,[]]) as holders, patch.object(self.module,'request',side_effect=request), patch.object(self.module.time,'sleep',side_effect=lambda seconds:trace.append('wait-child')):
                self.module.wait_closed(SimpleNamespace(poll=lambda:1),SimpleNamespace(atomic_bytes=write))
            self.assertEqual(holders.call_count,3)
            self.assertEqual(trace,['wait-child','wait-child','sole-owner-write','request-resume','resume-release'])

    def test_surviving_controller_completion_needs_no_competing_recovery(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'quiescent').touch()
            with patch.object(self.module,'SESSION',root), patch.object(self.module,'custodians',return_value=[123]), patch.object(self.module,'request') as request, patch.object(self.module.time,'sleep',side_effect=lambda seconds:(root/'quiescent').unlink()):
                self.module.wait_closed(SimpleNamespace(poll=lambda:1),SimpleNamespace(atomic_bytes=lambda *args:self.fail('Original controller must retain its guardian receipt')))
            request.assert_not_called()

    def test_synchronous_native_recovery_keeps_its_full_existing_bound(self):
        from unittest.mock import patch
        with patch.object(self.module.subprocess,'run',return_value=SimpleNamespace(returncode=0)) as run:
            self.module.request('resume-release')
            self.assertGreaterEqual(run.call_args.kwargs['timeout'],2230)
            self.module.request('request-resume')
            self.assertEqual(run.call_args.kwargs['timeout'],45)

    def test_guardian_reuses_original_dispatch_and_recovers_on_parent_loss_after_prepared(self):
        source = (Path(__file__).parents[2] / 'deploy/report-backup-window.sh').read_text()
        body = self.module.guardian_program(source)
        self.assertIn('release-dispatch', body)
        self.assertIn('resume-release', body)
        self.assertIn('kill -0 "$9"', body)
        self.assertNotIn('[ ! -f "$1/prepared" ] && ! kill -0 "$9"', body)
        self.assertIn('4500', body)


if __name__ == '__main__':unittest.main()

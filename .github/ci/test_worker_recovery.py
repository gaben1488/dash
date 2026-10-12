"""Worker-only recovery guards; synthetic status/Docker failures, no production IO."""
import hashlib
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/worker_recovery.py'


class WorkerRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('worker_recovery', SCRIPT)
        cls.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def status(self, identity='first', outcome='VERIFIED', **extra):
        return dict(status=outcome, attempt_id=identity, started_at='2026-10-11T21:00:00+00:00',
                    finished_at='2026-10-11T21:02:00+00:00', snapshot_id='synthetic-snapshot',
                    publication={'snapshot_id': 'synthetic-snapshot',
                                 'renderer_version': 'renderer-v1.5.0rc25', 'operational_available': True}, **extra)

    def test_two_different_cycles_and_frozen_word_are_required(self):
        seen = {}
        self.assertTrue(self.module.accept_cycle(self.status(), '2026-10-11T20:59:00+00:00', seen, {'first', 'second'}, 900))
        self.assertFalse(self.module.accept_cycle(self.status(), '2026-10-11T20:59:00+00:00', seen, {'first', 'second'}, 900))
        second = self.status('second')
        second.update(started_at='2026-10-11T21:17:00+00:00', finished_at='2026-10-11T21:19:00+00:00')
        self.assertTrue(self.module.accept_cycle(second, '2026-10-11T20:59:00+00:00', seen, {'first', 'second'}, 900))
        self.assertEqual(len(seen), 2)

    def test_old_or_running_status_cannot_close_a_cycle(self):
        self.assertFalse(self.module.accept_cycle(self.status(), '2026-10-11T21:05:00+00:00', {}, {'first'}, 900))
        self.assertFalse(self.module.accept_cycle(self.status(outcome='RUNNING'), '2026-10-11T20:59:00+00:00', {}, {'first'}, 900))

    def test_second_cycle_failure_does_not_preserve_false_acceptance(self):
        seen = {}
        self.module.accept_cycle(self.status(), '2026-10-11T20:59:00+00:00', seen, {'first', 'second'}, 900)
        with self.assertRaisesRegex(self.module.RecoveryError, 'WORKER_NEW_CYCLE_FAILED'):
            self.module.accept_cycle(self.status('second', 'NOT_ISSUED'), '2026-10-11T20:59:00+00:00', seen, {'first', 'second'}, 900)
        self.assertEqual(len(seen), 1)

    def test_attributed_source_change_rejects_publication_without_aborting_timer(self):
        seen = {}
        self.module.accept_cycle(self.status(), '2026-10-11T20:59:00+00:00', seen, {'first'}, 900)
        rejected = self.status('changed', 'NOT_ISSUED', error_code='SOURCE_CHANGED_BEFORE_PUBLICATION',
                               failure_stage='publication')
        rejected.pop('publication')
        rejected.update(started_at='2026-10-11T21:17:00+00:00', finished_at='2026-10-11T21:19:00+00:00')
        self.assertFalse(self.module.accept_cycle(rejected, '2026-10-11T20:59:00+00:00', seen, {'changed'}, 900))
        self.assertEqual(set(seen), {'first'})
        for extra in ({'finished_at':'invalid'}, {'failure_stage':'acquisition'}, {'error_code':'PUBLISHED_BUNDLE_CORRUPT'}):
            with self.subTest(extra=extra), self.assertRaises(self.module.RecoveryError):
                self.module.accept_cycle({**rejected, **extra}, '2026-10-11T20:59:00+00:00', seen, {'changed'}, 900)
        with self.assertRaises(self.module.RecoveryError):
            self.module.accept_cycle(rejected, '2026-10-11T20:59:00+00:00', seen, set(), 900)

    def test_snapshot_or_document_context_mismatch_fails(self):
        for change in ({'snapshot_id': 'different'}, {'operational_available': False}):
            status = self.status()
            status['publication'].update(change)
            with self.assertRaises(self.module.RecoveryError):
                self.module.accept_cycle(status, '2026-10-11T20:59:00+00:00', {}, {'first'}, 900)

    def test_invalid_timestamp_and_identifier_fail(self):
        for key, value in (('finished_at', '2026-10-11T19:00:00+00:00'), ('attempt_id', ''), ('started_at', 'bad')):
            status = self.status()
            status[key] = value
            with self.assertRaises(self.module.RecoveryError):
                self.module.accept_cycle(status, '2026-10-11T20:59:00+00:00', {}, {'first'}, 900)

    def test_distinct_ids_without_timer_wait_or_worker_attribution_are_not_accepted(self):
        seen = {}
        self.module.accept_cycle(self.status(), '2026-10-11T20:59:00+00:00', seen, {'first'}, 900)
        self.assertFalse(self.module.accept_cycle(self.status('manual'), '2026-10-11T20:59:00+00:00', seen, {'first'}, 900))
        with self.assertRaisesRegex(self.module.RecoveryError, 'WORKER_TIMER_ORDER_INVALID'):
            self.module.accept_cycle(self.status('second'), '2026-10-11T20:59:00+00:00', seen, {'first', 'second'}, 900)

    def test_lock_belongs_to_worker_process_not_manual_server_process(self):
        locks = '29: FLOCK  ADVISORY  WRITE 123 00:41:789 0 EOF'
        self.assertTrue(self.module.worker_lock_held(locks, {123}, 0, 65, 789))
        self.assertFalse(self.module.worker_lock_held(locks, {456}, 0, 65, 789))
        self.assertFalse(self.module.worker_lock_held(locks, {123}, 0, 65, 788))

    def test_default_docker_top_works_when_host_rejects_ps_format_options(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.server, recovery.worker = 'node', 'worker'
        processes = 'UID PID PPID C STIME TTY TIME CMD\nroot 123 1 0 21:00 ? 00:00:00 proc-report worker\n'
        def docker(args):
            if args[:2] == ['docker', 'exec']:
                return '[0, 65, 789]'
            if args == ['docker', 'top', 'worker', '-eo', 'pid']:
                return 'PID\n123\n'
            if args[:2] == ['docker', 'top'] and len(args) == 3:
                return processes if args[2] == 'worker' else processes.replace('proc-report worker', 'node server.js')
            raise self.module.RecoveryError('HOST_PS_FORMAT_UNSUPPORTED')
        recovery.call = docker
        recovery.require_no_manual_writer()
        with patch.object(Path, 'read_text', return_value='29: FLOCK ADVISORY WRITE 123 00:41:789 0 EOF'):
            self.assertTrue(recovery.holds_worker_lock())
        recovery.call = lambda args: processes.replace('worker', 'run-google')
        with self.assertRaisesRegex(self.module.RecoveryError, 'WORKER_CONCURRENT_MANUAL_WRITER'):
            recovery.require_no_manual_writer()

    def test_restore_failure_never_claims_rollback_or_restarts_partial_state(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.changed = True
        recovery.server = 'original-node'
        recovery.worker = 'replacement-worker'
        recovery.call = Mock(return_value="b" * 64)
        recovery.inspect = Mock(return_value={'State': {'Status': 'exited'}})
        recovery.tool = Mock(side_effect=self.module.RecoveryError('RESTORE_FAILED'))
        recovery.resume = Mock()
        recovery.compose = Mock()
        recovery.override = Mock()
        recovery.manifest_sha256 = 'a' * 64
        with self.assertRaises(self.module.RecoveryError):
            recovery.rollback()
        recovery.resume.assert_not_called()
        recovery.compose.assert_not_called()
    def test_rollback_reads_full_container_id_and_checks_both_writers(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.server, recovery.worker = 'a' * 64, 'b' * 64
        recovery.session = self.temp_path = Path('/tmp')
        recovery.original_worker = {'Image': 'sha256:' + 'c' * 64}
        recovery.manifest_sha256 = 'd' * 64
        calls = []
        def docker(args):
            calls.append(args)
            # Real Docker ps truncates IDs unless explicitly requested otherwise.
            if args[:2] == ['docker', 'ps']:
                return 'b' * (64 if '--no-trunc' in args else 12)
            return ''
        recovery.call = docker
        recovery.inspect = Mock(return_value={'State': {'Status': 'running'}})
        recovery.tool, recovery.resume, recovery.override = Mock(), Mock(), Mock()
        with self.assertRaisesRegex(self.module.RecoveryError, 'WORKER_ROLLBACK_WRITERS_NOT_QUIESCENT'):
            recovery.rollback()
        self.assertIn(['docker', 'stop', '--time', '75', 'b' * 64], calls)
        recovery.tool.assert_not_called()
        recovery.resume.assert_not_called()

    def test_valid_restore_resumes_node_even_when_stopped_worker_recreation_fails(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.server, recovery.worker = 'a' * 64, 'b' * 64
        recovery.original_worker = {'Image': 'sha256:' + 'c' * 64}
        recovery.manifest_sha256 = 'd' * 64
        recovery.call = Mock(return_value='b' * 64)
        recovery.inspect = Mock(return_value={'State': {'Status': 'exited'}})
        recovery.tool = Mock(return_value={'state': 'REPORT_SCOPE_RESTORED', 'core_state_preserved': True})
        recovery.override, recovery.resume, recovery.smoke = Mock(), Mock(), Mock()
        recovery.compose = Mock(side_effect=self.module.RecoveryError('COMPOSE_FAILED'))
        with self.assertRaisesRegex(self.module.RecoveryError, 'COMPOSE_FAILED'):
            recovery.rollback()
        recovery.resume.assert_called_once()
        recovery.smoke.assert_called_once()

    def test_manual_terminal_status_cannot_be_attributed_at_lock_turnover(self):
        first = self.status('manual', 'RUNNING')
        confirmed = self.status('manual', 'VERIFIED')
        self.assertFalse(self.module.same_running_attempt(first, confirmed))
        self.assertTrue(self.module.same_running_attempt(first, first))

    def test_tampered_backup_or_different_source_receipt_blocks_before_docker(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo, backup, session = root/'repo', root/'backup', root/'recovery'
            repo.mkdir()
            (backup/'backup').mkdir(parents=True)
            session.mkdir()
            (backup/'backup/manifest.json').write_bytes(b'private synthetic manifest')
            baseline = {'server':'a'*64, 'worker':'b'*64, 'image':'sha256:'+'c'*64, 'volume':'synthetic', 'candidate':'d'*40}
            (backup/'runtime.json').write_text(json.dumps(baseline))
            receipt = {'full_restore':'VERIFIED_IN_SCRATCH', 'compatibility':'PASS', 'backup_sha':'d'*40,
                'backup_session':str(backup), 'manifest_sha256':hashlib.sha256((backup/'backup/manifest.json').read_bytes()).hexdigest()}
            (session/'receipt.json').write_text(json.dumps(receipt))
            self.module.Recovery(repo, session)
            receipt['backup_sha'] = 'e'*40
            (session/'receipt.json').write_text(json.dumps(receipt))
            with self.assertRaisesRegex(self.module.RecoveryError, 'WORKER_BACKUP_RECEIPT_INVALID'):
                self.module.Recovery(repo, session)
            receipt['backup_sha'] = 'd'*40
            (session/'receipt.json').write_text(json.dumps(receipt))
            (backup/'backup/manifest.json').write_bytes(b'changed')
            with self.assertRaisesRegex(self.module.RecoveryError, 'WORKER_BACKUP_RECEIPT_INVALID'):
                self.module.Recovery(repo, session)

    def test_failure_diagnostics_are_saved_privately_before_destructive_report_restore(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.worker = 'b'*64
        with tempfile.TemporaryDirectory() as tmp:
            recovery.session = Path(tmp)
            def copy(args, **kwargs):
                self.assertEqual(args[:2], ['docker', 'cp'])
                if args[-1].endswith('failure-status.json'):
                    Path(args[-1]).write_text(json.dumps({'attempt_id':'d'*32, 'status':'NOT_ISSUED'}))
                return ''
            recovery.call = Mock(side_effect=copy)
            recovery.save_failure_diagnostics()
            self.assertEqual(recovery.call.call_count, 2)
            recovery.call = Mock(side_effect=self.module.RecoveryError('CONTAINER_UNAVAILABLE'))
            recovery.save_failure_diagnostics()  # Failure to copy must not prevent rollback.

    def test_diagnostic_failure_stops_only_worker_preserving_api(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.server, recovery.worker, recovery.volume = 'a'*64, 'b'*64, 'synthetic'
        recovery.image = 'sha256:'+'c'*64
        mounts = [{'Type':'volume', 'Name':'synthetic', 'Destination':'/app/packages/server/data'}]
        server = {'Image': recovery.image, 'Mounts': mounts, 'State': {'Status':'running'}}
        worker = {'Image':'sha256:'+'d'*64, 'Mounts': mounts, 'State': {'Status':'exited'},
                  'Config': {'Cmd':['proc-report', 'worker', '--interval-seconds', '900']}}
        recovery.require_no_manual_writer, recovery.smoke = Mock(), Mock()
        recovery.match_report_backup, recovery.override, recovery.rollback = Mock(), Mock(), Mock()
        recovery.stop_failed_worker = Mock()
        for failure in (subprocess.TimeoutExpired('docker cp', 1), AttributeError('invalid private status shape')):
            recovery.inspect = Mock(side_effect=[server, worker])
            recovery.compose = Mock(side_effect=lambda *args: 'b'*64 if args[0]=='ps'
                                    else (_ for _ in ()).throw(self.module.RecoveryError('COMPOSE_START_FAILED')))
            recovery.call = Mock(side_effect=lambda args, **kwargs: 'b'*64 if args[:2]==['docker','ps']
                                 else (_ for _ in ()).throw(failure))
            recovery.rollback.reset_mock()
            with tempfile.TemporaryDirectory() as tmp:
                recovery.session = Path(tmp)
                with self.assertRaisesRegex(self.module.RecoveryError, 'COMPOSE_START_FAILED'):
                    recovery.recover()
            recovery.rollback.assert_not_called()
        self.assertEqual(recovery.stop_failed_worker.call_count, 2)

    def test_report_match_never_stops_or_restarts_api(self):
        recovery = self.module.Recovery.__new__(self.module.Recovery)
        recovery.server = 'original-node'
        recovery.call = Mock()
        recovery.inspect = Mock(return_value={'State':{'Status':'exited'}})
        recovery.resume = Mock()
        recovery.tool = Mock(return_value={'state':'REPORT_SCOPE_MATCHED_ONLY'})
        recovery.match_report_backup()
        recovery.call.assert_not_called()
        recovery.resume.assert_not_called()
        recovery.tool.assert_called_once_with('match-reports')
        recovery.tool.return_value = {'state':'REPORT_SCOPE_MISMATCH'}
        with self.assertRaisesRegex(self.module.RecoveryError, 'WORKER_BACKUP_STALE'):
            recovery.match_report_backup()
        recovery.call.assert_not_called()
        recovery.resume.assert_not_called()

    def test_acceptance_timeout_is_pending_without_failure_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            observer=Mock()
            observer.recover.side_effect=self.module.RecoveryError('WORKER_TWO_CYCLES_TIMED_OUT')
            with patch.object(self.module, 'Recovery', return_value=observer):
                with patch('sys.argv', ['worker_recovery.py','--repo',str(root),'--session',str(root)]):
                    self.assertEqual(self.module.main(), 3)
            self.assertFalse((root/'failure.json').exists())
            self.assertEqual(json.loads((root/'pending.json').read_text())['state'], 'NOT_ACCEPTED')

    def test_recreated_stopped_worker_and_observer_timeout_leave_api_and_worker_alone(self):
        recovery=self.module.Recovery.__new__(self.module.Recovery)
        recovery.server,recovery.worker,recovery.volume='a'*64,'old-removed-id','synthetic'
        recovery.image='sha256:'+'c'*64
        mounts=[{'Type':'volume','Name':'synthetic','Destination':'/app/packages/server/data'}]
        running=[False]
        def inspect(container):
            if container==recovery.server:
                return {'Image':recovery.image,'Mounts':mounts,'State':{'Status':'running'}}
            self.assertEqual(container,'b'*64)
            return {'Image':recovery.image if running[0] else 'sha256:'+'d'*64,
                    'Mounts':mounts,'State':{'Status':'running' if running[0] else 'created'},
                    'Config':{'Cmd':['proc-report','worker','--interval-seconds','900']},
                    'HostConfig':{'RestartPolicy':{'Name':'unless-stopped'}}}
        def compose(*args):
            if args[0]=='up':running[0]=True
            return 'b'*64 if args[0]=='ps' else ''
        recovery.inspect,recovery.compose=inspect,compose
        recovery.call=Mock(return_value='b'*64)
        recovery.require_no_manual_writer,recovery.smoke=Mock(),Mock()
        recovery.match_report_backup,recovery.override=Mock(),Mock()
        recovery.save_failure_diagnostics,recovery.stop_failed_worker=Mock(),Mock()
        recovery.rollback=Mock()
        with tempfile.TemporaryDirectory() as tmp:
            recovery.session=Path(tmp)
            with patch.object(self.module.time,'monotonic',side_effect=[0,9999]):
                with self.assertRaisesRegex(self.module.RecoveryError,'WORKER_TWO_CYCLES_TIMED_OUT'):
                    recovery.recover()
        self.assertTrue(running[0])
        recovery.stop_failed_worker.assert_not_called()
        recovery.rollback.assert_not_called()
        self.assertIn('--no-trunc', recovery.call.call_args.args[0])

    def test_hard_failure_stops_only_the_owned_worker(self):
        recovery=self.module.Recovery.__new__(self.module.Recovery)
        recovery.server='a'*64
        recovery.worker='b'*64
        recovery.call=Mock(side_effect=['b'*64,''])
        recovery.inspect=Mock(return_value={'State':{'Status':'running'}})
        recovery.stop_failed_worker()
        self.assertEqual(recovery.call.call_args_list[-1].args[0], ['docker','stop','--time','75','b'*64])
        self.assertNotIn(recovery.server,str(recovery.call.call_args_list))

    def test_external_worker_replacement_is_never_stopped(self):
        recovery=self.module.Recovery.__new__(self.module.Recovery)
        recovery.server,recovery.worker='a'*64,'b'*64
        recovery.call=Mock(return_value='c'*64)
        recovery.inspect=Mock(return_value={'State':{'Status':'running'}})
        with self.assertRaisesRegex(self.module.RecoveryError,'WORKER_RUNTIME_CHANGED'):
            recovery.stop_failed_worker()
        self.assertEqual(recovery.call.call_count,1)

    def test_both_workflow_polls_recognize_pending_without_acceptance(self):
        workflow = (SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml').read_text()
        recovery_job = workflow.split('  restore-current-worker:', 1)[1].split('  full-worker-backup:', 1)[0]
        self.assertEqual(recovery_job.count("test -f '$session/pending.json'"), 2)
        self.assertEqual(recovery_job.count('WORKER_ACCEPTANCE_PENDING\'; exit 3'), 2)

    def test_history_schema_probe_runs_even_when_timer_receipt_is_pending(self):
        import yaml
        workflow = yaml.safe_load((SCRIPT.parents[1] / '.github/workflows/vps-cache-cleanup.yml').read_text())
        steps = workflow['jobs']['worker-acceptance-readback']['steps']
        probe = next((step for step in steps if step.get('name') == 'Check actual historical schemas independently of timer acceptance'), None)
        self.assertIsNotNone(probe, 'A pending timer must not prevent read-only historical schema validation')
        self.assertEqual(probe['if'], 'always()')
        self.assertIn('report-schema-probe.cjs', probe['with']['script'])
        self.assertNotIn('result.json', probe['with']['script'])
        self.assertNotIn('compose up', probe['with']['script'])


if __name__ == '__main__':
    unittest.main()

"""The read-only observer works before an optional failure receipt exists."""
import contextlib
import io
import json
import os
import re
import stat
import tempfile
import textwrap
import unittest
from pathlib import Path
from types import SimpleNamespace

from test_acceptance_target_binding import TARGET


class ReleaseObserverTests(unittest.TestCase):
    def test_cleanup_only_admits_the_cancelled_readonly_rehearsal(self):
        import copy
        workflow = (Path(__file__).resolve().parents[1] / 'workflows' / 'ci.yml').read_text()
        match = re.findall(r'^            def admit_cancelled_replay\(record,image\):\n.*?(?=^            targets=)', workflow, re.MULTILINE | re.DOTALL)
        self.assertEqual(len(match), 1, 'A guarded read-only rehearsal cleanup must exist')
        namespace = {'re': re}
        exec(compile(textwrap.dedent(match[0]), '<actual-rehearsal-admission>', 'exec'), namespace)  # noqa: S102
        image = 'sha256:'+'d'*64
        record = {'Image': image, 'Config': {'Labels': {'aemr.rehearsal-run': '39147300916',
            'aemr.rehearsal-attempt': '1', 'aemr.rehearsal-job': 'frozen-replay'}},
            'HostConfig': {'ReadonlyRootfs': True, 'NetworkMode': 'none', 'AutoRemove': True}, 'Mounts': [
                {'Type': 'volume', 'Destination': '/app/packages/server/data', 'Name': 'aemr_server_data', 'RW': False},
                {'Type': 'volume', 'Destination': '/tmp', 'Name': 'a'*64, 'RW': True},
                {'Type': 'bind', 'Destination': '/candidate', 'RW': False}]}
        namespace['admit_cancelled_replay'](record, image)
        for defect in ('run', 'compose', 'primary_rw', 'named_scratch', 'bind_rw', 'image', 'network', 'rootfs', 'autoremove'):
            value = copy.deepcopy(record)
            if defect == 'run': value['Config']['Labels']['aemr.rehearsal-run'] = 'other'
            if defect == 'compose': value['Config']['Labels']['com.docker.compose.project'] = 'aemr'
            if defect == 'primary_rw': value['Mounts'][0]['RW'] = True
            if defect == 'named_scratch': value['Mounts'][1]['Name'] = 'aemr_server_data'
            if defect == 'bind_rw': value['Mounts'][2]['RW'] = True
            if defect == 'image': value['Image'] = 'other'
            if defect == 'network': value['HostConfig']['NetworkMode'] = 'bridge'
            if defect == 'rootfs': value['HostConfig']['ReadonlyRootfs'] = False
            if defect == 'autoremove': value['HostConfig']['AutoRemove'] = False
            with self.subTest(defect=defect), self.assertRaises(AssertionError):
                namespace['admit_cancelled_replay'](value, image)

    def test_native_failure_keeps_the_fixed_reason_without_leaking_stderr(self):
        workflow = (Path(__file__).resolve().parents[1] / 'workflows' / 'ci.yml').read_text()
        source = workflow.split('                def readonly(args,*,timeout=45,**kwargs):', 1)[1].split('                executor=', 1)[0]
        source = 'def readonly(args,*,timeout=45,**kwargs):' + textwrap.dedent('\n' + source)
        # Preserve the actual function body indent after taking it out of YAML.
        source = 'def readonly(args,*,timeout=45,**kwargs):\n' + textwrap.indent(textwrap.dedent(source.split('\n', 1)[1]), '    ')
        command = ['exec', 'aemr-server-1', '/opt/report-env/bin/python', '-m', 'procurement_engine.deployment_smoke']
        for stderr, expected in [('REPORT_EXPORT_HTTP_503\n', 'REPORT_EXPORT_HTTP_503'),
                                 ('PRIVATE ROW and credential\n', 'UNCLASSIFIED')]:
            output = io.StringIO()
            namespace = {'m': SimpleNamespace(RecoveryError=RuntimeError), 'json': json, 're': re,
                'permitted_proofs': set(), 'subprocess': SimpleNamespace(run=lambda *args, stderr=stderr, **kwargs:
                    SimpleNamespace(returncode=1, stderr=stderr, stdout='PRIVATE PAYLOAD'))}
            exec(compile(source, '<actual-observer-command>', 'exec'), namespace)  # noqa: S102
            with contextlib.redirect_stdout(output), self.assertRaisesRegex(RuntimeError, 'WORKER_OBSERVATION_IO_FAILED'):
                namespace['readonly'](command)
            self.assertEqual(json.loads(output.getvalue()), {'worker_native_failure': expected})
            self.assertNotIn('PRIVATE', output.getvalue())

    def run_observer(self, target):
        workflow = (Path(__file__).resolve().parents[1] / 'workflows/ci.yml').read_text()
        function = re.search(
            r'^            def release_failure_metadata\(\):\n.*?(?=^            def transfer_host_metadata\(\):)',
            workflow, re.MULTILINE | re.DOTALL).group()
        function = textwrap.dedent(function).replace(
            '/root/codex-fixes/release-38831492016/runner-diagnostics.json', str(target))
        namespace = {'Path': Path, 'os': os, 'stat': stat, 'json': json, 're': re}
        exec(compile(function, '<actual-workflow-observer>', 'exec'), namespace)  # noqa: S102 — actual trusted workflow code.
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            namespace['release_failure_metadata']()
        return json.loads(output.getvalue())

    def test_no_failure_receipt_during_normal_backup_is_observable(self):
        with tempfile.TemporaryDirectory() as folder:
            result = self.run_observer(Path(folder) / 'not-created.json')
        self.assertEqual(result, {'release_failure_metadata': True, 'present': False})

    def test_dangling_failure_receipt_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'unsafe.json'
            target.symlink_to(Path(folder) / 'absent.json')
            with self.assertRaises(AssertionError):
                self.run_observer(target)


class AcceptedAttemptMetadataTests(unittest.TestCase):
    """Actual inline projector; synthetic filesystem ownership is explicitly modelled."""
    def run_projection(self, *, observed=True, defect=None, receipt=True):
        workflow = (Path(__file__).resolve().parents[1] / 'workflows/ci.yml').read_text()
        function = re.search(r'^            def accepted_cycle_metadata\(\):\n.*?(?=^            def checkpoint_metadata\(\):)',
                             workflow, re.MULTILINE | re.DOTALL).group()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); base = root / 'acceptance-999999-1'; reports = root / 'reports'
            base.mkdir(); reports.mkdir()
            ids = ['a'*32, 'b'*32]
            self.expected_retained_stats={}
            def save(name, value):
                path = base / name; path.write_text(json.dumps(value)); path.chmod(0o600)
            save('result.json', {'state': 'TWO_AUTONOMOUS_CYCLES_VERIFIED',
                'source_sha': '0'*40 if defect == 'source' else TARGET,
                'native_word': 'PASS', 'sealed_entries_verified': 123, 'attempt_ids': ids,
                'observation_since': '2026-10-16T21:59:00Z',
                'worker_started_at': '2026-10-16T21:59:30Z',
                'eligibility_since': '2026-10-16T21:58:00Z' if defect == 'cutoff' else '2026-10-16T21:59:30Z',
                'attempt_proofs_verified': 2, 'reference_attempts_verified': (2 if observed else 0) if defect != 'count' else 1})
            for index, attempt in enumerate(ids, 1):
                (base / ('cycle-'+str(index)+'.json')).write_text('PRIVATE_CYCLE_BODY_NOT_JSON')
                (base / ('cycle-'+str(index)+'.json')).chmod(0o600)
                save('attribution-'+attempt+'.json', {'double_host_flock': True,
                    'samples': [{'held': True}, {'held': True}],
                    'started_at': '2026-10-16T21:59:29Z' if defect == 'started_before_cutoff' else f'2026-10-16T22:{(index-1)*20:02d}:00Z'})
                status = reports / 'attempts' / attempt / 'status.json'; status.parent.mkdir(parents=True)
                status.write_bytes(b'PRIVATE_STATUS_BODY_NOT_JSON'); status.chmod(0o600)
                info=status.stat();self.expected_retained_stats[index]=(info.st_size,info.st_blocks*512)
                proof = {'scope': 'WRONG' if defect == 'scope' else 'SINGLE_RETAINED_ATTEMPT',
                    'format': 'REFERENCE' if observed else 'INLINE', 'coverage': 'OBSERVED' if observed else 'NOT_OBSERVED',
                    'proof_matches': True, 'global_compatible': True if observed else None,
                    'retained_bytes': status.stat().st_size + (1 if defect == 'size' else 0),
                    'global_bytes': 4*1024*1024 if observed else None}
                save('attempt-proof-'+attempt+'.json', proof)
            (reports / 'status.json').write_bytes(b'CURRENT_GLOBAL_BODY_NOT_JSON'); (reports / 'status.json').chmod(0o600)
            current=(reports/'status.json').stat();self.expected_global_stats=(current.st_size,current.st_blocks*512)
            if defect == 'symlink':
                status.unlink(); status.symlink_to(root / 'missing')
            if defect == 'oversize':
                path = base / ('attempt-proof-'+ids[0]+'.json'); path.write_text(path.read_text()+' '*4096)
            code = textwrap.dedent(function).replace('/var/lib/aemr/worker-quarantine', str(root))
            code = code.replace('/var/lib/docker/volumes/aemr_server_data/_data/reports', str(reports))
            original_lstat = Path.lstat
            class FixturePath(type(Path())):
                def lstat(self):
                    info = original_lstat(self)
                    # GHA caller1001 is not the native owner; model only this trusted metadata boundary.
                    return SimpleNamespace(st_mode=info.st_mode, st_size=info.st_size, st_nlink=info.st_nlink,
                        st_uid=1000 if self.is_relative_to(reports) else 0, st_blocks=info.st_blocks)
            opened = []
            def open_metadata(path, flags):
                path = Path(path)
                if path.is_relative_to(reports) or path.name.startswith('cycle-'):
                    raise AssertionError('Projector must not open a status/cycle payload')
                opened.append(path.name)
                return os.open(path, flags)
            def fstat_metadata(descriptor):
                info = os.fstat(descriptor)
                return SimpleNamespace(st_mode=info.st_mode, st_size=info.st_size, st_nlink=info.st_nlink, st_uid=0)
            guarded_os = SimpleNamespace(open=open_metadata, fdopen=os.fdopen, fstat=fstat_metadata,
                O_RDONLY=os.O_RDONLY, O_NOFOLLOW=os.O_NOFOLLOW, O_NONBLOCK=os.O_NONBLOCK,
                environ={'WORKER_ACCEPTANCE':base.name if receipt else ''},path=os.path)
            worker={'Image':'sha256:'+'a'*64, 'State':{'Status':'running',
                'StartedAt':'2026-10-16T21:59:31Z' if defect=='worker_start' else '2026-10-16T21:59:30Z'}}
            recovery=SimpleNamespace(ReleaseRecovery=lambda **kwargs:SimpleNamespace(_records=lambda *args,**kw:{'report-worker':worker}))
            plan={'release_sha':TARGET, 'candidate_images':{'report-worker':worker['Image']}}
            namespace = {'Path': FixturePath, 'os': guarded_os, 'stat': stat, 'json': json, 're': re}
            namespace['current_release_plan']=lambda **kwargs:(recovery,plan)
            exec(compile(code, '<actual-accepted-metadata>', 'exec'), namespace)  # noqa: S102 — actual trusted inline source.
            output = io.StringIO()
            with contextlib.redirect_stdout(output): namespace['accepted_cycle_metadata']()
            self.assertNotIn('PRIVATE_', output.getvalue())
            return [json.loads(line) for line in output.getvalue().splitlines()], opened

    def test_proofs_and_lstat_are_projected_without_opening_payloads(self):
        rows, opened = self.run_projection()
        proofs = [row for row in rows if 'accepted_attempt_proof' in row]
        self.assertEqual(len(proofs), 2)
        self.assertTrue(all(row['proof']['coverage'] == 'OBSERVED' for row in proofs))
        self.assertTrue(all(row['retained_status_content_reverified'] is False for row in proofs))
        for row in proofs:
            self.assertEqual((row['retained_status_logical_bytes'],row['retained_status_allocated_bytes']),
                             self.expected_retained_stats[row['accepted_attempt_proof']])
        current = next(row for row in rows if row.get('scope') == 'CURRENT_GLOBAL_LSTAT_ONLY')
        self.assertEqual((current['logical_bytes'],current['allocated_bytes']),self.expected_global_stats)
        self.assertIs(current['content_reverified'], False)
        self.assertEqual(sum(name.startswith('attempt-proof-') for name in opened), 2)

    def test_zero_references_remains_explicit_not_observed(self):
        rows, _ = self.run_projection(observed=False)
        proofs = [row for row in rows if 'accepted_attempt_proof' in row]
        self.assertEqual(len(proofs), 2)
        self.assertTrue(all(row['proof']['coverage'] == 'NOT_OBSERVED' for row in proofs))

    def test_absent_receipt_selection_does_not_fall_back_to_old_acceptance(self):
        rows, opened = self.run_projection(receipt=False)
        self.assertEqual(rows,[{'accepted_worker':False,'state':'NOT_ACCEPTED','reason':'CURRENT_RECEIPT_NOT_SELECTED'}])
        self.assertEqual(opened,[])

    def test_rejects_wrong_scope_source_count_size_symlink_and_oversized_proof(self):
        for defect in ('scope', 'source', 'count', 'size', 'symlink', 'oversize', 'worker_start'):
            with self.subTest(defect=defect), self.assertRaises(AssertionError):
                self.run_projection(defect=defect)

    def test_rejects_backdated_cutoff_and_attempt_before_new_worker(self):
        for defect in ('cutoff', 'started_before_cutoff'):
            with self.subTest(defect=defect), self.assertRaises(AssertionError):
                self.run_projection(defect=defect)


if __name__ == '__main__':
    unittest.main()

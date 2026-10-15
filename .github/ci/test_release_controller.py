"""Private release trial: real full restore and SQLite, mocked native image commands."""
import base64
import contextlib
import importlib.util
import io
import json
import os
import sqlite3
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('recovery_fixtures', ROOT / '.github/ci/test_release_recovery.py')
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


def bare_status(root, release_id):
    """Use the real reader's bare-endpoint envelope, with only its store mocked."""
    with patch.object(sys, 'path', [str(ROOT / 'packages/report-engine/src'), *sys.path]):
        from procurement_engine import publication_reader
    (root / 'published').mkdir(parents=True, exist_ok=True)
    (root / 'published/publications.sqlite').touch()
    latest = {'release_id': release_id, 'snapshot_id': 'synthetic', 'report_date': '30.09.2026',
              'cutoff_at': '2026-09-29T15:00:00Z', 'published_at': '2026-09-30T06:00:00Z',
              'model_sha256': 'b' * 64, 'rules_version': 'synthetic',
              'renderer_version': 'synthetic', 'status': 'VERIFIED'}
    with patch.object(publication_reader, 'PublicationStore') as store:
        store.return_value.latest.return_value = latest
        value = json.loads(publication_reader._read_publication(root, 'status'))
    assert 'latest' in value and 'selected' not in value
    return value


@unittest.skipUnless(os.geteuid() == 0, 'real root ownership exercised by namespace wrapper')
class TrialTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.ReleaseRecoveryTests('test_kernel_lock_and_private_receipt_are_required')
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.setUp()
        path = self.fixture.trusted_source('deploy/release_trial.py')
        self.assertTrue(path.exists(), 'Trusted native one-clone trial is missing')
        sys.modules['release_recovery'] = self.fixture.module
        spec = importlib.util.spec_from_file_location('release_trial', path)
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.clone = self.fixture.private / 'trial-clone'
        self.clone.mkdir()
        patcher = patch.object(self.module, 'CLONE', self.clone)
        patcher.start()
        self.addCleanup(patcher.stop)
        uid_patch = patch.object(self.module, 'NODE_UID', 0)  # namespace maps only UID0; filesystem remains real
        uid_patch.start()
        self.addCleanup(uid_patch.stop)
        self.calls = []
        self.reject_previous = False
        self.reject_candidate = False
        self.plan = self.fixture.plan
        for name in ('compose.json', 'candidate-compose.json'):
            path = self.fixture.runtime / name
            resolved = json.loads(path.read_text())
            resolved['services']['server']['environment'] = {'AEMR_API_KEY': 'PRIVATE_TEST_KEY'}
            path.write_text(json.dumps(resolved))
            self.fixture.plan['config_sha256'][name] = self.fixture.module.digest(path.read_bytes())
        self.fixture.records['server']['Config']['Env'] = ['AEMR_API_KEY=PRIVATE_TEST_KEY']
        self.fixture.records['caddy']['Mounts'] = [{'Type': 'bind', 'Source': '/home/aemr/dash/deploy/Caddyfile', 'Destination': '/etc/caddy/Caddyfile', 'RW': False}]
        self.fixture.persist_records()
        source_gate_patch = patch.object(self.module, 'SOURCE_GATE', self.fixture.trusted_source('.github/ci/source_ci_gate.py'))
        source_gate_patch.start()
        self.addCleanup(source_gate_patch.stop)
        self.ci = {'run': {'head_sha': self.plan['release_sha'], 'name': 'CI', 'event': 'pull_request',
                           'path': '.github/workflows/ci.yml', 'head_repository': {'full_name': 'gaben1488/dash'}},
                   'jobs': [{'name': name, 'status': 'completed', 'conclusion': 'success'} for name in
                            ['Lint, TypeScript, Tests, Build, Audit', 'Report engine, publication and runtime',
                             'Production image with report runtime']],
                   'candidate_image_binding': {'source_sha': self.plan['release_sha'], 'images': self.plan['candidate_images']}}
        self.source_file = self.fixture.runtime / 'source-ci.json'
        self.source_file.write_text(json.dumps(self.ci))
        self.source_file.chmod(0o600)
        self.runner = self.module.ReleaseTrial(command=self.command)

    def command(self, args, **kwargs):
        self.calls.append(args)
        if args[0] == 'ps':
            return ''
        if args[:2] == ['image', 'inspect']:
            return json.dumps([{'Id': args[2]}])
        if args[0] == 'run':
            self.assertIn('none', args)
            self.assertNotIn('--privileged', args)
            self.assertNotIn('-p', args)
            mounts = [args[i + 1] for i, value in enumerate(args) if value == '--mount']
            self.assertTrue(any(str(self.clone) in value for value in mounts))
            image = next(value for value in args if value.startswith('sha256:'))
            if '/opt/report-env/bin/proc-report' in args:
                self.assertIn('initialize-publication-readers', args)
                return ''
            if image == self.plan['candidate_images']['server']:
                if self.reject_candidate:
                    raise self.fixture.module.RecoveryError('PRIVATE_NATIVE_BODY')
                with sqlite3.connect(self.clone / 'aemr.db') as db:
                    db.execute('alter table receipt add column candidate_only text')
                return 'CANDIDATE_TRIAL_PASS\n'
            self.assertEqual(image, self.plan['images']['server'])
            with sqlite3.connect(self.clone / 'aemr.db') as db:
                self.assertIn('candidate_only', [row[1] for row in db.execute('pragma table_info(receipt)')])
            if self.reject_previous:
                raise self.fixture.module.RecoveryError('PRIVATE_OLD_INCOMPATIBILITY')
            return 'PREVIOUS_TRIAL_PASS\n'
        raise AssertionError(args)

    def test_native_driver_real_node_process_enforces_schema_word_and_private_failure(self):
        native = self.fixture.private / 'native-fixture'
        (native / 'published/releases').mkdir(parents=True)
        (native / 'archives').mkdir()
        document = self.fixture.source / 'reports/published/releases' / self.fixture.release_id / 'main_report.docx'
        encoded = base64.b64encode(document.read_bytes()).decode()
        binding = {'release_id': self.fixture.release_id, 'sha256': {view: self.fixture.module.digest(document.read_bytes())
                                                                    for view in ('main', 'supplement', 'operational')}}
        envelope = bare_status(self.fixture.private / 'native-reader-status', self.fixture.release_id)
        app = "Promise.resolve({createApp:async()=>({inject:async({url})=>{if(url==='/api/health')return {statusCode:200};if(url==='/api/report-releases'){const payload=JSON.stringify({...ENVELOPE,padding:'p'.repeat(PADDING)});return {statusCode:200,payload,rawPayload:Buffer.from(payload)};}return {statusCode:200,rawPayload:Buffer.from('WORD','base64')};},close:async()=>{}})})"
        shared = 'import(' + json.dumps((ROOT / 'packages/shared/src/schemas.ts').as_uri()) + ')'
        for valid, word, padding, expected in [('true', encoded, 0, 0), ('false', encoded, 0, 2), ('null', encoded, 0, 2), ('missing', encoded, 0, 2), ('later', encoded, 0, 0), ('true', base64.b64encode(b'PRIVATE_NATIVE_BAD_WORD').decode(), 0, 2), ('true', encoded, 9 * 1024**2, 0), ('true', encoded, 33 * 1024**2, 2)]:
            with self.subTest(valid=valid, expected=expected):
                value = json.loads(json.dumps(envelope))
                if valid == 'false':value['latest']['status'] = 'PRIVATE_INVALID_STATUS'
                if valid == 'null':value['latest'] = None
                if valid == 'missing':value['selected'] = value.pop('latest')
                if valid == 'later':value['latest']['release_id'] = 'REL-' + 'c' * 64
                program = self.module.NATIVE_PROGRAM.replace("import('./src/app.ts')", app.replace('ENVELOPE', json.dumps(value)).replace('WORD', word).replace('PADDING', str(padding)))
                program = program.replace("import('@aemr/shared')", shared)
                program = program.replace('/app/packages/server/data/reports', str(native))
                program = program.replace('/opt/report-env/bin/python', sys.executable)
                result = subprocess.run(['node', '--import', str(ROOT / 'packages/server/node_modules/tsx/dist/loader.mjs'), '--eval', program, 'candidate'], input=json.dumps(binding),
                                        text=True, capture_output=True, timeout=15, check=False,
                                        env={**os.environ, 'AEMR_API_KEY': 'PRIVATE_SYNTHETIC_API_TOKEN'})
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertNotIn('PRIVATE_', result.stdout + result.stderr)
                self.assertEqual(result.stdout.strip(), 'CANDIDATE_TRIAL_PASS' if expected == 0 else '')

    def test_one_clone_candidate_then_previous_then_actual_full_restore(self):
        proof = self.runner.run(self.plan)
        self.assertEqual(proof['state'], 'TRUSTED_RELEASE_TRIAL_PASS')
        self.assertEqual(self.fixture.backup_tool.inventory(self.clone), self.fixture.expected)
        self.assertEqual(proof['manifest_sha256'], self.fixture.digest)
        self.assertEqual(proof['candidate_images'], self.plan['candidate_images'])
        self.assertEqual(proof['config_sha256'], self.plan['config_sha256'])
        self.assertEqual(proof['in_place_restore']['state'], 'STATE_RESTORED')
        self.assertEqual(len([c for c in self.calls if c[0] == 'run']), 3)

    def test_native_failure_never_returns_pass_or_changes_source(self):
        for field in ('reject_candidate', 'reject_previous'):
            with self.subTest(field=field):
                setattr(self, field, True)
                with self.assertRaises(self.fixture.module.RecoveryError):
                    self.runner.run(self.plan)
                self.assertEqual(self.fixture.backup_tool.inventory(self.fixture.source), self.fixture.expected)
                setattr(self, field, False)

    def test_supplied_pass_labels_cannot_replace_actual_native_checks(self):
        self.reject_candidate = True
        self.plan['proofs']['previous_runtime']['state'] = 'PREVIOUS_RUNTIME_COMPATIBLE'
        with self.assertRaises(self.fixture.module.RecoveryError):
            self.runner.run(self.plan)


@unittest.skipUnless(os.geteuid() == 0, 'real root ownership exercised by namespace wrapper')
class ControllerTests(TrialTests):
    def setUp(self):
        super().setUp()
        path = self.fixture.trusted_source('deploy/release-controller.py')
        self.assertTrue(path.exists(), 'Trusted release producer is missing')
        sys.modules['release_trial'] = self.module
        spec = importlib.util.spec_from_file_location('release_controller', path)
        self.controller_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.controller_module)
        source_gate = self.module.SOURCE_GATE
        patcher = patch.object(self.controller_module, 'SOURCE_GATE', source_gate)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.ci = {'run': {'head_sha': self.plan['release_sha'], 'name': 'CI', 'event': 'pull_request',
                           'path': '.github/workflows/ci.yml', 'head_repository': {'full_name': 'gaben1488/dash'}},
                   'jobs': [{'name': name, 'status': 'completed', 'conclusion': 'success'} for name in
                            ['Lint, TypeScript, Tests, Build, Audit', 'Report engine, publication and runtime',
                             'Production image with report runtime']],
                   'candidate_image_binding': {'source_sha': self.plan['release_sha'], 'images': self.plan['candidate_images']}}
        self.source_file = self.fixture.runtime / 'source-ci.json'
        self.source_file.write_text(json.dumps(self.ci))
        self.source_file.chmod(0o600)
        self.controller = self.controller_module.ReleaseController(self.fixture.executor)

    def stage_fixture(self):
        self.operator = self.fixture.private / 'operator'
        self.operator.mkdir(mode=0o700)
        reviewed = self.fixture.private / 'reviewed'
        reviewed.mkdir(mode=0o700)
        for path, body in ((self.operator / 'docker-compose.yml', 'operator compose'),
                           (self.operator / '.env.production', 'AEMR_API_KEY=PRIVATE_TEST_KEY\n'),
                           (self.operator / 'Caddyfile', 'old private Caddy'),
                           (reviewed / 'reviewed-docker-compose.yml', 'reviewed compose'),
                           (reviewed / 'reviewed-Caddyfile', 'new private Caddy')):
            path.write_text(body)
            path.chmod(0o600)
        for name, value in {'OPERATOR': self.operator, 'REVIEWED_COMPOSE': reviewed / 'reviewed-docker-compose.yml',
                            'REVIEWED_CADDY': reviewed / 'reviewed-Caddyfile'}.items():
            patcher = patch.object(self.controller_module, name, value, create=True)
            patcher.start()
            self.addCleanup(patcher.stop)
        old = json.loads((self.fixture.runtime / 'compose.json').read_text())
        old['services']['caddy']['volumes'][0]['source'] = str(self.operator / 'Caddyfile')
        self.fixture.records['caddy']['Mounts'][0]['Source'] = str(self.operator / 'Caddyfile')
        self.fixture.records['server']['State']['Status'] = 'running'
        self.fixture.persist_records()
        self.compose_sources = {str(self.operator / 'docker-compose.yml'): old,
                                str(reviewed / 'reviewed-docker-compose.yml'): json.loads(json.dumps(old))}
        self.request = {'release_sha': self.plan['release_sha'],
                        'candidate_images': {s: self.plan['candidate_images'][s] for s in ('server', 'web')},
                        'source_ci': {k: self.ci[k] for k in ('run', 'jobs')}}
        self.bad_revision = False
        actual = self.fixture.executor.command
        def command(args, **kwargs):
            if args[:2] == ['image', 'inspect']:
                return json.dumps([{'Id': args[2], 'Config': {'Labels': {
                    'org.opencontainers.image.revision': ('f' * 40 if self.bad_revision else self.plan['release_sha'])}}}])
            if args[0] == 'compose' and args[-3:] == ['config', '--format', 'json']:
                path = args[args.index('-f') + 1]
                value = self.compose_sources.get(path)
                if value is None:
                    value = json.loads(Path(path).read_text())
                return json.dumps(value)
            if args[0] == 'exec' and 'python3' in args and '/api/report-releases' in args[-1]:
                compile(args[-1], '<native-word-capture>', 'exec')
                return json.dumps(self.plan['word'])
            return actual(args, **kwargs)
        self.fixture.executor.command = command

    def backup_session(self):
        self.fixture.backups.chmod(0o700)
        self.fixture.backup.parent.chmod(0o700)
        record = {'candidate': self.plan['release_sha'], 'server': self.fixture.records['server']['Id'],
                  'worker': self.fixture.records['report-worker']['Id'], 'volume': self.plan['volume'],
                  'image': self.plan['images']['server'], 'worker_image': self.plan['images']['report-worker'],
                  'worker_was_running': False, 'authorized_quiesce': True, 'release_controller': True}
        self.fixture.module.atomic_json(self.fixture.backup.parent / 'runtime.json', record)
        self.fixture.records['server']['State']['Status'] = 'exited'
        self.fixture.persist_records()

    def test_stage_captures_actual_private_configuration_without_runtime_mutation(self):
        self.stage_fixture()
        self.assertTrue(hasattr(self.controller, 'stage'), 'Trusted fixed-path stage producer is missing')
        result = self.controller.stage(self.request)
        self.assertEqual(result, {'state': 'RELEASE_CONFIGURATION_STAGED'})
        stage = json.loads((self.fixture.runtime / 'stage.json').read_text())
        self.assertEqual(stage['images'], self.plan['images'])
        self.assertEqual(stage['candidate_images']['report-worker'], self.request['candidate_images']['server'])
        self.assertEqual(stage['candidate_images']['caddy'], self.plan['images']['caddy'])
        self.assertFalse(stage['original_running']['report-worker'])
        self.assertEqual(stage['word'], self.plan['word'])
        self.assertEqual((self.fixture.runtime / 'Caddyfile').read_text(), 'old private Caddy')
        self.assertEqual((self.fixture.runtime / 'candidate-Caddyfile').read_text(), 'new private Caddy')
        for name in (*self.fixture.module.CONFIG_FILES, 'stage.json', 'source-ci.json'):
            self.assertEqual((self.fixture.runtime / name).stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.fixture.backup_tool.inventory(self.fixture.source), self.fixture.expected)
        self.assertFalse(any(c[0] in ('stop', 'start', 'run', 'rm') for c in self.fixture.calls))
        self.assertFalse(self.fixture.pending.exists())

    def test_stage_actual_compose_dollars_match_inspected_runtime_and_replay_once(self):
        self.stage_fixture()
        # Config JSON escapes dollars for replay; inspect Env contains the actual
        # value, including the single dollars in bcrypt and any literal pair.
        token = '$2b$12$SYNTHETIC_ONLY$$literal'
        shell = ['sh', '-c', 'printf %s "$LITERAL_TOKEN"; printf %s "$$pair"']
        for path, resolved in self.compose_sources.items():
            resolved['services']['server']['environment']['LITERAL_TOKEN'] = token
            resolved['services']['server']['command'] = shell
            resolved['services']['caddy']['environment'] = {'BASIC_AUTH_HASH': token}
            Path(path).write_text(json.dumps(self.fixture.module.literal(resolved)))
        self.fixture.records['server']['Config']['Env'].append('LITERAL_TOKEN=' + token)
        self.fixture.records['server']['Config']['Cmd'] = shell
        self.fixture.records['caddy']['Config']['Env'] = ['BASIC_AUTH_HASH=' + token]
        self.fixture.persist_records()
        previous_command = self.fixture.executor.command
        serialized = []
        def command(args, **kwargs):
            if args[0] == 'compose' and args[-3:] == ['config', '--format', 'json']:
                result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=15, check=False)
                self.assertEqual(result.returncode, 0, result.stderr)
                serialized.append(json.loads(result.stdout))
                return result.stdout
            return previous_command(args, **kwargs)
        self.fixture.executor.command = command
        self.controller.stage(self.request)
        stage = json.loads((self.fixture.runtime / 'stage.json').read_text())
        captured = json.loads((self.fixture.runtime / 'compose.json').read_text())
        self.assertEqual(captured['services']['caddy']['environment']['BASIC_AUTH_HASH'], token)
        self.assertEqual(captured['services']['server']['environment']['LITERAL_TOKEN'], token)
        self.assertEqual(captured['services']['server']['command'], shell)
        self.plan['config_sha256'] = stage['config_sha256']
        _, replay = self.fixture.executor._files(self.plan, candidate_runtime=True)
        path = self.fixture.runtime / 'dollar-replay.json'
        path.write_text(json.dumps(replay))
        result = subprocess.run(['docker', 'compose', '-f', str(path), 'config', '--format', 'json'],
                                capture_output=True, text=True, timeout=15, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        replayed = json.loads(result.stdout)
        self.assertEqual(replayed['services']['server']['command'], serialized[-1]['services']['server']['command'])
        for service, key in [('caddy', 'BASIC_AUTH_HASH'), ('server', 'LITERAL_TOKEN')]:
            self.assertEqual(replayed['services'][service]['environment'][key],
                             serialized[-1]['services'][service]['environment'][key])

    def test_stage_rejects_failed_source_jobs_before_overwriting_private_config(self):
        self.stage_fixture()
        self.assertTrue(hasattr(self.controller, 'stage'), 'Trusted fixed-path stage producer is missing')
        self.request['source_ci']['jobs'][0]['conclusion'] = 'failure'
        original = (self.fixture.runtime / 'compose.json').read_bytes()
        with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_SOURCE_CI_INVALID'):
            self.controller.stage(self.request)
        self.assertEqual((self.fixture.runtime / 'compose.json').read_bytes(), original)
        self.assertFalse((self.fixture.runtime / 'stage.json').exists())

    def test_stage_native_get_driver_bounds_real_status_and_validates_actual_docx_bytes(self):
        import urllib.request
        document = self.fixture.source / 'reports/published/releases' / self.fixture.release_id / 'main_report.docx'
        word = document.read_bytes()
        expected = {'release_id': self.fixture.release_id,
                    'sha256': {view: self.fixture.module.digest(word) for view in ('main', 'supplement', 'operational')}}
        envelope = bare_status(self.fixture.private / 'reader-status', self.fixture.release_id)
        for padding, body, succeeds in ((9 * 1024**2, word, True), (33 * 1024**2, word, False),
                                       (0, b'PRIVATE_CORRUPT_DOCUMENT', False)):
            with self.subTest(padding=padding, succeeds=succeeds):
                urls = []
                def get(request, timeout, *, urls=urls, padding=padding, body=body):
                    self.assertEqual(request.get_header('Authorization'), 'Bearer PRIVATE_CAPTURE_TOKEN')
                    self.assertNotIn('?', request.full_url)
                    urls.append(request.full_url)
                    if request.full_url.endswith('/api/health'):
                        value = b'{}'
                    elif request.full_url.endswith('/api/report-releases'):
                        value = json.dumps({**envelope, 'padding': 'p' * padding}).encode()
                    else:
                        value = body
                    response = io.BytesIO(value)
                    response.status = 200
                    return response
                output = io.StringIO()
                with patch.object(urllib.request, 'urlopen', side_effect=get), \
                     patch.dict(os.environ, {'AEMR_API_KEY': 'PRIVATE_CAPTURE_TOKEN'}), \
                     contextlib.redirect_stdout(output):
                    if succeeds:
                        exec(self.controller_module.CAPTURE_WORD, {})  # noqa: S102 - fixed native GET program, isolated HTTP fixture
                    else:
                        with self.assertRaises((ValueError, __import__('zipfile').BadZipFile)):
                            exec(self.controller_module.CAPTURE_WORD, {})  # noqa: S102 - fixed native GET program, isolated HTTP fixture
                self.assertEqual(json.loads(output.getvalue()) if succeeds else output.getvalue(), expected if succeeds else '')
                self.assertNotIn('PRIVATE_', output.getvalue())
                if succeeds:
                    self.assertEqual(len(urls), 5)

    def test_workflow_preflight_uses_bare_reader_and_fixed_private_safe_diagnostics(self):
        workflow = (ROOT / '.github/workflows/vps-cache-cleanup.yml').read_text()
        step = workflow.split('          # Raw response travels only over the private pipe;', 1)[1].split('      - name:', 1)[0]
        if "<<'JSREPORT'" in step:
            program = step.split("<<'JSREPORT'\n", 1)[1].split('\n          JSREPORT', 1)[0]
            program = '\n'.join(line.removeprefix('          ') for line in program.splitlines())
        else:
            program = step.split('          program="', 1)[1].split('"\n', 1)[0]
        envelope = bare_status(self.fixture.private / 'preflight-reader-status', self.fixture.release_id)
        bodies = [(json.dumps(envelope), 'LIVE_LATEST_REPORT_SCHEMA_PASS', False),
                  (json.dumps({**envelope, 'latest': None}), 'LIVE_REPORT_LATEST_NULL', False),
                  (json.dumps({'selected': envelope['latest'], 'attempt': None}), 'LIVE_REPORT_LATEST_MISSING', False),
                  (json.dumps({**envelope, 'latest': {**envelope['latest'], 'status': 'PRIVATE_INVALID_STATUS'}}), 'LIVE_REPORT_SCHEMA_INVALID', False),
                  ('PRIVATE_NOT_JSON', 'LIVE_REPORT_JSON_INVALID', False),
                  ('', 'LIVE_REPORT_BODY_EMPTY', False),
                  (json.dumps(envelope), 'LIVE_REPORT_SCHEMA_IMPORT_FAILED', True)]
        for body, expected, fail_import in bodies:
            with self.subTest(expected=expected):
                shared = 'Promise.reject(Error("PRIVATE_IMPORT_FAILURE"))' if fail_import else 'import(' + json.dumps((ROOT / 'packages/shared/src/schemas.ts').as_uri()) + ')'
                code = program.replace("import('@aemr/shared')", shared)
                result = subprocess.run(['node', '--import', str(ROOT / 'packages/server/node_modules/tsx/dist/loader.mjs'), '--eval', code],
                                        input=body, text=True, capture_output=True, timeout=15, check=False)
                self.assertEqual(result.returncode, 0 if expected.endswith('_PASS') else 2, result.stderr)
                self.assertEqual(result.stdout.strip(), expected)
                self.assertNotIn('PRIVATE_', result.stdout + result.stderr)

    def test_workflow_preflight_read_failure_has_only_fixed_diagnostic(self):
        import urllib.request
        workflow = (ROOT / '.github/workflows/vps-cache-cleanup.yml').read_text()
        step = workflow.split('          # Raw response travels only over the private pipe;', 1)[1].split('      - name:', 1)[0]
        source = 'import os,sys,urllib.request' + step.split('          import os,sys,urllib.request', 1)[1].split('\n          PY', 1)[0]
        source = '\n'.join(line.removeprefix('          ') for line in source.splitlines())
        body = json.dumps(bare_status(self.fixture.private / 'preflight-read-status', self.fixture.release_id)).encode()
        for status, key in [(200, 'PRIVATE_TOKEN'), (503, 'PRIVATE_TOKEN'), (200, '')]:
            with self.subTest(status=status, authenticated=bool(key)):
                response = io.BytesIO(body);response.status = status
                output = io.BytesIO();pipe = io.TextIOWrapper(output);diagnostic = io.StringIO()
                with patch.object(urllib.request, 'urlopen', return_value=response), \
                     patch.dict(os.environ, {'AEMR_API_KEY': key}), \
                     contextlib.redirect_stdout(pipe), contextlib.redirect_stderr(diagnostic):
                    if status == 200 and key:
                        exec(compile(source, '<private-live-read>', 'exec'), {})  # noqa: S102 - tracked fixed read program with isolated HTTP/stdout fixtures
                    else:
                        with self.assertRaises(SystemExit) as raised:
                            exec(compile(source, '<private-live-read>', 'exec'), {})  # noqa: S102 - tracked fixed read program with isolated HTTP/stdout fixtures
                        self.assertEqual(raised.exception.code, 2)
                self.assertEqual(output.getvalue(), body if status == 200 and key else b'')
                self.assertEqual(diagnostic.getvalue(), '' if status == 200 and key else 'LIVE_REPORT_READ_FAILED\n')

    def test_stage_rejects_arbitrary_metadata_paths_or_commands_before_docker(self):
        self.stage_fixture()
        original = json.loads(json.dumps(self.request))
        for key in ('command', 'backup', 'compose'):
            self.request = {**original, key: '/tmp/arbitrary'}
            self.fixture.calls.clear()
            with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_STAGE_INPUT_INVALID'):
                self.controller.stage(self.request)
            self.assertEqual(self.fixture.calls, [])
        self.assertFalse((self.fixture.runtime / 'stage.json').exists())

    def test_stage_rejects_candidate_image_with_other_source_revision(self):
        self.stage_fixture()
        self.assertTrue(hasattr(self.controller, 'stage'), 'Trusted fixed-path stage producer is missing')
        self.bad_revision = True
        with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_IMAGE_SOURCE_INVALID'):
            self.controller.stage(self.request)
        self.assertFalse((self.fixture.runtime / 'stage.json').exists())

    def test_stage_rejects_unapproved_caddy_bind_even_when_saved_configuration_matches(self):
        self.stage_fixture()
        path = self.fixture.private / 'arbitrary-Caddyfile'
        path.write_text('must not be trusted as release input')
        path.chmod(0o600)
        old = self.compose_sources[str(self.operator / 'docker-compose.yml')]
        old['services']['caddy']['volumes'][0]['source'] = str(path)
        self.fixture.records['caddy']['Mounts'][0]['Source'] = str(path)
        self.fixture.persist_records()
        with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_CADDY_SOURCE_INVALID'):
            self.controller.stage(self.request)
        self.assertFalse((self.fixture.runtime / 'stage.json').exists())

    def test_stage_rejects_undeclared_actual_mount_instead_of_losing_it_in_capture(self):
        self.stage_fixture()
        self.fixture.records['server']['Mounts'].append({'Type': 'volume', 'Name': 'unexplained', 'Destination': '/private'})
        self.fixture.persist_records()
        with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_SAVED_RUNTIME_MISMATCH'):
            self.controller.stage(self.request)
        self.assertFalse((self.fixture.runtime / 'stage.json').exists())

    def test_stage_rejects_dangling_pending_or_progress_before_docker(self):
        self.stage_fixture()
        self.assertTrue(hasattr(self.controller, 'stage'), 'Trusted fixed-path stage producer is missing')
        for name in ('pending-release.json', 'release-recovery-progress.json'):
            marker = self.fixture.private / name
            marker.symlink_to(self.fixture.private / 'absent')
            self.fixture.calls.clear()
            with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_ALREADY_PENDING'):
                self.controller.stage(self.request)
            self.assertEqual(self.fixture.calls, [])
            marker.unlink()

    def test_stage_requires_actual_kernel_ex(self):
        import fcntl
        self.stage_fixture()
        self.assertTrue(hasattr(self.controller, 'stage'), 'Trusted fixed-path stage producer is missing')
        fcntl.flock(self.fixture.lock, fcntl.LOCK_UN)
        with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_LOCK_REQUIRED'):
            self.controller.stage(self.request)
        self.assertFalse((self.fixture.runtime / 'stage.json').exists())

    def test_stage_selects_matching_saved_runtime_and_immutable_caddy_capsule(self):
        self.stage_fixture()
        self.assertTrue(hasattr(self.controller, 'stage'), 'Trusted fixed-path stage producer is missing')
        base = self.fixture.private / 'release-configs'
        base.mkdir(mode=0o700)
        capsule = base / ('c' * 40)
        capsule.mkdir(mode=0o700)
        caddy = capsule / 'candidate-Caddyfile'
        caddy.write_text('previous accepted Caddy')
        caddy.chmod(0o600)
        saved = json.loads(json.dumps(self.compose_sources[str(self.operator / 'docker-compose.yml')]))
        saved['services']['server']['environment']['AEMR_API_KEY'] = 'PRIVATE_CHANGED_KEY'
        saved['services']['caddy']['volumes'][0]['source'] = str(caddy)
        self.fixture.records['server']['Config']['Env'] = ['AEMR_API_KEY=PRIVATE_CHANGED_KEY']
        self.fixture.records['caddy']['Mounts'][0]['Source'] = str(caddy)
        self.fixture.persist_records()
        path = self.fixture.runtime / 'candidate-resume.json'
        self.fixture.module.atomic_json(path, saved)
        self.compose_sources[str(path)] = saved
        self.controller.stage(self.request)
        self.assertEqual(json.loads((self.fixture.runtime / 'compose.json').read_text()), saved)
        self.assertEqual((self.fixture.runtime / 'Caddyfile').read_text(), 'previous accepted Caddy')

    def test_stage_rejects_unmatched_actual_environment_without_faking_old_runtime(self):
        self.stage_fixture()
        self.assertTrue(hasattr(self.controller, 'stage'), 'Trusted fixed-path stage producer is missing')
        self.fixture.records['server']['Config']['Env'] = ['AEMR_API_KEY=PRIVATE_UNDECLARED']
        self.fixture.persist_records()
        with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_SAVED_RUNTIME_MISMATCH'):
            self.controller.stage(self.request)
        self.assertFalse((self.fixture.runtime / 'stage.json').exists())

    def test_base_plan_binds_stage_to_actual_backup_session_and_native_word_manifest(self):
        self.stage_fixture()
        self.assertTrue(hasattr(self.controller, 'stage'), 'Trusted fixed-path stage producer is missing')
        self.assertTrue(hasattr(self.controller, 'base_plan'), 'Backup-bound base plan producer is missing')
        self.controller.stage(self.request)
        self.backup_session()
        import fcntl
        # Guardian owns EX at this point; this producer only writes private plan
        # metadata. Same-owner prepare still performs source-match and mutation gate.
        fcntl.flock(self.fixture.lock, fcntl.LOCK_UN)
        self.assertEqual(self.controller.base_plan('123'), {'state': 'RELEASE_BASE_PLAN_CREATED'})
        plan = self.fixture.module.validate_plan(json.loads((self.fixture.runtime / 'base-plan.json').read_text()))
        self.assertEqual(plan['manifest_sha256'], self.fixture.digest)
        self.assertEqual(plan['backup_reference'], 'worker-123/backup')
        self.assertFalse(plan['original_running']['report-worker'])
        self.assertEqual(plan['word'], self.plan['word'])
        self.assertFalse(self.fixture.pending.exists())
        self.assertFalse((self.fixture.runtime / 'trial-plan.json').exists())

    def test_base_plan_rejects_session_image_drift_and_staged_config_tampering(self):
        self.stage_fixture()
        self.assertTrue(hasattr(self.controller, 'stage'), 'Trusted fixed-path stage producer is missing')
        self.assertTrue(hasattr(self.controller, 'base_plan'), 'Backup-bound base plan producer is missing')
        self.controller.stage(self.request)
        self.backup_session()
        record = self.fixture.backup.parent / 'runtime.json'
        original = record.read_bytes()
        value = json.loads(original)
        value['worker_image'] = 'sha256:' + 'f' * 64
        self.fixture.module.atomic_json(record, value)
        with self.assertRaises(self.fixture.module.RecoveryError):
            self.controller.base_plan('123')
        record.write_bytes(original)
        (self.fixture.runtime / 'candidate-Caddyfile').write_text('tampered')
        with self.assertRaises(self.fixture.module.RecoveryError):
            self.controller.base_plan('123')
        self.assertFalse((self.fixture.runtime / 'base-plan.json').exists())

    def test_base_plan_rejects_changed_native_word_manifest_or_invalid_run_id(self):
        self.stage_fixture()
        self.controller.stage(self.request)
        self.backup_session()
        for run in ('../123', '123/backup', '', '-1'):
            with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_BACKUP_SESSION_INVALID'):
                self.controller.base_plan(run)
        path = self.fixture.backup / 'manifest.json'
        manifest = json.loads(path.read_bytes())
        document = 'reports/published/releases/' + self.fixture.release_id + '/main_report.docx'
        manifest['files'][document]['sha256'] = 'f' * 64
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_WORD_PROOF_INVALID'):
            self.controller.base_plan('123')
        self.assertFalse((self.fixture.runtime / 'base-plan.json').exists())

    def test_prepare_binds_source_jobs_and_current_frozen_checkpoint_without_arming(self):
        result = self.controller.prepare(self.plan)
        self.assertEqual(result['state'], 'RELEASE_TRIAL_PREPARED')
        self.assertFalse(self.fixture.pending.exists())
        self.assertTrue((self.fixture.runtime / 'trial-plan.json').exists())

    def live_api_driver(self, *, padding=9 * 1024**2, broken=None, transient=False, stalled_cancel=False):
        # Actual shared Dashboard schema and public Header validators execute in
        # Node; only HTTP is faked. Publication envelopes use the real reader shape.
        trust = {'overall': 100, 'components': [], 'grade': 'A', 'computedAt': 'fixture', 'basedOnSnapshot': 'fixture'}
        snapshot = {'id': 'fixture', 'spreadsheetId': 'fixture', 'createdAt': 'fixture', 'officialMetrics': {},
                    'calculatedMetrics': {}, 'deltas': [], 'issues': [], 'trust': trust, 'rowCount': 0,
                    'metadata': {'sheetsRead': [], 'cellsRead': 0, 'readDurationMs': 0, 'pipelineDurationMs': 0}}
        period = {key: None for key in ('kpCount', 'kpFactCount', 'kpPlan', 'kpFact', 'kpPercent', 'epCount',
                  'epFactCount', 'epPlan', 'epFact', 'epPercent', 'fbPlan', 'kbPlan', 'mbPlan', 'fbFact', 'kbFact', 'mbFact')}
        period.update(source='calculated', kpCount=1, kpFactCount=1, kpPlan=10, kpFact=10, kpPercent=100)
        dashboard = {'snapshot': snapshot, 'kpiCards': [], 'departmentSummaries': [], 'summaryByPeriod': {'year': period},
                     'recentIssues': [], 'signalCounts': {}, 'issueSummary': {'total': 0, **{key: {} for key in
                     ('bySeverity', 'byCategory', 'byDepartment', 'byOrigin', 'signalCounts')}},
                     'trust': trust, 'lastRefreshed': 'fixture', 'year': 2026}
        latest = {'release_id': self.fixture.release_id, 'snapshot_id': 'fixture', 'report_date': '15.10.2026',
                  'cutoff_at': '2026-10-15T00:00:00Z', 'published_at': '2026-10-15T00:00:00Z',
                  'model_sha256': 'a' * 64, 'rules_version': 'fixture', 'renderer_version': 'fixture',
                  'status': 'VERIFIED_WITH_WARNINGS'}
        envelope = {'latest': latest, 'attempt': None}
        if broken == 'missing-latest':
            envelope = {'selected': latest, 'attempt': None}
        elif broken == 'null-latest':
            envelope['latest'] = None
        elif broken == 'invalid-latest':
            latest['status'] = 'PRIVATE_INVALID_STATUS'
        kinds = ('row-vanished', 'row-identity-candidate', 'money', 'dates', 'row-added', 'method', 'comment', 'flag', 'subject', 'other')
        headers = {
            '/api/sources': {'refresh': {'webhookConfigured': False, 'withinWorkWindow': False,
                             'autoRefreshMinutes': 0, 'workWindowLabel': 'fixture'}},
            '/api/registry/buckets': {'source': 'snapshot', 'asOf': '2026-10-15T00:00:00Z',
                                     'unfunded': {'rows': 0, 'planSum': 0}, 'yearlong': {'rows': 0, 'planSum': 0}},
            '/api/comments': {'total': 0, 'comments': [], 'witnesses': []},
            '/api/change-story': {'since': '2026-10-15', 'digest': {'books': 0, 'rows': 0, 'entries': 0,
                 'byKind': {key: 0 for key in kinds}, 'booksNamed': [], 'authors': [], 'firstAt': None,
                 'lastAt': None, 'emptiness': 'quiet'}, 'gaps': [], 'entries': [],
                 'facets': {'books': [], 'authors': []}, 'total': 0, 'shown': 0},
        }
        if broken == 'numerator':
            del dashboard['summaryByPeriod']['year']['kpFactCount']
        if broken == 'header':
            del headers['/api/sources']['refresh']['workWindowLabel']
        trace = self.fixture.private / 'live-api-calls.json'
        actual = self.fixture.executor.command
        def native(args, **kwargs):
            if './node_modules/.bin/tsx' not in args:
                return actual(args, **kwargs)
            shared = (ROOT / 'packages/shared/src/schemas.ts').as_uri()
            replacement = "import(" + json.dumps(shared) + ")"
            program = args[-1].replace("import('@aemr/shared')", replacement)
            program = program.replace("import('/opt/aemr/header_api_probe.mjs')", 'import(' + json.dumps((ROOT / '.github/ci/header_api_probe.mjs').as_uri()) + ')')
            setup = """const calls=[];const dashboard=DASHBOARD;const headers=HEADERS;const traceFs=require('node:fs');
process.on('exit',()=>traceFs.writeFileSync(TRACE,JSON.stringify(calls)));
globalThis.fetch=async(raw,options)=>{
 const url=new URL(raw);calls.push(url.pathname+url.search);
 if((options.method??'GET')!=='GET'||options.headers.Authorization!=='Bearer PRIVATE_LIVE_TOKEN')throw Error('PRIVATE_BAD_REQUEST');
 if(url.pathname==='/api/report-releases'){
  const body=JSON.stringify({...ENVELOPE,padding:'p'.repeat(PADDING)});
  if(STALLED_CANCEL)return new Response(new ReadableStream({start(c){c.enqueue(Buffer.from(body));},cancel(){return new Promise(()=>{});}}));
  return new Response(body);}
 if(url.pathname==='/api/dashboard'){
  if(TRANSIENT&&calls.filter(x=>x==='/api/dashboard').length===1)return new Response('{}',{status:503});
  return new Response(JSON.stringify(dashboard));}
 if(url.pathname==='/api/comments'&&url.searchParams.get('view')!=='discussions')throw Error('PRIVATE_WRONG_VIEW');
 if(url.pathname==='/api/sources'&&BROKEN==='http')return new Response('PRIVATE_UNAVAILABLE',{status:401});
 if(headers[url.pathname])return new Response(JSON.stringify(headers[url.pathname]));
 throw Error('PRIVATE_UNEXPECTED_ENDPOINT');};
""".replace('DASHBOARD', json.dumps(dashboard)).replace('HEADERS', json.dumps(headers)).replace('TRACE', json.dumps(str(trace)))
            setup = setup.replace('ENVELOPE', json.dumps(envelope)).replace('PADDING', str(padding)).replace('TRANSIENT', str(transient).lower()).replace('BROKEN', json.dumps(broken))
            setup = setup.replace('STALLED_CANCEL', str(stalled_cancel).lower())
            result = subprocess.run(['node', '--import', str(ROOT / 'packages/server/node_modules/tsx/dist/loader.mjs'), '--eval', setup + program],
                                    capture_output=True, text=True, timeout=15, check=False,
                                    env={**os.environ, 'AEMR_API_KEY': 'PRIVATE_LIVE_TOKEN'})
            self.assertNotIn('PRIVATE_', result.stdout + result.stderr)
            self.assertEqual(result.returncode, 0 if result.stdout.strip() == 'CANDIDATE_SCHEMA_PASS' else 2, result.stderr)
            return result.stdout
        self.fixture.executor.command = native
        return trace

    def test_live_schema_driver_accepts_existing_large_receipts_and_bounds_oversize(self):
        for padding, expected in [(9 * 1024**2, True), (33 * 1024**2, False)]:
            self.live_api_driver(padding=padding)
            if expected:
                self.fixture.executor._verify_candidate_schema()
            else:
                with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_CANDIDATE_SCHEMA_INVALID'):
                    self.fixture.executor._verify_candidate_schema()

    def test_live_gate_requires_real_latest_shape_without_fabricating_selected(self):
        for broken in ('missing-latest', 'null-latest', 'invalid-latest'):
            with self.subTest(broken=broken):
                trace = self.live_api_driver(padding=0, broken=broken)
                with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_CANDIDATE_SCHEMA_INVALID'):
                    self.fixture.executor._verify_candidate_schema()
                self.assertEqual(json.loads(trace.read_text()), ['/api/report-releases'])

    def test_live_gate_reads_both_dashboard_scopes_and_all_four_header_contracts(self):
        trace = self.live_api_driver()
        self.fixture.executor._verify_candidate_schema()
        calls = json.loads(trace.read_text())
        self.assertEqual(len(calls), 7)
        self.assertIn('/api/dashboard', calls)
        self.assertIn('/api/dashboard?year=all', calls)
        self.assertTrue(any(url.startswith('/api/comments?') and 'view=discussions' in url for url in calls))

    def test_broken_live_header_or_missing_dashboard_numerator_never_commits_accept(self):
        self.fixture.executor.arm(self.plan)
        self.fixture.mutate()
        for service in ('caddy', 'report-worker'):
            self.fixture.records[service]['State']['Status'] = 'created'
        self.fixture.persist_records()
        for broken in ('header', 'numerator', 'http'):
            with self.subTest(broken=broken):
                trace = self.live_api_driver(broken=broken)
                with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_CANDIDATE_SCHEMA_INVALID'):
                    self.fixture.executor.accept()
                self.assertFalse((self.fixture.private / 'release-recovery-progress.json').exists())
                self.assertTrue(self.fixture.pending.exists())
                calls = json.loads(trace.read_text())
                self.assertEqual(calls.count('/api/dashboard'), 1)
                self.assertEqual(calls.count('/api/sources'), 0 if broken == 'numerator' else 1)

    def test_live_gate_retries_startup_503_then_validates_without_substitution(self):
        trace = self.live_api_driver(transient=True)
        self.fixture.executor._verify_candidate_schema()
        calls = json.loads(trace.read_text())
        self.assertEqual(calls.count('/api/dashboard'), 2)
        self.assertEqual(len(calls), 8)

    def test_live_gate_rejects_oversize_without_waiting_for_stream_cancellation(self):
        self.live_api_driver(padding=33 * 1024**2, stalled_cancel=True)
        with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_CANDIDATE_SCHEMA_INVALID'):
            self.fixture.executor._verify_candidate_schema()

    def test_source_failed_or_wrong_candidate_image_never_prepares_or_arms(self):
        self.ci['jobs'][0]['conclusion'] = 'failure'
        self.source_file.write_text(json.dumps(self.ci))
        with self.assertRaises(self.fixture.module.RecoveryError):
            self.controller.prepare(self.plan)
        self.assertFalse((self.fixture.runtime / 'trial-plan.json').exists())
        self.assertFalse(self.fixture.pending.exists())

    def test_saved_old_runtime_environment_drift_blocks_prepare(self):
        self.fixture.records['server']['Config']['Env'] = ['AEMR_API_KEY=DIFFERENT_PRIVATE_TEST_KEY']
        self.fixture.persist_records()
        with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_SAVED_RUNTIME_MISMATCH'):
            self.controller.prepare(self.plan)
        self.assertFalse((self.fixture.runtime / 'trial-plan.json').exists())
        self.assertFalse(self.fixture.pending.exists())

    def test_full_producer_accepts_candidate_without_restoring_its_new_state(self):
        self.controller.prepare(self.plan)
        proof = self.runner.run(self.plan)
        self.fixture.module.atomic_json(self.fixture.runtime / 'trial-proof.json', proof)
        actual = self.fixture.executor.command
        def native_candidate(args, **kwargs):
            result = actual(args, **kwargs)
            if args[0] == 'compose' and '--no-start' not in args and 'server' in args and 'candidate-resume.json' in args[args.index('-f') + 1]:
                with sqlite3.connect(self.fixture.source / 'aemr.db') as db:
                    db.execute('alter table receipt add column live_candidate text')
            return result
        self.fixture.executor.command = native_candidate
        result = self.controller.deploy()
        self.assertEqual(result['state'], 'RELEASE_CANDIDATE_ACCEPTED')
        self.assertFalse(self.fixture.pending.exists())
        with sqlite3.connect(self.fixture.source / 'aemr.db') as db:
            self.assertIn('live_candidate', [row[1] for row in db.execute('pragma table_info(receipt)')])
        self.assertTrue((self.fixture.private / 'release-accepted.json').exists())

    def test_candidate_schema_failure_restores_whole_checkpoint_before_old_ingress(self):
        self.controller.prepare(self.plan)
        proof = self.runner.run(self.plan)
        self.fixture.module.atomic_json(self.fixture.runtime / 'trial-proof.json', proof)
        actual = self.fixture.executor.command
        def reject_candidate(args, **kwargs):
            if './node_modules/.bin/tsx' in args:
                return 'INVALID_CANDIDATE_SCHEMA'
            result = actual(args, **kwargs)
            if args[0] == 'compose' and '--no-start' not in args and 'server' in args and 'candidate-resume.json' in args[args.index('-f') + 1]:
                with sqlite3.connect(self.fixture.source / 'aemr.db') as db:
                    db.execute('alter table receipt add column failed_candidate text')
            return result
        self.fixture.executor.command = reject_candidate
        with self.assertRaisesRegex(self.fixture.module.RecoveryError, 'RELEASE_CANDIDATE_REJECTED_AND_RECOVERED'):
            self.controller.deploy()
        self.assertEqual(self.fixture.backup_tool.inventory(self.fixture.source), self.fixture.expected)
        self.assertFalse(self.fixture.pending.exists())
        self.assertTrue(all(r['Image'] == self.plan['images'][s] for s, r in self.fixture.records.items()))

    def test_checkpoint_drift_after_external_trial_rejects_without_runtime_changes(self):
        self.controller.prepare(self.plan)
        proof = self.runner.run(self.plan)
        self.fixture.module.atomic_json(self.fixture.runtime / 'trial-proof.json', proof)
        with sqlite3.connect(self.fixture.source / 'aemr.db') as db:
            db.execute('update receipt set value=123')
        with self.assertRaises(self.fixture.module.RecoveryError):
            self.controller.deploy()
        self.assertFalse(self.fixture.pending.exists())
        self.assertFalse(any(call[0] == 'compose' for call in self.fixture.calls))
        with sqlite3.connect(self.fixture.source / 'aemr.db') as db:
            self.assertEqual(db.execute('select value from receipt').fetchone()[0], 123)

    def test_returned_trial_proof_mismatch_rejects_before_candidate_mutation(self):
        self.controller.prepare(self.plan)
        proof = self.runner.run(self.plan)
        proof['candidate_images']['server'] = 'sha256:' + 'f' * 64
        self.fixture.module.atomic_json(self.fixture.runtime / 'trial-proof.json', proof)
        with self.assertRaises(self.fixture.module.RecoveryError):
            self.controller.deploy()
        self.assertFalse(self.fixture.pending.exists())
        self.assertFalse(any(c[0] == 'compose' for c in self.fixture.calls))


class NamespaceTests(unittest.TestCase):
    def test_real_privileged_trial_in_user_namespace(self):
        if os.geteuid() == 0:
            return
        result = subprocess.run(['unshare', '-Ur', sys.executable, str(Path(__file__).resolve()), '-q'],
                                capture_output=True, text=True, timeout=60, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == '__main__':
    unittest.main()

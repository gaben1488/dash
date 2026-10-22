#!/usr/bin/env python3
"""Trusted release producer. Only fixed private paths and actual maintenance EX."""
import argparse
import json
import os
import re
import shlex
import stat
import subprocess
import sys
import types
from pathlib import Path

import release_recovery as recovery
import release_trial as trial

SOURCE_GATE = trial.SOURCE_GATE
OPERATOR = Path('/home/aemr/dash/deploy')
REVIEWED_COMPOSE = Path('/usr/local/libexec/aemr/reviewed-docker-compose.yml')
REVIEWED_CADDY = Path('/usr/local/libexec/aemr/reviewed-Caddyfile')
RUNTIME_POLICY = Path('/etc/aemr/runtime-policy.json')


def web_only_inputs(paths):
    """Only UI sources and inert documentation may reuse the installed backend."""
    seen_web = False
    for path in paths:
        if (not isinstance(path, str) or not path or '\\' in path
                or any(part in {'', '.', '..'} for part in path.split('/'))):
            return False
        # A changed API adapter is a changed backend dependency, even when
        # Git reports it under the frontend directory.
        if path == 'packages/web/src/api.ts' or path.startswith('packages/web/src/api/'):
            return False
        if path.startswith('packages/web/'):
            seen_web = True
        elif not (path.startswith('docs/') and path.endswith('.md') or path in
                  {'README.md', 'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'LICENSE', 'LICENSE.txt'}):
            return False
    return seen_web


CAPTURE_WORD = """import hashlib,io,json,os,re,sys,urllib.request,zipfile
key=os.environ.get('AEMR_API_KEY','')
if not key: raise ValueError('auth')
def get(path):
 request=urllib.request.Request('http://127.0.0.1:3000'+path,headers={'Authorization':'Bearer '+key})
 with urllib.request.urlopen(request,timeout=25) as response:
  if response.status!=200: raise ValueError('status')
  body=response.read(32*1024*1024+1)
 if len(body)>32*1024*1024: raise ValueError('size')
 return body
get('/api/health')
status=json.loads(get('/api/report-releases'))
if 'latest' not in status: raise ValueError('latest')
latest=status['latest']
if latest is None:
 print(json.dumps({'release_id':None,'sha256':{}}));sys.exit(0)
if not isinstance(latest,dict): raise ValueError('latest')
release=latest.get('release_id')
if not isinstance(release,str) or not re.fullmatch('REL-[a-f0-9]{64}',release): raise ValueError('release')
hashes={}
for view in ('main','supplement','operational'):
 body=get('/api/report-releases/'+release+'/'+view+'.docx')
 with zipfile.ZipFile(io.BytesIO(body)) as document:
  if document.testzip() or 'word/document.xml' not in document.namelist(): raise ValueError('word')
 hashes[view]=hashlib.sha256(body).hexdigest()
print(json.dumps({'release_id':release,'sha256':hashes}))
"""


class ReleaseController:
    def __init__(self, executor=None):
        self.executor = executor or recovery.ReleaseRecovery()

    def _source(self, plan):
        # Same fixed gate implementation on runner and host, never a second registry.
        trial.SOURCE_GATE = SOURCE_GATE
        return trial.check_source_ci(plan)

    @staticmethod
    def _web_toolchain():
        """Fingerprint the actual root-owned recovery dependencies at staging."""
        files = {
            'controller': Path(__file__),
            'recovery': Path(recovery.__file__),
            'trial': Path(trial.__file__),
            'source_gate': SOURCE_GATE,
            'runtime_guard': Path(__file__).with_name('runtime_guard.py'),
            'runtime_policy': RUNTIME_POLICY,
        }
        return {name: recovery.digest(recovery.read_owned(path, private=name == 'runtime_policy'))
                for name, path in files.items()}

    @staticmethod
    def _web_toolchain_matches(expected):
        keys = {'controller', 'recovery', 'trial', 'source_gate', 'runtime_guard', 'runtime_policy'}
        if not isinstance(expected, dict) or set(expected) != keys:
            return False
        try:
            return expected == ReleaseController._web_toolchain()
        except (OSError, recovery.RecoveryError):
            # Missing/replaced root-owned programs or policy never authorize reuse.
            return False

    @staticmethod
    def _backend_runtime(records):
        """Process identity, not merely immutable container/image IDs."""
        identity = {}
        for service in ('server', 'report-worker', 'caddy'):
            record = records[service]
            state = record['State']
            started = state.get('StartedAt')
            restarts = record.get('RestartCount')
            if (not isinstance(started, str) or not started
                    or type(restarts) is not int or restarts < 0):
                recovery.fail('RELEASE_BACKEND_IDENTITY_UNAVAILABLE')
            identity[service] = {
                'container': record['Id'], 'image': record['Image'],
                'status': state['Status'], 'started_at': started,
                'restart_count': restarts,
            }
        return identity

    def _images(self, plan):
        for image in set(plan['images'].values()) | set(plan['candidate_images'].values()):
            if json.loads(self.executor.command(['image', 'inspect', image]))[0].get('Id') != image:
                recovery.fail('RELEASE_IMAGE_UNAVAILABLE')

    def _web_source(self, images, release_sha):
        """Unknown history means full release, never inferred compatibility."""
        image = json.loads(self.executor.command(['image', 'inspect', images['server']]))[0]
        before = (image.get('Config', {}).get('Labels') or {}).get('org.opencontainers.image.revision', '')
        if not isinstance(before, str) or not re.fullmatch('[a-f0-9]{40}', before) or images['server'] != images['report-worker']:
            return None
        try:
            command = ['git', '-c', 'safe.directory=' + str(OPERATOR.parent), '-C', str(OPERATOR.parent)]
            subprocess.run([*command, 'merge-base', '--is-ancestor', before, release_sha],
                           capture_output=True, check=True, timeout=30)
            paths = subprocess.run([*command, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', before, release_sha],
                                   capture_output=True, check=True, timeout=30).stdout.decode().rstrip('\0').split('\0')
        except (OSError, UnicodeError, subprocess.SubprocessError):
            return None
        return before if web_only_inputs(paths) else None

    def _saved_runtime(self, plan, records, resolved=None):
        if resolved is None:
            resolved = json.loads(recovery.read_owned(recovery.RUNTIME_DIR / 'compose.json'))
        for service, record in records.items():
            declared = resolved['services'][service]
            image = json.loads(self.executor.command(['image', 'inspect', plan['images'][service]]))[0].get('Config', {})
            actual = record.get('Config', {})
            def environment(values):
                if not isinstance(values, list) or any(not isinstance(v, str) or '=' not in v for v in values):
                    recovery.fail('RELEASE_SAVED_RUNTIME_MISMATCH')
                pairs = [value.split('=', 1) for value in values]
                if len({key for key, _ in pairs}) != len(pairs):
                    recovery.fail('RELEASE_SAVED_RUNTIME_MISMATCH')
                return dict(pairs)
            expected_env = environment(image.get('Env') or [])
            supplied = declared.get('environment') or {}
            if not isinstance(supplied, dict) or any(not isinstance(v, str) for v in supplied.values()):
                recovery.fail('RELEASE_SAVED_RUNTIME_MISMATCH')
            expected_env.update(supplied)
            if expected_env != environment(actual.get('Env') or []):
                recovery.fail('RELEASE_SAVED_RUNTIME_MISMATCH')
            for compose_key, docker_key in [('command', 'Cmd'), ('entrypoint', 'Entrypoint'),
                                             ('user', 'User'), ('working_dir', 'WorkingDir')]:
                # Compose null inherits the image; [] explicitly clears a command.
                expected = declared.get(compose_key)
                if expected is None:
                    # A non-null entrypoint suppresses the image CMD unless
                    # Compose also supplies an explicit command.
                    expected = (None if compose_key == 'command' and declared.get('entrypoint') is not None
                                else image.get(docker_key))
                if isinstance(expected, str) and compose_key in {'command', 'entrypoint'}:
                    expected = shlex.split(expected)
                observed = actual.get(docker_key)
                if compose_key in {'command', 'entrypoint'}:
                    expected = [] if expected is None else expected
                    observed = [] if observed is None else observed
                else:
                    # Docker omits empty image defaults and materializes them as ''.
                    expected = '' if expected is None else expected
                    observed = '' if observed is None else observed
                if expected != observed:
                    recovery.fail('RELEASE_SAVED_RUNTIME_MISMATCH')
            mounts = declared.get('volumes', [])
            declared_targets = {m.get('target') for m in mounts}
            image_targets = set(image.get('Volumes') or {})
            if declared_targets | image_targets != {m.get('Destination') for m in record.get('Mounts', [])}:
                recovery.fail('RELEASE_SAVED_RUNTIME_MISMATCH')
            # Image VOLUME declarations create anonymous mounts without Compose entries.
            for target in image_targets - declared_targets:
                values = [m for m in record.get('Mounts', []) if m.get('Destination') == target]
                if (len(values) != 1 or values[0].get('Type') != 'volume'
                        or not values[0].get('Name') or values[0].get('RW') is not True):
                    recovery.fail('RELEASE_SAVED_RUNTIME_MISMATCH')
            for mount in mounts:
                matches = [value for value in record.get('Mounts', []) if value.get('Destination') == mount['target']]
                if len(matches) != 1:
                    recovery.fail('RELEASE_SAVED_RUNTIME_MISMATCH')
                actual_mount = matches[0]
                if mount['type'] == 'volume':
                    entry = resolved.get('volumes', {}).get(mount['source']) or {}
                    expected_source = entry.get('name', 'aemr_' + mount['source'])
                    matched = actual_mount.get('Type') == 'volume' and actual_mount.get('Name') == expected_source
                else:
                    matched = actual_mount.get('Type') == 'bind' and actual_mount.get('Source') == mount.get('source')
                if not matched or bool(mount.get('read_only', False)) != (actual_mount.get('RW', True) is False):
                    recovery.fail('RELEASE_SAVED_RUNTIME_MISMATCH')

    @staticmethod
    def _idle():
        recovery.private_directory(recovery.STATE_DIR)
        recovery.private_directory(recovery.RUNTIME_DIR)
        if any(os.path.lexists(recovery.STATE_DIR / name) for name in
               ('pending-release.json', 'release-recovery-progress.json')):
            recovery.fail('RELEASE_ALREADY_PENDING')

    @staticmethod
    def _operator_file(path, *, private=False):
        if any(value.is_symlink() for value in (path, *path.parents)):
            recovery.fail('RELEASE_OPERATOR_FILE_INVALID')
        with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as file:
            value = os.fstat(file.fileno())
            if (not stat.S_ISREG(value.st_mode) or value.st_nlink != 1
                    or value.st_uid not in {0, OPERATOR.stat().st_uid}
                    or value.st_mode & (0o077 if private else 0o022) or value.st_size > 1024 * 1024):
                recovery.fail('RELEASE_OPERATOR_FILE_INVALID')
            return file.read(1024 * 1024 + 1)

    def stage(self, request):
        """Capture private configuration only; no checkpoint or release proof."""
        recovery.require_lock(self.executor.lock_fd)
        self._idle()
        if (not isinstance(request, dict) or set(request) != {'release_sha', 'candidate_images', 'source_ci'}
                or not isinstance(request['release_sha'], str) or not re.fullmatch('[a-f0-9]{40}', request['release_sha'])
                or not isinstance(request['candidate_images'], dict) or set(request['candidate_images']) != {'server', 'web'}
                or any(not isinstance(v, str) or not recovery.IMAGE.fullmatch(v) for v in request['candidate_images'].values())):
            recovery.fail('RELEASE_STAGE_INPUT_INVALID')
        ci = request['source_ci']
        if (not isinstance(ci, dict) or set(ci) != {'run', 'jobs'} or not isinstance(ci['run'], dict)
                or not isinstance(ci['jobs'], list) or any(not isinstance(v, dict) for v in ci['jobs'])):
            recovery.fail('RELEASE_SOURCE_CI_INVALID')
        gate = types.ModuleType('aemr_stage_source_gate')
        exec(compile(recovery.read_owned(SOURCE_GATE, private=False), str(SOURCE_GATE), 'exec'), gate.__dict__)  # noqa: S102 - fixed root-owned source-CI gate, never input code
        if not gate.source_ci_passed(ci['run'], ci['jobs'], request['release_sha']):
            recovery.fail('RELEASE_SOURCE_CI_INVALID')
        for image in set(request['candidate_images'].values()):
            value = json.loads(self.executor.command(['image', 'inspect', image]))[0]
            if (value.get('Id') != image or (value.get('Config', {}).get('Labels') or {}).get(
                    'org.opencontainers.image.revision') != request['release_sha']):
                recovery.fail('RELEASE_IMAGE_SOURCE_INVALID')
        images = {s: json.loads(self.executor.command(['inspect', 'aemr-' + s + '-1']))[0].get('Image')
                  for s in recovery.SERVICES}
        if any(not isinstance(v, str) or not recovery.IMAGE.fullmatch(v) for v in images.values()):
            recovery.fail('RELEASE_RUNTIME_NOT_OWNED')
        candidate_images = {**images, **request['candidate_images'], 'report-worker': request['candidate_images']['server']}
        binding = {'images': images, 'candidate_images': candidate_images, 'volume': 'aemr_server_data'}
        records = self.executor._records(binding, original=True)
        # Rollback must own the complete inventory before ingress is ever fenced.
        self.executor._recovery_records(binding)
        self.executor._volume(binding)
        if (any(r['State']['Status'] not in {'running', 'exited', 'created'} for r in records.values())
                or records['server']['State']['Status'] != 'running'
                or records['server']['State'].get('Health', {}).get('Status') != 'healthy'):
            recovery.fail('RELEASE_API_NOT_HEALTHY')
        self._images(binding)
        env = self._operator_file(OPERATOR / '.env.production', private=True)
        def resolved(path):
            # Compose serializes literal dollars as $$ even in config JSON.
            # Capture actual values for inspect comparison; _files escapes once
            # when producing the later Compose input.
            value = json.loads(self.executor.command(['compose', '--project-directory', str(OPERATOR),
                '--env-file', str(OPERATOR / '.env.production'), '-f', str(path), '--profile', 'reports',
                'config', '--format', 'json']).replace('$$', '$'))
            if not isinstance(value, dict) or value.get('name') != 'aemr' or set(value.get('services', {})) != set(recovery.SERVICES):
                recovery.fail('RELEASE_CONFIG_INVALID')
            return value
        previous = None
        # A prior accepted/recovered private compose may supersede operator YAML.
        # Each fixed allowlisted source must explain actual env/cmd/user/mounts.
        for path in (OPERATOR / 'docker-compose.yml', *(recovery.RUNTIME_DIR / name for name in
                     ('candidate-resume.json', 'recovery-compose.json', 'compose.json', 'candidate-compose.json'))):
            if not path.exists() and not path.is_symlink():
                continue
            try:
                if path.parent == OPERATOR:
                    self._operator_file(path)
                else:
                    recovery.read_owned(path)
                value = resolved(path)
                self._saved_runtime(binding, records, value)
                previous = value
                break
            except (recovery.RecoveryError, ValueError, KeyError, TypeError):
                continue
        if previous is None:
            recovery.fail('RELEASE_SAVED_RUNTIME_MISMATCH')
        mounts = [m for m in records['caddy'].get('Mounts', []) if m.get('Destination') == '/etc/caddy/Caddyfile']
        if len(mounts) != 1 or mounts[0].get('Type') != 'bind' or mounts[0].get('RW') is not False:
            recovery.fail('RELEASE_CADDY_SOURCE_INVALID')
        caddy = Path(mounts[0]['Source'])
        if caddy == OPERATOR / 'Caddyfile':
            old_caddy = self._operator_file(caddy)
        else:
            base = recovery.STATE_DIR / 'release-configs'
            if (caddy.parent.parent != base or not re.fullmatch('[a-f0-9]{40}', caddy.parent.name)
                    or caddy.name not in {'Caddyfile', 'candidate-Caddyfile'}
                    or any(p.is_symlink() for p in (caddy, *caddy.parents))):
                recovery.fail('RELEASE_CADDY_SOURCE_INVALID')
            recovery.private_directory(base)
            recovery.private_directory(caddy.parent)
            old_caddy = recovery.read_owned(caddy)
        recovery.read_owned(REVIEWED_COMPOSE, private=False)
        candidate = resolved(REVIEWED_COMPOSE)
        for config, pins in ((previous, images), (candidate, candidate_images)):
            for service in recovery.SERVICES:
                config['services'][service]['image'] = pins[service]
        backend_sha = self._web_source(images, request['release_sha'])
        same_caddy = old_caddy == recovery.read_owned(REVIEWED_CADDY, private=False)
        if same_caddy:
            # A previous release may bind identical bytes from its immutable capsule.
            for mount in candidate['services']['caddy'].get('volumes', []):
                if mount.get('type') == 'bind' and mount.get('target') == '/etc/caddy/Caddyfile':
                    mount['source'] = str(caddy)
        # Source equivalence alone cannot excuse changed environment/mounts/limits.
        comparable = json.loads(json.dumps(candidate))
        for service in recovery.SERVICES:
            comparable['services'][service]['image'] = images[service]
        if (backend_sha and comparable == previous
                and same_caddy
                and records['web']['State']['Status'] == 'running'
                and not previous['services']['web'].get('volumes')):
            candidate_images.update({s: images[s] for s in ('server', 'report-worker')})
            for service in ('server', 'report-worker'):
                candidate['services'][service]['image'] = images[service]
        else:
            backend_sha = None
        word = json.loads(self.executor.command(['exec', 'aemr-server-1', 'python3', '-c', CAPTURE_WORD], timeout=150))
        if not recovery.valid_word_binding(word):
            recovery.fail('RELEASE_WORD_PROOF_INVALID')
        source_ci = {**ci, 'candidate_image_binding': {'source_sha': request['release_sha'], 'images': candidate_images}}
        encode = lambda value: json.dumps(value, sort_keys=True, allow_nan=False).encode()
        bodies = {'compose.json': encode(previous), 'candidate-compose.json': encode(candidate),
                  '.env.production': env, 'Caddyfile': old_caddy, 'candidate-Caddyfile': recovery.read_owned(REVIEWED_CADDY, private=False)}
        stage = {'format': 'aemr-release-stage-v1', 'release_sha': request['release_sha'], **binding,
                 'config_sha256': {name: recovery.digest(body) for name, body in bodies.items()},
                 'tool_sha256': recovery.digest(recovery.read_owned(recovery.TOOL, private=False)),
                 'source_ci_sha256': recovery.digest(encode(source_ci)), 'word': word,
                 'original_running': {s: r['State']['Status'] == 'running' for s, r in records.items()},
                 'container_ids': {s: r['Id'] for s, r in records.items()}}
        for name, body in bodies.items():
            recovery.atomic_bytes(recovery.RUNTIME_DIR / name, body)
        recovery.atomic_bytes(recovery.RUNTIME_DIR / 'source-ci.json', encode(source_ci))
        recovery.atomic_json(recovery.RUNTIME_DIR / 'stage.json', stage)
        recovery.atomic_json(recovery.RUNTIME_DIR / 'component.json',
                             {'mode': 'web' if backend_sha else 'full', 'backend_sha': backend_sha,
                              'stage_sha256': recovery.digest(encode(stage)),
                              'tools_sha256': self._web_toolchain(),
                              'backend_runtime': self._backend_runtime(records) if backend_sha else None})
        return {'state': 'RELEASE_CONFIGURATION_STAGED'}

    def deploy_web(self):
        recovery.require_lock(self.executor.lock_fd)
        self._idle()
        stage = json.loads(recovery.read_owned(recovery.RUNTIME_DIR / 'stage.json'))
        component = json.loads(recovery.read_owned(recovery.RUNTIME_DIR / 'component.json'))
        if (component.get('mode') != 'web' or component.get('stage_sha256') != recovery.digest(
                json.dumps(stage, sort_keys=True, allow_nan=False).encode())
                # Check installed tool bytes before executing the mutable source-CI gate.
                # Changed or malformed trusted code must refuse component reuse.
                or not self._web_toolchain_matches(component.get('tools_sha256'))
                or stage['tool_sha256'] != recovery.digest(recovery.read_owned(recovery.TOOL, private=False))
                or self._web_source(stage['images'], stage['release_sha']) != component.get('backend_sha')
                or self._source(stage) != stage['source_ci_sha256']):
            recovery.fail('RELEASE_WEB_COMPATIBILITY_CHANGED')
        self._images(stage)
        records = self.executor._records(stage, original=True)
        self._saved_runtime(stage, records)
        # A Docker process can restart in-place while its container ID stays
        # unchanged. Do not mistake that for a component-safe no-restart release.
        if component.get('backend_runtime') != self._backend_runtime(records):
            recovery.fail('RELEASE_WEB_BACKEND_CHANGED')
        plan = {**stage, 'format': 'aemr-web-release-v1', 'backend_sha': component['backend_sha'],
                'backend_runtime': component['backend_runtime']}
        self.executor.web_config(plan)
        self.executor.web_unchanged(plan, records)
        recovery.atomic_json(recovery.PENDING, plan)
        try:
            self.executor.web_start(plan, candidate=True)
            self.executor.web_verify(plan, candidate=True)
            if component['backend_runtime'] != self._backend_runtime(self.executor._records(plan, candidate=True)):
                recovery.fail('RELEASE_WEB_BACKEND_CHANGED')
            plan_hash = recovery.digest(json.dumps(plan, sort_keys=True).encode())
            recovery.atomic_json(recovery.STATE_DIR / 'web-release-accepted.json', {'plan_sha256': plan_hash})
            return self.executor.recover()
        except Exception:  # noqa: BLE001 - durable recovery also handles interrupted activation
            self.executor.recover()
            recovery.fail('RELEASE_WEB_REJECTED_AND_RECOVERED')

    def base_plan(self, run_id):
        """Read the guardian's frozen backup; prepare later owns the actual EX."""
        self._idle()
        if not isinstance(run_id, str) or not re.fullmatch('[0-9]+', run_id):
            recovery.fail('RELEASE_BACKUP_SESSION_INVALID')
        stage = json.loads(recovery.read_owned(recovery.RUNTIME_DIR / 'stage.json'))
        keys = {'format', 'release_sha', 'images', 'candidate_images', 'volume', 'config_sha256', 'tool_sha256',
                'source_ci_sha256', 'word', 'original_running', 'container_ids'}
        if not isinstance(stage, dict) or set(stage) != keys or stage['format'] != 'aemr-release-stage-v1':
            recovery.fail('RELEASE_STAGE_INVALID')
        session = recovery.BACKUP_BASE / ('worker-' + run_id)
        if any(p.is_symlink() for p in (session, *session.parents)):
            recovery.fail('RELEASE_BACKUP_SESSION_INVALID')
        recovery.private_directory(recovery.BACKUP_BASE)
        recovery.private_directory(session)
        captured = json.loads(recovery.read_owned(session / 'runtime.json'))
        if (captured.get('candidate') != stage['release_sha'] or captured.get('volume') != stage['volume']
                or captured.get('image') != stage['images']['server'] or captured.get('worker_image') != stage['images']['report-worker']
                or captured.get('server') != stage['container_ids']['server'] or captured.get('worker') != stage['container_ids']['report-worker']
                or captured.get('worker_was_running') is not stage['original_running']['report-worker']
                or captured.get('authorized_quiesce') is not True or captured.get('release_controller') is not True):
            recovery.fail('RELEASE_BACKUP_SESSION_INVALID')
        backup = session / 'backup'
        if any(p.is_symlink() for p in (backup, *backup.parents)):
            recovery.fail('RELEASE_BACKUP_UNSAFE')
        manifest = recovery.read_owned(backup / 'manifest.json', 128 * 1024 * 1024)
        plan = {k: stage[k] for k in ('release_sha', 'images', 'candidate_images', 'volume', 'config_sha256', 'tool_sha256', 'word', 'original_running')}
        plan.update(format='aemr-release-recovery-v1', backup_reference='worker-' + run_id + '/backup', manifest_sha256=recovery.digest(manifest))
        bound = {k: plan[k] for k in ('release_sha', 'manifest_sha256', 'images', 'config_sha256')}
        # Structural labels only: prepare and independent actual trial still gate deploy.
        plan['proofs'] = {name: {**bound, 'state': state} for name, state in recovery.PROOF_STATES.items()}
        recovery.validate_plan(plan)
        if self._source(plan) != stage['source_ci_sha256']:
            recovery.fail('RELEASE_SOURCE_CI_INVALID')
        self.executor._files(plan)
        self._images(plan)
        records = self.executor._records(plan, original=True)
        self._saved_runtime(plan, records)
        if (any(records[s]['State']['Status'] not in {'exited', 'created'} for s in ('server', 'report-worker'))
                or any(records[s]['Id'] != stage['container_ids'][s] for s in recovery.SERVICES)):
            recovery.fail('RELEASE_BACKUP_SESSION_INVALID')
        recovery.atomic_json(recovery.RUNTIME_DIR / 'base-plan.json', plan)
        return {'state': 'RELEASE_BASE_PLAN_CREATED'}

    def prepare(self, plan):
        recovery.require_lock(self.executor.lock_fd)
        plan = recovery.validate_plan(plan)
        self._source(plan)
        backup, _ = self.executor._files(plan)
        self._images(plan)
        records = self.executor._records(plan, original=True)
        self._saved_runtime(plan, records)
        if any(records[s]['State']['Status'] not in {'exited', 'created'} for s in ('server', 'report-worker')):
            recovery.fail('RELEASE_WRITER_NOT_QUIESCENT')
        self.executor._no_volume_writers(plan)
        self.executor._tool(plan, backup, 'match-source')
        recovery.atomic_json(recovery.RUNTIME_DIR / 'trial-plan.json', plan)
        return {'state': 'RELEASE_TRIAL_PREPARED'}

    def _proof(self, plan):
        proof = json.loads(recovery.read_owned(recovery.RUNTIME_DIR / 'trial-proof.json'))
        binding = {key: plan[key] for key in ('release_sha', 'manifest_sha256', 'images', 'candidate_images',
                                             'config_sha256', 'tool_sha256')}
        expected = {**binding, 'state': 'TRUSTED_RELEASE_TRIAL_PASS',
                    'plan_sha256': recovery.digest(json.dumps(plan, sort_keys=True, separators=(',', ':')).encode()),
                    'source_ci_sha256': self._source(plan),
                    'trial_module_sha256': trial.module_digest(trial.__file__),
                    'recovery_module_sha256': trial.module_digest(recovery.__file__),
                    'native_program_sha256': recovery.digest(trial.NATIVE_PROGRAM.encode()),
                    'candidate_native': 'CANDIDATE_TRIAL_PASS', 'previous_native': 'PREVIOUS_TRIAL_PASS'}
        if (not isinstance(proof, dict) or set(proof) != set(expected) | {'full_restore', 'in_place_restore'}
                or any(proof[key] != value for key, value in expected.items())):
            recovery.fail('RELEASE_TRIAL_PROOF_INVALID')
        for key in ('full_restore', 'in_place_restore'):
            value = recovery.validate_restore_proof(proof[key])
            if value['manifest_sha256'] != plan['manifest_sha256']:
                recovery.fail('RELEASE_TRIAL_PROOF_INVALID')
        if proof['full_restore'] != proof['in_place_restore']:
            recovery.fail('RELEASE_TRIAL_PROOF_INVALID')
        # Actual independent trial replaces incoming labels; cannot deploy from labels alone.
        bound = {key: plan[key] for key in ('release_sha', 'manifest_sha256', 'images', 'config_sha256')}
        plan['proofs'] = {name: {**bound, 'state': state} for name, state in recovery.PROOF_STATES.items()}
        return recovery.validate_plan(plan)

    def _retire_previous_checkpoint(self,plan):
        """Retire only after deploy() verifies the exact independent replacement trial."""
        import hashlib
        import shutil
        r=recovery
        executor=self.executor
        r.require_lock(executor.lock_fd)
        binding=r.RUNTIME_DIR/'previous-checkpoint.json'
        if not os.path.lexists(binding):return
        if any(os.path.lexists(r.STATE_DIR/name) for name in ('pending-release.json','release-recovery-progress.json')):
            raise ValueError('CHECKPOINT_RELEASE_ALREADY_ARMED')
        records=executor._records(plan,original=True)
        stage=json.loads(r.read_owned(r.RUNTIME_DIR/'stage.json'))
        if ({s:value['Id'] for s,value in records.items()}!=stage['container_ids']
                or any(records[s]['State']['Status'] not in {'exited','created'} for s in ('server','report-worker'))):
            raise ValueError('CHECKPOINT_WRITER_ACTIVE')
        executor._no_volume_writers(plan)
        fresh,_=executor._files(plan)
        try:new_manifest,files,total=executor.backup_tool._validated_backup(fresh)
        except executor.backup_tool.BackupError as error:raise ValueError('CHECKPOINT_REPLACEMENT_INVALID') from error
        if new_manifest['format']!=2:raise ValueError('CHECKPOINT_FORMAT_INVALID')
        previous=json.loads(r.read_owned(binding))
        if (set(previous)!={'backup_reference','manifest_sha256'}
                or not re.fullmatch(r'worker-[0-9]+/backup',previous['backup_reference'])
                or not re.fullmatch('[a-f0-9]{64}',previous['manifest_sha256'])
                or previous['backup_reference']==plan['backup_reference']):
            raise ValueError('CHECKPOINT_PREVIOUS_INVALID')
        old=r.BACKUP_BASE/previous['backup_reference']
        if any(p.is_symlink() for p in (old,*old.parents)):raise ValueError('CHECKPOINT_PATH_UNSAFE')
        for directory in (r.BACKUP_BASE,old.parent,old):r.private_directory(directory)
        body=r.read_owned(old/'manifest.json',limit=16*1024**2)
        if r.digest(body)!=previous['manifest_sha256']:raise ValueError('CHECKPOINT_PREVIOUS_CHANGED')
        manifest=json.loads(body)
        if manifest.get('format')!=2 or type(manifest.get('archive_bytes')) is not int:
            raise ValueError('CHECKPOINT_FORMAT_INVALID')
        expected={'state':'SUPERSEDED_ARCHIVE_RETIRED','retained_backup':plan['backup_reference'],
                  'retained_manifest_sha256':plan['manifest_sha256'],
                  'removed_bytes':manifest['archive_bytes'],'removed_sha256':manifest['archive_sha256']}
        archive=old/'state.tar.gz';receipt=old/'superseded-retirement.json'
        source=executor._volume(plan)
        # Keep the installed conservative restore admission unchanged: shared inodes
        # contribute zero here. A proven fresh backup must STILL fit full flat restore.
        reclaimable=0
        for relative in files:
            path=source/relative
            if path.is_symlink() or path.is_mount() or path.stat().st_dev!=source.stat().st_dev:
                raise ValueError('CHECKPOINT_SOURCE_UNSAFE')
            info=path.stat()
            if not relative.endswith('/') and info.st_nlink==1:reclaimable+=info.st_blocks*512
        released=0
        if os.path.lexists(archive):
            with os.fdopen(os.open(archive,os.O_RDONLY|os.O_NOFOLLOW),'rb') as file:
                info=os.fstat(file.fileno())
                if (not stat.S_ISREG(info.st_mode) or info.st_uid!=0 or info.st_nlink!=1
                        or info.st_dev!=source.stat().st_dev
                        or stat.S_IMODE(info.st_mode)!=0o600 or info.st_size!=manifest['archive_bytes']
                        or hashlib.file_digest(file,'sha256').hexdigest()!=manifest['archive_sha256']):
                    raise ValueError('CHECKPOINT_ARCHIVE_CHANGED')
            released=info.st_blocks*512
            if shutil.disk_usage(source).free+released+reclaimable<total+128*1024**2:
                raise ValueError('CHECKPOINT_RESTORE_CAPACITY_INSUFFICIENT')
            if os.path.lexists(receipt):
                if json.loads(r.read_owned(receipt))!=expected:raise ValueError('CHECKPOINT_RECEIPT_CHANGED')
            else:r.atomic_json(receipt,expected)
            current=archive.lstat()
            if any(getattr(current,k)!=getattr(info,k) for k in
                   ('st_dev','st_ino','st_mode','st_uid','st_gid','st_size','st_nlink','st_mtime_ns','st_ctime_ns')):
                raise ValueError('CHECKPOINT_ARCHIVE_CHANGED')
            archive.unlink();r.fsync_directory(old)
        elif json.loads(r.read_owned(receipt))!=expected:
            raise ValueError('CHECKPOINT_RECEIPT_CHANGED')
        if shutil.disk_usage(source).free+reclaimable<total+128*1024**2:
            raise ValueError('CHECKPOINT_RESTORE_CAPACITY_INSUFFICIENT')
        print('FRESH_FULL_TRIAL_BACKUP_RETAINED_SUPERSEDED_ARCHIVE_RETIRED_ROLLBACK_CAPACITY_PASS',flush=True)

    def deploy(self):
        recovery.require_lock(self.executor.lock_fd)
        plan = recovery.validate_plan(json.loads(recovery.read_owned(recovery.RUNTIME_DIR / 'trial-plan.json')))
        plan = self._proof(plan)
        self._images(plan)
        _backup, candidate = self.executor._files(plan, candidate_runtime=True)
        records = self.executor._records(plan, original=True)
        self._saved_runtime(plan, records)
        if any(records[s]['State']['Status'] not in {'exited', 'created'} for s in ('server', 'report-worker')):
            recovery.fail('RELEASE_WRITER_NOT_QUIESCENT')
        self.executor._no_volume_writers(plan)
        # arm performs exact source admission under the SAME actual EX owner;
        # all pre-arm failures leave backup guardian responsible for original API.
        service = candidate['services']['server']
        if (service.get('command') not in (None, ['./node_modules/.bin/tsx', 'src/index.ts'])
                or service.get('entrypoint')):
            recovery.fail('RELEASE_CANDIDATE_STARTUP_INVALID')
        self._retire_previous_checkpoint(plan)
        self.executor.arm(plan)
        try:
            # Candidate index.ts owns native reader initialization before API listen.
            path = recovery.RUNTIME_DIR / 'candidate-resume.json'
            recovery.atomic_json(path, candidate)
            prefix = ['compose', '-p', 'aemr', '-f', str(path), '--env-file',
                      str(recovery.RUNTIME_DIR / '.env.production'), '--profile', 'reports']
            self.executor.command([*prefix, 'up', '--no-start', '--no-build', '--no-deps', '--force-recreate',
                                   *recovery.SERVICES], timeout=180)
            # Neither scheduler nor ingress starts before ACCEPT is durable.
            self.executor.command([*prefix, 'up', '-d', '--no-build', '--no-deps', 'server',
                                   *(['web'] if plan['original_running']['web'] else [])], timeout=180)
            self.executor.accept()
            return self.executor.recover()
        except Exception:  # noqa: BLE001 - recovery never echoes private candidate errors
            self.executor.recover()
            recovery.fail('RELEASE_CANDIDATE_REJECTED_AND_RECOVERED')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('stage', 'base-plan', 'prepare', 'deploy', 'deploy-web'))
    parser.add_argument('run_id', nargs='?')
    args = parser.parse_args(argv)
    try:
        # base-plan reads the guardian's frozen checkpoint over another SSH
        # connection. It owns no EX descriptor; prepare/deploy still require it.
        controller = ReleaseController(recovery.ReleaseRecovery(lock_fd=None) if args.mode == 'base-plan' else None)
        if (args.mode == 'base-plan') != (args.run_id is not None):
            recovery.fail('RELEASE_STAGE_INPUT_INVALID')
        if args.mode in ('stage', 'prepare'):
            body = sys.stdin.buffer.read(65537)
            if len(body) > 65536:
                recovery.fail('RELEASE_RECEIPT_INVALID')
            result = getattr(controller, args.mode)(json.loads(body))
        elif args.mode == 'base-plan':
            result = controller.base_plan(args.run_id)
        elif args.mode == 'deploy-web':
            result = controller.deploy_web()
        else:
            result = controller.deploy()
        print(result['state'])
        return 0
    except Exception as error:  # noqa: BLE001 - fixed-code boundary for all private inputs
        print(str(error) if isinstance(error, recovery.RecoveryError) else 'RELEASE_CONTROLLER_FAILED', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

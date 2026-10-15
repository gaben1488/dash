#!/usr/bin/env python3
"""Trusted release producer. Only fixed private paths and actual maintenance EX."""
import argparse
import json
import os
import re
import shlex
import stat
import sys
import types
from pathlib import Path

import release_recovery as recovery
import release_trial as trial

SOURCE_GATE = trial.SOURCE_GATE
OPERATOR = Path('/home/aemr/dash/deploy')
REVIEWED_COMPOSE = Path('/usr/local/libexec/aemr/reviewed-docker-compose.yml')
REVIEWED_CADDY = Path('/usr/local/libexec/aemr/reviewed-Caddyfile')
CAPTURE_WORD = """import hashlib,io,json,os,re,urllib.request,zipfile
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
latest=json.loads(get('/api/report-releases')).get('latest')
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

    def _images(self, plan):
        for image in set(plan['images'].values()) | set(plan['candidate_images'].values()):
            if json.loads(self.executor.command(['image', 'inspect', image]))[0].get('Id') != image:
                recovery.fail('RELEASE_IMAGE_UNAVAILABLE')

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
        word = json.loads(self.executor.command(['exec', 'aemr-server-1', 'python3', '-c', CAPTURE_WORD], timeout=150))
        if (not isinstance(word, dict) or set(word) != {'release_id', 'sha256'}
                or not isinstance(word['release_id'], str) or not re.fullmatch('REL-[a-f0-9]{64}', word['release_id'])
                or not isinstance(word['sha256'], dict) or set(word['sha256']) != {'main', 'supplement', 'operational'}
                or any(not isinstance(v, str) or not recovery.HEX.fullmatch(v) for v in word['sha256'].values())):
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
        return {'state': 'RELEASE_CONFIGURATION_STAGED'}

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
    parser.add_argument('mode', choices=('stage', 'base-plan', 'prepare', 'deploy'))
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
        else:
            result = controller.deploy()
        print(result['state'])
        return 0
    except Exception as error:  # noqa: BLE001 - fixed-code boundary for all private inputs
        print(str(error) if isinstance(error, recovery.RecoveryError) else 'RELEASE_CONTROLLER_FAILED', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

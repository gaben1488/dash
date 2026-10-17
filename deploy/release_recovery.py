#!/usr/bin/env python3
"""Explicit release checkpoint recovery; ordinary report failures never arm it.

The trusted controller must provide independently verified, digest-bound proofs.
No proof is manufactured here. Both arming and recovery require the actual host
maintenance EX lock. Production paths are fixed; receipts contain no commands.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import time
import types
import uuid
from pathlib import Path

STATE_DIR = Path('/var/lib/aemr')
RUNTIME_DIR = STATE_DIR / 'release-runtime'
PENDING = STATE_DIR / 'pending-release.json'
BACKUP_BASE = Path('/home/aemr/.dash-private-backups')
TOOL = Path('/usr/local/libexec/aemr/stateful_backup.py')
LOCK = Path('/run/lock/aemr-maintenance.lock')
VOLUME_BASE = Path('/var/lib/docker/volumes')
SERVICES = ('server', 'web', 'report-worker', 'caddy')
CONFIG_FILES = ('compose.json', '.env.production', 'Caddyfile', 'candidate-compose.json', 'candidate-Caddyfile')
PROOF_STATES = {'full_restore': 'VERIFIED_IN_SCRATCH', 'in_place_restore': 'STATE_RESTORED',
                'previous_runtime': 'PREVIOUS_RUNTIME_COMPATIBLE'}
HEX = re.compile('[a-f0-9]{64}')
IMAGE = re.compile('sha256:[a-f0-9]{64}')


class RecoveryError(Exception):
    """Fixed public code only; never expose configuration, source or Docker stderr."""


def fail(code):
    raise RecoveryError(code)


def digest(body):
    return hashlib.sha256(body).hexdigest()


def private_directory(path):
    value = path.lstat()
    if not stat.S_ISDIR(value.st_mode) or value.st_uid != 0 or stat.S_IMODE(value.st_mode) != 0o700:
        fail('RELEASE_PRIVATE_DIRECTORY_INVALID')


def read_owned(path, limit=1024 * 1024, *, private=True):
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as file:
        value = os.fstat(file.fileno())
        mode = stat.S_IMODE(value.st_mode)
        if (not stat.S_ISREG(value.st_mode) or value.st_uid != 0 or value.st_nlink != 1
                or (mode != 0o600 if private else mode & 0o022) or value.st_size > limit):
            fail('RELEASE_OWNED_FILE_INVALID')
        body = file.read(limit + 1)
        if len(body) > limit:
            fail('RELEASE_OWNED_FILE_INVALID')
        return body


def atomic_bytes(path, body):
    private_directory(path.parent)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as file:
            file.write(body)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
        fsync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_json(path, value):
    atomic_bytes(path, json.dumps(value, sort_keys=True, allow_nan=False).encode())


def fsync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def require_lock(fd):
    if os.geteuid() != 0:
        fail('RELEASE_ROOT_REQUIRED')
    target, held = LOCK.lstat(), os.fstat(fd)
    if (not stat.S_ISREG(target.st_mode) or target.st_uid != 0 or stat.S_IMODE(target.st_mode) != 0o600
            or target.st_nlink != 1 or (target.st_dev, target.st_ino) != (held.st_dev, held.st_ino)):
        fail('RELEASE_LOCK_REQUIRED')
    found = False
    for line in Path(f'/proc/self/fdinfo/{fd}').read_text().splitlines():
        fields = line.split()
        if fields and fields[0] == 'lock:':
            fields = fields[1:]
        if len(fields) == 8 and fields[1:4] == ['FLOCK', 'ADVISORY', 'WRITE']:
            major, minor, inode = fields[5].split(':')
            found |= (int(major, 16), int(minor, 16), int(inode)) == (
                os.major(held.st_dev), os.minor(held.st_dev), held.st_ino)
    if not found:
        fail('RELEASE_LOCK_REQUIRED')


def validate_plan(plan):
    keys = {'format', 'release_sha', 'manifest_sha256', 'images', 'candidate_images', 'config_sha256',
            'backup_reference', 'volume', 'tool_sha256', 'original_running', 'word', 'proofs'}
    if not isinstance(plan, dict) or set(plan) != keys or plan['format'] != 'aemr-release-recovery-v1':
        fail('RELEASE_RECEIPT_INVALID')
    if not isinstance(plan['release_sha'], str) or not re.fullmatch('[a-f0-9]{40}', plan['release_sha']):
        fail('RELEASE_RECEIPT_INVALID')
    for key in ('manifest_sha256', 'tool_sha256'):
        if not isinstance(plan[key], str) or not HEX.fullmatch(plan[key]):
            fail('RELEASE_RECEIPT_INVALID')
    for key in ('images', 'candidate_images'):
        if (not isinstance(plan[key], dict) or set(plan[key]) != set(SERVICES)
                or any(not isinstance(value, str) or not IMAGE.fullmatch(value) for value in plan[key].values())):
            fail('RELEASE_RECEIPT_INVALID')
    if (not isinstance(plan['config_sha256'], dict) or set(plan['config_sha256']) != set(CONFIG_FILES)
            or any(not isinstance(value, str) or not HEX.fullmatch(value) for value in plan['config_sha256'].values())):
        fail('RELEASE_RECEIPT_INVALID')
    if (not isinstance(plan['original_running'], dict) or set(plan['original_running']) != set(SERVICES)
            or any(type(value) is not bool for value in plan['original_running'].values())):
        fail('RELEASE_RECEIPT_INVALID')
    if plan['original_running']['server'] is not True:
        fail('RELEASE_RECEIPT_INVALID')
    if (not isinstance(plan['backup_reference'], str)
            or not re.fullmatch(r'worker-[0-9]+/(?:backup|release-[a-f0-9]{40}-[0-9]+-[0-9]+)', plan['backup_reference'])
            or not isinstance(plan['volume'], str) or not re.fullmatch(r'aemr_[A-Za-z0-9_.-]+', plan['volume'])):
        fail('RELEASE_RECEIPT_INVALID')
    word = plan['word']
    if (not isinstance(word, dict) or set(word) != {'release_id', 'sha256'}
            or not isinstance(word['release_id'], str) or not re.fullmatch('REL-[a-f0-9]{64}', word['release_id'])
            or not isinstance(word['sha256'], dict) or set(word['sha256']) != {'main', 'supplement', 'operational'}
            or any(not isinstance(value, str) or not HEX.fullmatch(value) for value in word['sha256'].values())):
        fail('RELEASE_RECEIPT_INVALID')
    binding = {key: plan[key] for key in ('release_sha', 'manifest_sha256', 'images', 'config_sha256')}
    if not isinstance(plan['proofs'], dict) or set(plan['proofs']) != set(PROOF_STATES):
        fail('RELEASE_PROOF_INVALID')
    for name, state in PROOF_STATES.items():
        if plan['proofs'][name] != {**binding, 'state': state}:
            fail('RELEASE_PROOF_INVALID')
    return plan


def validate_restore_proof(value):
    if (not isinstance(value, dict)
            or set(value) != {'state', 'files', 'bytes', 'sqlite_checked', 'docx_checked', 'manifest_sha256'}
            or value['state'] != 'STATE_RESTORED'
            or not isinstance(value['manifest_sha256'], str) or not HEX.fullmatch(value['manifest_sha256'])
            or any(type(value[key]) is not int or value[key] < 0
                   for key in ('files', 'bytes', 'sqlite_checked', 'docx_checked'))):
        fail('RELEASE_PROGRESS_INVALID')
    return value


def validate_acceptance(value):
    keys = {'state', 'release_sha', 'manifest_sha256', 'candidate_images', 'config_sha256', 'word_sha256'}
    if (not isinstance(value, dict) or set(value) != keys or value['state'] != 'RELEASE_CANDIDATE_ACCEPTED'
            or not isinstance(value['release_sha'], str) or not re.fullmatch('[a-f0-9]{40}', value['release_sha'])
            or not isinstance(value['manifest_sha256'], str) or not HEX.fullmatch(value['manifest_sha256'])
            or not isinstance(value['candidate_images'], dict) or set(value['candidate_images']) != set(SERVICES)
            or any(not isinstance(v, str) or not IMAGE.fullmatch(v) for v in value['candidate_images'].values())
            or not isinstance(value['config_sha256'], dict) or set(value['config_sha256']) != set(CONFIG_FILES)
            or any(not isinstance(v, str) or not HEX.fullmatch(v) for v in value['config_sha256'].values())
            or not isinstance(value['word_sha256'], dict) or set(value['word_sha256']) != {'main', 'supplement', 'operational'}
            or any(not isinstance(v, str) or not HEX.fullmatch(v) for v in value['word_sha256'].values())):
        fail('RELEASE_ACCEPTANCE_INVALID')
    return value


def validate_progress(value):
    if isinstance(value, dict) and value.get('phase') == 'candidate_accept':
        if (set(value) != {'plan_sha256', 'phase', 'acceptance'}
                or not isinstance(value['plan_sha256'], str) or not HEX.fullmatch(value['plan_sha256'])):
            fail('RELEASE_PROGRESS_INVALID')
        validate_acceptance(value['acceptance'])
        return value
    if (not isinstance(value, dict) or set(value) != {'plan_sha256', 'phase', 'restored'}
            or value['phase'] != 'runtime_resume'
            or not isinstance(value['plan_sha256'], str) or not HEX.fullmatch(value['plan_sha256'])):
        fail('RELEASE_PROGRESS_INVALID')
    validate_restore_proof(value['restored'])
    return value


def validate_completed(value):
    if (not isinstance(value, dict)
            or set(value) != {'state', 'plan_sha256', 'release_sha', 'manifest_sha256', 'restored'}
            or value['state'] != 'RELEASE_RUNTIME_AND_STATE_RECOVERED'
            or not isinstance(value['release_sha'], str) or not re.fullmatch('[a-f0-9]{40}', value['release_sha'])
            or any(not isinstance(value[key], str) or not HEX.fullmatch(value[key])
                   for key in ('plan_sha256', 'manifest_sha256'))):
        fail('RELEASE_PROGRESS_INVALID')
    validate_restore_proof(value['restored'])
    if value['manifest_sha256'] != value['restored']['manifest_sha256']:
        fail('RELEASE_PROGRESS_INVALID')
    return value


def docker(args, *, timeout=90, input=None, lock_fd=None):
    result = subprocess.run(['/usr/bin/docker', *args], capture_output=True, text=True,
                            timeout=timeout, check=False, close_fds=True, input=input,
                            pass_fds=() if lock_fd is None else (lock_fd,),
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'DOCKER_CONFIG': '/etc/aemr/docker'})
    if result.returncode:
        fail('RELEASE_COMMAND_FAILED')
    return result.stdout


def literal(value):
    """Resolved config values must not be re-interpolated with a new environment."""
    if isinstance(value, str):
        return value.replace('$', '$$')
    if isinstance(value, list):
        return [literal(item) for item in value]
    if isinstance(value, dict):
        return {key: literal(item) for key, item in value.items()}
    return value


class ReleaseRecovery:
    def __init__(self, command=None, *, lock_fd=9, sleep=time.sleep):
        self.lock_fd, self.sleep = lock_fd, sleep
        # Live CLI children retain this EXACT open file description after owner
        # death. Independent scratch trial injects its command explicitly.
        self.command = command or (lambda args, **kwargs: docker(args, lock_fd=self.lock_fd, **kwargs))
        self.backup_tool = None

    def _volume(self, plan):
        record = json.loads(self.command(['volume', 'inspect', plan['volume']]))[0]
        source = VOLUME_BASE / plan['volume'] / '_data'
        labels = record.get('Labels') or {}
        if (record.get('Name') != plan['volume'] or record.get('Driver') != 'local'
                or record.get('Options') or record.get('Mountpoint') != str(source)
                or labels.get('com.docker.compose.project') != 'aemr'
                or labels.get('com.docker.compose.volume') != 'server_data'
                or not source.is_dir() or any(p.is_symlink() for p in (source, *source.parents))):
            fail('RELEASE_VOLUME_NOT_OWNED')
        return source

    def _files(self, plan, *, candidate_runtime=False):
        private_directory(STATE_DIR)
        private_directory(RUNTIME_DIR)
        config = {}
        candidate = {}
        for name in CONFIG_FILES:
            body = read_owned(RUNTIME_DIR / name)
            if digest(body) != plan['config_sha256'][name]:
                fail('RELEASE_CONFIG_CHANGED')
            if name == 'compose.json':
                config = json.loads(body)
            elif name == 'candidate-compose.json':
                candidate = json.loads(body)
        tool = read_owned(TOOL, private=False)
        if digest(tool) != plan['tool_sha256']:
            fail('RELEASE_TOOL_CHANGED')
        self.backup_tool = types.ModuleType('aemr_verified_stateful_backup')
        self.backup_tool.__file__ = str(TOOL)
        exec(compile(tool, str(TOOL), 'exec'), self.backup_tool.__dict__)  # noqa: S102 - root-owned SHA-bound stdlib helper
        backup = BACKUP_BASE / plan['backup_reference']
        if any(path.is_symlink() for path in (backup, *backup.parents)):
            fail('RELEASE_BACKUP_UNSAFE')
        manifest_body = (backup / 'manifest.json').read_bytes()
        if digest(manifest_body) != plan['manifest_sha256']:
            fail('RELEASE_CHECKPOINT_CHANGED')
        manifest = json.loads(manifest_body)
        names = {'main': 'main_report.docx', 'supplement': 'management_report.docx', 'operational': 'operational_report.docx'}
        for view, name in names.items():
            key = f'reports/published/releases/{plan["word"]["release_id"]}/{name}'
            if manifest.get('files', {}).get(key, {}).get('sha256') != plan['word']['sha256'][view]:
                fail('RELEASE_WORD_PROOF_INVALID')
        if (not isinstance(config, dict) or config.get('name') != 'aemr'
                or set(config.get('services', {})) != set(SERVICES)):
            fail('RELEASE_CONFIG_INVALID')
        if (not isinstance(candidate, dict) or candidate.get('name') != 'aemr'
                or set(candidate.get('services', {})) != set(SERVICES)):
            fail('RELEASE_CONFIG_INVALID')
        for resolved in (config, candidate):
            volumes = resolved.get('volumes', {})
            if not isinstance(volumes, dict) or 'server_data' not in volumes:
                fail('RELEASE_CONFIG_INVALID')
            volume = volumes['server_data']
            volume = {} if volume is None else volume
            if (not isinstance(volume, dict)
                    or volume.get('name', 'aemr_server_data') != plan['volume']
                    or volume.get('driver', 'local') != 'local'
                    or volume.get('driver_opts')
                    or type(volume.get('external', False)) is not bool):
                fail('RELEASE_CONFIG_INVALID')
            for service in ('server', 'report-worker'):
                mounts = resolved['services'][service].get('volumes', [])
                if not isinstance(mounts, list):
                    fail('RELEASE_CONFIG_INVALID')
                data_mounts = []
                for mount in mounts:
                    if not isinstance(mount, dict):
                        fail('RELEASE_CONFIG_INVALID')
                    target = mount.get('target')
                    if not isinstance(target, str) or not target.startswith('/'):
                        fail('RELEASE_CONFIG_INVALID')
                    target_path = Path(target)
                    data_path = Path('/app/packages/server/data')
                    if target_path == data_path or target_path in data_path.parents or data_path in target_path.parents:
                        data_mounts.append(mount)
                if (len(data_mounts) != 1 or data_mounts[0].get('type') != 'volume'
                        or data_mounts[0].get('source') != 'server_data'
                        or data_mounts[0].get('target') != str(data_path)
                        or data_mounts[0].get('read_only')
                        or data_mounts[0].get('volume', {}).get('subpath')):
                    fail('RELEASE_CONFIG_INVALID')
        for service, item in candidate['services'].items():
            if (not isinstance(item, dict) or item.get('network_mode') is not None
                    or (service != 'caddy' and item.get('ports'))
                    or item.get('privileged') or item.get('pid') == 'host'):
                fail('RELEASE_CONFIG_INVALID')
            if service in ('server', 'report-worker') and not any(
                    isinstance(mount, dict) and mount.get('type') == 'volume'
                    and mount.get('source') == 'server_data'
                    and mount.get('target') == '/app/packages/server/data'
                    for mount in item.get('volumes', [])):
                fail('RELEASE_CONFIG_INVALID')
        if candidate_runtime:
            config = candidate
        for service, item in config['services'].items():
            if (not isinstance(item, dict) or item.get('container_name', f'aemr-{service}-1') != f'aemr-{service}-1'
                    or item.get('network_mode') is not None or (service != 'caddy' and item.get('ports'))):
                fail('RELEASE_CONFIG_INVALID')
            item['container_name'] = f'aemr-{service}-1'
            item['image'] = plan['candidate_images' if candidate_runtime else 'images'][service]
            item.pop('build', None)
            item.pop('env_file', None)  # --environment must already be resolved in saved config.
            item['pull_policy'] = 'never'
            for mount in item.get('volumes', []):
                if mount.get('type') == 'bind':
                    if service != 'caddy' or mount.get('target') != '/etc/caddy/Caddyfile':
                        fail('RELEASE_CONFIG_INVALID')
                    name = 'candidate-Caddyfile' if candidate_runtime else 'Caddyfile'
                    # A later stage may replace the mutable input files. Existing
                    # live binds retain immutable, SHA-scoped bytes across stages.
                    directory = STATE_DIR / 'release-configs'
                    for path in (directory, directory / plan['release_sha']):
                        if not path.exists() and not path.is_symlink():
                            path.mkdir(mode=0o700)
                        private_directory(path)
                    destination = directory / plan['release_sha'] / name
                    body = read_owned(RUNTIME_DIR / name)
                    if destination.exists() or destination.is_symlink():
                        if read_owned(destination) != body:
                            fail('RELEASE_CADDY_CAPSULE_CHANGED')
                    else:
                        atomic_bytes(destination, body)
                    mount['source'] = str(destination)
                    mount['read_only'] = True
            if service in ('server', 'report-worker') and not any(
                    mount.get('type') == 'volume' and mount.get('source') == 'server_data'
                    and mount.get('target') == '/app/packages/server/data' for mount in item.get('volumes', [])):
                fail('RELEASE_CONFIG_INVALID')
        config.setdefault('volumes', {})['server_data'] = {'name': plan['volume'], 'external': True}
        return backup, literal(config)

    @staticmethod
    def _owned_record(plan, service, record, *, original=False, candidate=False):
        labels = record.get('Config', {}).get('Labels', {}) or {}
        if (labels.get('com.docker.compose.project') != 'aemr'
                or labels.get('com.docker.compose.service') != service
                or str(labels.get('com.docker.compose.oneoff', 'false')).lower() != 'false'
                or record.get('Image') not in {plan['images'][service], plan['candidate_images'][service]}
                or (original and record.get('Image') != plan['images'][service])
                or (candidate and record.get('Image') != plan['candidate_images'][service])):
            fail('RELEASE_RUNTIME_NOT_OWNED')
        if service in ('server', 'report-worker') and not any(
                mount.get('Type') == 'volume' and mount.get('Name') == plan['volume']
                and mount.get('Destination') == '/app/packages/server/data' for mount in record.get('Mounts', [])):
            fail('RELEASE_RUNTIME_NOT_OWNED')

    def _records(self, plan, *, original=False, candidate=False):
        records = {}
        for service in SERVICES:
            name = f'aemr-{service}-1'
            record = json.loads(self.command(['inspect', name]))[0]
            self._owned_record(plan, service, record, original=original, candidate=candidate)
            if record.get('Name') != '/' + name:
                fail('RELEASE_RUNTIME_NOT_OWNED')
            ids = self.command(['ps', '--all', '--quiet', '--no-trunc', '--filter', 'label=com.docker.compose.project=aemr',
                                '--filter', f'label=com.docker.compose.service={service}', '--filter', 'label=com.docker.compose.oneoff=False']).split()
            if ids != [record['Id']]:
                fail('RELEASE_RUNTIME_NOT_OWNED')
            records[service] = record
        return records

    def _recovery_records(self, plan):
        """Compose recreation may leave absent names or one renamed survivor.

        Arming still requires the complete canonical runtime. Only an already
        armed recovery may reconstruct absent services, after checking every
        container for canonical-name collisions and ambiguous owned survivors.
        """
        names = {'/aemr-' + service + '-1': service for service in SERVICES}
        records = {}
        for identifier in self.command(['ps', '--all', '--quiet', '--no-trunc']).split():
            record = json.loads(self.command(['inspect', identifier]))[0]
            labels = record.get('Config', {}).get('Labels', {}) or {}
            named_service = names.get(record.get('Name'))
            owned_service = (labels.get('com.docker.compose.service')
                             if labels.get('com.docker.compose.project') == 'aemr' else None)
            service = named_service or owned_service
            if service not in SERVICES:
                continue
            self._owned_record(plan, service, record)
            if service in records:
                fail('RELEASE_RUNTIME_NOT_OWNED')
            records[service] = record
        return records

    def _images(self, plan):
        for image in set(plan['images'].values()):
            if json.loads(self.command(['image', 'inspect', image]))[0].get('Id') != image:
                fail('RELEASE_ROLLBACK_IMAGE_UNAVAILABLE')

    def _no_volume_writers(self, plan):
        source = self._volume(plan).resolve(strict=True)
        for identifier in self.command(['ps', '--quiet', '--no-trunc']).split():
            record = json.loads(self.command(['inspect', identifier]))[0]
            if record.get('State', {}).get('Status') != 'running':
                continue
            for mount in record.get('Mounts', []):
                mounted = mount.get('Source')
                overlap = False
                if isinstance(mounted, str) and mounted.startswith('/'):
                    actual = Path(mounted).resolve()
                    overlap = actual == source or actual in source.parents or source in actual.parents
                if ((mount.get('Name') == plan['volume'] or overlap)
                        and mount.get('RW') is not False):
                    fail('RELEASE_VOLUME_WRITER_PRESENT')

    def _tool(self, plan, backup, mode):
        source = self._volume(plan)
        # Filesystem writes remain in THIS lock-owning process. SIGKILL cannot
        # leave a detached Docker daemon writer alive after EX is released.
        try:
            if mode == 'match-source':
                result = self.backup_tool.match_source(backup, source)
            else:
                result = self.backup_tool.restore_state(backup, source, plan['manifest_sha256'])
        except Exception:  # noqa: BLE001 - private failure details must remain unreported
            fail('RELEASE_STATE_RESTORE_FAILED')
        expected = 'SOURCE_MATCHED_ONLY' if mode == 'match-source' else 'STATE_RESTORED'
        if result.get('state') != expected or (mode == 'restore-state' and result.get('manifest_sha256') != plan['manifest_sha256']):
            fail('RELEASE_STATE_RESTORE_UNVERIFIED')
        return result

    def _close(self, plan, services=('caddy', 'report-worker', 'server', 'web'), *, recreating=False):
        for service in services:
            records = self._recovery_records(plan) if recreating else self._records(plan)
            if service not in records:
                continue
            status = records[service]['State']['Status']
            if status not in {'running', 'exited', 'created'}:
                fail('RELEASE_WRITER_NOT_QUIESCENT')
            if status == 'running':
                seconds = 900 if service == 'report-worker' else 75
                name = records[service]['Id'] if recreating else f'aemr-{service}-1'
                self.command(['stop', '--signal', 'SIGTERM', '--timeout', '-1', name], timeout=seconds)
            records = self._recovery_records(plan) if recreating else self._records(plan)
            if service in records and records[service]['State']['Status'] not in {'exited', 'created'}:
                fail('RELEASE_WRITER_NOT_QUIESCENT')

    def _verify_api_word(self, plan, *, candidate=False):
        for attempt in range(60):
            records = self._records(plan, original=not candidate, candidate=candidate)
            if records['server']['State'].get('Health', {}).get('Status') == 'healthy':
                break
            self.sleep(2)
        else:
            fail('RELEASE_API_NOT_HEALTHY')
        self.command(['exec', 'aemr-server-1', 'curl', '-fsS', '--max-time', '5', 'http://127.0.0.1:3000/api/health'])
        program = """import hashlib,json,os,sys,urllib.request,zipfile,io
out={}
for view in ('main','supplement','operational'):
 r=urllib.request.Request('http://127.0.0.1:3000/api/report-releases/'+sys.argv[1]+'/'+view+'.docx',headers={'Authorization':'Bearer '+os.environ.get('AEMR_API_KEY','')})
 with urllib.request.urlopen(r,timeout=20) as response: body=response.read(32*1024*1024+1)
 if len(body)>32*1024*1024: raise ValueError('size')
 with zipfile.ZipFile(io.BytesIO(body)) as document:
  if document.testzip() or 'word/document.xml' not in document.namelist(): raise ValueError('word')
 out[view]=hashlib.sha256(body).hexdigest()
print(json.dumps(out))"""
        actual = json.loads(self.command(['exec', 'aemr-server-1', 'python3', '-c', program, plan['word']['release_id']], timeout=90))
        if actual != plan['word']['sha256']:
            fail('RELEASE_NATIVE_WORD_MISMATCH')

    def _retire_completed_progress(self):
        progress_path = STATE_DIR / 'release-recovery-progress.json'
        if not progress_path.exists() and not progress_path.is_symlink():
            return
        private_directory(STATE_DIR)
        progress = validate_progress(json.loads(read_owned(progress_path)))
        if progress['phase'] == 'candidate_accept':
            completed = json.loads(read_owned(STATE_DIR / 'release-accepted.json'))
            if (not isinstance(completed, dict) or set(completed) != {'plan_sha256', 'acceptance'}
                    or completed['plan_sha256'] != progress['plan_sha256']
                    or validate_acceptance(completed['acceptance']) != progress['acceptance']):
                fail('RELEASE_PROGRESS_INVALID')
            progress_path.unlink()
            fsync_directory(STATE_DIR)
            return
        completed = validate_completed(json.loads(read_owned(STATE_DIR / 'release-recovered.json')))
        if (completed['plan_sha256'] != progress['plan_sha256']
                or completed['restored'] != progress['restored']):
            fail('RELEASE_PROGRESS_INVALID')
        progress_path.unlink()
        fsync_directory(STATE_DIR)

    def arm(self, plan):
        require_lock(self.lock_fd)
        plan = validate_plan(plan)
        completed = STATE_DIR / 'release-recovered.json'
        if completed.exists() or completed.is_symlink():
            previous = validate_completed(json.loads(read_owned(completed)))
            if previous.get('release_sha') == plan['release_sha']:
                fail('RELEASE_ALREADY_RECOVERED')
        if PENDING.exists() or PENDING.is_symlink():
            fail('RELEASE_ALREADY_PENDING')
        self._retire_completed_progress()
        self._recovery_records(plan)
        backup, _ = self._files(plan)
        self._images(plan)
        records = self._records(plan, original=True)
        if any(records[s]['State']['Status'] not in {'exited', 'created'} for s in ('server', 'report-worker')):
            fail('RELEASE_WRITER_NOT_QUIESCENT')
        self._no_volume_writers(plan)
        self._tool(plan, backup, 'match-source')
        atomic_json(PENDING, plan)
        # Pending is durable first: owner loss during ingress shutdown is recoverable.
        self._close(plan)
        return {'state': 'RELEASE_RECOVERY_ARMED'}

    @staticmethod
    def _acceptance(plan):
        return {'state': 'RELEASE_CANDIDATE_ACCEPTED', 'release_sha': plan['release_sha'],
                'manifest_sha256': plan['manifest_sha256'], 'candidate_images': plan['candidate_images'],
                'config_sha256': plan['config_sha256'], 'word_sha256': plan['word']['sha256']}

    def _verify_candidate_schema(self):
        program = """(async()=>{
const deadline=Date.now()+90000;
const {ReportReleaseStatusSchema,DashboardDataSchema}=await import('@aemr/shared');
// Import the reviewed validators without activating their standalone CLI path.
delete process.env.HEADER_PROBE_CLI;
const {HEADER_ENDPOINTS,validHeaderPayload}=await import('/opt/aemr/header_api_probe.mjs');
const token=process.env.AEMR_API_KEY;if(!token)throw Error('auth');
async function read(endpoint){
 for(;;){
  const remaining=deadline-Date.now();if(remaining<=0)throw Error('deadline');
  const response=await fetch('http://127.0.0.1:3000'+endpoint,{method:'GET',
   headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(Math.min(25000,remaining))});
  if(response.status!==200){
   response.body?.cancel().catch(()=>{});
   // Only unavailable startup data may warm up. A 200 contract failure,
   // authentication error, or other HTTP status fails this release immediately.
   if(response.status!==503||Date.now()+1000>=deadline)throw Error('status');
   await new Promise(resolve=>setTimeout(resolve,1000));continue;
  }
  let size=0;const chunks=[];const reader=response.body.getReader();
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;
   // Rejection cannot wait for an over-budget stream's cancellation handshake.
   if(size>32*1024*1024){reader.cancel().catch(()=>{});throw Error('size');}chunks.push(Buffer.from(part.value));}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }
}
const parsed=ReportReleaseStatusSchema.safeParse(await read('/api/report-releases'));
if(!parsed.success||parsed.data.latest===null)throw Error('schema');
for(const endpoint of ['/api/dashboard','/api/dashboard?year=all']){
 if(!DashboardDataSchema.safeParse(await read(endpoint)).success)throw Error('dashboard');
}
for(const [name,endpoint] of Object.entries(HEADER_ENDPOINTS)){
 const url=new URL(endpoint,'http://127.0.0.1:3000');
 if(name==='comments')url.searchParams.set('view','discussions');
 if(!validHeaderPayload(name,await read(url.pathname+url.search)))throw Error('header');
}
console.log('CANDIDATE_SCHEMA_PASS');
})().catch(()=>process.exit(2));"""
        value = self.command(['exec', 'aemr-server-1', './node_modules/.bin/tsx', '--eval', program], timeout=100)
        if value.strip() != 'CANDIDATE_SCHEMA_PASS':
            fail('RELEASE_CANDIDATE_SCHEMA_INVALID')

    def accept(self):
        require_lock(self.lock_fd)
        plan = validate_plan(json.loads(read_owned(PENDING, 64 * 1024)))
        self._files(plan, candidate_runtime=True)
        records = self._records(plan, candidate=True)
        if any(records[s]['State']['Status'] not in {'created', 'exited'} for s in ('caddy', 'report-worker')):
            fail('RELEASE_INGRESS_NOT_FENCED')
        self._verify_api_word(plan, candidate=True)
        self._verify_candidate_schema()
        acceptance = self._acceptance(plan)
        atomic_json(STATE_DIR / 'release-recovery-progress.json', {
            'plan_sha256': digest(json.dumps(plan, sort_keys=True, separators=(',', ':')).encode()),
            'phase': 'candidate_accept', 'acceptance': acceptance})
        return acceptance

    def _resume_candidate(self, plan, progress):
        expected = self._acceptance(plan)
        if (progress['plan_sha256'] != digest(json.dumps(plan, sort_keys=True, separators=(',', ':')).encode())
                or progress['acceptance'] != expected):
            fail('RELEASE_ACCEPTANCE_INVALID')
        _, config = self._files(plan, candidate_runtime=True)
        self._records(plan, candidate=True)
        atomic_json(RUNTIME_DIR / 'candidate-resume.json', config)
        prefix = ['compose', '-p', 'aemr', '-f', str(RUNTIME_DIR / 'candidate-resume.json'),
                  '--env-file', str(RUNTIME_DIR / '.env.production'), '--profile', 'reports']
        try:
            records = self._records(plan, candidate=True)
            wanted = [s for s in ('server', 'web') if plan['original_running'][s]]
            stopped = [s for s in wanted if records[s]['State']['Status'] != 'running']
            if stopped:
                self.command([*prefix, 'up', '-d', '--no-build', '--no-deps', *stopped], timeout=180)
            self._verify_api_word(plan, candidate=True)
            self._verify_candidate_schema()
            for service in ('report-worker', 'caddy'):
                records = self._records(plan, candidate=True)
                if plan['original_running'][service] and records[service]['State']['Status'] != 'running':
                    self.command([*prefix, 'up', '-d', '--no-build', '--no-deps', service], timeout=180)
            records = self._records(plan, candidate=True)
            if any(records[s]['State']['Status'] not in
                   ({'running'} if plan['original_running'][s] else {'created', 'exited'}) for s in SERVICES):
                fail('RELEASE_RUNTIME_RECOVERY_FAILED')
            atomic_json(STATE_DIR / 'release-accepted.json', {'plan_sha256': progress['plan_sha256'], 'acceptance': expected})
            PENDING.unlink()
            fsync_directory(STATE_DIR)
            (STATE_DIR / 'release-recovery-progress.json').unlink()
            fsync_directory(STATE_DIR)
            return expected
        except Exception:  # noqa: BLE001 - preserve accepted data; never restore checkpoint again
            try:
                self._close(plan, ('caddy', 'report-worker'))
            except Exception:  # noqa: BLE001, S110 - durable acceptance remains for guarded retry
                pass
            fail('RELEASE_ACCEPTED_RUNTIME_UNAVAILABLE')

    def recover(self):
        require_lock(self.lock_fd)
        if not PENDING.exists() and not PENDING.is_symlink():
            self._retire_completed_progress()
            return None
        private_directory(STATE_DIR)
        plan = validate_plan(json.loads(read_owned(PENDING, 64 * 1024)))
        progress_path = STATE_DIR / 'release-recovery-progress.json'
        if progress_path.exists() or progress_path.is_symlink():
            early = validate_progress(json.loads(read_owned(progress_path)))
            if early['phase'] == 'candidate_accept':
                return self._resume_candidate(plan, early)
        backup, config = self._files(plan)
        self._images(plan)
        self._recovery_records(plan)
        progress_path = STATE_DIR / 'release-recovery-progress.json'
        plan_hash = digest(json.dumps(plan, sort_keys=True, separators=(',', ':')).encode())
        progress = None
        if progress_path.exists() or progress_path.is_symlink():
            progress = validate_progress(json.loads(read_owned(progress_path)))
            if (progress['plan_sha256'] != plan_hash
                    or progress['restored']['manifest_sha256'] != plan['manifest_sha256']):
                fail('RELEASE_PROGRESS_INVALID')
        resumed = progress is not None
        try:
            if not resumed:
                self._close(plan, recreating=True)
                self._no_volume_writers(plan)
                for service, record in self._recovery_records(plan).items():
                    if record['Name'] != '/aemr-' + service + '-1':
                        # No force/volume removal: only verified, stopped renamed
                        # survivors are discarded before fixed-name reconstruction.
                        self.command(['rm', record['Id']])
                restored = self._tool(plan, backup, 'restore-state')
            else:
                restored = progress['restored']
                self._records(plan, original=True)
            atomic_json(RUNTIME_DIR / 'recovery-compose.json', config)
            prefix = ['compose', '-p', 'aemr', '-f', str(RUNTIME_DIR / 'recovery-compose.json'),
                      '--env-file', str(RUNTIME_DIR / '.env.production'), '--profile', 'reports']
            if not resumed:
                self.command([*prefix, 'up', '--no-start', '--no-build', '--no-deps', *SERVICES], timeout=180)
            self._records(plan, original=True)
            def start(*services):
                self.command([*prefix, 'up', '-d', '--no-build', '--no-deps', *services], timeout=180)
                records = self._records(plan, original=True)
                if any(records[s]['State']['Status'] != 'running' for s in services):
                    fail('RELEASE_RUNTIME_RECOVERY_FAILED')
            targets = ['server', *(['web'] if plan['original_running']['web'] else [])]
            stopped = [s for s in targets if self._records(plan, original=True)[s]['State']['Status'] != 'running']
            if stopped:
                start(*stopped)
            self._verify_api_word(plan)
            if not resumed:
                validate_restore_proof(restored)
                atomic_json(progress_path, {'plan_sha256': plan_hash, 'phase': 'runtime_resume', 'restored': restored})
                resumed = True
            if plan['original_running']['report-worker']:
                start('report-worker')
            if plan['original_running']['caddy']:
                start('caddy')
            records = self._records(plan, original=True)
            if any(records[s]['State']['Status'] not in
                   ({'running'} if plan['original_running'][s] else {'created', 'exited'})
                   for s in SERVICES):
                fail('RELEASE_RUNTIME_RECOVERY_FAILED')
            receipt = {'state': 'RELEASE_RUNTIME_AND_STATE_RECOVERED', 'plan_sha256': plan_hash, 'release_sha': plan['release_sha'],
                       'manifest_sha256': plan['manifest_sha256'], 'restored': restored}
            atomic_json(STATE_DIR / 'release-recovered.json', receipt)
            PENDING.unlink()
            fsync_directory(STATE_DIR)
            progress_path.unlink(missing_ok=True)
            fsync_directory(STATE_DIR)
            return receipt
        except Exception:  # noqa: BLE001 - private failure details must remain unreported
            # Before durable runtime_resume, retry restores a partial extraction.
            # After it, preserve newly exposed data and only fence ingress/worker.
            try:
                self._close(plan, ('caddy', 'report-worker') if resumed else ('caddy', 'report-worker', 'server', 'web'),
                            recreating=not resumed)
            except Exception:  # noqa: BLE001, S110 - retain pending without leaking private stderr
                pass
            fail('RELEASE_RECOVERY_FAILED')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('arm', 'recover'))
    args = parser.parse_args(argv)
    try:
        executor = ReleaseRecovery()
        if args.mode == 'arm':
            body = sys.stdin.buffer.read(64 * 1024 + 1)
            if len(body) > 64 * 1024:
                fail('RELEASE_RECEIPT_INVALID')
            result = executor.arm(json.loads(body))
        else:
            result = executor.recover()
        print(result['state'] if result else 'NO_PENDING_RELEASE')
        return 0
    except Exception as error:  # noqa: BLE001 - fixed-code CLI privacy boundary
        print(str(error) if isinstance(error, RecoveryError) else 'RELEASE_RECOVERY_UNAVAILABLE', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

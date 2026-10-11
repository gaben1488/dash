#!/usr/bin/env python3
"""Owner-authorized worker-only recovery. Never deploy or migrate server/web/Sheets.

The trusted Actions job supplies a private receipt after independent full restore.
Detailed Docker output/status stays in the private session, never Actions logs.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path


class RecoveryError(Exception):
    pass


def accept_cycle(status, since, seen, attributed, interval_seconds):
    try:
        started = datetime.fromisoformat(status['started_at'])
        marker = datetime.fromisoformat(since)
        if started.tzinfo is None or marker.tzinfo is None:
            raise ValueError
        if started < marker:
            return False
        outcome = status['status']
        if outcome in {'NOT_ISSUED', 'FAILED', 'PLAN_CHANGED'}:
            raise RecoveryError('WORKER_NEW_CYCLE_FAILED')
        if outcome not in {'VERIFIED', 'VERIFIED_WITH_WARNINGS'}:
            return False
        finished = datetime.fromisoformat(status['finished_at'])
        identity = status['attempt_id']
        publication = status['publication']
        if (finished.tzinfo is None or finished < started or not identity
                or not status.get('snapshot_id') or status['snapshot_id'] != publication.get('snapshot_id')
                or publication.get('operational_available') is not True):
            raise ValueError
        if identity in seen:
            return False
        if identity not in attributed:
            return False  # A fast/manual/unobserved attempt is never worker evidence.
        if seen and started < max(seen.values()) + timedelta(seconds=interval_seconds):
            raise RecoveryError('WORKER_TIMER_ORDER_INVALID')
        seen[identity] = finished
        return True
    except (KeyError, ValueError, TypeError, AttributeError) as exc:
        raise RecoveryError('WORKER_CYCLE_PROOF_INVALID') from exc


def same_running_attempt(first, confirmed):
    return (first.get('status') == confirmed.get('status') == 'RUNNING'
            and first.get('attempt_id') == confirmed.get('attempt_id')
            and first.get('started_at') == confirmed.get('started_at'))


def worker_lock_held(locks, pids, major, minor, inode):
    for line in locks.splitlines():
        fields = line.split()
        if len(fields) != 8 or fields[1:4] != ['FLOCK', 'ADVISORY', 'WRITE']:
            continue
        try:
            device_major, device_minor, file_inode = fields[5].split(':')
            if (int(fields[4]) in pids and int(device_major, 16) == major
                    and int(device_minor, 16) == minor and int(file_inode) == inode):
                return True
        except ValueError:
            continue
    return False


class Recovery:
    def __init__(self, repo, session):
        self.repo, self.session = repo.resolve(strict=True), session.resolve(strict=True)
        self.receipt = json.loads((session / 'receipt.json').read_text())
        self.backup_session = Path(self.receipt['backup_session']).resolve(strict=True)
        if self.backup_session.parent != session.parent or self.backup_session == session:
            raise RecoveryError('WORKER_BACKUP_PATH_INVALID')
        self.baseline = json.loads((self.backup_session / 'runtime.json').read_text())
        self.server, self.worker = self.baseline['server'], self.baseline['worker']
        self.image, self.volume = self.baseline['image'], self.baseline['volume']
        self.manifest_sha256 = self.receipt['manifest_sha256']
        self.changed = False
        if (self.receipt.get('full_restore') != 'VERIFIED_IN_SCRATCH'
                or self.receipt.get('backup_sha') != self.baseline.get('candidate')
                or self.receipt.get('compatibility') != 'PASS'
                or not re.fullmatch(r'[0-9a-f]{64}', self.manifest_sha256)
                or not re.fullmatch(r'sha256:[0-9a-f]{64}', self.image)
                or not re.fullmatch(r'[A-Za-z0-9_.-]+', self.volume)
                or not all(re.fullmatch(r'[0-9a-f]{64}', x) for x in (self.server, self.worker))
                or hashlib.sha256((self.backup_session / 'backup/manifest.json').read_bytes()).hexdigest()
                    != self.manifest_sha256):
            raise RecoveryError('WORKER_BACKUP_RECEIPT_INVALID')

    def call(self, args, *, timeout=1800):
        result = subprocess.run(args, cwd=self.repo / 'deploy', capture_output=True, timeout=timeout, check=False)
        with (self.session / 'private-command.log').open('ab') as log:
            log.write(result.stderr)
        if result.returncode:
            raise RecoveryError('WORKER_COMMAND_FAILED')
        return result.stdout.decode()

    def inspect(self, container):
        return json.loads(self.call(['docker', 'inspect', container]))[0]

    def compose(self, *args):
        return self.call(['docker', 'compose', '--env-file', '.env.production', '-f', 'docker-compose.yml',
                          '-f', str(self.session / 'worker-override.json'), '--profile', 'reports', *args])

    def override(self, image):
        (self.session / 'worker-override.json').write_text(json.dumps({'services': {'report-worker': {
            'image': image, 'command': self.original_worker['Config']['Cmd']}}}))

    def tool(self, command, *args):
        readonly = command != 'restore-reports'
        output = self.call(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0',
            '--mount', f'type=volume,src={self.volume},dst=/source' + (',readonly' if readonly else ''),
            '--mount', f'type=bind,src={self.backup_session}/backup,dst=/backup,readonly',
            '--mount', f'type=bind,src={self.session}/stateful_backup.py,dst=/tool.py,readonly',
            '--entrypoint', '/opt/report-env/bin/python', self.image, '-B', '/tool.py', command,
            '--backup', '/backup', '--source', '/source', *args])
        return json.loads(output)

    def resume(self):
        self.call(['docker', 'start', self.server])
        for _ in range(60):
            runtime = self.inspect(self.server)
            if runtime['State']['Status'] == 'running' and runtime['State'].get('Health', {}).get('Status') == 'healthy':
                return
            time.sleep(2)
        raise RecoveryError('WORKER_ORIGINAL_SERVER_UNHEALTHY')

    def smoke(self):
        result = json.loads(self.call(['docker', 'exec', self.server, '/opt/report-env/bin/python',
                                     '-m', 'procurement_engine.deployment_smoke'], timeout=180))
        if any(result.get(k) != 'PASS' for k in ('context', 'snapshot', 'main', 'supplement', 'operational')):
            raise RecoveryError('WORKER_WORD_SMOKE_FAILED')

    def require_no_manual_writer(self):
        processes = self.call(['docker', 'top', self.server, '-eo', 'args'])
        if re.search(r'proc-report\s+(?:run-google|worker)|procurement_engine.*(?:run-google|worker)', processes):
            raise RecoveryError('WORKER_CONCURRENT_MANUAL_WRITER')

    def holds_worker_lock(self):
        # Host /proc/locks proves which container process owns the real run.lock.
        # A sampled command name alone cannot attribute short/manual attempts.
        metadata = json.loads(self.call(['docker', 'exec', self.worker, '/opt/report-env/bin/python', '-B', '-c',
            ('import json,os; from pathlib import Path; s=Path("/app/packages/server/data/reports/run.lock").stat(); '
            'print(json.dumps([os.major(s.st_dev),os.minor(s.st_dev),s.st_ino]))')]))
        pids = {int(line.strip()) for line in self.call(['docker', 'top', self.worker, '-eo', 'pid']).splitlines()[1:]}
        return worker_lock_held(Path('/proc/locks').read_text(), pids, *metadata)

    def save_failure_diagnostics(self):
        try:
            # Docker cp works even after a worker exits. Keep new failure evidence
            # outside reports/ before restoring the original report state.
            self.call(['docker', 'cp', self.worker + ':/app/packages/server/data/reports/status.json',
                       str(self.session / 'failure-status.json')], timeout=30)
            status = json.loads((self.session / 'failure-status.json').read_text())
            identity = status.get('attempt_id', '')
            if re.fullmatch('[0-9a-f]{32}', identity):
                self.call(['docker', 'cp', self.worker + ':/app/packages/server/data/reports/attempts/'
                    + identity + '/error.json', str(self.session / 'attempt-error.json')], timeout=30)
        except Exception:  # noqa: BLE001 — diagnostics must never prevent rollback.
            # Private command stderr records an absent error file/container. This
            # never blocks recovery, nor turns a failed cycle into accepted work.
            return False

    def rollback(self):
        # Independent Docker lookup still works if Compose itself caused the failure.
        workers = self.call(['docker', 'ps', '--all', '--quiet', '--no-trunc', '--filter',
            'label=com.docker.compose.project=aemr', '--filter',
            'label=com.docker.compose.service=report-worker']).split()
        if len(workers) != 1 or not re.fullmatch('[0-9a-f]{64}', workers[0]):
            raise RecoveryError('WORKER_ROLLBACK_CONTAINER_UNAVAILABLE')
        self.worker = workers[0]
        self.call(['docker', 'stop', '--time', '75', self.worker])
        self.call(['docker', 'stop', '--time', '75', self.server])
        if any(self.inspect(x)['State']['Status'] != 'exited' for x in (self.worker, self.server)):
            raise RecoveryError('WORKER_ROLLBACK_WRITERS_NOT_QUIESCENT')
        result = self.tool('restore-reports', '--verified-manifest-sha256', self.manifest_sha256)
        if result.get('state') != 'REPORT_SCOPE_RESTORED' or result.get('core_state_preserved') is not True:
            raise RecoveryError('WORKER_ROLLBACK_NOT_PROVEN')
        try:
            self.override(self.original_worker['Image'])
            # Restore original worker image/config but its original stopped state.
            self.compose('up', '--no-start', '--no-deps', '--no-build', '--pull', 'never', 'report-worker')
        finally:
            # A Compose failure must not keep the restored, unchanged Node offline.
            self.resume()
            self.smoke()
        self.changed = False
        (self.session / 'rollback.json').write_text(json.dumps({'state': 'REPORT_SCOPE_RESTORED',
            'original_server': self.server, 'original_worker_image': self.original_worker['Image'],
            'core_state_preserved': True, 'native_word': 'PASS'}))

    def match_report_backup(self):
        try:
            self.call(['docker', 'stop', '--time', '75', self.server])
            if self.inspect(self.server)['State']['Status'] != 'exited':
                raise RecoveryError('WORKER_SOURCE_NOT_QUIESCENT')
            if self.tool('match-reports').get('state') != 'REPORT_SCOPE_MATCHED_ONLY':
                raise RecoveryError('WORKER_BACKUP_STALE')
        finally:
            self.resume()

    def recover(self):
        server = self.inspect(self.server)
        self.original_worker = self.inspect(self.worker)
        (self.session / 'original-worker.json').write_text(json.dumps(self.original_worker))
        def volume(config):
            return next((x.get('Name') for x in config['Mounts'] if x['Destination'] == '/app/packages/server/data'
                         and x['Type'] == 'volume'), None)
        if (server['Image'] != self.image or volume(server) != self.volume
                or volume(self.original_worker) != self.volume or server['State']['Status'] != 'running'
                or self.original_worker['State']['Status'] != 'exited'):
            raise RecoveryError('WORKER_RUNTIME_CHANGED')
        self.require_no_manual_writer()
        self.smoke()
        self.match_report_backup()
        self.require_no_manual_writer()
        cmd = self.original_worker['Config']['Cmd']
        try:
            interval = int(cmd[cmd.index('--interval-seconds') + 1])
            if not 1 <= interval <= 1200:
                raise ValueError
        except (ValueError, IndexError) as exc:
            raise RecoveryError('WORKER_INTERVAL_UNSUPPORTED') from exc
        since = datetime.now(timezone.utc).isoformat()
        self.override(self.image)
        self.changed = True
        try:
            self.compose('up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'report-worker')
            self.worker = self.compose('ps', '--all', '--quiet', 'report-worker').strip()
            config = self.inspect(self.worker)
            if (config['Image'] != self.image or volume(config) != self.volume
                    or config['Config']['Cmd'] != self.original_worker['Config']['Cmd']
                    or config['HostConfig']['RestartPolicy']['Name'] != 'unless-stopped'):
                raise RecoveryError('WORKER_PINNED_RUNTIME_MISMATCH')
            seen, attributed = {}, set()
            deadline = time.monotonic() + max(2100, 2 * interval + 600)
            while time.monotonic() < deadline:
                if self.inspect(self.worker)['State']['Status'] != 'running':
                    raise RecoveryError('WORKER_EXITED')
                self.require_no_manual_writer()
                status = json.loads(self.call(['docker', 'exec', self.server, 'cat',
                    '/app/packages/server/data/reports/status.json']))
                if status.get('status') == 'RUNNING' and self.holds_worker_lock():
                    confirmed = json.loads(self.call(['docker', 'exec', self.server, 'cat',
                        '/app/packages/server/data/reports/status.json']))
                    if same_running_attempt(status, confirmed) and self.holds_worker_lock():
                        attributed.add(status['attempt_id'])
                if accept_cycle(status, since, seen, attributed, interval):
                    self.smoke()
                    (self.session / f'cycle-{len(seen)}.json').write_text(json.dumps(status))
                    print(f'WORKER_AUTONOMOUS_CYCLE_{len(seen)}_AND_THREE_WORDS_PASS', flush=True)
                if len(seen) == 2:
                    if self.inspect(self.server)['Image'] != self.image:
                        raise RecoveryError('WORKER_ORIGINAL_SERVER_CHANGED')
                    return {'state': 'TWO_AUTONOMOUS_CYCLES_VERIFIED', 'worker_image': self.image,
                            'worker_started_at': since, 'attempt_ids': sorted(seen), 'native_word': 'PASS'}
                time.sleep(5)
            raise RecoveryError('WORKER_TWO_CYCLES_TIMED_OUT')
        except Exception:
            self.save_failure_diagnostics()
            self.rollback()
            raise



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--session', type=Path, required=True)
    args = parser.parse_args()
    try:
        recovery = Recovery(args.repo, args.session)
        result = recovery.recover()
        (args.session / 'result.json').write_text(json.dumps(result))
        print('WORKER_RECOVERY_ACCEPTED', flush=True)
        return 0
    except Exception as error:  # noqa: BLE001 — sanitize the process boundary.
        reason = str(error) if isinstance(error, RecoveryError) else 'WORKER_RECOVERY_IO_FAILED'
        (args.session / 'failure.json').write_text(json.dumps({'state': 'FAILED', 'reason': reason}))
        print(reason, flush=True)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())

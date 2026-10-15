#!/usr/bin/env python3
"""Process supervision and explicit release recovery under one host lock."""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import stat
import subprocess
import sys
import time
from pathlib import Path

PROBES = {
    'server': ['curl', '-fsS', '--max-time', '3', 'http://127.0.0.1:3000/api/health'],
    'web': ['wget', '-q', '-T', '3', '-O', '/dev/null', 'http://127.0.0.1/index.html'],
    'caddy': ['wget', '-q', '-T', '3', '-O', '/dev/null', 'http://127.0.0.1:2019/config/'],
}


def docker(args):
    result = subprocess.run(['docker', *args], capture_output=True, text=True, timeout=35, check=False)
    if result.returncode:
        raise RuntimeError('DOCKER_OPERATION_FAILED')  # No private stderr/environment in journal.
    return result.stdout


def enforce_limits(container, record, limits, command):
    fields = {'mem_limit': ('Memory', '--memory'), 'memswap_limit': ('MemorySwap', '--memory-swap'),
              'mem_reservation': ('MemoryReservation', '--memory-reservation'),
              'pids_limit': ('PidsLimit', '--pids-limit'), 'cpu_shares': ('CpuShares', '--cpu-shares')}
    flags = []
    host = record.get('HostConfig', {})
    for key, (field, flag) in fields.items():
        if key in limits and host.get(field) != int(limits[key]):
            flags.extend([flag, str(limits[key])])
    if 'cpus' in limits and host.get('NanoCpus') != int(float(limits['cpus']) * 1_000_000_000):
        flags.extend(['--cpus', str(limits['cpus'])])
    if flags:
        command(['update', *flags, container])


def supervise(policy, state, command=docker, *, now=None, maintenance=False):
    if maintenance:
        return []
    now = time.time() if now is None else now
    failures = state.setdefault('failures', {})
    last = state.setdefault('last_recovery', {})
    records, events = {}, []
    for service, config in policy['services'].items():
        try:
            record = json.loads(command(['inspect', config['container']]))[0]
            labels = record['Config'].get('Labels') or {}
            if (record['Name'] != '/' + config['container']
                    or labels.get('com.docker.compose.project') != policy['project']
                    or labels.get('com.docker.compose.service') != service):
                events.append({'service': service, 'event': 'ownership_mismatch'})
                continue
            records[service] = record
        except (RuntimeError, KeyError, ValueError, IndexError, subprocess.TimeoutExpired):
            events.append({'service': service, 'event': 'container_unavailable'})

    for service, record in records.items():
        container = policy['services'][service]['container']
        if service == 'report-worker' and policy.get('worker_enabled', False):
            server = records.get('server', {})
            if (record['Image'] != server.get('Image')
                    or server.get('State', {}).get('Status') != 'running'):
                events.append({'service': service, 'event': 'worker_runtime_mismatch'})
                continue
        status = record['State']['Status']
        limits = policy['services'][service].get('limits', {})
        if limits:
            try:
                enforce_limits(container, record, limits, command)
            except (RuntimeError, subprocess.TimeoutExpired):
                events.append({'service': service, 'event': 'resource_limits_failed'})
        if service == 'report-worker' and not policy.get('worker_enabled', False):
            continue
        action = None
        if status in {'exited', 'created'}:
            action = ['start', container]
        elif status == 'running' and service in PROBES:
            try:
                command(['exec', container, *PROBES[service]])
                failures[service] = 0
            except (RuntimeError, subprocess.TimeoutExpired):
                failures[service] = failures.get(service, 0) + 1
                if failures[service] >= policy.get('failure_threshold', 3):
                    action = ['restart', '--time', '20', container]
        if action and now - last.get(service, 0) >= policy.get('cooldown_seconds', 300):
            try:
                command(action)
                last[service] = now
                failures[service] = 0
                events.append({'service': service, 'event': action[0]})
            except (RuntimeError, subprocess.TimeoutExpired):
                last[service] = now  # Bound repeated failures as well as successful restarts.
                events.append({'service': service, 'event': 'recovery_failed'})
    return events


RELEASE_MARKERS = (Path('/var/lib/aemr/pending-release.json'),
                   Path('/var/lib/aemr/release-recovery-progress.json'))


def recover_release(lock_fd):
    """Installed root-owned executor shares this process and the exact EX lock."""
    script=Path(__file__).with_name('release_recovery.py')
    value=script.lstat()
    if not stat.S_ISREG(value.st_mode) or value.st_uid!=0 or value.st_mode & 0o022:
        raise RuntimeError('RELEASE_EXECUTOR_INVALID')
    spec=importlib.util.spec_from_file_location('aemr_release_recovery',script)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.ReleaseRecovery(lock_fd=lock_fd).recover()


def main():
    import fcntl  # Linux host only; pure supervision logic is tested on all platforms.
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--policy', type=Path, default=Path('/etc/aemr/runtime-policy.json'))
    parser.add_argument('--state', type=Path, default=Path('/var/lib/aemr/runtime-guard.json'))
    parser.add_argument('--lock', type=Path, default=Path('/run/lock/aemr-maintenance.lock'))
    args = parser.parse_args()
    with args.lock.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0  # Deliberate maintenance owns the lock; never race data restoration.
        # Recovery owns the data boundary; ordinary process starts cannot bypass it.
        # lexists catches dangling evidence, which must fail closed instead of vanish.
        if any(os.path.lexists(marker) for marker in RELEASE_MARKERS):
            try:
                result = recover_release(lock.fileno())
            except Exception:  # noqa: BLE001 - fixed-code boundary; private config must not reach journald
                print('RELEASE_RECOVERY_UNAVAILABLE',file=sys.stderr)
                return 2
            print(result['state'] if result else 'NO_PENDING_RELEASE')
            return 0
        policy = json.loads(args.policy.read_text())
        state = json.loads(args.state.read_text()) if args.state.exists() else {}
        events = supervise(policy, state)
        state['checked_at'] = time.time()
        state['events'] = events
        temporary = args.state.with_suffix('.tmp')
        temporary.write_text(json.dumps(state))
        temporary.replace(args.state)
        for event in events:
            print(json.dumps(event), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

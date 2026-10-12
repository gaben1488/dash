import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def run_deploy(tmp_path, *, fail=False, running=False, fail_smoke=False, fail_worker=False):
    docker = tmp_path / 'docker'
    docker.write_text('''#!/usr/bin/env python3
import os,sys
with open(os.environ['CALL_LOG'],'a') as f:f.write(' '.join(sys.argv[1:])+'\\n')
if os.environ.get('FAIL_RUN')=='1' and 'run-google' in ' '.join(sys.argv):sys.exit(2)
if os.environ.get('FAIL_SMOKE')=='1' and 'procurement_engine.deployment_smoke' in sys.argv:sys.exit(3)
if os.environ.get('FAIL_WORKER')=='1' and '--worker-since' in sys.argv:sys.exit(4)
if 'ps' in sys.argv and (os.environ.get('WAS_RUNNING')=='1' or 'up -d report-worker' in open(os.environ['CALL_LOG']).read()):print('existing-worker')
''')
    docker.chmod(0o755)
    log = tmp_path / 'calls'
    result = subprocess.run(['bash', str(ROOT / 'deploy/enable-reports.sh')],
        cwd=tmp_path, env={**os.environ, 'PATH': str(tmp_path) + os.pathsep + os.environ['PATH'],
                         'CALL_LOG': str(log), 'FAIL_RUN': '1' if fail else '0',
                         'FAIL_SMOKE': '1' if fail_smoke else '0',
                         'FAIL_WORKER': '1' if fail_worker else '0',
                         'WAS_RUNNING':'1' if running else '0'}, capture_output=True, text=True, check=False)
    return result, log.read_text() if log.exists() else ''


def test_schedule_starts_only_after_private_bootstrap_and_successful_run(tmp_path):
    result, log = run_deploy(tmp_path)
    assert result.returncode == 0
    assert log.index('bootstrap-google') < log.index('migrate-google-schema') < log.index('run-google') < log.index('procurement_engine.deployment_smoke') < log.index('up -d report-worker')
    assert 'preflight.log' in log
    assert 'Reading and checking report sources' in result.stdout
    assert log.index('up -d report-worker') < log.index('--worker-since')
    assert 'completed automatic worker cycle verified; schedule running.' in result.stdout


def test_failed_preflight_never_enables_schedule(tmp_path):
    result, log = run_deploy(tmp_path, fail=True)
    assert result.returncode != 0
    assert 'run-google' in log
    assert 'up -d report-worker' not in log
    assert 'start report-worker' not in log


def test_failed_update_restores_previously_running_worker_and_preserves_failure(tmp_path):
    result,log=run_deploy(tmp_path,fail=True,running=True)
    assert result.returncode==2
    assert log.index('run-google') < log.index('procurement_engine.deployment_diagnostics') < log.index('start report-worker')
    assert 'up -d report-worker' not in log


def test_failed_http_acceptance_restores_previous_worker(tmp_path):
    result, log = run_deploy(tmp_path, fail_smoke=True, running=True)
    assert result.returncode == 3
    assert log.index('procurement_engine.deployment_smoke') < log.index('start report-worker')
    assert 'up -d report-worker' not in log


def test_failed_worker_cycle_never_reports_schedule_success(tmp_path):
    result, log = run_deploy(tmp_path, fail_worker=True, running=True)
    assert result.returncode == 4
    assert log.index('up -d report-worker') < log.index('--worker-since') < log.index('start report-worker')
    assert 'schedule running.' not in result.stdout


def test_maintenance_contention_blocks_before_any_docker_call(tmp_path):
    import fcntl
    with open('/run/lock/aemr-maintenance.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result, log = run_deploy(tmp_path)
    assert result.returncode != 0
    assert 'AEMR_MAINTENANCE_BUSY' in result.stderr
    assert log == ''


def test_verified_inherited_lock_avoids_nested_deadlock():
    helper = ROOT / 'deploy/maintenance-lock.sh'
    result = subprocess.run(['bash', '-c', '''
. "$1"
maintenance_lock_acquire || exit 1
bash -c '. "$1"; maintenance_lock_acquire; maintenance_lock_owned_by $$' nested "$1"
''', 'parent', str(helper)], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr


def test_unlocked_fd_and_fake_flag_cannot_bypass_actual_exclusion(tmp_path):
    import fcntl
    with open('/run/lock/aemr-maintenance.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = subprocess.run(['bash', '-c', '''
exec 9>/run/lock/aemr-maintenance.lock
export AEMR_MAINTENANCE_LOCK_HELD=1
. "$1"
maintenance_lock_acquire
''', 'fake', str(ROOT / 'deploy/maintenance-lock.sh')], capture_output=True, text=True, check=False)
    assert result.returncode != 0
    assert 'AEMR_MAINTENANCE_BUSY' in result.stderr


def test_guard_installation_is_excluded_before_any_host_mutation(tmp_path):
    import fcntl
    install = tmp_path / 'install'
    install.write_text('#!/bin/sh\nprintf "mutation\\n" >> "$CALL_LOG"\nexit 19\n')
    install.chmod(0o755)
    log = tmp_path / 'calls'
    with open('/run/lock/aemr-maintenance.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = subprocess.run(['bash', str(ROOT / 'deploy/install-runtime-guard.sh')],
            env={**os.environ, 'PATH': str(tmp_path) + os.pathsep + os.environ['PATH'],
                 'CALL_LOG': str(log)}, capture_output=True, text=True, check=False)
    assert result.returncode != 0
    assert 'AEMR_MAINTENANCE_BUSY' in result.stderr
    assert not log.exists()


def test_tmpfiles_recreates_boot_lock_without_replacing_locked_inode(tmp_path):
    import fcntl
    import shutil
    import stat

    import pytest
    executable = shutil.which('systemd-tmpfiles')
    if not executable:
        pytest.skip('Linux systemd-tmpfiles is required')
    rule = (ROOT / 'deploy/systemd/aemr-maintenance.conf').read_text()
    assert 'f /run/lock/aemr-maintenance.lock 0600 root root -' in rule
    # Use the real platform implementation in an isolated root. Unprivileged
    # tests substitute their numeric owner; production keeps root:root.
    config = tmp_path / 'maintenance.conf'
    config.write_text(rule.replace('root root -', f'{os.getuid()} {os.getgid()} -'))
    isolated = tmp_path / 'boot'
    (isolated / 'run/lock').mkdir(parents=True)
    command = [executable, '--create', '--root', str(isolated), str(config)]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stderr
    target = isolated / 'run/lock/aemr-maintenance.lock'
    before = target.stat()
    assert stat.S_IMODE(before.st_mode) == 0o600
    assert (before.st_uid, before.st_gid) == (os.getuid(), os.getgid())
    with target.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        assert result.returncode == 0, result.stderr
        assert target.stat().st_ino == before.st_ino
        with target.open('a') as contender, pytest.raises(BlockingIOError):
            fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)


def test_backup_guardian_holds_lock_across_caller_exit_and_releases_on_resume(tmp_path):
    import fcntl
    import time
    script = (ROOT / 'deploy/report-backup-window.sh').read_text()
    body = script.split("  nohup bash -c '", 1)[1].split("  ' watchdog", 1)[0]
    (tmp_path / 'quiescent').touch()
    guardian = subprocess.Popen(['bash', '-c', body, 'watchdog', str(tmp_path), 'original-server', str(ROOT / 'deploy')],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            if (tmp_path / 'guardian-ready').exists():
                break
            time.sleep(.02)
        assert (tmp_path / 'guardian-ready').exists()
        with open('/run/lock/aemr-maintenance.lock', 'a') as contender:
            try:
                fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                pass
            else:
                raise AssertionError('guardian did not retain EX lock')
        (tmp_path / 'quiescent').unlink()
        assert guardian.wait(timeout=5) == 0
        with open('/run/lock/aemr-maintenance.lock', 'a') as contender:
            fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
    finally:
        if guardian.poll() is None:
            guardian.terminate()
            guardian.wait(timeout=5)


def test_backup_watchdog_restarts_only_original_server_before_unlock(tmp_path):
    script = (ROOT / 'deploy/report-backup-window.sh').read_text()
    body = script.split("  nohup bash -c '", 1)[1].split("  ' watchdog", 1)[0].replace('SECONDS + 1800', 'SECONDS + 0')
    docker = tmp_path / 'docker'
    docker.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\n')
    docker.chmod(0o755)
    (tmp_path / 'quiescent').touch()
    guardian = subprocess.Popen(['bash', '-c', body, 'watchdog', str(tmp_path), 'original-server', str(ROOT / 'deploy')],
        env={**os.environ, 'PATH': str(tmp_path) + os.pathsep + os.environ['PATH'], 'CALL_LOG': str(tmp_path / 'calls')},
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    assert guardian.wait(timeout=5) == 0
    assert (tmp_path / 'calls').read_text() == 'start original-server\n'
    assert not (tmp_path / 'quiescent').exists()


def recovery_module():
    import importlib.util
    spec = importlib.util.spec_from_file_location('maintenance_recovery', ROOT / 'deploy/worker_recovery.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_fatal_stop_admission_is_atomic_preserving_other_policy_fields(tmp_path):
    import json
    import stat
    policy = tmp_path / 'runtime-policy.json'
    original = {'project': 'aemr', 'worker_enabled': True, 'services': {'server': {'container': 'original'}}, 'extra': 17}
    policy.write_text(json.dumps(original))
    policy.chmod(0o600)
    before = policy.stat()
    recovery_module().disable_worker_admission(policy)
    assert json.loads(policy.read_text()) == {**original, 'worker_enabled': False}
    after = policy.stat()
    assert stat.S_IMODE(after.st_mode) == 0o600
    assert (after.st_uid, after.st_gid) == (before.st_uid, before.st_gid)
    assert not list(tmp_path.glob('.runtime-policy-*'))


def test_admission_absence_does_not_create_policy_and_foreign_or_symlink_fail(tmp_path):
    import pytest
    module = recovery_module()
    policy = tmp_path / 'policy.json'
    module.disable_worker_admission(policy)
    assert not policy.exists()
    policy.write_text('{"project":"foreign","worker_enabled":true}')
    with pytest.raises(module.RecoveryError, match='WORKER_ADMISSION_DISABLE_FAILED'):
        module.disable_worker_admission(policy)
    alias = tmp_path / 'alias'
    alias.symlink_to(policy)
    with pytest.raises(module.RecoveryError, match='WORKER_ADMISSION_DISABLE_FAILED'):
        module.disable_worker_admission(alias)


def test_worker_observation_releases_maintenance_but_start_is_exclusive(tmp_path, monkeypatch):
    import json
    module = recovery_module()
    server, worker = 'a' * 64, 'b' * 64
    config = {'Image': 'sha256:' + 'c' * 64, 'Mounts': [{'Destination': '/app/packages/server/data', 'Type': 'volume', 'Name': 'state'}],
              'State': {'Status': 'running'}, 'Config': {'Cmd': ['worker', '--interval-seconds', '1']},
              'HostConfig': {'RestartPolicy': {'Name': 'unless-stopped'}}}
    recovery = object.__new__(module.Recovery)
    recovery.server, recovery.worker, recovery.image, recovery.volume = server, worker, config['Image'], 'state'
    recovery.session, recovery.changed = tmp_path, False
    recovery.inspect = lambda container: {**config, 'State': {'Status': 'exited' if container == worker and not recovery.changed else 'running'}}
    recovery.call = lambda args, **kwargs: worker if args[1] == 'ps' else json.dumps({'status': 'VERIFIED'})
    recovery.require_no_manual_writer = lambda: None
    recovery.smoke = lambda: None
    recovery.match_report_backup = lambda: None
    recovery.override = lambda image: None
    recovery.save_failure_diagnostics = lambda: None
    def compose(*args):
        if args[0] == 'up':
            # A second real process cannot enter the container transition.
            assert subprocess.run(['flock', '-n', '/run/lock/aemr-maintenance.lock', 'true'], check=False).returncode != 0
        return worker
    recovery.compose = compose
    def accept(status, since, seen, attributed, interval):
        # Timer observations must not disable API recovery for 40 minutes.
        assert subprocess.run(['flock', '-n', '/run/lock/aemr-maintenance.lock', 'true'], check=False).returncode == 0
        seen[str(len(seen))] = 'complete'
        return True
    monkeypatch.setattr(module, 'accept_cycle', accept)
    monkeypatch.setattr(module.time, 'sleep', lambda _: None)
    result = recovery.recover()
    assert result['state'] == 'TWO_AUTONOMOUS_CYCLES_VERIFIED'


def test_backup_guardian_contention_never_stops_api(tmp_path):
    import fcntl
    docker = tmp_path / 'docker'
    docker.write_text('''#!/usr/bin/env python3
import os,sys
args=sys.argv[1:]
with open(os.environ['CALL_LOG'],'a') as log:log.write(' '.join(args)+'\\n')
if args[0]=='compose':print(('a' if args[-1]=='server' else 'b')*64)
elif args[0]=='inspect':
 fmt=args[2]
 if '.State.Status' in fmt:print('exited' if args[-1]=='b'*64 else 'running')
 elif '.Image' in fmt:print('sha256:'+'c'*64)
 else:print('state')
''')
    docker.chmod(0o755)
    git = tmp_path / 'git'
    git.write_text('#!/bin/sh\ncase "$*" in *deploy/maintenance-lock.sh*) cat "$HELPER";; esac\nexit 0\n')
    git.chmod(0o755)
    log = tmp_path / 'calls'
    with open('/run/lock/aemr-maintenance.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = subprocess.run(['bash', str(ROOT / 'deploy/report-backup-window.sh'), 'prepare', 'd'*40, '1', str(ROOT), str(tmp_path / 'backup')],
            env={**os.environ, 'PATH': str(tmp_path)+os.pathsep+os.environ['PATH'], 'CALL_LOG': str(log), 'HELPER': str(ROOT / 'deploy/maintenance-lock.sh')},
            capture_output=True, text=True, timeout=15, check=False)
    assert result.returncode != 0
    assert 'BACKUP_GUARDIAN_' in result.stderr
    assert not any(line.startswith('stop ') for line in log.read_text().splitlines())


def test_failed_admission_write_blocks_deliberate_worker_stop(monkeypatch):
    import pytest
    module = recovery_module()
    def fail():
        raise module.RecoveryError('WORKER_ADMISSION_DISABLE_FAILED')
    monkeypatch.setattr(module, 'disable_worker_admission', fail)
    recovery = object.__new__(module.Recovery)
    recovery.call = lambda *args, **kwargs: pytest.fail('Docker stop reached before durable admission disable')
    with pytest.raises(module.RecoveryError, match='WORKER_ADMISSION_DISABLE_FAILED'):
        recovery._stop_failed_worker_locked()


def ready_recovery(tmp_path, module):
    recovery = object.__new__(module.Recovery)
    recovery.server, recovery.worker, recovery.image, recovery.volume = 'a'*64, 'b'*64, 'sha256:'+'c'*64, 'state'
    recovery.session = tmp_path
    config = {'Image': recovery.image, 'Mounts': [{'Destination': '/app/packages/server/data', 'Type': 'volume', 'Name': 'state'}],
              'Config': {'Cmd': ['worker', '--interval-seconds', '1']}}
    recovery.inspect = lambda container: {**config, 'State': {'Status': 'running' if container == recovery.server else 'exited'}}
    recovery.call = lambda args, **kwargs: recovery.worker
    recovery.require_no_manual_writer = lambda: None
    recovery.smoke = lambda: None
    recovery.match_report_backup = lambda: None
    return recovery


def test_startup_cannot_mutate_runtime_without_durable_admission_control(tmp_path, monkeypatch):
    import pytest
    module = recovery_module()
    def unreadable_policy():
        raise module.RecoveryError('WORKER_ADMISSION_DISABLE_FAILED')
    monkeypatch.setattr(module, 'disable_worker_admission', unreadable_policy)
    recovery = ready_recovery(tmp_path, module)
    recovery.override = lambda *args: pytest.fail('override written before admission-control preflight')
    recovery.compose = lambda *args: pytest.fail('worker started before admission-control preflight')
    with pytest.raises(module.RecoveryError, match='WORKER_ADMISSION_DISABLE_FAILED'):
        recovery.recover()


def test_rejected_source_preflight_preserves_existing_worker_admission(tmp_path, monkeypatch):
    import pytest
    module = recovery_module()
    calls = []
    monkeypatch.setattr(module, 'disable_worker_admission', lambda: calls.append('disabled'))
    recovery = ready_recovery(tmp_path, module)
    def stale():
        raise module.RecoveryError('WORKER_BACKUP_STALE')
    recovery.match_report_backup = stale
    with pytest.raises(module.RecoveryError, match='WORKER_BACKUP_STALE'):
        recovery.recover()
    assert calls == []

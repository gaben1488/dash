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


def test_guard_installer_refuses_pending_receipt_before_overwriting_programs(tmp_path):
    private=tmp_path/'private';private.mkdir();(private/'pending-release.json').touch()
    source=(ROOT/'deploy/install-runtime-guard.sh').read_text().replace('/var/lib/aemr/pending-release.json',str(private/'pending-release.json')).replace('/var/lib/aemr/release-recovery-progress.json',str(private/'release-recovery-progress.json'))
    script=tmp_path/'installer.sh';script.write_text(source)
    (tmp_path/'maintenance-lock.sh').write_text((ROOT/'deploy/maintenance-lock.sh').read_text())
    install=tmp_path/'install';install.write_text('#!/bin/sh\necho mutation >> "$CALL_LOG"\nexit 19\n');install.chmod(0o755)
    log=tmp_path/'calls'
    result=subprocess.run(['bash',str(script)],env={**os.environ,'PATH':str(tmp_path)+os.pathsep+os.environ['PATH'],'CALL_LOG':str(log)},capture_output=True,text=True,check=False)
    assert result.returncode!=0
    assert 'RUNTIME_GUARD_RELEASE_PENDING' in result.stderr
    assert not log.exists()


def test_guard_installer_validates_volume_before_any_program_install(tmp_path):
    install=tmp_path/'install';install.write_text('#!/bin/sh\necho mutation >> "$CALL_LOG"\nexit 19\n');install.chmod(0o755)
    docker=tmp_path/'docker';docker.write_text('#!/bin/sh\ncat <<\'JSON\'\n[{"Name":"foreign"}]\nJSON\n');docker.chmod(0o755)
    log=tmp_path/'calls'
    result=subprocess.run(['bash',str(ROOT/'deploy/install-runtime-guard.sh')],env={**os.environ,'PATH':str(tmp_path)+os.pathsep+os.environ['PATH'],'CALL_LOG':str(log)},capture_output=True,text=True,check=False)
    assert result.returncode!=0
    assert 'RUNTIME_GUARD_VOLUME_INVALID' in result.stderr
    assert 'Traceback' not in result.stderr
    assert not log.exists()


def isolated_guard_installer(tmp_path, *, real_compose=False):
    """Real installer/EX/atomic files; every host path and daemon command private."""
    import shutil
    source = tmp_path / 'source' / 'deploy'
    source.mkdir(parents=True)
    host = tmp_path / 'host'
    policy_dir = host / 'etc/aemr'
    policy_dir.mkdir(parents=True, mode=0o700)
    (host / 'etc/systemd/system').mkdir(parents=True)
    volume = host / 'volumes/aemr_server_data/_data'
    volume.mkdir(parents=True)
    tools = host / 'libexec'
    tools.mkdir()
    (tools / 'runtime_guard.py').write_text('previous reviewed program')
    for path in (ROOT / 'deploy').rglob('*'):
        if path.is_file() and '__pycache__' not in path.parts:
            target = source / path.relative_to(ROOT / 'deploy')
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
    gate = source.parent / '.github/ci/source_ci_gate.py'
    gate.parent.mkdir(parents=True)
    shutil.copyfile(ROOT / '.github/ci/source_ci_gate.py', gate)
    lock = tmp_path / 'maintenance.lock'
    helper = (source / 'maintenance-lock.sh').read_text().replace('/run/lock/aemr-maintenance.lock', str(lock))
    (source / 'maintenance-lock.sh').write_text(helper)
    replacements = {'/usr/local/libexec/aemr': str(tools), '/var/lib/aemr': str(host / 'state'),
                    '/etc/aemr': str(policy_dir), '/etc/systemd/system': str(host / 'etc/systemd/system'),
                    '/etc/tmpfiles.d': str(host / 'etc/tmpfiles.d'), '/var/lib/docker/volumes': str(host / 'volumes'),
                    '/home/aemr/.dash-private-backups': str(host / 'backups')}
    script = (source / 'install-runtime-guard.sh').read_text()
    for before, after in replacements.items():
        script = script.replace(before, after)
    (source / 'install-runtime-guard.sh').write_text(script)
    commands = tmp_path / 'commands'
    commands.mkdir()
    calls = tmp_path / 'calls'
    docker = commands / 'docker'
    docker.write_text("""#!/usr/bin/env python3
import json,os,sys
with open(os.environ['CALL_LOG'],'a') as file:file.write('DOCKER\\n')
if sys.argv[1:3]==['volume','inspect']:
 print(json.dumps([{'Name':'aemr_server_data','Driver':'local','Options':None,'Mountpoint':os.environ['PRIVATE_VOLUME'],
  'Labels':{'com.docker.compose.project':'aemr','com.docker.compose.volume':'server_data'}}]))
elif os.environ.get('PRIVATE_COMPOSE_DOCKER'):
 os.execv(os.environ['PRIVATE_COMPOSE_DOCKER'],[os.environ['PRIVATE_COMPOSE_DOCKER'],*sys.argv[1:]])
else:print(json.dumps({'services':{s:{'mem_limit':134217728} for s in ('server','web','report-worker','caddy')}}))
""")
    docker.chmod(0o700)
    for name in ('systemctl', 'systemd-analyze', 'systemd-tmpfiles'):
        command = commands / name
        command.write_text('#!/bin/sh\nprintf "SYSTEMD\\n" >> "$CALL_LOG"\n')
        command.chmod(0o700)
    operator = tmp_path / 'operator'
    operator.mkdir()
    (operator / '.env.production').write_text('PRIVATE_FIXTURE=1')
    if real_compose:
        shutil.copyfile(ROOT / 'deploy/docker-compose.yml', operator / 'docker-compose.yml')
    else:
        (operator / 'docker-compose.yml').write_text('fixture compose')
    def run():
        return subprocess.run(['bash', str(source / 'install-runtime-guard.sh'), str(operator)], cwd=operator,
            capture_output=True, text=True, timeout=15, check=False,
            env={**os.environ, 'PATH': str(commands) + os.pathsep + os.environ['PATH'],
                 'CALL_LOG': str(calls), 'PRIVATE_VOLUME': str(volume),
                 'PRIVATE_COMPOSE_DOCKER': shutil.which('docker') if real_compose else ''})
    return run, policy_dir / 'runtime-policy.json', tools, calls


def installer_root_namespace(test_name):
    """Exercise actual root ownership in ordinary non-root pytest runs too."""
    if os.geteuid() == 0:
        return False
    import sys
    result = subprocess.run(['unshare', '-Ur', sys.executable, '-m', 'pytest',
                             str(Path(__file__).resolve()) + '::' + test_name, '-q'],
                            capture_output=True, text=True, timeout=45, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    return True


def test_guard_installer_private_policy_preserves_every_approved_field_and_caps(tmp_path):
    if installer_root_namespace(test_guard_installer_private_policy_preserves_every_approved_field_and_caps.__name__):
        return
    import json
    run, policy, tools, _calls = isolated_guard_installer(tmp_path)
    approved = json.loads((ROOT / 'deploy/runtime-policy.json').read_text())
    approved.update(worker_enabled=True, failure_threshold=9, cooldown_seconds=987, operator_note='PRIVATE_APPROVAL')
    approved['services']['server']['limits'] = {'mem_limit': 123456789, 'cpus': 0.75, 'pids_limit': 50}
    body = json.dumps(approved, indent=3).encode()
    policy.write_bytes(body)
    policy.chmod(0o600)
    inode = policy.stat().st_ino
    result = run()
    assert result.returncode == 0, result.stderr
    assert policy.read_bytes() == body
    assert policy.stat().st_ino == inode
    assert (tools / 'runtime_guard.py').read_bytes() == (ROOT / 'deploy/runtime_guard.py').read_bytes()
    assert 'PRIVATE_APPROVAL' not in result.stdout + result.stderr


def test_guard_installer_private_policy_new_install_uses_reviewed_defaults(tmp_path):
    if installer_root_namespace(test_guard_installer_private_policy_new_install_uses_reviewed_defaults.__name__):
        return
    import json
    run, policy, _tools, _calls = isolated_guard_installer(tmp_path)
    result = run()
    assert result.returncode == 0, result.stderr
    value = json.loads(policy.read_bytes())
    assert value['worker_enabled'] is False
    assert value['services']['server']['limits']['mem_limit'] == 134217728
    assert policy.stat().st_uid == 0 and policy.stat().st_mode & 0o777 == 0o600


def test_guard_installer_private_policy_preserves_actual_compose_limits_and_legacy_cpu_string(tmp_path):
    if installer_root_namespace(test_guard_installer_private_policy_preserves_actual_compose_limits_and_legacy_cpu_string.__name__):
        return
    import json
    run, policy, _tools, _calls = isolated_guard_installer(tmp_path, real_compose=True)
    created = run()
    assert created.returncode == 0, created.stderr
    value = json.loads(policy.read_bytes())
    assert float(value['services']['server']['limits']['cpus']) == 1.75
    assert float(value['services']['report-worker']['limits']['cpus']) == 1
    for legacy in (False, True):
        if legacy:
            for item in value['services'].values():
                item['limits']['cpus'] = str(item['limits']['cpus'])
            value['services']['server']['limits'].update(memswap_limit='-1', pids_limit='-1')
            policy.write_text(json.dumps(value))
        body, before = policy.read_bytes(), policy.stat()
        preserved = run()
        assert preserved.returncode == 0, (legacy, preserved.stderr)
        assert policy.read_bytes() == body
        assert policy.stat().st_ino == before.st_ino
        assert policy.stat().st_mode == before.st_mode
        assert policy.stat().st_uid == before.st_uid


def test_guard_installer_private_policy_ignores_operator_python_module_shadowing(tmp_path):
    if installer_root_namespace(test_guard_installer_private_policy_ignores_operator_python_module_shadowing.__name__):
        return
    run, policy, _tools, _calls = isolated_guard_installer(tmp_path)
    marker = tmp_path / 'untrusted-import'
    shadow = tmp_path / 'operator/json.py'
    shadow.write_text('import os\nfrom pathlib import Path\nPath(' + repr(str(marker))
                      + ').write_text(str(os.geteuid()))\nraise RuntimeError("PRIVATE_UNTRUSTED_MODULE")\n')
    result = run()
    assert result.returncode == 0, result.stderr
    assert not marker.exists()
    assert policy.exists()
    assert 'PRIVATE_' not in result.stdout + result.stderr


def test_guard_installer_private_policy_invalid_prior_blocks_program_overwrite(tmp_path):
    if installer_root_namespace(test_guard_installer_private_policy_invalid_prior_blocks_program_overwrite.__name__):
        return
    import json
    approved = json.loads((ROOT / 'deploy/runtime-policy.json').read_text())
    for case in ('malformed', 'symlink', 'hardlink', 'public', 'foreign', 'identity', 'worker', 'threshold', 'cooldown', 'limits',
                 'cpus_bool', 'cpus_negative', 'cpus_string_negative', 'cpus_nan', 'cpus_inf', 'cpus_invalid',
                 'mem_bool', 'mem_negative', 'mem_fractional', 'mem_nan', 'mem_inf', 'swap_negative', 'pids_negative'):
        folder = tmp_path / case
        folder.mkdir()
        run, policy, tools, _calls = isolated_guard_installer(folder)
        value = json.loads(json.dumps(approved))
        if case == 'foreign':
            value['project'] = 'foreign'
        elif case == 'identity':
            value['services']['server']['container'] = 'foreign-container'
        elif case == 'worker':
            value['worker_enabled'] = 'true'
        elif case == 'threshold':
            value['failure_threshold'] = 0
        elif case == 'cooldown':
            value['cooldown_seconds'] = -1
        elif case == 'limits':
            value['services']['server']['limits'] = {'mem_limit': 'PRIVATE_INVALID_CAP'}
        elif case.startswith('cpus_'):
            value['services']['server']['limits'] = {'cpus': {
                'cpus_bool': True, 'cpus_negative': -1, 'cpus_string_negative': '-1',
                'cpus_nan': 'NaN', 'cpus_inf': 'Infinity', 'cpus_invalid': 'PRIVATE_INVALID_CAP',
            }[case]}
        elif case.startswith(('mem_', 'swap_', 'pids_')):
            key = 'memswap_limit' if case == 'swap_negative' else 'pids_limit' if case == 'pids_negative' else 'mem_limit'
            cap = {'mem_bool': True, 'mem_negative': '-1', 'mem_fractional': '1.5', 'mem_nan': 'NaN',
                   'mem_inf': 'Infinity', 'swap_negative': '-2', 'pids_negative': '-2'}[case]
            value['services']['server']['limits'] = {key: cap}
        policy.write_text('{PRIVATE_INVALID' if case == 'malformed' else json.dumps(value))
        policy.chmod(0o644 if case == 'public' else 0o600)
        if case in ('symlink', 'hardlink'):
            original = policy.with_name('approved.json')
            policy.rename(original)
            if case == 'symlink':
                policy.symlink_to(original)
            else:
                os.link(original, policy)
        result = run()
        assert result.returncode != 0, case
        assert 'RUNTIME_GUARD_POLICY_INVALID' in result.stderr, (case, result.stderr)
        assert (tools / 'runtime_guard.py').read_text() == 'previous reviewed program', case
        assert 'PRIVATE_' not in result.stdout + result.stderr


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


def backup_guardian_fixture(tmp_path):
    """Exercise the real recovery script and captured record, not a stale shell ABI."""
    import json
    session = tmp_path / 'private/worker-1'
    session.mkdir(parents=True)
    repo = tmp_path / 'repo'
    (repo / 'deploy').mkdir(parents=True)
    (session / 'maintenance-lock.sh').write_text((ROOT / 'deploy/maintenance-lock.sh').read_text())
    (session / 'recovery-window.sh').write_text((ROOT / 'deploy/report-backup-window.sh').read_text())
    (session / 'runtime.json').write_text(json.dumps({
        'candidate': 'd' * 40, 'server': 'a' * 64, 'worker': 'b' * 64,
        'volume': 'synthetic_data', 'image': 'sha256:' + 'c' * 64,
        'worker_image': 'sha256:' + 'e' * 64,
        'worker_was_running': False, 'authorized_quiesce': False,
    }))
    (session / 'quiescent').touch()
    # Keep the prepare caller alive while testing a later deadline independently.
    (session / 'prepared').touch()
    args = ['watchdog', str(session), 'a' * 64, str(session), 'd' * 40,
            '1', str(repo), str(session.parent), '', str(os.getpid())]
    return session, args


def test_backup_guardian_holds_lock_across_caller_exit_and_releases_on_resume(tmp_path):
    import fcntl
    import time
    script = (ROOT / 'deploy/report-backup-window.sh').read_text()
    body = script.split("  nohup bash -c '", 1)[1].split("  ' watchdog", 1)[0]
    session, args = backup_guardian_fixture(tmp_path)
    guardian = subprocess.Popen(['bash', '-c', body, *args],
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            if (session / 'guardian-ready').exists():
                break
            time.sleep(.02)
        assert (session / 'guardian-ready').exists()
        with open('/run/lock/aemr-maintenance.lock', 'a') as contender:
            try:
                fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                pass
            else:
                raise AssertionError('guardian did not retain EX lock')
        (session / 'quiescent').unlink()
        assert guardian.wait(timeout=5) == 0
        with open('/run/lock/aemr-maintenance.lock', 'a') as contender:
            fcntl.flock(contender, fcntl.LOCK_EX | fcntl.LOCK_NB)
    finally:
        if guardian.poll() is None:
            guardian.terminate()
            guardian.wait(timeout=5)


def test_backup_watchdog_restarts_only_original_server_before_unlock(tmp_path):
    import json
    script = (ROOT / 'deploy/report-backup-window.sh').read_text()
    body = script.split("  nohup bash -c '", 1)[1].split("  ' watchdog", 1)[0].replace('SECONDS + 1800', 'SECONDS + 0')
    docker = tmp_path / 'docker'
    docker.write_text('''#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['CALL_LOG'],'a') as log:log.write(json.dumps(args)+'\\n')
if args[0]=='compose':print(('a' if args[-1]=='server' else 'b')*64)
elif args[0]=='inspect':
    fmt=args[2]
    if '.State.Health' in fmt:print('healthy')
    elif '.State.Status' in fmt:print('running' if args[-1]=='a'*64 else 'exited')
    elif '.Image' in fmt:print('sha256:'+('c' if args[-1]=='a'*64 else 'e')*64)
    else:print('synthetic_data')
''')
    docker.chmod(0o755)
    session, args = backup_guardian_fixture(tmp_path)
    guardian = subprocess.Popen(['bash', '-c', body, *args],
        env={**os.environ, 'PATH': str(tmp_path) + os.pathsep + os.environ['PATH'], 'CALL_LOG': str(tmp_path / 'calls')},
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    try:
        assert guardian.wait(timeout=5) == 0
        calls = [json.loads(line) for line in (tmp_path / 'calls').read_text().splitlines()]
        assert [call for call in calls if call[0] == 'start'] == [['start', 'a' * 64]]
        assert not (session / 'quiescent').exists()
        assert subprocess.run(['flock', '-n', '/run/lock/aemr-maintenance.lock', 'true'], check=False).returncode == 0
    finally:
        if guardian.poll() is None:
            guardian.terminate()
            guardian.wait(timeout=5)


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

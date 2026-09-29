import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def run_deploy(tmp_path, *, fail=False, running=False):
    docker = tmp_path / 'docker'
    docker.write_text('''#!/usr/bin/env python3
import os,sys
with open(os.environ['CALL_LOG'],'a') as f:f.write(' '.join(sys.argv[1:])+'\\n')
if os.environ.get('FAIL_RUN')=='1' and 'run-google' in ' '.join(sys.argv):sys.exit(2)
if 'ps' in sys.argv and os.environ.get('WAS_RUNNING')=='1':print('existing-worker')
''')
    docker.chmod(0o755)
    log = tmp_path / 'calls'
    result = subprocess.run(['bash', str(ROOT / 'deploy/enable-reports.sh')],
        cwd=tmp_path, env={**os.environ, 'PATH': str(tmp_path) + os.pathsep + os.environ['PATH'],
                         'CALL_LOG': str(log), 'FAIL_RUN': '1' if fail else '0',
                         'WAS_RUNNING':'1' if running else '0'}, capture_output=True, text=True, check=False)
    return result, log.read_text() if log.exists() else ''


def test_schedule_starts_only_after_private_bootstrap_and_successful_run(tmp_path):
    result, log = run_deploy(tmp_path)
    assert result.returncode == 0
    assert log.index('bootstrap-google') < log.index('run-google') < log.index('up -d report-worker')
    assert 'preflight.log' in log
    assert result.stdout == ''


def test_failed_preflight_never_enables_schedule(tmp_path):
    result, log = run_deploy(tmp_path, fail=True)
    assert result.returncode != 0
    assert 'run-google' in log
    assert 'up -d report-worker' not in log
    assert 'start report-worker' not in log


def test_failed_update_restores_previously_running_worker_and_preserves_failure(tmp_path):
    result,log=run_deploy(tmp_path,fail=True,running=True)
    assert result.returncode==2
    assert log.index('run-google')<log.index('start report-worker')
    assert 'up -d report-worker' not in log

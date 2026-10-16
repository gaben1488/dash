"""Recover the original successful trial receipt; never deploy or touch app data."""
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

SHA = '43f10742c274777dc5b8e0ac5b7c97d0a78cf6fa'
RUN = '38821521319'
TOOLS = Path('/usr/local/libexec/aemr')
RUNTIME = Path('/var/lib/aemr/release-runtime')


def owned(path, *, private=True, limit=1024*1024):
    assert not any(p.is_symlink() for p in (path, *path.parents))
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        info = os.fstat(stream.fileno())
        assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and info.st_size <= limit
        assert stat.S_IMODE(info.st_mode) == 0o600 if private else not info.st_mode & 0o022
        return stream.read(limit + 1)


def recover_under_lock(lock_fd):
    assert os.geteuid() == 0
    sys.dont_write_bytecode = True
    window = json.loads(owned(Path('/home/aemr/.dash-private-backups') / ('worker-' + RUN) / 'release-window.json'))
    names = {'release-controller.py', 'release_recovery.py', 'release_trial.py', 'stateful_backup.py', 'source_ci_gate.py'}
    assert window['candidate'] == SHA and window['run_id'] == RUN and set(window['module_sha256']) == names
    for name, pin in window['module_sha256'].items():
        assert re.fullmatch('[a-f0-9]{64}', pin) and hashlib.sha256(owned(TOOLS / name, private=False)).hexdigest() == pin
    sys.path.insert(0, str(TOOLS))
    import importlib.util

    import release_recovery as r
    spec = importlib.util.spec_from_file_location('release_controller', TOOLS / 'release-controller.py')
    controller_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(controller_module)
    r.require_lock(lock_fd)
    plan = r.validate_plan(json.loads(r.read_owned(RUNTIME / 'trial-plan.json')))
    assert plan['release_sha'] == SHA and plan['backup_reference'] == 'worker-' + RUN + '/backup'
    assert not any(os.path.lexists(r.STATE_DIR / name) for name in ('pending-release.json', 'release-recovery-progress.json'))

    payload = b'{"synthetic_transport_probe":true}'
    with tempfile.TemporaryDirectory(prefix='aemr-proof-transport-', dir='/var/lib/aemr') as directory:
        root = Path(directory)
        target = root / 'install.json'
        result = subprocess.run(['install', '-m', '600', '/dev/stdin', str(target)], input=payload, capture_output=True, timeout=10, check=False)
        install_equal = target.is_file() and target.read_bytes() == payload
        # The replacement reads fd0 itself and reuses the existing fsync+replace writer.
        writer = "import json,sys;sys.dont_write_bytecode=True;sys.path.insert(0,'/usr/local/libexec/aemr');import release_recovery as r;body=sys.stdin.buffer.read(1048577);assert len(body)<=1048576;json.loads(body);r.atomic_bytes(r.Path(sys.argv[1]),body)"
        direct = root / 'direct.json'
        copied = subprocess.run([sys.executable, '-IB', '-c', writer, str(direct)], input=payload, capture_output=True, timeout=10, check=False)
        direct_equal = copied.returncode == 0 and direct.is_file() and direct.read_bytes() == payload and stat.S_IMODE(direct.stat().st_mode) == 0o600
        print(json.dumps({'synthetic_transport_probe': True, 'install_returncode': result.returncode, 'install_byte_equal': install_equal, 'direct_fd0_byte_equal_mode600': direct_equal}), flush=True)
        assert direct_equal

    logs = json.loads(owned(Path('/root/codex-fixes') / ('release-' + RUN) / 'runner-diagnostics.json', private=False, limit=8*1024*1024))
    detail = json.loads(logs['trial-diagnostic.log'])
    assert detail['state'] == 'FROZEN_TRIAL_REPLAY_PASS' and detail['phase'] == 'complete' and detail['process_failures'] == []
    proof = detail['proof']
    assert proof['release_sha'] == SHA and proof['manifest_sha256'] == plan['manifest_sha256']
    target = RUNTIME / 'trial-proof.json'
    prior = r.read_owned(target)
    r.atomic_json(target, proof)
    try:
        controller_module.ReleaseController(r.ReleaseRecovery(lock_fd=None))._proof(plan)
        assert json.loads(r.read_owned(target)) == proof
    except Exception:
        r.atomic_bytes(target, prior)
        raise
    print(json.dumps({'state': 'ORIGINAL_TRIAL_RECEIPT_RECOVERED', 'release_sha': SHA,
                      'full_restore': proof['full_restore'], 'in_place_restore': proof['in_place_restore'],
                      'proof_sha256': r.digest(r.read_owned(target)), 'deployment_performed': False}), flush=True)


def main():
    import fcntl
    assert os.geteuid() == 0
    path = Path('/run/lock/aemr-maintenance.lock')
    with os.fdopen(os.open(path, os.O_RDWR | os.O_NOFOLLOW), 'r+') as lock:
        # Existing inode only, fail closed if another operation owns the window.
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        recover_under_lock(lock.fileno())


if __name__ == '__main__':
    try:
        main()
    except Exception:  # noqa: BLE001 - private failure details never enter public logs
        print('ORIGINAL_TRIAL_RECEIPT_RECOVERY_FAILED', file=sys.stderr)
        raise SystemExit(2) from None

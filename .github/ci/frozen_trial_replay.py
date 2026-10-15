"""Transparent diagnostics for the original frozen trial on an ephemeral runner.

Never called on the VPS. Actual trial code, images, archive and native programs
are unchanged. Only failed subprocess outputs and Python phase names are observed.
"""
import json
import os
import subprocess
import sys
import traceback
from pathlib import Path
from unittest.mock import patch

PHASES = {'check_source_ci', '_files', '_images', 'restore_state', '_validated_backup',
          '_validate_archive_content', '_restore_compressed', 'inventory',
          'verify_restored_documents_and_sqlite', 'native_environment'}
CODES = {'RELEASE_COMMAND_FAILED', 'RELEASE_NATIVE_TRIAL_FAILED', 'RELEASE_SOURCE_CI_INVALID',
         'RELEASE_OWNED_FILE_INVALID', 'RELEASE_CONFIG_CHANGED', 'RELEASE_TOOL_CHANGED',
         'RELEASE_CHECKPOINT_CHANGED', 'RELEASE_WORD_PROOF_INVALID', 'RELEASE_TRIAL_IMAGE_UNAVAILABLE',
         'BACKUP_MISMATCH', 'BACKUP_SQLITE_INVALID', 'BACKUP_DOCX_INVALID', 'BACKUP_STATE_INCOMPLETE',
         'BACKUP_STORAGE_INSUFFICIENT', 'BACKUP_UNSAFE_FILE', 'BACKUP_MANIFEST_INVALID'}


def diagnose(trial, plan):
    result = {'state': 'FROZEN_TRIAL_REPLAY_FAILED', 'phase': 'entry', 'process_failures': []}
    original_run, original_profile = subprocess.run, sys.getprofile()
    def profile(frame, event, arg):
        if (event == 'call' and frame.f_code.co_name in PHASES
                and Path(frame.f_code.co_filename).name in {'stateful_backup.py', 'release_recovery.py', 'release_trial.py'}):
            result['phase'] = frame.f_code.co_name
    def captured(*args, **kwargs):
        value = original_run(*args, **kwargs)
        if value.returncode:
            def bounded(body):
                return body[-65536:].decode('utf-8', errors='replace') if isinstance(body, bytes) else (body or '')[-65536:]
            result['process_failures'].append({'returncode': value.returncode, 'stdout': bounded(value.stdout), 'stderr': bounded(value.stderr)})
            result['process_failures'] = result['process_failures'][-8:]
        return value
    try:
        sys.setprofile(profile)
        with patch('subprocess.run', captured):
            result['proof'] = trial.run(plan)
        result.update(state='FROZEN_TRIAL_REPLAY_PASS', phase='complete')
    except Exception as error:  # noqa: BLE001 - errors remain in the private diagnostic receipt
        result.update(error_code=str(error) if str(error) in CODES else 'FROZEN_REPLAY_FAILED',
                      exception_type=type(error).__name__, private_trace=traceback.format_exc(limit=20),
                      frames=[{'file': Path(frame.filename).name, 'line': frame.lineno, 'function': frame.name}
                              for frame in traceback.extract_tb(error.__traceback__)[-8:]])
    finally:
        sys.setprofile(original_profile)
    return result


def public_summary(result):
    value = {key: result[key] for key in ('state', 'phase', 'error_code', 'exception_type', 'frames') if key in result}
    if result['state'] == 'FROZEN_TRIAL_REPLAY_PASS':
        value.update({key: result['proof']['full_restore'][key] for key in ('sqlite_checked', 'docx_checked')})
    return value


def main():
    assert os.geteuid() == 0 and os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_OS') == 'Linux'
    os.umask(0o077)
    sys.dont_write_bytecode = True
    sys.path.insert(0, '/usr/local/libexec/aemr')
    import release_recovery as r
    import release_trial
    plan = json.loads(r.read_owned(r.RUNTIME_DIR / 'trial-plan.json'))
    result = diagnose(release_trial.ReleaseTrial(), plan)
    target = Path(sys.argv[1])
    with target.open('x', encoding='utf-8') as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(result, stream)
    print(json.dumps(public_summary(result)))
    return 0 if result['state'] == 'FROZEN_TRIAL_REPLAY_PASS' else 2


if __name__ == '__main__':
    raise SystemExit(main())
